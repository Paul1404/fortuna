import { createHash, randomUUID } from "node:crypto";
import {
	and,
	desc,
	eq,
	gte,
	ilike,
	inArray,
	isNull,
	ne,
	or,
	sql,
} from "drizzle-orm";
import { addDays, todayIso } from "@/domain/dates";
import { transactionFingerprint } from "@/domain/fingerprint";
import { parseDecimalToMinor } from "@/domain/money";
import { providerAccountName } from "@/domain/normalize";
import {
	type HeldRow,
	pendingReadFrom,
	unreportedPendingIds,
} from "@/domain/pending";
import { matchPaypalFunding } from "@/domain/transfers";
import { ACCOUNT_TYPE_LABELS } from "@/lib/labels";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { db } from "@/server/db";
import {
	type Account,
	accounts,
	type BankConnection,
	bankConnections,
	categories,
	importJobs,
	transactions,
} from "@/server/db/schema";
import { logger } from "@/server/logger";
import {
	authorizeEnableBankingSession,
	EnableBankingApiError,
	getEnableBankingAccountDetails,
	getEnableBankingBalances,
	getEnableBankingSession,
	getEnableBankingTransactions,
	getRequiredPsuHeaders,
	listInstitutions,
	startEnableBankingAuthorization,
} from "@/server/providers/bank/enable-banking-client";
import {
	type PsuPresence,
	psuHeadersFor,
} from "@/server/providers/bank/psu-presence";
import { recordBalance } from "./accounts";
import { loadEnableBankingCredential } from "./provider-credentials";
import { coalesceSync } from "./sync-coalescing";
import { alteredTextSince, insertTransactions } from "./transactions";

type ObjectValue = Record<string, unknown>;
type StoredSession = { sessionId: string; accountUids: string[] };
export const ENABLE_BANKING_RATE_LIMIT_RETRY_MS = 6 * 60 * 60 * 1_000;

function storedSession(encryptedSecret: string | null): StoredSession | null {
	if (!encryptedSecret) return null;
	try {
		const value = object(JSON.parse(decryptSecret(encryptedSecret)));
		const sessionId = text(value?.sessionId);
		const accountUids = Array.isArray(value?.accountUids)
			? value.accountUids.filter(
					(uid): uid is string => typeof uid === "string" && Boolean(uid),
				)
			: [];
		// A session with no account uids is still a granted consent: the uids can
		// be re-read from the provider, and discarding it would throw away an
		// approval the owner actually completed at their bank.
		return sessionId ? { sessionId, accountUids } : null;
	} catch {
		return null;
	}
}

/** A granted session that carries at least one account Fortuna can read. */
export function hasEnableBankingAccounts(
	encryptedSecret: string | null,
): boolean {
	return (storedSession(encryptedSecret)?.accountUids.length ?? 0) > 0;
}

export function hasEnableBankingSession(
	encryptedSecret: string | null,
): boolean {
	return storedSession(encryptedSecret) !== null;
}

/** Why a callback could not be completed, for the owner and for the log. */
export class EnableBankingAuthorizationError extends Error {
	constructor(
		readonly reason:
			| "connection_not_found"
			| "state_mismatch"
			| "credential_missing"
			| "session_rejected"
			| "no_accounts",
		message: string,
	) {
		super(message);
		this.name = "EnableBankingAuthorizationError";
	}
}

export class EnableBankingSyncError extends Error {
	constructor(
		readonly stage: string,
		cause: unknown,
	) {
		super("Bankabgleich fehlgeschlagen", { cause });
		this.name = "EnableBankingSyncError";
	}
}

