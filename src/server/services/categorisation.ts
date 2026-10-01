import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
	type CategorisedPrior,
	type CategorySuggestion,
	parseConsultation,
	proposeCategories,
	suggestionKey,
} from "@/domain/categorisation";
import { db } from "@/server/db";
import {
	categories,
	categorizationRules,
	merchants,
	recurringPayments,
	transactions,
} from "@/server/db/schema";
import { logger } from "@/server/logger";
import { providerErrorClass } from "@/server/provider-errors";
import { isolatedTurn } from "./copilot";
import { loadRules } from "./rules";

/**
 * How many bookings one review covers. A review the owner cannot finish in one
 * sitting is a review they abandon, and the query behind it has to stay cheap.
 */
const REVIEW_LIMIT = 200;

/**
 * How far back to read for evidence. Two years is enough to establish what a
 * merchant usually is without dragging in habits the owner has since changed.
 */
const EVIDENCE_LIMIT = 4_000;

export type ReviewRow = {
	id: string;
	bookingDate: string;
	description: string;
	merchantName: string | null;
	counterpartyName: string | null;
	amountMinor: number;
	currency: string;
	accountName: string | null;
	suggestion: (CategorySuggestion & { categoryName: string }) | null;
	/** Why there is no proposal, when there is something honest to say. */
	note: string | null;
};

export type CategoryReview = {
	/** Proposals that only repeat a decision the owner already made. */
	certain: ReviewRow[];
	/** Proposals worth showing that the owner has to decide. */
	uncertain: ReviewRow[];
	/** Bookings with no evidence to go on at all. */
	unknown: ReviewRow[];
	/** Uncategorised bookings beyond this review's limit. */
	remaining: number;
};

