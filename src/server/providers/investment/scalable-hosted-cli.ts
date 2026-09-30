import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type ScalableCliAuthFiles = { session: string; signingKey: string };

/**
 * The exit statuses `sc capabilities --json` publishes. 20 is the one that
 * matters: the session is gone and only a new login brings it back.
 */
const EXIT_STATUS: Record<number, string> = {
	10: "VALIDATION_ERROR",
	20: "AUTH_OR_CONFIG_ERROR",
	30: "NETWORK_OR_BACKEND_ERROR",
};
const AUTH_EXIT_STATUS = 20;
/** Scalable refused the request as Fortuna phrased it. */
export const VALIDATION_EXIT_STATUS = 10;

/**
 * A failed CLI read, described by a code that can be logged and shown: the
 * exit status, a timeout, an oversized answer, a broken envelope, or the
 * envelope's own error code when it is a plain identifier. Never the
 * message — stderr and provider messages may carry account details.
 */
export class ScalableCliError extends Error {
	constructor(
		readonly code: string,
		message = "Scalable CLI-Leseaufruf fehlgeschlagen",
		readonly exitStatus: number | null = null,
	) {
		super(message);
	}
	/** Whether the failure points at a session the owner has to renew. */
	get needsLogin(): boolean {
		return (
			this.exitStatus === AUTH_EXIT_STATUS ||
			/AUTH|SESSION|TOKEN|LOGIN|EXPIRED|FORBIDDEN|UNAUTHORIZED/.test(this.code)
		);
	}
}

/** The code for a failed exit: the envelope's own reason, else the status's published name. */
export function exitErrorCode(
	status: number | null,
	envelope: unknown,
): string {
	const detail = envelopeErrorCode(envelope);
	if (detail) return `CLI_ERROR_${detail}`;
	if (status === null) return "CLI_EXIT_SIGNAL";
	const name = EXIT_STATUS[status];
	return name ? `CLI_${name}` : `CLI_EXIT_${status}`;
}

// The CLI answers in snake_case (`refresh_relogin_required`); older
// envelopes and other tools shout. Either is a bare identifier; mixed case,
// spaces or punctuation could be prose and are refused.
const ENVELOPE_CODE = /^(?:[A-Z][A-Z0-9_]{2,39}|[a-z][a-z0-9_]{2,39})$/;

/** The envelope's error code, if it is a bare identifier; nothing else is read. */
export function envelopeErrorCode(envelope: unknown): string | null {
	if (!envelope || typeof envelope !== "object") return null;
	const body = envelope as { error?: unknown; code?: unknown };
	const error =
		body.error && typeof body.error === "object"
			? (body.error as { code?: unknown; type?: unknown })
			: null;
	for (const candidate of [error?.code, error?.type, body.code]) {
		if (typeof candidate === "string" && ENVELOPE_CODE.test(candidate))
			return candidate.toUpperCase();
	}
	return null;
}
export type DevicePrompt = { url: string; code: string; expiresAt: number };
type PendingLogin = {
	process: ReturnType<typeof spawn>;
	prompt: DevicePrompt | null;
	startedAt: number;
};

const pending = new Map<string, PendingLogin>();
const MAX_STDOUT = 4 * 1024 * 1024;
const CONFIG =
	'[auth]\nsession_backend = "file"\nsigning_key_backend = "file"\n\n[trade_controls]\nallowed_isins = []\n';

function cliPath(): string {
	return process.env.NODE_ENV === "production"
		? "/usr/local/bin/sc"
		: (process.env.FORTUNA_SCALABLE_CLI_BIN ?? "/usr/local/bin/sc");
}

function safeEnv(configRoot: string): NodeJS.ProcessEnv {
	return {
		PATH: "/usr/local/bin:/usr/bin:/bin",
		XDG_CONFIG_HOME: configRoot,
		LANG: "C.UTF-8",
		TERM: "dumb",
	};
}