function object(value: unknown): ObjectValue | null {
	return value && typeof value === "object" ? (value as ObjectValue) : null;
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nestedText(value: unknown, key: string): string | null {
	return text(object(value)?.[key]);
}

function normalizedIban(value: string | null): string | null {
	return value?.replace(/\s/g, "").toUpperCase() || null;
}

/**
 * The account's stable identity at the provider.
 *
 * An IBAN where there is one. A PayPal account has none — Enable Banking
 * reports it under `other` with scheme OTHI and the owner's email — and
 * matching on IBAN alone left such an account unrecognisable, so every consent
 * renewal created another one beside it, each counted again in net worth.
 */
/** One normalisation for both kinds of identifier. */
function sameRef(value: string | null | undefined): string | null {
	return value?.replace(/\s/g, "").toUpperCase() || null;
}

export function providerAccountRef(
	accountId: Record<string, unknown> | unknown,
): string | null {
	const identity = nestedText(accountId, "iban");
	if (identity) return normalizedIban(identity);
	const other = (accountId as Record<string, unknown> | null)?.other;
	const identification = nestedText(other, "identification");
	return identification?.trim().toLowerCase() || null;
}

// Enable Banking UIDs identify accounts only within one authorization session.
// Reuse an existing connected account when a renewed session reports the same
// stable reference.
export async function findEnableBankingAccount(
	userId: string,
	connection: BankConnection,
	uid: string,
	reference: string | null,
	currency: string,
): Promise<{ account: Account | null; superseded: boolean }> {
	const exact = await db.query.accounts.findFirst({
		where: and(
			eq(accounts.userId, userId),
			eq(accounts.bankConnectionId, connection.id),
			eq(accounts.providerAccountId, uid),
		),
	});
	if (exact) return { account: exact, superseded: false };
	// Both sides through the same normalisation: an IBAN arrives spaced or
	// lower-cased depending on the bank, and an email identifier is matched
	// case-insensitively too.
	const identity = sameRef(reference);
	if (!identity) return { account: null, superseded: false };
	// Accounts left behind by a removed connection keep their reference, so they
	// are candidates too; otherwise reconnecting would duplicate them in net
	// worth.
	const candidates = await db
		.select({ account: accounts, owner: bankConnections })
		.from(accounts)
		.leftJoin(
			bankConnections,
			and(
				eq(accounts.bankConnectionId, bankConnections.id),
				eq(bankConnections.provider, "enable-banking"),
			),
		)
		.where(
			and(
				eq(accounts.userId, userId),
				eq(accounts.currency, currency),
				or(
					isNull(accounts.bankConnectionId),
					eq(bankConnections.provider, "enable-banking"),
				),
			),
		);
	const matches = candidates.filter(
		({ account }) =>
			// The backfilled reference, or an IBAN on an account that predates it.
			sameRef(account.providerAccountRef ?? account.iban) === identity,
	);
	// More than one account already carries this reference, so which one the bank
	// means cannot be decided here. Creating another would add a third row whose
	// balance is counted alongside the others in net worth, so the account is
	// left alone and reported instead.
	if (matches.length > 1) {
		// The reference itself is an IBAN or an email and never goes to a log.
		logger.warn("Enable Banking account is ambiguous", {
			event: "enable_banking.account.ambiguous",
			candidates: matches.length,
		});
		return { account: null, superseded: true };
	}
	if (matches.length === 0) return { account: null, superseded: false };
	const { account, owner } = matches[0];
	if (owner && owner.createdAt > connection.createdAt) {
		return { account: null, superseded: true };
	}
	const [relinked] = await db
		.update(accounts)
		.set({
			bankConnectionId: connection.id,
			providerAccountId: uid,
			// Stamp it on a relink too, so an account that predates the column
			// stops depending on its IBAN from the next renewal onwards.
			providerAccountRef: identity,
			syncStatus: "synced",
		})
		.where(
			and(
				eq(accounts.id, account.id),
				owner
					? eq(accounts.bankConnectionId, owner.id)
					: isNull(accounts.bankConnectionId),
			),
		)
		.returning();
	return { account: relinked ?? null, superseded: !relinked };
}

/**
 * A session exposes its authorised accounts in two documented shapes: the
 * authorisation response carries `accounts` as account objects, while a session
 * read carries `accounts` as bare uid strings plus `accounts_data` objects.
 * Reading only one of them loses the account list for a perfectly valid consent.
 */
export function accountUids(payload: ObjectValue): string[] {
	const seen = new Set<string>();
	for (const key of ["accounts", "accounts_data"]) {
		const entries = payload[key];
		if (!Array.isArray(entries)) continue;
		for (const entry of entries) {
			const uid =
				typeof entry === "string" ? text(entry) : text(object(entry)?.uid);
			if (uid) seen.add(uid);
		}
	}
	return [...seen];
}

function accountType(
	value: unknown,
	institution?: string,
): "current" | "savings" | "credit_card" | "cash" | "wallet" {
	switch (text(value)) {
		case "SVGS":
			return "savings";
		case "CARD":
			return "credit_card";
		case "CASH":
			return "cash";
		default:
			// A payment service reports no cash account type Fortuna recognises,
			// so it fell through to "current" and the Konten page labelled PayPal
			// a Girokonto. Liquid all the same; only the word was wrong.
			return institution && /paypal|wise|revolut|n26 wallet/i.test(institution)
				? "wallet"
				: "current";
	}
}

/**
 * A balance Fortuna cannot read is reported as unknown rather than as zero.
 * Recording a guessed 0 would write a false fact into the balance history and,
 * because a balance dated today already covers today's bookings, would keep
 * every imported transaction from ever moving it.
 */
// ISO 20022 balance types, by how well each answers "what is in the account
// now". ITBD is the booked balance taken during the day. XPCD is booked entries
// plus known pending items, projecting the end of day, and so still excludes an
// overdraft line. CLBD is the close of the last reporting period, which stays
// stale for the whole of the following day — Deutsche Bank offers no ITBD, and
// preferring CLBD showed 0,00 € for an account that had just received money.
// The available balances rank last: they can include credit that is not money.
const BALANCE_TYPE_RANK = ["ITBD", "XPCD", "CLBD", "ITAV", "CLAV", "PRCD"];

function balanceRank(row: ObjectValue): number {
	const index = BALANCE_TYPE_RANK.indexOf(text(row.balance_type) ?? "");
	return index === -1 ? BALANCE_TYPE_RANK.length : index;
}

export function selectBankBalance(
	rows: ObjectValue[],
	fallbackCurrency: string,
) {
	const row = [...rows].sort((a, b) => {
		const byRank = balanceRank(a) - balanceRank(b);
		if (byRank !== 0) return byRank;
		// Same kind of balance: the more recent reference date wins.
		return (text(b.reference_date) ?? "").localeCompare(
			text(a.reference_date) ?? "",
		);
	})[0];
	const amount = object(row?.balance_amount);
	const raw = text(amount?.amount);
	return {
		minor: raw === null ? null : parseDecimalToMinor(raw),
		currency: text(amount?.currency) ?? fallbackCurrency,
		date:
			text(row?.reference_date) ??
			text(row?.last_change_date_time)?.slice(0, 10) ??
			todayIso(),
		// Safe to log: type names and presence flags, never the amount itself.
		diagnostics: {
			balanceTypes: rows
				.map((item) => text(item.balance_type) ?? "unnamed")
				.join(","),
			chosenType: text(row?.balance_type),
			hasAmount: raw !== null,
			hasReferenceDate: text(row?.reference_date) !== null,
		},
	};
}

/**
 * An ISO 20022 code is not a description.
 *
 * `bank_transaction_code.description` is sometimes a readable phrase and
 * sometimes the bare domain code — the Sparda returns "PMNT", which says
 * "payment" and nothing more. Shown as the booking text it makes a transaction
 * unfilable by the owner and by Hr. Körner alike, so a code is discarded and
 * the counterparty is used instead.
 */
function usefulText(value: string | null): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	// Four capitals and nothing else is an ISO code, never a purpose.
	if (/^[A-Z]{4}$/.test(trimmed)) return null;
	return trimmed;
}

