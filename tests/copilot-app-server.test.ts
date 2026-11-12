import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A scripted stand-in for the Codex App Server child, so the lifecycle in
// `copilot.ts` runs without spawning anything or touching the real state
// directory under /tmp.

type Request = { id: number; method: string; params: Record<string, unknown> };
type Script = (request: Request, server: FakeServer) => void;

class FakeServer extends EventEmitter {
	stdin = new PassThrough();
	stdout = new PassThrough();
	stderr = new PassThrough();
	requests: Request[] = [];
	killed = false;
	constructor(private script: Script) {
		super();
		let buffer = "";
		this.stdin.on("data", (chunk: Buffer) => {
			buffer += chunk.toString();
			let index = buffer.indexOf("\n");
			while (index !== -1) {
				const line = buffer.slice(0, index);
				buffer = buffer.slice(index + 1);
				index = buffer.indexOf("\n");
				const message = JSON.parse(line) as Partial<Request>;
				if (typeof message.id !== "number" || !message.method) continue;
				const request = message as Request;
				this.requests.push(request);
				if (request.method === "initialize") {
					if (!holdInitialize) this.reply(request.id, {});
				} else if (request.method === "account/login/start" && holdLoginStart) {
					// Released explicitly by the concurrent-login test.
				} else this.script(request, this);
			}
		});
	}
	reply(id: number, result: unknown) {
		this.stdout.write(`${JSON.stringify({ id, result })}\n`);
	}
	fail(id: number, message: string) {
		this.stdout.write(`${JSON.stringify({ id, error: { message } })}\n`);
	}
	notify(method: string, params: Record<string, unknown>) {
		this.stdout.write(`${JSON.stringify({ method, params })}\n`);
	}
	kill() {
		this.killed = true;
		this.emit("exit", null, "SIGTERM");
	}
}

const children: FakeServer[] = [];
let script: Script = () => undefined;
let holdInitialize = false;
let holdLoginStart = false;
const advisoryLocks = new Set<string>();
const dbState = vi.hoisted(() => ({
	connection: null as Record<string, unknown> | null,
	forcePersistConflict: false,
	failConnectionRead: false,
	updateCalls: 0,
}));
const fileState = vi.hoisted(() => ({
	holdStateRemoval: false,
	stateRemovalStarted: false,
	releaseStateRemoval: null as (() => void) | null,
	events: [] as string[],
	authFileContents: '{"tokens":"opaque-test-value"}',
	storedAuthContents: '{"tokens":"opaque-test-value"}',
}));

