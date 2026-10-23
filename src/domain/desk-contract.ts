import type { ReservePot } from "./progress";

/**
 * The contract between Hr. Körner's desk (the page at `/`) and the server.
 * `desk.today` returns a `DeskToday`; the page renders it and never computes
 * a task itself. Everything money-related is a proposal the owner confirms;
 * bookkeeping Hr. Körner may apply himself (`filed`).
 */

/** What the owner can do about a task in one step, opened on the desk. */
export type DeskAction =
	/** Open the categorisation batch review. */
	| { kind: "review_bookings" }
	/** Mark, snooze or dismiss an actionable financial finding. */
	| { kind: "observation"; observationId: string }
	/** Anything else: a plain link to the page that handles it. */
	| { kind: "open"; href: string };

export type DeskTask = {
	/** Stable across visits, so the page can animate and the owner can dismiss. */
	key: string;
	/** Ordering: urgent before review before info. */
	severity: "urgent" | "review" | "info";
	/** Short German headline, e.g. "7 Buchungen ohne Kategorie". */
	title: string;
	/** One German sentence with the concrete numbers behind it. */
	detail: string;
	/** Money at stake, when there is a figure, in base currency. */
	amountMinor: number | null;
	action: DeskAction;
};

/** How quickly a part of net worth can become spendable money. */
export type LiquidityTier = "now" | "days" | "locked" | "sellable";

export type LiquidityItem = {
	id: string;
	name: string;
	tier: LiquidityTier;
	valueMinor: number;
	/** For `locked`: the first date it can be had, from a contract or liability. */
	availableFrom: string | null;
	/** One German clause on why it sits in this tier. */
	note: string | null;
	href: string | null;
};

export type LiquidityStructure = {
	baseCurrency: string;
	totals: Record<LiquidityTier, number>;
	items: LiquidityItem[];
};

/** Bank money beyond the reserve and the split's cash share: it could work. */
export type LazyCash = {
	bankCashMinor: number;
	/** `requiredReserve`: max(reserve months × monthly expenses, minimum). */
	reserveMinor: number;
	/** The target split's cash share of the whole portfolio. */
	cashTargetMinor: number;
	/** The plan's `bankFreeMinor`; zero or more. */
	excessMinor: number;
};

/** Bookings Hr. Körner filed himself on this visit, so the owner can undo them. */
export type DeskFiled = {
	count: number;
	transactionIds: string[];
	/** e.g. "Rewe → Lebensmittel (4)"; at most five lines. */
	summary: string[];
};

export type DeskToday = {
	asOf: string;
	baseCurrency: string;
	tasks: DeskTask[];
	/** Optional, never a task or warning. */
	investmentOpportunity: { bankMinor: number; brokerMinor: number } | null;
	liquidity: LiquidityStructure;
	lazyCash: LazyCash | null;
	/** Liquid bank cash against the reserve (`reservePot`); null without one. */
	reservePot: ReservePot | null;
};

/**
 * Procedures (oRPC, `desk` namespace):
 * - `desk.today`      session read → `DeskToday`
 * - `desk.fileCertain` session mutation → `DeskFiled`: applies every booking
 *   proposal that repeats a decision the owner already made (rule, recurring
 *   payment, merchant default, unbroken history) and nothing that rests on a
 *   guess. Idempotent; runs when the desk opens and after a bank import.
 * - `desk.unfile`     session mutation, input `{ transactionIds: string[] }`:
 *   clears the category again on those rows that are still exactly as
 *   Hr. Körner filed them (source `auto`), and returns how many it cleared.
 */