export const NO_PURPOSE = "Ohne Verwendungszweck";

export function transactionDescription(
	row: ObjectValue,
	ownName?: string | null,
): string {
	const remittance = Array.isArray(row.remittance_information)
		? row.remittance_information.filter(
				(value): value is string => typeof value === "string" && Boolean(value),
			)
		: [];
	// The owner's own name is not a description either: it is what the bank
	// puts there when the booking has no counterparty at all.
	const other = (value: string | null) =>
		ownName && value?.trim().toLowerCase() === ownName ? null : value;
	return (
		usefulText(remittance.join(" · ")) ||
		usefulText(text(row.note)) ||
		usefulText(other(nestedText(row.creditor, "name"))) ||
		usefulText(other(nestedText(row.debtor, "name"))) ||
		usefulText(nestedText(row.bank_transaction_code, "description")) ||
		NO_PURPOSE
	);
}

function transactionExternalId(row: ObjectValue, accountId: string): string {
	const source = text(row.entry_reference) ?? text(row.transaction_id);
	if (source) return `enable-banking:${source}`;
	return `enable-banking:${createHash("sha256")
		.update(`${accountId}|${JSON.stringify(row)}`)
		.digest("hex")}`;
}

/**
 * Enable Banking's transaction status, mapped onto Fortuna's two states.
 *
 * The API knows more than booked and pending: CNCL (cancelled) and RJCT
 * (rejected) are payments that will never happen. Mapped to pending, a
 * rejected transfer entered the forecast as money about to leave and stayed
 * there. They are dropped; a held (HOLD), scheduled (SCHD) or otherwise
 * unfinished one is still expected and stays pending.
 */
export function transactionStatus(value: unknown): "booked" | "pending" | null {
	const status = text(value)?.toUpperCase() ?? null;
	if (status === "BOOK") return "booked";
	if (status === "CNCL" || status === "RJCT") return null;
	return "pending";
}

/**
 * `holderName` is the account holder as the bank reports it. Where there is no
 * real counterparty a bank names the owner themselves, which turned four of
 * this owner's bookings into a merchant called "ALEX BEISPIEL" — grouping
 * unrelated transactions under a merchant that does not exist.
 */
function mapTransactions(
	rows: ObjectValue[],
	accountId: string,
	holderName?: string | null,
) {
	const ownName = holderName?.trim().toLowerCase() || null;
	const notTheOwner = (value: string | null) =>
		value && value.trim().toLowerCase() !== ownName ? value : null;
	return rows.flatMap((row) => {
		const amount = object(row.transaction_amount);
		const unsigned = parseDecimalToMinor(text(amount?.amount) ?? "");
		const bookingDate =
			text(row.booking_date) ??
			text(row.value_date) ??
			text(row.transaction_date);
		const status = transactionStatus(row.status);
		if (unsigned === null || !bookingDate || !status) return [];
		const debit = text(row.credit_debit_indicator) === "DBIT";
		const counterparty = debit ? object(row.creditor) : object(row.debtor);
		const counterpartyAccount = debit
			? object(row.creditor_account)
			: object(row.debtor_account);
		return [
			{
				providerAccountId: accountId,
				externalId: transactionExternalId(row, accountId),
				bookingDate,
				valueDate: text(row.value_date),
				amountMinor: debit ? -Math.abs(unsigned) : Math.abs(unsigned),
				currency: text(amount?.currency) ?? "EUR",
				description: transactionDescription(row, ownName),
				counterpartyName: notTheOwner(text(counterparty?.name)),
				counterpartyIban:
					text(counterpartyAccount?.iban) ??
					text(counterpartyAccount?.identification),
				status,
			},
		];
	});
}