vi.mock("node:child_process", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:child_process")>()),
	spawn: vi.fn(() => {
		fileState.events.push("spawn");
		const child = new FakeServer((request, server) => script(request, server));
		children.push(child);
		return child;
	}),
}));
vi.mock("node:fs", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:fs")>()),
	existsSync: () => true,
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:fs/promises")>()),
	mkdir: vi.fn(async () => undefined),
	readFile: vi.fn(async () => Buffer.from(fileState.authFileContents)),
	rm: vi.fn(async (path: string) => {
		if (path === "/tmp/fortuna-copilot-codex" && fileState.holdStateRemoval) {
			fileState.stateRemovalStarted = true;
			await new Promise<void>((resolve) => {
				fileState.releaseStateRemoval = resolve;
			});
			fileState.holdStateRemoval = false;
			fileState.stateRemovalStarted = false;
		}
		fileState.events.push(`rm:${path}`);
	}),
	writeFile: vi.fn(async (path: string) => {
		fileState.events.push(`write:${path}`);
	}),
}));
vi.mock("@/server/crypto", () => ({
	decryptSecret: (ciphertext: string) =>
		ciphertext.startsWith("test:")
			? Buffer.from(ciphertext.slice(5), "base64").toString("utf8")
			: fileState.storedAuthContents,
	encryptSecret: (value: string) =>
		`test:${Buffer.from(value, "utf8").toString("base64")}`,
}));
vi.mock("@/server/db", () => ({
	pool: {
		connect: async () => ({
			query: async (statement: string, values: string[]) => {
				const key = values[0];
				if (statement.includes("pg_try_advisory_lock")) {
					if (advisoryLocks.has(key)) return { rows: [{ acquired: false }] };
					advisoryLocks.add(key);
					return { rows: [{ acquired: true }] };
				}
				if (statement.includes("pg_advisory_unlock")) advisoryLocks.delete(key);
				if (statement.includes("pg_advisory_lock")) advisoryLocks.add(key);
				return { rows: [] };
			},
			release: () => undefined,
		}),
	},
	db: {
		query: {
			externalConnections: {
				findFirst: async () => {
					if (dbState.failConnectionRead)
						throw new Error("database unavailable");
					return dbState.connection;
				},
			},
			copilotThreads: { findFirst: async () => undefined },
		},
		insert: () => {
			let values: Record<string, unknown>;
			return {
				values(input: Record<string, unknown>) {
					values = input;
					return this;
				},
				onConflictDoUpdate({ set }: { set: Record<string, unknown> }) {
					const current = dbState.connection;
					const generation = current
						? (current.copilotAuthGeneration as bigint) + 1n
						: ((values.copilotAuthGeneration as bigint | undefined) ?? 1n);
					dbState.connection = {
						...values,
						...set,
						copilotAuthGeneration: generation,
						updatedAt: new Date(),
					};
					return this;
				},
			};
		},
		update: () => {
			dbState.updateCalls += 1;
			let values: Record<string, unknown>;
			return {
				set(input: Record<string, unknown>) {
					values = input;
					return this;
				},
				where() {
					return {
						returning: async () => {
							const current = dbState.connection;
							if (
								!current ||
								dbState.forcePersistConflict ||
								current.status === "disconnected"
							)
								return [];
							Object.assign(current, values);
							return [
								{
									copilotAuthGeneration: current.copilotAuthGeneration,
									encryptedSecret: current.encryptedSecret as string | null,
								},
							];
						},
					};
				},
			};
		},
		delete: () => ({ where: async () => undefined }),
	},
}));

const {
	FAILED_TURN_MESSAGE,
	disconnectCopilot,
	getCopilotStatus,
	isolatedTurn,
	resetCopilotChat,
	startCopilotLogin,
	verifyCopilotAuthGeneration,
} = await import("@/server/services/copilot");
const { CopilotOperationBusyError, withCopilotOperationLock } = await import(
	"@/server/services/copilot-operation-lock"
);

function encodedAuth(value: string) {
	return `test:${Buffer.from(value, "utf8").toString("base64")}`;
}

function decodeTestPrompt(ciphertext: string) {
	if (!ciphertext.startsWith("test:"))
		throw new Error("unexpected test ciphertext");
	return JSON.parse(
		Buffer.from(ciphertext.slice(5), "base64").toString("utf8"),
	) as {
		loginId: string;
		verificationUrl: string;
		userCode: string;
	};
}

/** Answers like a signed-out App Server that completes every turn. */
function answering(text: string, status = "completed"): Script {
	return (request, server) => {
		if (request.method === "account/read")
			server.reply(request.id, { account: null });
		if (request.method === "thread/start")
			server.reply(request.id, { thread: { id: "thread-1" } });
		if (request.method === "turn/start") {
			server.reply(request.id, { turn: { id: "turn-1" } });
			setTimeout(() => {
				server.notify("item/completed", {
					threadId: request.params.threadId,
					item: { type: "agentMessage", text },
				});
				server.notify("turn/completed", {
					threadId: request.params.threadId,
					turn: {
						status,
						error:
							status === "failed"
								? {
										message:
											'unexpected status 401 Unauthorized: {"detail":"secret provider body"}',
									}
								: undefined,
					},
				});
			}, 5);
		}
	};
}

beforeEach(async () => {
	advisoryLocks.clear();
	holdInitialize = false;
	holdLoginStart = false;
	fileState.holdStateRemoval = false;
	fileState.stateRemovalStarted = false;
	fileState.releaseStateRemoval = null;
	fileState.events.length = 0;
	fileState.authFileContents = '{"tokens":"opaque-test-value"}';
	fileState.storedAuthContents = '{"tokens":"opaque-test-value"}';
	dbState.connection = null;
	dbState.forcePersistConflict = false;
	dbState.failConnectionRead = false;
	dbState.updateCalls = 0;
	script = (request, server) => {
		if (request.method === "account/logout") server.reply(request.id, {});
	};
	await disconnectCopilot("owner");
	dbState.connection = null;
	children.length = 0;
});
afterEach(() => {
	holdInitialize = false;
	holdLoginStart = false;
	script = () => undefined;
});