function tempRoot(): string {
	// Production credentials must exist only on a memory-backed filesystem.
	return process.env.NODE_ENV === "production" ? "/dev/shm" : tmpdir();
}

async function workspace(auth?: ScalableCliAuthFiles, config = CONFIG) {
	const root = await mkdtemp(join(tempRoot(), "fortuna-scalable-"));
	try {
		const configDir = join(root, "scalable-cli");
		await mkdir(configDir, { mode: 0o700 });
		await writeFile(join(configDir, "config.toml"), config, { mode: 0o600 });
		if (auth) {
			await writeFile(join(configDir, "session.json"), auth.session, {
				mode: 0o600,
			});
			await writeFile(
				join(configDir, "auth-signing-key.json"),
				auth.signingKey,
				{ mode: 0o600 },
			);
		}
		return { root, configDir, env: safeEnv(root) };
	} catch (error) {
		await rm(root, { recursive: true, force: true });
		throw error;
	}
}

async function readAuthFiles(configDir: string): Promise<ScalableCliAuthFiles> {
	const [session, signingKey] = await Promise.all([
		readFile(join(configDir, "session.json"), "utf8"),
		readFile(join(configDir, "auth-signing-key.json"), "utf8"),
	]);
	if (session.length > 256_000 || signingKey.length > 16_000)
		throw new Error("Scalable session is too large");
	const parsedSession = JSON.parse(session) as {
		session?: { access_token?: unknown; refresh_token?: unknown };
	};
	const parsedKey = JSON.parse(signingKey) as {
		kty?: unknown;
		crv?: unknown;
		d?: unknown;
	};
	if (
		typeof parsedSession.session?.access_token !== "string" ||
		(parsedSession.session.refresh_token !== null &&
			parsedSession.session.refresh_token !== undefined &&
			typeof parsedSession.session.refresh_token !== "string") ||
		parsedKey.kty !== "EC" ||
		parsedKey.crv !== "P-256" ||
		typeof parsedKey.d !== "string"
	) {
		throw new Error("Scalable session files are invalid");
	}
	return { session, signingKey };
}

/** Parse only Scalable's fixed device prompt, never expose stdout or tokens. */
export function parseScalableDevicePrompt(
	output: string,
	now = Date.now(),
): DevicePrompt | null {
	const urlText = output.match(/Open this URL:\s*(https:\/\/[^\s]+)/u)?.[1];
	const code = output.match(
		/Verify the code ([A-Z0-9-]{4,32}) in your browser/u,
	)?.[1];
	if (!urlText || !code) return null;
	const url = new URL(urlText);
	if (
		url.protocol !== "https:" ||
		!(
			url.hostname === "scalable.capital" ||
			url.hostname.endsWith(".scalable.capital")
		)
	)
		return null;
	return { url: url.toString(), code, expiresAt: now + 10 * 60_000 };
}

/**
 * A login in progress, per slot. The read connection uses the user id; the
 * separate trading login uses `tradingLoginSlot(userId)`, so the two device
 * flows never share or cancel each other's process.
 */
export function pendingScalableLogin(slot: string): DevicePrompt | null {
	return pending.get(slot)?.prompt ?? null;
}

export function tradingLoginSlot(userId: string): string {
	return `${userId}:trading`;
}