const PROVIDER_IMPORT_SOURCE = "provider:enable-banking";

/** Held rows this provider delivered for one account. */
async function heldProviderRows(accountId: string): Promise<HeldRow[]> {
	return db
		.select({
			id: transactions.id,
			bookingDate: transactions.bookingDate,
			externalId: transactions.externalId,
			fingerprint: transactions.fingerprint,
			transferGroupId: transactions.transferGroupId,
			categorySource: transactions.categorySource,
			notes: transactions.notes,
		})
		.from(transactions)
		.where(
			and(
				eq(transactions.accountId, accountId),
				eq(transactions.status, "pending"),
				eq(transactions.importSource, PROVIDER_IMPORT_SOURCE),
			),
		);
}

/**
 * Removes held rows the bank stopped reporting (see `unreportedPendingIds`).
 * Runs after the read was imported, so a held row the read just booked is
 * already booked and out of reach. Only pending rows are ever deleted.
 */
export async function expireUnreportedPending(
	accountId: string,
	reported: readonly {
		bookingDate: string;
		amountMinor: number;
		currency: string;
		description: string;
		counterpartyIban?: string | null;
		externalId?: string | null;
	}[],
	readFrom: string | null,
	today: string,
): Promise<number> {
	const held = await heldProviderRows(accountId);
	if (!held.length) return 0;
	const ids = unreportedPendingIds(
		held,
		reported.map((row) => ({
			bookingDate: row.bookingDate,
			externalId: row.externalId ?? null,
			fingerprint: transactionFingerprint(row),
		})),
		readFrom,
		today,
	);
	if (!ids.length) return 0;
	const removed = await db
		.delete(transactions)
		.where(
			and(
				eq(transactions.accountId, accountId),
				eq(transactions.status, "pending"),
				inArray(transactions.id, ids),
			),
		)
		.returning({ id: transactions.id });
	return removed.length;
}

/**
 * How far back a read overlaps the newest booking already stored. A bank posts
 * some bookings dated days before they appear, and pending rows turn into
 * bookings; reading from the newest date alone missed both for good. Every
 * overlapping row is deduplicated, so the overlap costs nothing but a page.
 */
export const TRANSACTION_READ_OVERLAP_DAYS = 7;

export function transactionReadFrom(
	latestBooked: string | null,
): string | null {
	return latestBooked
		? addDays(latestBooked, -TRANSACTION_READ_OVERLAP_DAYS)
		: null;
}

async function credentialFor(userId: string) {
	const credential = await loadEnableBankingCredential(userId);
	if (!credential) throw new Error("Enable Banking ist nicht eingerichtet");
	return credential;
}

export async function listEnableBankingInstitutions(userId: string) {
	const entries = await listInstitutions(await credentialFor(userId));
	return entries.map(({ name, country }) => ({ name, country }));
}

export async function beginEnableBankingConnection(
	userId: string,
	institutionName: string,
	institutionCountry: string,
): Promise<{ redirectUrl: string }> {
	const credential = await credentialFor(userId);
	const institutions = await listInstitutions(credential);
	// Name and country together, so a request cannot name an institution in a
	// country the application was never offered.
	if (
		!institutions.some(
			(entry) =>
				entry.name === institutionName && entry.country === institutionCountry,
		)
	) {
		throw new Error("Das ausgewählte Institut ist nicht verfügbar");
	}
	const state = randomUUID();
	const validUntil = `${addDays(todayIso(), 90)}T23:59:59Z`;
	const redirectBase = process.env.BETTER_AUTH_URL?.replace(/\/$/, "");
	if (!redirectBase) throw new Error("Die öffentliche Fortuna-URL fehlt");
	const started = await startEnableBankingAuthorization(credential, {
		institutionName,
		institutionCountry,
		state,
		redirectUrl: `${redirectBase}/api/bank/enable-banking/callback`,
		validUntil,
	});
	await db.insert(bankConnections).values({
		userId,
		provider: "enable-banking",
		providerConnectionId: state,
		institutionName,
		institutionCountry,
		status: "pending",
		encryptedSecret: encryptSecret(
			JSON.stringify({ state, authorizationId: started.authorizationId }),
		),
		consentExpiresAt: new Date(validUntil),
	});
	return { redirectUrl: started.url };
}

// A bank can deliver the same redirect twice. The first call rotates the state
// off the connection, so the second finds nothing and used to report a failure
// for an authorization that had just succeeded.
const recentlyCompleted = new Map<string, number>();
const REPLAY_WINDOW_MS = 10 * 60 * 1_000;

