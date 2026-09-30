import { ORPCError } from "@orpc/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { contractCostsUntil } from "@/domain/contract";
import { todayIso } from "@/domain/dates";
import {
	optimizationSavings,
	type SavingsProgress,
	savingsProgress,
} from "@/domain/optimization";
import { db } from "@/server/db";
import {
	accounts,
	contracts,
	type Optimization,
	optimizations,
	recurringPayments,
} from "@/server/db/schema";

export type OptimizationRow = Optimization & {
	currentAccountName: string | null;
	replacementAccountName: string | null;
	recurringPaymentName: string | null;
	contractName: string | null;
	monthlySavingsMinor: number;
	annualSavingsMinor: number;
	firstYearSavingsMinor: number;
	realizedSavingsMinor: number;
	/** Where the mission stands: planned, waiting, earning back, saving. */
	progress: SavingsProgress;
};

async function assertOwnedReferences(
	userId: string,
	input: {
		currentAccountId?: string | null;
		replacementAccountId?: string | null;
		recurringPaymentId?: string | null;
		contractId?: string | null;
	},
) {
	if (input.contractId) {
		const contract = await db.query.contracts.findFirst({
			where: and(
				eq(contracts.id, input.contractId),
				eq(contracts.userId, userId),
			),
			columns: { id: true },
		});
		if (!contract)
			throw new ORPCError("BAD_REQUEST", { message: "Vertrag nicht gefunden" });
	}
	for (const id of [input.currentAccountId, input.replacementAccountId]) {
		if (!id) continue;
		const account = await db.query.accounts.findFirst({
			where: and(eq(accounts.id, id), eq(accounts.userId, userId)),
			columns: { id: true },
		});
		if (!account)
			throw new ORPCError("BAD_REQUEST", { message: "Konto nicht gefunden" });
	}
	if (input.recurringPaymentId) {
		const recurring = await db.query.recurringPayments.findFirst({
			where: and(
				eq(recurringPayments.id, input.recurringPaymentId),
				eq(recurringPayments.userId, userId),
			),
			columns: { id: true },
		});
		if (!recurring)
			throw new ORPCError("BAD_REQUEST", {
				message: "Wiederkehrende Zahlung nicht gefunden",
			});
	}
}