export async function categoryReview(
	userId: string,
	options: { limit?: number } = {},
): Promise<CategoryReview> {
	const [pending, priorRows, rules, ruleRows, merchantRows, recurringRows] =
		await Promise.all([
			db.query.transactions.findMany({
				where: and(
					eq(transactions.userId, userId),
					isNull(transactions.categoryId),
					isNull(transactions.transferGroupId),
				),
				with: { account: { columns: { name: true } } },
				orderBy: (row, { desc }) => [desc(row.bookingDate)],
				limit: options.limit ?? REVIEW_LIMIT,
			}),
			db
				.select({
					merchantName: transactions.merchantName,
					description: transactions.description,
					counterpartyName: transactions.counterpartyName,
					amountMinor: transactions.amountMinor,
					categoryId: transactions.categoryId,
					categorySource: transactions.categorySource,
				})
				.from(transactions)
				.where(
					and(
						eq(transactions.userId, userId),
						isNotNull(transactions.categoryId),
					),
				)
				.limit(EVIDENCE_LIMIT),
			loadRules(userId),
			db
				.select({ id: categorizationRules.id, name: categorizationRules.name })
				.from(categorizationRules)
				.where(eq(categorizationRules.userId, userId)),
			db
				.select({
					name: merchants.name,
					defaultCategoryId: merchants.defaultCategoryId,
				})
				.from(merchants)
				.where(eq(merchants.userId, userId)),
			db
				.select({
					id: recurringPayments.id,
					categoryId: recurringPayments.categoryId,
				})
				.from(recurringPayments)
				.where(eq(recurringPayments.userId, userId)),
		]);

	const [{ count } = { count: 0 }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(transactions)
		.where(
			and(
				eq(transactions.userId, userId),
				isNull(transactions.categoryId),
				isNull(transactions.transferGroupId),
			),
		);

	const categoryRows = await db
		.select({ id: categories.id, name: categories.name })
		.from(categories)
		.where(eq(categories.userId, userId));
	const categoryNames = new Map(categoryRows.map((row) => [row.id, row.name]));

	const priorsByKey = new Map<string, CategorisedPrior[]>();
	for (const row of priorRows) {
		if (!row.categoryId) continue;
		const key = suggestionKey(
			row.merchantName,
			row.counterpartyName,
			row.description,
			row.amountMinor,
		);
		if (!key) continue;
		const list = priorsByKey.get(key) ?? [];
		list.push({ ...row, categoryId: row.categoryId });
		priorsByKey.set(key, list);
	}

	const { suggestions, notes } = proposeCategories({
		transactions: pending.map((row) => ({
			id: row.id,
			accountId: row.accountId,
			description: row.description,
			merchantName: row.merchantName,
			counterpartyName: row.counterpartyName,
			counterpartyIban: row.counterpartyIban,
			amountMinor: row.amountMinor,
			recurringPaymentId: row.recurringPaymentId,
		})),
		rules,
		merchantDefaults: new Map(
			merchantRows
				.filter((row) => row.defaultCategoryId)
				.map((row) => [
					row.name.toLowerCase(),
					row.defaultCategoryId as string,
				]),
		),
		recurringCategories: new Map(
			recurringRows
				.filter((row) => row.categoryId)
				.map((row) => [row.id, row.categoryId as string]),
		),
		priorsByKey,
		categoryNames,
		ruleNames: new Map(ruleRows.map((row) => [row.id, row.name])),
	});
	const byTransaction = new Map(
		suggestions.map((suggestion) => [suggestion.transactionId, suggestion]),
	);

	const review: CategoryReview = {
		certain: [],
		uncertain: [],
		unknown: [],
		remaining: Math.max(0, count - pending.length),
	};
	for (const row of pending) {
		const suggestion = byTransaction.get(row.id);
		const entry: ReviewRow = {
			id: row.id,
			bookingDate: row.bookingDate,
			description: row.description,
			merchantName: row.merchantName,
			counterpartyName: row.counterpartyName,
			amountMinor: row.amountMinor,
			currency: row.currency,
			accountName: row.account?.name ?? null,
			suggestion: suggestion
				? {
						...suggestion,
						categoryName: categoryNames.get(suggestion.categoryId) ?? "",
					}
				: null,
			note: notes.get(row.id) ?? null,
		};
		if (!suggestion) review.unknown.push(entry);
		else if (suggestion.certain) review.certain.push(entry);
		else review.uncertain.push(entry);
	}
	return review;
}

export type ApplyReviewInput = {
	/** The owner's final picks. Anything not listed is left uncategorised. */
	picks: { transactionId: string; categoryId: string }[];
	/**
	 * Merchants to remember, so the same answer is not asked for again. Off by
	 * default in the UI: one confirmation is not a standing instruction.
	 */
	rememberMerchants?: string[];
};

export async function applyCategoryReview(
	userId: string,
	input: ApplyReviewInput,
): Promise<{ updated: number; remembered: number }> {
	if (input.picks.length === 0)
		return { updated: 0, remembered: input.rememberMerchants?.length ?? 0 };

	const categoryIds = [...new Set(input.picks.map((pick) => pick.categoryId))];
	const owned = await db
		.select({ id: categories.id })
		.from(categories)
		.where(
			and(eq(categories.userId, userId), inArray(categories.id, categoryIds)),
		);
	if (owned.length !== categoryIds.length)
		throw new ORPCError("BAD_REQUEST", {
			message: "Kategorie nicht gefunden",
		});

	const result = await db.transaction(async (tx) => {
		let updated = 0;
		for (const pick of input.picks) {
			// The owner confirmed every one of these by hand, so they are manual:
			// no later rule run or detection may overwrite them.
			const rows = await tx
				.update(transactions)
				.set({ categoryId: pick.categoryId, categorySource: "manual" })
				.where(
					and(
						eq(transactions.id, pick.transactionId),
						eq(transactions.userId, userId),
					),
				)
				.returning({ id: transactions.id });
			updated += rows.length;
		}

		let remembered = 0;
		const names = input.rememberMerchants ?? [];
		if (names.length > 0) {
			// Which merchant each picked booking belongs to is read back from the
			// database, never taken from the request: a client could otherwise
			// pin any category onto any merchant.
			const picked = await tx
				.select({
					id: transactions.id,
					merchantName: transactions.merchantName,
				})
				.from(transactions)
				.where(
					and(
						eq(transactions.userId, userId),
						inArray(
							transactions.id,
							input.picks.map((pick) => pick.transactionId),
						),
					),
				);
			const merchantByTransaction = new Map(
				picked.map((row) => [row.id, row.merchantName]),
			);
			for (const name of names) {
				const pick = input.picks.find(
					(candidate) =>
						merchantByTransaction
							.get(candidate.transactionId)
							?.toLowerCase() === name.toLowerCase(),
				);
				if (!pick) continue;
				const rows = await tx
					.update(merchants)
					.set({ defaultCategoryId: pick.categoryId })
					.where(and(eq(merchants.userId, userId), eq(merchants.name, name)))
					.returning({ id: merchants.id });
				remembered += rows.length;
			}
		}
		return { updated, remembered };
	});
	return result;
}

/** Merchants per consultation. Enough for one review, bounded. */
const CONSULT_LIMIT = 40;

/** How long a consultation can be picked up again, in milliseconds. */
const SESSION_TTL_MS = 30 * 60_000;

const sessions = new Map<
	string,
	{ userId: string; threadId: string; expiresAt: number }
>();

const INSTRUCTIONS = [
	"Du bist Herr Konrad Körner, Fortunas Buchhalter, und hilfst beim Einsortieren von Bankbuchungen.",
	"Antworte ausschließlich mit JSON in dieser Form:",
	'{"nachricht":"…","zuordnungen":[{"haendler":"…","kategorie":"…","neu":false,"begruendung":"…"}],"rueckfragen":[{"haendler":"…","frage":"…","antworten":["…","…"]}]}',
	"",
	"Regeln:",
	'- „kategorie" ist entweder exakt ein vorhandener Kategoriename oder ein neuer, den du vorschlägst; dann ist „neu" true.',
	'- Schlag eine neue Kategorie nur vor, wenn keine vorhandene wirklich passt. Ihr Name ist kurz, deutsch und allgemein („Vereinsbeitrag", nicht „SV Untereuerheim").',
	"- Jeder offene Händler bekommt entweder eine Zuordnung oder eine Rückfrage — niemals beides, aber auch niemals nichts. Übergeh keinen, auch nicht den größten.",
	'- Stell bis zu drei Rückfragen pro Antwort, zu den Händlern mit dem größten Betrag zuerst. Nenn in „antworten" zwei bis vier plausible Antworten zum Anklicken.',
	"- Das Gespräch geht weiter, bis nichts mehr offen ist. Nach jeder Antwort bekommst du die verbliebene Liste und machst da weiter.",
	'- „nachricht" ist ein bis zwei sachliche Sätze in klarem Hochdeutsch, ohne Dialekt. Sprich den Besitzer mit Sie an. Sag, was noch offen ist.',
	"- Rate nicht: wo du unsicher bist, frag. Eine Rückfrage ist immer besser als ein übergangener Händler.",
].join("\n");

export type ConsultQuestion = {
	merchant: string;
	question: string;
	options: string[];
};

export type ConsultResult = {
	/** Pass back to continue the same conversation. */
	sessionId: string;
	message: string;
	/** Merchants still without an answer, so the owner can see it shrink. */
	openMerchants: number;
	assignments: {
		transactionId: string;
		categoryId: string | null;
		categoryName: string;
		isNew: boolean;
		reason: string;
	}[];
	questions: ConsultQuestion[];
};

function pruneSessions(now: number) {
	for (const [key, session] of sessions)
		if (session.expiresAt <= now) sessions.delete(key);
}

/**
 * Works through the unfiled bookings with Hr. Körner.
 *
 * The first call describes what is left; later calls carry an answer to one of
 * his questions on the same thread, so he still has the context he asked
 * about. He may propose categories the owner does not have yet — on a list of
 * nine categories, mapping everything onto them is the wrong answer far more
 * often than admitting a new one is needed. Nothing he proposes is created or
 * written here; the owner accepts it in the review.
 */
export async function consultCategorisation(
	userId: string,
	input: {
		sessionId?: string | null;
		merchant?: string;
		answer?: string;
		resolved?: string[];
	},
): Promise<ConsultResult> {
	const now = Date.now();
	pruneSessions(now);
	const existing = input.sessionId ? sessions.get(input.sessionId) : undefined;
	if (input.sessionId && (!existing || existing.userId !== userId))
		throw new ORPCError("BAD_REQUEST", {
			message: "Das Gespräch ist abgelaufen. Frag Hr. Körner noch einmal.",
		});

	const review = await categoryReview(userId);
	const open = [...review.unknown, ...review.uncertain];
	const byMerchant = new Map<
		string,
		{
			name: string;
			sample: string;
			direction: "in" | "out";
			ids: string[];
			amounts: number[];
		}
	>();
	for (const row of open) {
		const name = row.merchantName ?? row.counterpartyName;
		if (!name) continue;
		const key = `${row.amountMinor < 0 ? "out" : "in"}|${name.toLowerCase()}`;
		const entry = byMerchant.get(key) ?? {
			name,
			sample: row.description.slice(0, 120),
			direction: (row.amountMinor < 0 ? "out" : "in") as "in" | "out",
			ids: [],
			amounts: [],
		};
		entry.ids.push(row.id);
		entry.amounts.push(row.amountMinor);
		byMerchant.set(key, entry);
	}
	// Anything the owner has already settled is off the list, or he would keep
	// proposing categories for rows that are done.
	const settled = new Set(
		(input.resolved ?? []).map((name) => name.toLowerCase()),
	);
	const merchants = [...byMerchant.values()]
		.filter((row) => !settled.has(row.name.toLowerCase()))
		.sort(
			(left, right) =>
				Math.abs(right.amounts.reduce((a, b) => a + b, 0)) -
				Math.abs(left.amounts.reduce((a, b) => a + b, 0)),
		)
		.slice(0, CONSULT_LIMIT);
	if (merchants.length === 0)
		return {
			sessionId: input.sessionId ?? "",
			message: "Da ist nichts mehr offen.",
			openMerchants: 0,
			assignments: [],
			questions: [],
		};

	const categoryRows = await db
		.select({ id: categories.id, name: categories.name })
		.from(categories)
		.where(eq(categories.userId, userId));

	const describe = (row: (typeof merchants)[number]) => {
		const count = row.ids.length;
		const sum = row.amounts.reduce((total, value) => total + value, 0);
		return `- ${row.name} · ${count} ${count === 1 ? "Buchung" : "Buchungen"} · zusammen ${(sum / 100).toFixed(2).replace(".", ",")} € · ${row.direction === "out" ? "Ausgabe" : "Einnahme"} · Buchungstext: ${row.sample}`;
	};
	// A follow-up carries the list that is still open, not just the answer. The
	// thread remembers what it was first told, but not what the owner has since
	// decided themselves — and without the remaining list there is nothing to
	// work through, which is how the conversation used to stall after one
	// question with the largest merchant untouched.
	const prompt =
		existing && input.answer
			? [
					input.merchant
						? `Zu „${input.merchant}": ${input.answer}`
						: input.answer,
					"",
					`Noch offen (${merchants.length}):`,
					...merchants.map(describe),
					"",
					"Ordne mit dieser Information zu, was du kannst, und frag zu den übrigen.",
				].join("\n")
			: [
					`Vorhandene Kategorien: ${categoryRows.map((row) => row.name).join(", ") || "keine"}`,
					"",
					`Offene Händler (${merchants.length}):`,
					...merchants.map(describe),
				].join("\n");

	let answer: { threadId: string; text: string };
	try {
		answer = await isolatedTurn(userId, {
			threadId: existing?.threadId ?? null,
			instructions: INSTRUCTIONS,
			prompt,
		});
	} catch (error) {
		// Another turn already running is the owner's to know about; it is not
		// a broken connection.
		if (error instanceof ORPCError && error.code === "CONFLICT") throw error;
		// A provider failure arrives as its raw response — status, URL and a
		// request id — which must reach neither the log nor the owner.
		logger.warn("Categorisation consultation failed", {
			event: "categorisation.consult.failed",
			userId,
			errorClass: providerErrorClass(error),
		});
		throw new ORPCError("BAD_GATEWAY", {
			message:
				"Herr Körner konnte gerade nicht antworten. Prüf die Verbindung unter Verbindungen und versuch es später noch einmal.",
		});
	}

	const sessionId = input.sessionId ?? randomUUID();
	sessions.set(sessionId, {
		userId,
		threadId: answer.threadId,
		expiresAt: now + SESSION_TTL_MS,
	});

	const parsed = parseConsultation(answer.text, {
		merchants: merchants.map((row) => row.name),
		categories: categoryRows,
	});
	// He answers per merchant name, but a merchant with both payments and
	// refunds open is listed once per direction. Keyed by name alone, the
	// second group replaced the first, so his answer reached only one of them
	// and the other stayed open however often he answered.
	const idsByMerchant = new Map<string, string[]>();
	for (const row of merchants) {
		const key = row.name.toLowerCase();
		idsByMerchant.set(key, [...(idsByMerchant.get(key) ?? []), ...row.ids]);
	}
	return {
		sessionId,
		message: parsed.message,
		// What he did not settle this turn: assigned and asked both count as
		// handled, the rest is what the next turn still has to reach.
		openMerchants: Math.max(
			0,
			idsByMerchant.size - parsed.assignments.length - parsed.questions.length,
		),
		questions: parsed.questions,
		assignments: parsed.assignments.flatMap((assignment) =>
			(idsByMerchant.get(assignment.merchant.toLowerCase()) ?? []).map(
				(id) => ({
					transactionId: id,
					categoryId: assignment.categoryId,
					categoryName: assignment.categoryName,
					isNew: assignment.isNew,
					reason: assignment.reason,
				}),
			),
		),
	};
}