export function wasRecentlyCompleted(state: string): boolean {
	const at = recentlyCompleted.get(state);
	if (!at) return false;
	if (Date.now() - at > REPLAY_WINDOW_MS) {
		recentlyCompleted.delete(state);
		return false;
	}
	return true;
}

export async function completeEnableBankingConnection(
	state: string,
	code: string,
): Promise<{ imported: number; duplicates: number; accountsLinked: number }> {
	const connection = await db.query.bankConnections.findFirst({
		where: and(
			eq(bankConnections.provider, "enable-banking"),
			eq(bankConnections.providerConnectionId, state),
			inArray(bankConnections.status, ["pending", "error"]),
		),
	});
	if (!connection)
		throw new EnableBankingAuthorizationError(
			"connection_not_found",
			"Zu dieser Rückmeldung gibt es in Fortuna keine offene Bankfreigabe. Bitte erneut verbinden.",
		);
	const pending = connection.encryptedSecret
		? object(JSON.parse(decryptSecret(connection.encryptedSecret)))
		: null;
	if (text(pending?.state) !== state)
		throw new EnableBankingAuthorizationError(
			"state_mismatch",
			"Die Rückmeldung der Bank gehört nicht zu dieser Freigabe. Bitte erneut verbinden.",
		);
	const credential = await loadEnableBankingCredential(connection.userId);
	if (!credential)
		throw new EnableBankingAuthorizationError(
			"credential_missing",
			"Der Enable-Banking-Schlüssel fehlt. Bitte zuerst hinterlegen.",
		);
	const session = await authorizeEnableBankingSession(credential, code);
	const sessionId = text(session.session_id);
	if (!sessionId)
		throw new EnableBankingAuthorizationError(
			"session_rejected",
			"Die Bank hat keine Sitzung zu dieser Freigabe geliefert.",
		);
	const uids = accountUids(session);
	// No accounts in the authorisation response does not mean the approval
	// failed. The session is kept so the owner can retry the sync, which reads
	// the account list from the session itself, instead of approving again.
	const stored: StoredSession = { sessionId, accountUids: uids };
	const grantedUntil = text(object(session.access)?.valid_until);
	const consentExpiresAt = grantedUntil ? new Date(grantedUntil) : null;
	await db
		.update(bankConnections)
		.set({
			// Rotated off the state value so a replayed callback matches nothing.
			// The session id itself stays in the encrypted secret.
			providerConnectionId: randomUUID(),
			encryptedSecret: encryptSecret(JSON.stringify(stored)),
			...(consentExpiresAt && !Number.isNaN(consentExpiresAt.getTime())
				? { consentExpiresAt }
				: {}),
			status: "active",
			lastError: null,
		})
		.where(eq(bankConnections.id, connection.id));
	recentlyCompleted.set(state, Date.now());
	try {
		// Through the same gate as Abgleichen and the automatic sync: the row is
		// active from the update above, so another open tab could start its own
		// read of the same session and create the same accounts a second time.
		const result = await coalesceSync(connection.userId, connection.id, () =>
			syncEnableBankingConnection(connection.userId, connection.id),
		);
		logger.info("Enable Banking authorization completed", {
			event: "enable_banking.authorization.completed",
			accountsLinked: result.accountsLinked,
			imported: result.imported,
			duplicates: result.duplicates,
		});
		return result;
	} catch (error) {
		const failure =
			error instanceof EnableBankingSyncError ? error.cause : error;
		const rateLimited =
			failure instanceof EnableBankingApiError && failure.status === 429;
		await db
			.update(bankConnections)
			.set({
				status: "error",
				// The state value was rotated moments ago, so the callback's own
				// message can no longer find this row. Say it here instead: the
				// approval did succeed and only the first read failed.
				lastError: rateLimited
					? "Banklimit erreicht (HTTP 429). Bis zum nächsten Versuch bleiben die letzten Kontostände erhalten."
					: 'Bankfreigabe wurde bestätigt, der erste Abruf ist aber fehlgeschlagen. Mit „Abgleichen" erneut versuchen.',
				automaticRetryAt: rateLimited
					? new Date(Date.now() + ENABLE_BANKING_RATE_LIMIT_RETRY_MS)
					: null,
			})
			.where(eq(bankConnections.id, connection.id));
		throw error;
	}
}

export async function failEnableBankingConnection(
	state: string,
	message = "Bankfreigabe wurde nicht abgeschlossen.",
): Promise<void> {
	await db
		.update(bankConnections)
		.set({
			status: "error",
			lastError: message.slice(0, 200),
		})
		.where(
			and(
				eq(bankConnections.provider, "enable-banking"),
				eq(bankConnections.providerConnectionId, state),
			),
		);
}