describe("Copilot App Server lifecycle", () => {
	it("starts a new App Server after the old one exited", async () => {
		script = answering("{}");
		expect(await getCopilotStatus("owner")).toMatchObject({
			available: true,
		});
		children[0].kill();
		// A dead child used to be handed out again, so every later request
		// failed with "nicht verfügbar" until the process restarted.
		expect(await getCopilotStatus("owner")).toMatchObject({
			available: true,
		});
		expect(children).toHaveLength(2);
	});

	it("claims the owner before starting the thread, so two turns cannot overlap", async () => {
		script = answering('{"ok":true}');
		const first = isolatedTurn("owner", { instructions: "x", prompt: "a" });
		const second = isolatedTurn("owner", { instructions: "x", prompt: "b" });
		await expect(second).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(first).resolves.toEqual({
			threadId: "thread-1",
			text: '{"ok":true}',
		});
		// Released again once the turn is over.
		await expect(
			isolatedTurn("owner", { instructions: "x", prompt: "c" }),
		).resolves.toMatchObject({ threadId: "thread-1" });
	});

	it("rejects a turn held by another process through the shared advisory lock", async () => {
		let release!: () => void;
		const otherProcess = withCopilotOperationLock(
			"owner",
			() => new Promise<void>((resolve) => (release = resolve)),
		);
		await vi.waitFor(() => expect(advisoryLocks.size).toBe(1));
		await expect(
			isolatedTurn("owner", { instructions: "x", prompt: "another turn" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(resetCopilotChat("owner")).rejects.toMatchObject({
			code: "CONFLICT",
		});
		await expect(disconnectCopilot("owner")).resolves.toBeUndefined();
		expect(dbState.connection).toMatchObject({ status: "disconnected" });
		release();
		await otherProcess;
	});

	it("interrupts a local turn before resetting its thread", async () => {
		script = (request, server) => {
			if (request.method === "account/read")
				server.reply(request.id, { account: null });
			if (request.method === "thread/start")
				server.reply(request.id, { thread: { id: "thread-1" } });
			if (request.method === "turn/start")
				server.reply(request.id, { turn: { id: "turn-1" } });
			if (request.method === "turn/interrupt") {
				server.reply(request.id, {});
				server.notify("turn/completed", {
					threadId: "thread-1",
					turn: { status: "interrupted" },
				});
			}
		};
		const turn = isolatedTurn("owner", { instructions: "x", prompt: "a" });
		await vi.waitFor(() =>
			expect(
				children[0]?.requests.some(
					(request) => request.method === "turn/start",
				),
			).toBe(true),
		);
		await expect(resetCopilotChat("owner")).resolves.toBeUndefined();
		await expect(turn).rejects.toThrow("Herr Körner hat nicht geantwortet");
		expect(
			children[0]?.requests.some(
				(request) => request.method === "turn/interrupt",
			),
		).toBe(true);
	});

	it("does not let a stale status callback restore auth after disconnect", async () => {
		dbState.connection = {
			userId: "owner",
			provider: "openai-chatgpt",
			status: "active",
			encryptedSecret: "encrypted-before-test",
			copilotAuthGeneration: 10n,
		};
		script = (request, server) => {
			if (request.method === "account/read") {
				dbState.connection = {
					...dbState.connection,
					status: "disconnected",
					encryptedSecret: null,
					copilotAuthGeneration: 11n,
				};
				server.reply(request.id, {
					account: { type: "chatgpt", email: "owner@example.test" },
				});
			}
		};
		await expect(getCopilotStatus("owner")).resolves.toMatchObject({
			available: true,
			connected: false,
		});
		expect(dbState.connection).toMatchObject({
			status: "disconnected",
			copilotAuthGeneration: 11n,
		});
		expect(children[0]?.killed).toBe(true);
	});

	it("interrupts an in-flight local turn when the generation is revoked", async () => {
		dbState.connection = {
			userId: "owner",
			provider: "openai-chatgpt",
			status: "active",
			encryptedSecret: "encrypted-before-test",
			copilotAuthGeneration: 20n,
		};
		script = (request, server) => {
			if (request.method === "account/read")
				server.reply(request.id, { account: null });
			if (request.method === "thread/start")
				server.reply(request.id, { thread: { id: "thread-1" } });
			if (request.method === "turn/start")
				server.reply(request.id, { turn: { id: "turn-1" } });
			if (request.method === "turn/interrupt") server.reply(request.id, {});
		};
		const turn = isolatedTurn("owner", { instructions: "x", prompt: "a" });
		await vi.waitFor(() =>
			expect(
				children[0]?.requests.some(
					(request) => request.method === "turn/start",
				),
			).toBe(true),
		);
		dbState.connection = {
			...dbState.connection,
			status: "disconnected",
			encryptedSecret: null,
			copilotAuthGeneration: 21n,
		};
		await expect(verifyCopilotAuthGeneration()).resolves.toBe("revoked");
		await expect(turn).rejects.toThrow("Herr Körner hat nicht geantwortet");
		expect(
			children[0]?.requests.some(
				(request) => request.method === "turn/interrupt",
			),
		).toBe(true);
		expect(children[0]?.killed).toBe(true);
	});

	it("fails closed on DB read errors and interrupts the local turn", async () => {
		dbState.connection = {
			userId: "owner",
			provider: "openai-chatgpt",
			status: "active",
			encryptedSecret: "encrypted-before-test",
			copilotAuthGeneration: 25n,
		};
		script = (request, server) => {
			if (request.method === "account/read")
				server.reply(request.id, { account: null });
			if (request.method === "thread/start")
				server.reply(request.id, { thread: { id: "thread-1" } });
			if (request.method === "turn/start")
				server.reply(request.id, { turn: { id: "turn-1" } });
			if (request.method === "turn/interrupt") server.reply(request.id, {});
		};
		const turn = isolatedTurn("owner", { instructions: "x", prompt: "a" });
		await vi.waitFor(() =>
			expect(
				children[0]?.requests.some(
					(request) => request.method === "turn/start",
				),
			).toBe(true),
		);
		dbState.failConnectionRead = true;
		await expect(verifyCopilotAuthGeneration()).resolves.toBe(
			"database_unavailable",
		);
		await expect(turn).rejects.toThrow("Herr Körner hat nicht geantwortet");
		expect(
			children[0]?.requests.some(
				(request) => request.method === "turn/interrupt",
			),
		).toBe(true);
		expect(children[0]?.killed).toBe(true);
	});

	it("disconnects across pods even while another pod holds the turn lock", async () => {
		dbState.connection = {
			userId: "owner",
			provider: "openai-chatgpt",
			status: "active",
			encryptedSecret: "encrypted-before-test",
			copilotAuthGeneration: 30n,
		};
		let release!: () => void;
		const remoteTurn = withCopilotOperationLock(
			"owner",
			() => new Promise<void>((resolve) => (release = resolve)),
		);
		await vi.waitFor(() => expect(advisoryLocks.size).toBe(1));
		await expect(disconnectCopilot("owner")).resolves.toBeUndefined();
		expect(dbState.connection).toMatchObject({
			status: "disconnected",
			copilotAuthGeneration: 31n,
		});
		release();
		await remoteTurn;
	});

	it("starts a fresh login generation after disconnect", async () => {
		dbState.connection = {
			userId: "owner",
			provider: "openai-chatgpt",
			status: "disconnected",
			encryptedSecret: null,
			copilotAuthGeneration: 40n,
		};
		script = (request, server) => {
			if (request.method === "account/login/start")
				server.reply(request.id, {
					type: "chatgptDeviceCode",
					loginId: "test-login",
					verificationUrl: "https://example.test/device",
					userCode: "TEST-CODE",
				});
		};
		await expect(startCopilotLogin("owner")).resolves.toMatchObject({
			alreadyConnected: false,
			loginId: "test-login",
		});
		expect(dbState.connection).toMatchObject({
			status: "pending",
			copilotAuthGeneration: 41n,
		});
		expect(
			decodeTestPrompt(dbState.connection?.encryptedSecret as string),
		).toMatchObject({ loginId: "test-login", userCode: "TEST-CODE" });
	});

	it("persists device-code completion on the App Server that started login", async () => {
		script = (request, server) => {
			if (request.method === "account/login/start")
				server.reply(request.id, {
					type: "chatgptDeviceCode",
					loginId: "worker-login",
					verificationUrl: "https://example.test/device",
					userCode: "WORKER-CODE",
				});
			if (request.method === "account/read")
				server.reply(request.id, {
					account: { type: "chatgpt", email: "owner@example.test" },
				});
		};
		fileState.authFileContents = '{"tokens":"device-login-auth"}';
		const started = await startCopilotLogin("owner");
		if (started.alreadyConnected) throw new Error("login unexpectedly skipped");
		const promptCipher = dbState.connection?.encryptedSecret;
		expect(typeof promptCipher).toBe("string");
		expect(promptCipher).not.toContain("WORKER-CODE");
		children[0].notify("account/login/completed", {
			loginId: started.loginId,
			success: true,
			error: null,
		});
		await vi.waitFor(() => expect(dbState.connection?.status).toBe("active"));
		expect(dbState.connection?.encryptedSecret).toBe(
			encodedAuth(fileState.authFileContents),
		);
		expect(dbState.connection?.copilotAuthGeneration).toBe(1n);
		await expect(verifyCopilotAuthGeneration()).resolves.toBe("current");
		expect(children[0]?.killed).toBe(false);
	});

	it("reuses the current encrypted login prompt instead of replacing a live flow", async () => {
		let loginStarts = 0;
		script = (request, server) => {
			if (request.method === "account/login/start") {
				loginStarts += 1;
				server.reply(request.id, {
					type: "chatgptDeviceCode",
					loginId: "reused-login",
					verificationUrl: "https://example.test/device",
					userCode: "REUSED-CODE",
				});
			}
		};
		holdLoginStart = true;
		const firstRequest = startCopilotLogin("owner");
		await vi.waitFor(() =>
			expect(
				children[0]?.requests.some(
					(request) => request.method === "account/login/start",
				),
			).toBe(true),
		);
		const pendingGeneration = dbState.connection?.copilotAuthGeneration;
		await expect(startCopilotLogin("owner")).rejects.toBeInstanceOf(
			CopilotOperationBusyError,
		);
		expect(dbState.connection?.copilotAuthGeneration).toBe(pendingGeneration);
		holdLoginStart = false;
		const startRequest = children[0]?.requests.find(
			(request) => request.method === "account/login/start",
		);
		if (!startRequest) throw new Error("login start request missing");
		loginStarts += 1;
		children[0].reply(startRequest.id, {
			type: "chatgptDeviceCode",
			loginId: "reused-login",
			verificationUrl: "https://example.test/device",
			userCode: "REUSED-CODE",
		});
		const first = await firstRequest;
		if (first.alreadyConnected) throw new Error("login unexpectedly skipped");
		const firstGeneration = dbState.connection?.copilotAuthGeneration;
		const second = await startCopilotLogin("owner");
		expect(second).toEqual(first);
		expect(dbState.connection?.copilotAuthGeneration).toBe(firstGeneration);
		expect(loginStarts).toBe(1);
		expect(children).toHaveLength(1);
	});

	it("replaces an expired login lease and ignores its late completion", async () => {
		let loginStarts = 0;
		script = (request, server) => {
			if (request.method === "account/login/start") {
				loginStarts += 1;
				server.reply(request.id, {
					type: "chatgptDeviceCode",
					loginId: `expired-login-${loginStarts}`,
					verificationUrl: "https://example.test/device",
					userCode: `CODE-${loginStarts}`,
				});
			}
		};
		const first = await startCopilotLogin("owner");
		if (first.alreadyConnected) throw new Error("login unexpectedly skipped");
		const oldChild = children[0];
		const currentConnection = dbState.connection;
		if (!currentConnection) throw new Error("login connection missing");
		const oldGeneration = currentConnection.copilotAuthGeneration as bigint;
		currentConnection.lastAttemptedSyncAt = new Date(Date.now() - 60_000);
		const second = await startCopilotLogin("owner");
		if (second.alreadyConnected)
			throw new Error("second login unexpectedly skipped");
		expect(second.loginId).toBe("expired-login-2");
		expect(dbState.connection?.copilotAuthGeneration).toBe(oldGeneration + 1n);
		oldChild.notify("account/login/completed", {
			loginId: first.loginId,
			success: true,
			error: null,
		});
		await Promise.resolve();
		expect(dbState.connection).toMatchObject({
			status: "pending",
			copilotAuthGeneration: oldGeneration + 1n,
		});
		expect(
			decodeTestPrompt(dbState.connection?.encryptedSecret as string),
		).toMatchObject({
			loginId: second.loginId,
		});
	});

	it("fences device-code completion after disconnect", async () => {
		script = (request, server) => {
			if (request.method === "account/login/start")
				server.reply(request.id, {
					type: "chatgptDeviceCode",
					loginId: "revoked-login",
					verificationUrl: "https://example.test/device",
					userCode: "REVOKED-CODE",
				});
			if (request.method === "account/read")
				server.reply(request.id, {
					account: { type: "chatgpt", email: "owner@example.test" },
				});
		};
		const started = await startCopilotLogin("owner");
		if (started.alreadyConnected) throw new Error("login unexpectedly skipped");
		const child = children[0];
		await disconnectCopilot("owner");
		child.notify("account/login/completed", {
			loginId: "revoked-login",
			success: true,
			error: null,
		});
		await Promise.resolve();
		expect(dbState.connection).toMatchObject({
			status: "disconnected",
			encryptedSecret: null,
		});
		expect(child.killed).toBe(true);
	});

	it("serializes old state cleanup before a newer login child starts", async () => {
		dbState.connection = {
			userId: "owner",
			provider: "openai-chatgpt",
			status: "active",
			encryptedSecret: "encrypted-before-test",
			copilotAuthGeneration: 42n,
		};
		script = (request, server) => {
			if (request.method === "account/read")
				server.reply(request.id, { account: null });
			if (request.method === "account/login/start")
				server.reply(request.id, {
					type: "chatgptDeviceCode",
					loginId: "next-login",
					verificationUrl: "https://example.test/device",
					userCode: "NEXT-CODE",
				});
		};
		await getCopilotStatus("owner");
		fileState.holdStateRemoval = true;
		const disconnect = disconnectCopilot("owner");
		await vi.waitFor(() => expect(fileState.stateRemovalStarted).toBe(true));
		const login = startCopilotLogin("owner");
		await vi.waitFor(() => expect(dbState.connection?.status).toBe("pending"));
		// The second generation is registered, but its child waits behind the
		// old generation's serialized CODEX_HOME cleanup.
		expect(children).toHaveLength(1);
		fileState.holdStateRemoval = false;
		fileState.releaseStateRemoval?.();
		await disconnect;
		await expect(login).resolves.toMatchObject({ loginId: "next-login" });
		expect(children).toHaveLength(2);
		const newSpawn = fileState.events.lastIndexOf("spawn");
		const stateRemovals = fileState.events
			.map((event, index) => ({ event, index }))
			.filter(({ event }) => event.startsWith("rm:/tmp/fortuna-copilot-codex"));
		expect(stateRemovals.length).toBeGreaterThan(0);
		expect(stateRemovals.at(-1)?.index).toBeLessThan(newSpawn);
	});

	it("stops a child whose startup overlaps a committed revocation", async () => {
		dbState.connection = {
			userId: "owner",
			provider: "openai-chatgpt",
			status: "active",
			encryptedSecret: "encrypted-before-test",
			copilotAuthGeneration: 45n,
		};
		holdInitialize = true;
		const status = getCopilotStatus("owner");
		await vi.waitFor(() =>
			expect(
				children[0]?.requests.some(
					(request) => request.method === "initialize",
				),
			).toBe(true),
		);
		dbState.connection = {
			...dbState.connection,
			status: "disconnected",
			encryptedSecret: null,
			copilotAuthGeneration: 46n,
		};
		await vi.waitFor(() => expect(children[0]?.killed).toBe(true), {
			timeout: 7_000,
			interval: 50,
		});
		await expect(status).resolves.toMatchObject({
			available: true,
			connected: false,
		});
		expect(children[0]?.killed).toBe(true);
		expect(
			children[0]?.requests.some((request) => request.method === "initialize"),
		).toBe(true);
	});

	it("keeps the generation stable during normal token refresh", async () => {
		dbState.connection = {
			userId: "owner",
			provider: "openai-chatgpt",
			status: "active",
			encryptedSecret: "encrypted-before-test",
			copilotAuthGeneration: 50n,
		};
		fileState.authFileContents = '{"tokens":"rotated-test-value"}';
		script = (request, server) => {
			if (request.method === "account/read")
				server.reply(request.id, {
					account: { type: "chatgpt", email: "owner@example.test" },
				});
		};
		await expect(getCopilotStatus("owner")).resolves.toMatchObject({
			connected: true,
		});
		await expect(verifyCopilotAuthGeneration()).resolves.toBe("current");
		expect(dbState.connection).toMatchObject({
			status: "active",
			copilotAuthGeneration: 50n,
			encryptedSecret: encodedAuth(fileState.authFileContents),
		});
		expect(dbState.updateCalls).toBe(1);
		expect(children).toHaveLength(1);
		expect(children[0]?.killed).toBe(false);
	});

	it("reuses stored ciphertext for semantically unchanged auth JSON", async () => {
		dbState.connection = {
			userId: "owner",
			provider: "openai-chatgpt",
			status: "active",
			encryptedSecret: "encrypted-before-test",
			copilotAuthGeneration: 51n,
		};
		fileState.authFileContents = ' { "tokens" : "opaque-test-value" } ';
		script = (request, server) => {
			if (request.method === "account/read")
				server.reply(request.id, {
					account: { type: "chatgpt", email: "owner@example.test" },
				});
		};
		await expect(getCopilotStatus("owner")).resolves.toMatchObject({
			connected: true,
		});
		expect(dbState.connection).toMatchObject({
			copilotAuthGeneration: 51n,
			encryptedSecret: "encrypted-before-test",
		});
		expect(dbState.updateCalls).toBe(0);
		await expect(verifyCopilotAuthGeneration()).resolves.toBe("current");
		expect(children[0]?.killed).toBe(false);
	});

	it("does not let a stale pod overwrite another pod's token rotation", async () => {
		dbState.connection = {
			userId: "owner",
			provider: "openai-chatgpt",
			status: "active",
			encryptedSecret: "ciphertext-from-pod-a",
			copilotAuthGeneration: 55n,
		};
		script = (request, server) => {
			if (request.method === "account/read") {
				// Another pod persisted a refreshed auth file while this pod was
				// waiting for its account/read response.
				dbState.connection = {
					...dbState.connection,
					encryptedSecret: "ciphertext-rotated-by-pod-b",
				};
				server.reply(request.id, {
					account: { type: "chatgpt", email: "owner@example.test" },
				});
			}
		};
		await expect(getCopilotStatus("owner")).resolves.toMatchObject({
			available: true,
			connected: false,
		});
		expect(dbState.connection).toMatchObject({
			status: "active",
			encryptedSecret: "ciphertext-rotated-by-pod-b",
			copilotAuthGeneration: 55n,
		});
		expect(dbState.updateCalls).toBe(0);
		expect(children[0]?.killed).toBe(true);
	});

	it("releases the claim when the thread cannot be started", async () => {
		script = (request, server) => {
			if (request.method === "thread/start")
				server.fail(request.id, "upstream said: secret provider body");
		};
		const failed = isolatedTurn("owner", { instructions: "x", prompt: "a" });
		await expect(failed).rejects.toThrow("thread/start");
		await expect(failed).rejects.not.toThrow("secret");
		script = answering("{}");
		await expect(
			isolatedTurn("owner", { instructions: "x", prompt: "b" }),
		).resolves.toMatchObject({ text: "{}" });
	});

	it("never passes the provider's error text on from a failed turn", async () => {
		script = answering("", "failed");
		const failed = isolatedTurn("owner", { instructions: "x", prompt: "a" });
		await expect(failed).rejects.toThrow(FAILED_TURN_MESSAGE);
		await expect(failed).rejects.not.toThrow("secret");
	});
});