export async function beginScalableDeviceLogin(
	slot: string,
	onComplete: (auth: ScalableCliAuthFiles) => Promise<void>,
	onFailure: () => Promise<void>,
	options: { readOnly?: boolean } = {},
): Promise<DevicePrompt> {
	// Every read connection logs in read-only. Only the trading login, which
	// the owner starts on purpose, may hold a session that can place orders.
	const readOnly = options.readOnly ?? true;
	const userId = slot;
	const existing = pending.get(userId);
	if (existing) {
		if (existing.prompt) return existing.prompt;
		throw new Error("Scalable-Anmeldung läuft bereits");
	}
	const files = await workspace();
	const child = spawn(
		cliPath(),
		readOnly ? ["login", "--local-read-only"] : ["login"],
		{
			env: files.env,
			cwd: files.root,
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	const state: PendingLogin = {
		process: child,
		prompt: null,
		startedAt: Date.now(),
	};
	pending.set(userId, state);
	let stdout = "";
	let settled = false;
	let resolvePrompt: (prompt: DevicePrompt) => void = () => undefined;
	let rejectPrompt: (error: Error) => void = () => undefined;
	const promptPromise = new Promise<DevicePrompt>((resolve, reject) => {
		resolvePrompt = resolve;
		rejectPrompt = reject;
	});
	const timeout = setTimeout(() => child.kill(), 11 * 60_000);
	const promptTimeout = setTimeout(() => {
		if (!settled) {
			settled = true;
			rejectPrompt(new Error("Scalable CLI hat keinen Anmeldecode geliefert"));
			child.kill();
		}
	}, 20_000);
	child.stdout.on("data", (chunk: Buffer) => {
		stdout += chunk.toString("utf8");
		if (stdout.length > 16_000) {
			child.kill();
			return;
		}
		const prompt = parseScalableDevicePrompt(stdout);
		if (prompt && !settled) {
			settled = true;
			clearTimeout(promptTimeout);
			state.prompt = prompt;
			resolvePrompt(prompt);
		}
	});
	// stderr may contain provider details. Drain it without recording or logging.
	child.stderr.resume();
	child.once("error", () => {
		if (!settled) {
			settled = true;
			rejectPrompt(
				new Error("Scalable CLI ist auf dem Server nicht verfügbar"),
			);
		}
	});
	child.once("close", (code) => {
		clearTimeout(timeout);
		clearTimeout(promptTimeout);
		pending.delete(userId);
		if (!settled) {
			settled = true;
			rejectPrompt(
				new Error("Scalable-Anmeldung konnte nicht gestartet werden"),
			);
		}
		void (async () => {
			try {
				if (code !== 0) {
					await onFailure();
					return;
				}
				await onComplete(await readAuthFiles(files.configDir));
			} catch {
				await onFailure().catch(() => undefined);
			} finally {
				await rm(files.root, { recursive: true, force: true });
			}
		})();
	});
	return promptPromise;
}

export function cancelScalableDeviceLogin(userId: string): void {
	pending.get(userId)?.process.kill();
}

function allowedReadArgs(args: string[]): boolean {
	if (args[0] !== "broker") return false;
	if (["overview", "holdings", "cash-breakdown"].includes(args[1] ?? ""))
		return args.length === 2;
	if (
		args[1] !== "transactions" ||
		args[2] !== "--page-size" ||
		args[3] !== "100"
	)
		return false;
	return (
		args.length === 4 ||
		(args.length === 6 &&
			args[4] === "--cursor" &&
			args[5].length >= 1 &&
			args[5].length <= 512 &&
			[...args[5]].every(
				(char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) < 127,
			))
	);
}

async function readCommand(
	args: string[],
	env: NodeJS.ProcessEnv,
	cwd: string,
): Promise<unknown> {
	if (!allowedReadArgs(args))
		throw new Error("Scalable read allowlist rejected command");
	return runCommand(args, env, cwd, 30_000);
}

/**
 * Runs one CLI command that an allowlist has already accepted. Callers never
 * reach this without `allowedReadArgs` or `allowedTradeArgs` in front of it.
 */
function runCommand(
	args: string[],
	env: NodeJS.ProcessEnv,
	cwd: string,
	timeoutMs: number,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const child = spawn(cliPath(), [...args, "--json"], {
			env,
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, timeoutMs);
		child.stdout.on("data", (chunk: Buffer) => {
			output += chunk.toString("utf8");
			if (output.length > MAX_STDOUT) child.kill();
		});
		child.stderr.resume();
		child.once("error", () =>
			reject(
				new ScalableCliError(
					"CLI_NOT_FOUND",
					"Scalable CLI konnte nicht gestartet werden",
				),
			),
		);
		child.once("close", (code) => {
			clearTimeout(timeout);
			if (timedOut) {
				reject(new ScalableCliError("CLI_TIMEOUT"));
				return;
			}
			if (output.length > MAX_STDOUT) {
				reject(new ScalableCliError("CLI_OUTPUT_TOO_LARGE"));
				return;
			}
			let envelope: { ok?: unknown; data?: unknown } | null = null;
			try {
				envelope = JSON.parse(output) as { ok?: unknown; data?: unknown };
			} catch {
				envelope = null;
			}
			if (code !== 0) {
				// A failing command may still answer with a JSON envelope whose
				// error code says why; that code is the one thing worth keeping.
				reject(
					new ScalableCliError(exitErrorCode(code, envelope), undefined, code),
				);
				return;
			}
			if (envelope?.ok !== true || !envelope?.data) {
				const detail = envelopeErrorCode(envelope);
				reject(
					new ScalableCliError(
						detail ? `CLI_ERROR_${detail}` : "CLI_ENVELOPE_INVALID",
						"Scalable CLI-Antwort ist ungültig",
					),
				);
				return;
			}
			resolve(envelope.data);
		});
	});
}

/**
 * A command can refresh the session and then fail — a timeout on page three,
 * a backend error after the token call. The refreshed files are the only
 * valid ones once the old refresh token is spent, so a failed read still
 * stores them when they changed. Best effort: the command's own error is the
 * one that counts, and a session the CLI cleared is not worth keeping.
 */
async function keepRotatedSession(
	configDir: string,
	before: ScalableCliAuthFiles,
	onRefresh: (updated: ScalableCliAuthFiles) => Promise<void>,
): Promise<void> {
	try {
		const current = await readAuthFiles(configDir);
		if (
			current.session !== before.session ||
			current.signingKey !== before.signingKey
		)
			await onRefresh(current);
	} catch {
		// Unreadable or rejected session files: nothing worth storing.
	}
}

export async function readScalableBrokerSnapshot(
	auth: ScalableCliAuthFiles,
	onRefresh: (updated: ScalableCliAuthFiles) => Promise<void>,
) {
	const files = await workspace(auth);
	try {
		let stored = auth;
		const run = async (args: string[]) => {
			const response = await readCommand(args, files.env, files.root).catch(
				async (error: unknown) => {
					await keepRotatedSession(files.configDir, stored, onRefresh);
					throw error;
				},
			);
			const refreshed = await readAuthFiles(files.configDir);
			await onRefresh(refreshed);
			stored = refreshed;
			return response;
		};
		const overview = await run(["broker", "overview"]);
		const holdings = await run(["broker", "holdings"]);
		const cash = await run(["broker", "cash-breakdown"]);
		const transactions: unknown[] = [];
		const cursors = new Set<string>();
		let cursor: string | null = null;
		for (let page = 0; page < 100; page++) {
			const result = await run([
				"broker",
				"transactions",
				"--page-size",
				"100",
				...(cursor ? ["--cursor", cursor] : []),
			]);
			transactions.push(result);
			const next = (result as { result?: { cursor?: unknown } }).result?.cursor;
			if (typeof next !== "string" || !next) {
				cursor = null;
				break;
			}
			if (cursors.has(next))
				throw new Error("Scalable CLI-Paginierung wiederholt sich");
			cursors.add(next);
			cursor = next;
		}
		if (cursor)
			throw new Error(
				"Scalable CLI-Transaktionen überschreiten das Seitenlimit",
			);
		return { overview, holdings, cash, transactions };
	} finally {
		await rm(files.root, { recursive: true, force: true });
	}
}

/** One bounded official read. No trades, transaction scan or synthetic prices. */
export async function readScalableHoldingsPulse(
	auth: ScalableCliAuthFiles,
	onRefresh: (updated: ScalableCliAuthFiles) => Promise<void>,
) {
	const files = await workspace(auth);
	try {
		const response = await readCommand(
			["broker", "holdings"],
			files.env,
			files.root,
		).catch(async (error: unknown) => {
			await keepRotatedSession(files.configDir, auth, onRefresh);
			throw error;
		});
		await onRefresh(await readAuthFiles(files.configDir));
		return response;
	} finally {
		await rm(files.root, { recursive: true, force: true });
	}
}

/** Best-effort provider logout; caller must remove the local encrypted session regardless. */
export async function revokeScalableCliSession(
	auth: ScalableCliAuthFiles,
): Promise<void> {
	const files = await workspace(auth);
	try {
		await new Promise<void>((resolve, reject) => {
			const child = spawn(cliPath(), ["logout", "--json"], {
				env: files.env,
				cwd: files.root,
				stdio: ["ignore", "ignore", "ignore"],
			});
			const timeout = setTimeout(() => child.kill(), 20_000);
			child.once("error", () => reject(new Error("Scalable logout failed")));
			child.once("close", (code) => {
				clearTimeout(timeout);
				code === 0 ? resolve() : reject(new Error("Scalable logout failed"));
			});
		});
	} finally {
		await rm(files.root, { recursive: true, force: true });
	}
}

/**
 * Placing an order at Scalable — the owner's decision of 26.09.2026.
 *
 * The CLI's own two-phase flow: phase 1 previews the order and hands out a
 * confirmation id with the full pre-trade disclosure; phase 2 repeats the
 * identical arguments with `--confirm <id>` and submits it. Fortuna runs
 * phase 2 only from the owner's explicit confirmation after they have seen
 * phase 1 in full, never on its own and never from the Copilot or MCP.
 *
 * Every order runs in its own workspace whose trade controls allow exactly
 * that ISIN and, for a buy, exactly the confirmed amount (plus 1 % for the
 * CLI's rounding to whole cents of a fractional share). The read workspace
 * keeps `allowed_isins = []`, so a read session can never trade.
 */
export type TradeOrder =
	| { side: "buy"; isin: string; amountMinor: number }
	| { side: "sell"; isin: string; shares: number };

const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/** Minor units as the CLI's decimal amount, e.g. 123456 → "1234.56". */
export function cliAmount(minor: number): string {
	if (!Number.isSafeInteger(minor) || minor <= 0)
		throw new Error("Orderbetrag ist ungültig");
	return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

/** Shares as a plain decimal without exponent, at most eight places. */
export function cliShares(shares: number): string {
	if (!Number.isFinite(shares) || shares <= 0)
		throw new Error("Stückzahl ist ungültig");
	const text = shares.toFixed(8).replace(/\.?0+$/, "");
	if (text === "0") throw new Error("Stückzahl ist ungültig");
	return text;
}

/** The phase-1 arguments; phase 2 appends `--confirm <id>` to exactly these. */
export function tradeArgs(order: TradeOrder): string[] {
	if (!ISIN_PATTERN.test(order.isin)) throw new Error("ISIN ist ungültig");
	return order.side === "buy"
		? [
				"broker",
				"trade",
				"buy",
				"--isin",
				order.isin,
				"--amount",
				cliAmount(order.amountMinor),
				"--order-type",
				"market",
			]
		: [
				"broker",
				"trade",
				"sell",
				"--isin",
				order.isin,
				"--shares",
				cliShares(order.shares),
				"--order-type",
				"market",
			];
}

/** The config for one order's workspace: its ISIN only, its amount only. */
export function tradeConfig(order: TradeOrder): string {
	if (!ISIN_PATTERN.test(order.isin)) throw new Error("ISIN ist ungültig");
	const lines = [
		"[auth]",
		'session_backend = "file"',
		'signing_key_backend = "file"',
		"",
		"[trade_controls]",
		`allowed_isins = ["${order.isin}"]`,
	];
	if (order.side === "buy")
		// A string: the CLI refuses a TOML float here.
		lines.push(
			`max_order_notional = "${cliAmount(Math.ceil(order.amountMinor * 1.01))}"`,
		);
	return `${lines.join("\n")}\n`;
}

const CONFIRMATION_ID = /^[A-Za-z0-9_-]{4,128}$/;

/** Exactly the two phases of one market order, nothing else. */
export function allowedTradeArgs(args: string[]): boolean {
	const [broker, trade, side, isinFlag, isin, sizeFlag, size, typeFlag, type] =
		args;
	if (
		broker !== "broker" ||
		trade !== "trade" ||
		(side !== "buy" && side !== "sell") ||
		isinFlag !== "--isin" ||
		!ISIN_PATTERN.test(isin ?? "") ||
		typeFlag !== "--order-type" ||
		type !== "market"
	)
		return false;
	if (side === "buy") {
		if (sizeFlag !== "--amount" || !/^\d{1,12}\.\d{2}$/.test(size ?? ""))
			return false;
	} else if (
		sizeFlag !== "--shares" ||
		!/^\d{1,12}(\.\d{1,8})?$/.test(size ?? "")
	)
		return false;
	const rest = args.slice(9);
	if (rest.length === 0) return true;
	if (rest[0] !== "--confirm" || !CONFIRMATION_ID.test(rest[1] ?? ""))
		return false;
	if (rest.length === 2) return true;
	return (
		side === "buy" &&
		rest.length === 3 &&
		rest[2] === "--acknowledge-appropriateness-warning"
	);
}

export type TradeWorkspace = {
	root: string;
	configDir: string;
	env: NodeJS.ProcessEnv;
};

async function tradeCommand(
	ws: TradeWorkspace,
	args: string[],
): Promise<unknown> {
	if (!allowedTradeArgs(args))
		throw new Error("Scalable trade allowlist rejected command");
	return runCommand(args, ws.env, ws.root, 60_000);
}

/**
 * Phase 1. Returns the CLI's preview and the workspace that holds its
 * confirmation; the caller keeps the workspace until phase 2 or expiry and
 * must close it with `closeTradeWorkspace`.
 */
export async function previewScalableTrade(
	auth: ScalableCliAuthFiles,
	order: TradeOrder,
	onRefresh: (updated: ScalableCliAuthFiles) => Promise<void>,
): Promise<{ preview: unknown; workspace: TradeWorkspace }> {
	const ws = await workspace(auth, tradeConfig(order));
	try {
		const preview = await tradeCommand(ws, tradeArgs(order)).catch(
			async (error: unknown) => {
				await keepRotatedSession(ws.configDir, auth, onRefresh);
				throw error;
			},
		);
		await onRefresh(await readAuthFiles(ws.configDir));
		return { preview, workspace: ws };
	} catch (error) {
		await closeTradeWorkspace(ws);
		throw error;
	}
}

/**
 * Phase 2: the identical arguments plus the confirmation id. Always closes
 * the workspace; a confirmation is used at most once.
 */
export async function submitScalableTrade(
	ws: TradeWorkspace,
	order: TradeOrder,
	confirmationId: string,
	acknowledgeWarning: boolean,
	onRefresh: (updated: ScalableCliAuthFiles) => Promise<void>,
): Promise<unknown> {
	const before = await readAuthFiles(ws.configDir);
	try {
		const args = [...tradeArgs(order), "--confirm", confirmationId];
		if (acknowledgeWarning && order.side === "buy")
			args.push("--acknowledge-appropriateness-warning");
		const result = await tradeCommand(ws, args).catch(
			async (error: unknown) => {
				await keepRotatedSession(ws.configDir, before, onRefresh);
				throw error;
			},
		);
		await onRefresh(await readAuthFiles(ws.configDir));
		return result;
	} finally {
		await closeTradeWorkspace(ws);
	}
}

export async function closeTradeWorkspace(ws: TradeWorkspace): Promise<void> {
	await rm(ws.root, { recursive: true, force: true });
}