export async function syncEnableBankingConnection(
	userId: string,
	id: string,
	presence: PsuPresence | null = null,
) {
	let stage = "connection_lookup";
	try {
		const connection = await db.query.bankConnections.findFirst({
			where: and(
				eq(bankConnections.id, id),
				eq(bankConnections.userId, userId),
			),
		});
		if (!connection?.encryptedSecret)
			throw new Error("Bankverbindung ist nicht aktiv");
		stage = "credential_load";
		const credential = await credentialFor(userId);
		// Reads the owner is present for are not counted against the bank's
		// four-a-day allowance, but only if the bank is told they are present.
		stage = "psu_requirements";
		// Provider metadata, not account data: if the listing is unavailable the
		// read goes out without presence headers rather than failing a sync whose
		// account data is perfectly reachable.
		const requiredPsuHeaders = presence
			? await getRequiredPsuHeaders(
					credential,
					connection.institutionName,
					connection.institutionCountry,
				).catch(() => null)
			: [];
		const psuHeaders =
			presence && requiredPsuHeaders
				? psuHeadersFor(presence, requiredPsuHeaders)
				: null;
		// Header names and a flag only; the address and agent themselves are for
		// the bank and must never reach a log.
		logger.info("Enable Banking read presence", {
			event: "enable_banking.psu_presence",
			institution: connection.institutionName,
			requiredPsuHeaders: requiredPsuHeaders?.join(",") || "none",
			sentPsuHeaders: psuHeaders ? Object.keys(psuHeaders).join(",") : "none",
			attended: Boolean(psuHeaders),
		});
		stage = "session_decode";
		const stored = storedSession(connection.encryptedSecret);
		if (!stored) throw new Error("Bankfreigabe noch nicht abgeschlossen");
		if (stored.accountUids.length === 0) {
			// The authorisation response carried no account list. The consent is
			// valid, so read the accounts from the session itself and keep them.
			stage = "session_reread";
			const session = await getEnableBankingSession(
				credential,
				stored.sessionId,
			);
			const uids = accountUids(session);
			const sessionStatus = text(session.status);
			// Counts and field names are safe to log; account data is not. The
			// lengths separate "the bank sent nothing" from "we read the wrong
			// field", which the key list alone cannot.
			const shapeOf = (value: unknown) => {
				if (!Array.isArray(value)) return typeof value;
				const first = value[0];
				if (value.length === 0) return "empty";
				if (typeof first === "string") return "string";
				return `keys:${Object.keys(object(first) ?? {})
					.sort()
					.join("|")}`;
			};
			const granted = object(session.access);
			logger.info("Enable Banking session re-read for accounts", {
				event: "enable_banking.session.reread",
				accountCount: uids.length,
				sessionStatus,
				// Which ASPSP entry and login type the consent actually went to,
				// and the scope the bank granted rather than the one we asked for.
				aspspName: nestedText(session.aspsp, "name"),
				psuType: text(session.psu_type),
				grantedBalances: granted?.balances ?? null,
				grantedTransactions: granted?.transactions ?? null,
				grantedAccountScope: Array.isArray(granted?.accounts)
					? granted.accounts.length
					: typeof granted?.accounts,
				accountsLength: Array.isArray(session.accounts)
					? session.accounts.length
					: null,
				accountsShape: shapeOf(session.accounts),
				accountsDataLength: Array.isArray(session.accounts_data)
					? session.accounts_data.length
					: null,
				accountsDataShape: shapeOf(session.accounts_data),
			});
			// A consent the bank shares no account with is a state, not a failure:
			// a freshly opened account is often not released for third-party
			// access yet. Treating it as an error would paint the connection red
			// and back it off, when the next read is exactly what should pick the
			// account up once the bank does share it.
			if (uids.length > 0) {
				stored.accountUids = uids;
				await db
					.update(bankConnections)
					.set({
						encryptedSecret: encryptSecret(JSON.stringify(stored)),
					})
					.where(eq(bankConnections.id, connection.id));
			}
		}
		let accountsLinked = 0;
		let imported = 0;
		let duplicates = 0;
		let expired = 0;
		for (const uid of stored.accountUids) {
			stage = "account_read";
			const [details, balances] = await Promise.all([
				getEnableBankingAccountDetails(credential, uid, fetch, psuHeaders),
				getEnableBankingBalances(credential, uid, fetch, psuHeaders),
			]);
			const currency = text(details.currency) ?? "EUR";
			const balance = selectBankBalance(balances, currency);
			stage = "account_match";
			const reference = providerAccountRef(details.account_id);
			const match = await findEnableBankingAccount(
				userId,
				connection,
				uid,
				reference,
				balance.currency,
			);
			if (match.superseded) continue;
			let account = match.account;
			if (!account) {
				stage = "account_create";
				[account] = await db
					.insert(accounts)
					.values({
						userId,
						// Never `details.name`: banks answer that with the account
						// holder, so three connected accounts all came back called
						// "Alex Beispiel".
						name: providerAccountName({
							institution: connection.institutionName,
							product: text(details.product),
							typeLabel:
								ACCOUNT_TYPE_LABELS[
									accountType(
										details.cash_account_type,
										connection.institutionName,
									)
								],
							reference,
							taken: new Set(
								(
									await db
										.select({ name: accounts.name })
										.from(accounts)
										.where(eq(accounts.userId, userId))
								).map((row) => row.name),
							),
						}),
						institution: connection.institutionName,
						type: accountType(
							details.cash_account_type,
							connection.institutionName,
						),
						currency: balance.currency,
						iban: nestedText(details.account_id, "iban"),
						currentBalanceMinor: balance.minor ?? 0,
						// Without a readable balance there is no "as of" to claim.
						// Leaving the date empty keeps the account out of the
						// roll-forward's same-day rule and marks it, through the
						// existing data-quality view, as a balance still to confirm.
						balanceAsOf: balance.minor === null ? null : balance.date,
						syncStatus: "synced",
						bankConnectionId: id,
						providerAccountId: uid,
						providerAccountRef: reference,
					})
					.returning();
				accountsLinked += 1;
			}
			stage = "latest_transaction";
			// Only a booking the bank delivered anchors the next read. A pending
			// row carries a future value date, and a row typed in by hand any date
			// at all; either moved `date_from` past bookings not yet delivered.
			const latest = await db.query.transactions.findFirst({
				where: and(
					eq(transactions.accountId, account.id),
					eq(transactions.status, "booked"),
					ne(transactions.importSource, "manual"),
				),
				orderBy: desc(transactions.bookingDate),
			});
			// A booking whose text was altered behind its fingerprint is only
			// restored when the bank sends it again, so the read reaches back to
			// the oldest one. Once restored, the window is the usual overlap.
			// PSD2 guarantees about 90 days; a bank may refuse a longer read and
			// fail the whole sync, so the reach-back stops there.
			const altered = await alteredTextSince(account.id);
			const earliest = addDays(todayIso(), -89);
			// A held row can only be judged by a read that covers its date, so
			// the read also reaches back to the oldest one still pending.
			const held = await heldProviderRows(account.id);
			const heldFrom = pendingReadFrom(held);
			const oldest =
				altered && heldFrom
					? altered < heldFrom
						? altered
						: heldFrom
					: (altered ?? heldFrom);
			const reach = oldest && oldest < earliest ? earliest : oldest;
			const usual = transactionReadFrom(latest?.bookingDate ?? null);
			const readFrom = reach && (!usual || reach < usual) ? reach : usual;
			stage = "transaction_read";
			const rawTransactions = await getEnableBankingTransactions(
				credential,
				uid,
				readFrom,
				fetch,
				psuHeaders,
			);
			const mapped = mapTransactions(rawTransactions, uid, text(details.name));
			stage = "import_job";
			const [job] = await db
				.insert(importJobs)
				.values({
					userId,
					kind: "provider_sync",
					accountId: account.id,
					bankConnectionId: id,
					status: "completed",
					totalRows: mapped.length,
				})
				.returning();
			stage = "transaction_import";
			const result = await db.transaction((tx) =>
				insertTransactions(
					userId,
					account.id,
					mapped,
					{ importSource: PROVIDER_IMPORT_SOURCE, importJobId: job.id },
					tx,
				),
			);
			imported += result.inserted.length;
			duplicates += result.duplicates;
			stage = "pending_expiry";
			const expiredHere = await expireUnreportedPending(
				account.id,
				mapped,
				readFrom,
				todayIso(),
			);
			expired += expiredHere;
			stage = "balance_record";
			// Counts and dates only: enough to tell a balance that is stale from a
			// balance that is simply the booked part of an account with pending
			// money, without putting an amount in the log.
			const [stored] = await db
				.select({
					booked: sql<number>`count(*) filter (where ${transactions.status} = 'booked')::int`,
					pending: sql<number>`count(*) filter (where ${transactions.status} = 'pending')::int`,
					latest: sql<string | null>`max(${transactions.bookingDate})::text`,
				})
				.from(transactions)
				.where(eq(transactions.accountId, account.id));
			logger.info("Enable Banking balance read", {
				event: "enable_banking.balance.read",
				...balance.diagnostics,
				transactionsImported: result.inserted.length,
				textsRestored: result.restored ?? 0,
				bookedTransactions: stored?.booked ?? 0,
				pendingTransactions: stored?.pending ?? 0,
				latestBookingDate: stored?.latest ?? null,
				balanceAsOf: balance.date,
			});
			// An unreadable balance is not a zero balance. Recording one would
			// anchor the account at 0 as of today and stop every booking from
			// ever moving it.
			if (balance.minor !== null)
				await recordBalance(userId, {
					accountId: account.id,
					date: balance.date,
					balanceMinor: balance.minor,
					source: "provider",
				});
			stage = "import_job_update";
			await db
				.update(importJobs)
				.set({
					importedRows: result.inserted.length,
					duplicateRows: result.duplicates,
					log: [
						`${result.inserted.length} importiert, ${result.duplicates} Duplikate`,
						...(expiredHere
							? [
									`${expiredHere} Vormerkungen entfernt, die die Bank nicht mehr meldet`,
								]
							: []),
					],
				})
				.where(eq(importJobs.id, job.id));
		}
		stage = "connection_update";
		await db
			.update(bankConnections)
			.set({
				status: "active",
				lastSyncAt: new Date(),
				lastError: null,
				automaticRetryAt: null,
			})
			.where(eq(bankConnections.id, id));
		// After new rows have landed, not before: a PayPal payment and the bank
		// debit that funded it usually arrive in the same sync.
		stage = "paypal_funding";
		const funding = await linkPaypalFunding(userId).catch(() => ({
			linked: 0,
		}));
		return {
			accountsLinked,
			imported,
			duplicates,
			expired,
			funding: funding.linked,
		};
	} catch (error) {
		if (error instanceof EnableBankingSyncError) throw error;
		throw new EnableBankingSyncError(stage, error);
	}
}