export async function listOptimizations(
	userId: string,
): Promise<OptimizationRow[]> {
	const current = db
		.$with("current_accounts")
		.as(db.select({ id: accounts.id, name: accounts.name }).from(accounts));
	const replacement = db
		.$with("replacement_accounts")
		.as(db.select({ id: accounts.id, name: accounts.name }).from(accounts));
	const rows = await db
		.with(current, replacement)
		.select({
			optimization: optimizations,
			currentAccountName: current.name,
			replacementAccountName: replacement.name,
			recurringPaymentName: recurringPayments.name,
			contractName: contracts.name,
			contractStatus: contracts.status,
			contractStartDate: contracts.startDate,
			contractEndDate: contracts.endDate,
			contractCancellationDate: contracts.cancellationDate,
			contractRenewalDate: contracts.renewalDate,
			contractNoticePeriodDays: contracts.noticePeriodDays,
		})
		.from(optimizations)
		.leftJoin(current, eq(current.id, optimizations.currentAccountId))
		.leftJoin(
			replacement,
			eq(replacement.id, optimizations.replacementAccountId),
		)
		.leftJoin(
			recurringPayments,
			eq(recurringPayments.id, optimizations.recurringPaymentId),
		)
		.leftJoin(contracts, eq(contracts.id, optimizations.contractId))
		.where(eq(optimizations.userId, userId))
		.orderBy(desc(optimizations.updatedAt));
	// A mission that names only the payment still borrows its dates from the
	// contract behind that payment (AGENTS: a contract owns the dates). Read
	// past it, the mission asked for its own "Wegfall ab" date while the
	// contract kept running without an end, and the forecast kept charging.
	const paymentContracts = await db
		.select({
			recurringPaymentId: contracts.recurringPaymentId,
			status: contracts.status,
			startDate: contracts.startDate,
			endDate: contracts.endDate,
			cancellationDate: contracts.cancellationDate,
			renewalDate: contracts.renewalDate,
			noticePeriodDays: contracts.noticePeriodDays,
		})
		.from(contracts)
		.where(
			and(
				eq(contracts.userId, userId),
				isNotNull(contracts.recurringPaymentId),
			),
		);
	// Several contracts can name one payment; the last one to stop wins, and
	// one without an end is still running.
	const contractEndByPayment = new Map<string, string | null>();
	for (const contract of paymentContracts) {
		const paymentId = contract.recurringPaymentId as string;
		const until = contractCostsUntil(contract);
		const known = contractEndByPayment.get(paymentId);
		if (
			!contractEndByPayment.has(paymentId) ||
			(known !== null && (until === null || until > (known as string)))
		)
			contractEndByPayment.set(paymentId, until);
	}
	const today = todayIso();
	return rows.map(({ optimization, ...row }) => {
		const costs = {
			currentMonthlyMinor: optimization.currentMonthlyMinor,
			alternativeMonthlyMinor: optimization.alternativeMonthlyMinor,
			oneTimeCostMinor: optimization.oneTimeCostMinor,
		};
		const savings = optimizationSavings(costs);
		// The old contract, if one is linked, decides when the old price stops
		// leaving the account — which is when the saving really begins.
		const oldContract = row.contractStatus
			? {
					endsOn: contractCostsUntil({
						status: row.contractStatus,
						startDate: row.contractStartDate,
						endDate: row.contractEndDate,
						cancellationDate: row.contractCancellationDate,
						renewalDate: row.contractRenewalDate,
						noticePeriodDays: row.contractNoticePeriodDays,
					}),
				}
			: optimization.recurringPaymentId &&
					contractEndByPayment.has(optimization.recurringPaymentId)
				? {
						endsOn:
							contractEndByPayment.get(optimization.recurringPaymentId) ?? null,
					}
				: null;
		const progress = savingsProgress(
			costs,
			{
				status: optimization.status,
				savingFrom: optimization.savingFrom,
				oldContract,
			},
			today,
		);
		return {
			...optimization,
			currentAccountName: row.currentAccountName,
			replacementAccountName: row.replacementAccountName,
			recurringPaymentName: row.recurringPaymentName,
			contractName: row.contractName,
			monthlySavingsMinor: savings.monthlyMinor,
			annualSavingsMinor: savings.annualMinor,
			firstYearSavingsMinor: savings.firstYearMinor,
			realizedSavingsMinor: progress.realizedMinor,
			progress,
		};
	});
}

type OptimizationInput = Omit<
	typeof optimizations.$inferInsert,
	"id" | "userId" | "createdAt" | "updatedAt"
>;

export async function createOptimization(
	userId: string,
	input: OptimizationInput,
) {
	await assertOwnedReferences(userId, input);
	const [row] = await db
		.insert(optimizations)
		.values({
			...input,
			userId,
			completedAt:
				input.status === "completed" ? (input.completedAt ?? todayIso()) : null,
		})
		.returning();
	return row;
}

export async function updateOptimization(
	userId: string,
	input: { id: string } & Partial<OptimizationInput>,
) {
	const existing = await db.query.optimizations.findFirst({
		where: and(
			eq(optimizations.id, input.id),
			eq(optimizations.userId, userId),
		),
	});
	if (!existing)
		throw new ORPCError("NOT_FOUND", { message: "Sparmission nicht gefunden" });
	await assertOwnedReferences(userId, input);
	const { id, ...requested } = input;
	const status = requested.status ?? existing.status;
	const completedAt =
		status === "completed"
			? (requested.completedAt ?? existing.completedAt ?? todayIso())
			: null;
	const [row] = await db
		.update(optimizations)
		.set({ ...requested, completedAt })
		.where(and(eq(optimizations.id, id), eq(optimizations.userId, userId)))
		.returning();
	return row;
}

export async function deleteOptimization(userId: string, id: string) {
	await db
		.delete(optimizations)
		.where(and(eq(optimizations.id, id), eq(optimizations.userId, userId)));
}
