import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { todayIso } from "@/domain/dates";
import { sumInBase } from "@/domain/fx";
import { db } from "@/server/db";
import { categories } from "@/server/db/schema";
import { getAccount, listAccounts, recordBalance } from "./accounts";
import { getSettings, loadFxTable } from "./settings";
import { getTransaction, insertTransactions } from "./transactions";

export async function cashSummary(userId: string) {
	const [accounts, settings, fx] = await Promise.all([
		listAccounts(userId),
		getSettings(userId),
		loadFxTable(),
	]);
	const date = todayIso();
	const result = sumInBase(
		accounts
			.filter((account) => account.type === "cash" && account.isActive)
			.map((account) => ({
				amountMinor: account.currentBalanceMinor,
				currency: account.currency,
			})),
		settings.baseCurrency,
		fx,
		date,
	);
	return {
		date,
		baseCurrency: settings.baseCurrency,
		cashMinor: result.totalMinor,
		unconvertedCurrencies: result.unconverted,
	};
}

export async function recordCashMovement(
	userId: string,
	input: {
		accountId: string;
		date: string;
		amountMinor: number;
		description: string;
		categoryId?: string | null;
		notes?: string | null;
	},
) {
	const transactionId = await db.transaction(async (tx) => {
		const account = await getAccount(userId, input.accountId, tx);
		if (account.type !== "cash") {
			throw new ORPCError("BAD_REQUEST", {
				message: "Das ausgewählte Konto ist kein Bargeldkonto",
			});
		}
		if (account.balanceAsOf && input.date < account.balanceAsOf) {
			throw new ORPCError("BAD_REQUEST", {
				message:
					"Die Bargeldbewegung liegt vor dem letzten Zählbestand. Bitte zuerst einen passenden historischen Bestand erfassen.",
			});
		}
		if (input.categoryId) {
			const category = await tx.query.categories.findFirst({
				where: and(
					eq(categories.id, input.categoryId),
					eq(categories.userId, userId),
				),
				columns: { id: true },
			});
			if (!category)
				throw new ORPCError("BAD_REQUEST", {
					message: "Kategorie nicht gefunden",
				});
		}
		const nextBalance = account.currentBalanceMinor + input.amountMinor;
		if (nextBalance < 0) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Der Bargeldbestand kann nicht negativ werden",
			});
		}
		const result = await insertTransactions(
			userId,
			account.id,
			[
				{
					bookingDate: input.date,
					amountMinor: input.amountMinor,
					currency: account.currency,
					description: input.description,
					categoryId: input.categoryId,
					notes: input.notes,
					type: input.amountMinor > 0 ? "deposit" : "payment",
				},
			],
			{ importSource: "cash" },
			tx,
		);
		if (!result.inserted[0]) {
			throw new ORPCError("CONFLICT", {
				message: "Diese Bargeldbewegung ist bereits vorhanden",
			});
		}
		await recordBalance(
			userId,
			{
				accountId: account.id,
				date: input.date,
				balanceMinor: nextBalance,
				source: "cash",
			},
			tx,
		);
		return result.inserted[0];
	});
	return getTransaction(userId, transactionId);
}