/**
 * Stops the bank's PayPal debit from being counted a second time.
 *
 * PayPal reports only outgoing payments over PSD2, never the funding coming
 * in, so the bank's "PayPal" debit and PayPal's payment to the merchant are
 * the same money twice — both booked as spending. The PayPal leg is the one
 * that names the merchant, so it stays; the bank leg is categorised as a
 * transfer, which is what it actually is and which cashflow already excludes.
 *
 * Only bookings the owner has not categorised themselves are touched, and the
 * category is an ordinary one they can see, change or remove.
 */
export async function linkPaypalFunding(
	userId: string,
): Promise<{ linked: number }> {
	const paypalAccounts = await db
		.select({ id: accounts.id })
		.from(accounts)
		.innerJoin(
			bankConnections,
			eq(bankConnections.id, accounts.bankConnectionId),
		)
		.where(
			and(
				eq(accounts.userId, userId),
				ilike(bankConnections.institutionName, "%paypal%"),
			),
		);
	if (paypalAccounts.length === 0) return { linked: 0 };
	const paypalIds = paypalAccounts.map((row) => row.id);

	const since = addDays(todayIso(), -400);
	const candidates = await db
		.select({
			id: transactions.id,
			accountId: transactions.accountId,
			bookingDate: transactions.bookingDate,
			amountMinor: transactions.amountMinor,
			currency: transactions.currency,
			description: transactions.description,
			counterpartyName: transactions.counterpartyName,
			merchantName: transactions.merchantName,
			categoryId: transactions.categoryId,
			categorySource: transactions.categorySource,
			transferGroupId: transactions.transferGroupId,
		})
		.from(transactions)
		.where(
			and(
				eq(transactions.userId, userId),
				gte(transactions.bookingDate, since),
			),
		);

	const isPaypalAccount = (accountId: string) => paypalIds.includes(accountId);
	const namesPaypal = (row: (typeof candidates)[number]) =>
		/paypal/i.test(
			`${row.description} ${row.counterpartyName ?? ""} ${row.merchantName ?? ""}`,
		);
	const bank = candidates.filter(
		(row) =>
			!isPaypalAccount(row.accountId) &&
			namesPaypal(row) &&
			row.amountMinor < 0 &&
			!row.transferGroupId &&
			// The owner's own decision outranks this.
			row.categorySource !== "manual",
	);
	const paypal = candidates.filter((row) => isPaypalAccount(row.accountId));
	// Matched over every candidate, linked or not, so a debit linked in an
	// earlier run keeps its PayPal payment and that payment cannot be handed
	// to a second debit of the same amount. Only the pairs not yet written
	// are new; re-writing the old ones counted every link again on each run.
	const pairs = matchPaypalFunding(bank, paypal);
	if (pairs.length === 0) return { linked: 0 };
	const existing = await fundingCategory(userId);
	const bankById = new Map(bank.map((row) => [row.id, row]));
	const fresh = pairs.filter(
		(pair) =>
			!existing || bankById.get(pair.bankId)?.categoryId !== existing.id,
	);
	if (fresh.length === 0) return { linked: 0 };

	const category = existing ?? (await createFundingCategory(userId));
	let linked = 0;
	for (const pair of fresh) {
		const updated = await db
			.update(transactions)
			.set({ categoryId: category.id, categorySource: "rule" })
			.where(
				and(
					eq(transactions.id, pair.bankId),
					eq(transactions.userId, userId),
					// Re-checked at write time: the review could have run in between.
					sql`${transactions.categorySource} is distinct from 'manual'`,
					sql`${transactions.categoryId} is distinct from ${category.id}`,
				),
			)
			.returning({ id: transactions.id });
		linked += updated.length;
	}
	if (linked > 0)
		logger.info("PayPal funding linked", {
			event: "enable_banking.paypal_funding.linked",
			userId,
			linked,
		});
	return { linked };
}

function fundingCategory(userId: string) {
	return db.query.categories.findFirst({
		where: and(
			eq(categories.userId, userId),
			eq(categories.slug, "paypal-funding"),
		),
	});
}

/** The category the bank leg lands in, created once and named for what it is. */
async function createFundingCategory(userId: string) {
	const [created] = await db
		.insert(categories)
		.values({
			userId,
			name: "PayPal-Aufladung",
			slug: "paypal-funding",
			kind: "transfer",
			icon: "arrow-left-right",
		})
		.returning();
	return created;
}
