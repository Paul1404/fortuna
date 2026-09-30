import { generateKeyPairSync, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, addMonths, todayIso } from "@/domain/dates";
import { encryptSecret } from "@/server/crypto";
import { db, pool } from "@/server/db";
import { user } from "@/server/db/auth-schema";
import {
	accounts,
	assetValuations,
	bankConnections,
	copilotThreads,
	investmentSourcePositions,
	investmentSourceTransactionRevisions,
	providerCredentials,
	recurringPayments,
	transactions,
} from "@/server/db/schema";
import {
	balanceHistory,
	createAccount,
	getAccount,
	recordBalance,
} from "@/server/services/accounts";
import {
	addValuation,
	createAsset,
	deleteValuation,
	getAsset,
} from "@/server/services/assets";
import { cashSummary, recordCashMovement } from "@/server/services/cash";
import { cashflowReport } from "@/server/services/cashflow";
import {
	createCategory,
	ensureDefaultCategories,
	findCategoryBySlug,
	updateCategory,
} from "@/server/services/categories";
import {
	disconnect,
	listConnections,
	removeConnection,
	syncConnection,
} from "@/server/services/connections";
import {
	attachContractDocument,
	createContract,
	getContractDocument,
	getContractDocumentText,
	listContracts,
} from "@/server/services/contracts";
import { resetCopilotChat } from "@/server/services/copilot";
import { storeCopilotAttachments } from "@/server/services/copilot-attachments";
import {
	forget,
	listMemories,
	remember,
} from "@/server/services/copilot-memory";
import {
	findEnableBankingAccount,
	hasEnableBankingSession,
	providerAccountRef,
} from "@/server/services/enable-banking";
import {
	getFinancialProfile,
	updateFinancialProfile,
} from "@/server/services/hr-koerner";
import { commitCsv } from "@/server/services/import";
import { investmentPlan } from "@/server/services/investment-advice";
import {
	disconnectInvestmentSource,
	getInvestmentSourceAccount,
	ingestScalableCliSnapshot,
	investmentSourceStatus,
	listInvestmentSourceAccounts,
	listInvestmentSourcePositions,
	listInvestmentSourceTransactionPage,
	listInvestmentSourceTransactions,
} from "@/server/services/investment-sources";
import {
	createLiability,
	recordLiabilityBalance,
} from "@/server/services/liabilities";
import { currentNetWorth, netWorthAt } from "@/server/services/net-worth";
import {
	createOptimization,
	listOptimizations,
	updateOptimization,
} from "@/server/services/optimizations";
import {
	deleteEnableBankingCredential,
	getEnableBankingCredentialStatus,
	storeEnableBankingCredential,
} from "@/server/services/provider-credentials";
import {
	createReceivable,
	getReceivable,
	recordReceivableBalance,
} from "@/server/services/receivables";
import {
	createRecurring,
	linkMatchingBookings,
	linkTransactionToRecurring,
	listRecurring,
	runRecurringDetection,
} from "@/server/services/recurring";
import { createRule } from "@/server/services/rules";
import {
	beginScalableHostedConnection,
	disconnectScalableHosted,
	scalableHostedStatus,
	scalableMarketPulse,
	syncScalableHostedDue,
} from "@/server/services/scalable-hosted";
import { getSettings, updateSettings } from "@/server/services/settings";
import {
	alteredTextSince,
	deleteTransaction,
	insertTransactions,
	linkTransfer,
	listTransactions,
	updateTransaction,
} from "@/server/services/transactions";

// Runs against a real PostgreSQL (DATABASE_URL). Skipped unless
// FORTUNA_INTEGRATION_TEST=1 so the fast unit suite never needs a database.
const enabled = process.env.FORTUNA_INTEGRATION_TEST === "1";
const d = enabled ? describe : describe.skip;

d("financial flows against PostgreSQL", () => {
	const userId = `it-${randomUUID()}`;
	const today = todayIso();
	let giroId = "";
	let savingsId = "";
	let cashId = "";

	beforeAll(async () => {
		await db.insert(user).values({
			id: userId,
			name: "Integration",
			email: `${userId}@example.invalid`,
		});
		await ensureDefaultCategories(userId);
		giroId = (
			await createAccount(userId, {
				name: "Giro",
				type: "current",
				currency: "EUR",
				openingBalanceMinor: 100_000,
				openingBalanceDate: addMonths(today, -6),
			})
		).id;
		savingsId = (
			await createAccount(userId, {
				name: "Savings",
				type: "savings",
				currency: "EUR",
				openingBalanceMinor: 500_000,
				openingBalanceDate: addMonths(today, -6),
			})
		).id;
		cashId = (
			await createAccount(userId, {
				name: "Portemonnaie",
				type: "cash",
				currency: "EUR",
				openingBalanceMinor: 5_000,
				openingBalanceDate: today,
			})
		).id;
	});

	afterAll(async () => {
		await db.delete(user).where(eq(user.id, userId));
		await pool.end();
	});

	it("persists menu visibility per owner and rejects essential routes", async () => {
		expect((await getSettings(userId)).hiddenNavItems).toEqual([]);
		await updateSettings(userId, {
			hiddenNavItems: ["/assets", "/debts", "/assets"],
		});
		expect((await getSettings(userId)).hiddenNavItems).toEqual([
			"/assets",
			"/debts",
		]);
		await expect(
			updateSettings(userId, { hiddenNavItems: ["/settings"] }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect((await getSettings(userId)).hiddenNavItems).toEqual([
			"/assets",
			"/debts",
		]);
		// The desk at "/" can never be hidden.
		await expect(
			updateSettings(userId, { hiddenNavItems: ["/"] }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("imports a CSV idempotently and applies rules", async () => {
		const tech = await findCategoryBySlug(userId, "technology");
		await createRule(userId, {
			name: "Hetzner",
			priority: 1,
			isActive: true,
			descriptionContains: "hetzner",
			merchantContains: null,
			counterpartyIban: null,
			amountMinMinor: null,
			amountMaxMinor: null,
			accountId: null,
			direction: null,
			categoryId: tech?.id as string,
			setMerchantName: "Hetzner",
		});
		const csv = `Buchungstag;Verwendungszweck;Betrag\n${addMonths(today, -1)};HETZNER Online GmbH Rechnung;-14,90\n${addMonths(today, -1)};REWE SAGT DANKE;-42,10\n`;
		const mapping = {
			bookingDate: 0,
			description: 1,
			amount: 2,
			dateFormat: "iso" as const,
		};
		const first = await commitCsv(userId, {
			accountId: giroId,
			fileName: "a.csv",
			content: csv,
			mapping,
		});
		expect(first.importedRows).toBe(2);
		expect(first.duplicateRows).toBe(0);
		const second = await commitCsv(userId, {
			accountId: giroId,
			fileName: "a.csv",
			content: csv,
			mapping,
		});
		expect(second.importedRows).toBe(0);
		expect(second.duplicateRows).toBe(2);
		const list = await listTransactions(userId, {
			accountId: giroId,
			q: "hetzner",
			limit: 10,
			offset: 0,
			sort: "date_desc",
		});
		expect(list.rows[0]?.categoryName).toBe("Technologie");
		expect(list.rows[0]?.merchantName).toBe("Hetzner");
		expect(list.rows[0]?.categorySource).toBe("rule");
	});

	it("accepts official CLI snapshots idempotently and retains stale values after disconnect", async () => {
		const before = await currentNetWorth(userId);
		const identity = {
			account_id: "broker-account",
			portfolio_id: "portfolio-integration",
		};
		const now = `${today}T08:00:00Z`;
		const bundle = {
			overview: {
				...identity,
				result: {
					valuation: {
						total: "4700.00",
						securities: "4500.00",
						crypto: "200.00",
					},
					timestamps: { valuation_timestamp_utc: now },
				},
			},
			holdings: {
				...identity,
				result: {
					items: [
						{
							isin: "IE00B4L5Y983",
							name: "Beispiel ETF",
							quantity: "45",
							fifo_price: "90",
							valuation: "4500",
							valuation_currency: "EUR",
							quote_mid_price: "100",
							quote_currency: "EUR",
							quote_timestamp_utc: now,
						},
					],
				},
			},
			cash: {
				...identity,
				result: { cash_balance: "69", buying_power: "5000" },
			},
			transactions: [
				{
					...identity,
					result: {
						cursor: null,
						items: [
							{
								id: "cli-tx-1",
								last_event_datetime: now,
								security_transaction_type: "BUY",
								status: "FILLED",
								isin: "IE00B4L5Y983",
								quantity: "45",
								amount: "-4050",
								currency: "EUR",
								description: "Beispiel ETF",
							},
						],
					},
				},
			],
		};
		expect(await ingestScalableCliSnapshot(userId, bundle)).toMatchObject({
			positions: 1,
			imported: 1,
			duplicates: 0,
		});
		expect(await ingestScalableCliSnapshot(userId, bundle)).toMatchObject({
			positions: 1,
			imported: 0,
			duplicates: 1,
		});
		const after = await currentNetWorth(userId);
		expect(after.netWorthMinor - before.netWorthMinor).toBe(470000 + 6900);
		expect(after.providerBreakdown).toMatchObject([
			{ method: "cli", investmentsMinor: 470000, cashMinor: 6900 },
		]);
		expect(await investmentSourceStatus(userId)).toMatchObject({
			method: "cli",
			cashBalanceMinor: 6900,
			portfolioValueMinor: 470000,
		});
		const [depot] = await listInvestmentSourceAccounts(userId);
		expect(depot).toMatchObject({
			method: "cli",
			portfolioValueMinor: 470000,
			cryptoValueMinor: 20000,
			cashBalanceMinor: 6900,
			positionCount: 1,
			transactionCount: 1,
		});
		expect(await listInvestmentSourceAccounts(userId)).toHaveLength(1);
		const detail = await getInvestmentSourceAccount(userId, depot.id, {
			offset: 0,
			limit: 50,
		});
		expect(detail.positions).toMatchObject([
			{ instrumentName: "Beispiel ETF", quantity: 45, valueMinor: 450000 },
		]);
		expect(detail.transactions).toMatchObject([
			{ kind: "buy", amountMinor: -405000 },
		]);
		expect(detail.transactionCount).toBe(1);
		expect(
			await listInvestmentSourceTransactionPage(userId, {
				limit: 50,
				offset: 0,
			}),
		).toMatchObject({ total: 1, rows: [{ kind: "buy" }] });
		expect(
			await listInvestmentSourceTransactionPage(userId, {
				limit: 50,
				offset: 1,
			}),
		).toMatchObject({ total: 1, rows: [] });
		expect(JSON.stringify(detail)).not.toContain("encryptedRawMetadata");
		expect(
			(
				await getInvestmentSourceAccount(userId, depot.id, {
					offset: 1,
					limit: 50,
				})
			).transactions,
		).toEqual([]);
		await expect(
			getInvestmentSourceAccount(userId, "not-owned", { offset: 0, limit: 50 }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		const sourcePositions = await db
			.select()
			.from(investmentSourcePositions)
			.where(eq(investmentSourcePositions.userId, userId));
		expect(
			sourcePositions.find(
				(position) => position.verification === "provider_reported",
			)?.encryptedRawMetadata,
		).toMatch(/^v1\./);
		const changedTransaction = {
			...bundle.transactions[0].result.items[0],
			last_event_datetime: `${today}T09:00:00Z`,
			status: "SETTLED",
			amount: "-4051",
		};
		const changedBundle = {
			...bundle,
			transactions: [
				{ ...identity, result: { cursor: null, items: [changedTransaction] } },
			],
		};
		expect(
			await ingestScalableCliSnapshot(userId, changedBundle),
		).toMatchObject({
			imported: 0,
			revised: 1,
			conflicts: 0,
		});
		expect(
			await ingestScalableCliSnapshot(userId, changedBundle),
		).toMatchObject({
			imported: 0,
			revised: 0,
			duplicates: 1,
		});
		const revisions = await db
			.select()
			.from(investmentSourceTransactionRevisions)
			.where(eq(investmentSourceTransactionRevisions.userId, userId));
		expect(revisions).toHaveLength(1);
		expect(revisions[0].previousAmountMinor).toBe(-405000);
		expect(revisions[0].encryptedRawMetadata).toMatch(/^v1\./);
		expect((await listInvestmentSourceTransactions(userId))[0]).toMatchObject({
			status: "SETTLED",
			amountMinor: -405100,
		});
		expect(
			await ingestScalableCliSnapshot(userId, {
				...changedBundle,
				overview: {
					...bundle.overview,
					result: {
						...bundle.overview.result,
						valuation: { total: "4800", securities: "4600", crypto: "200" },
					},
				},
				holdings: {
					...bundle.holdings,
					result: {
						items: [{ ...bundle.holdings.result.items[0], valuation: "4600" }],
					},
				},
				transactions: [
					{
						...identity,
						result: {
							cursor: null,
							items: [{ ...changedTransaction, isin: "US0378331005" }],
						},
					},
				],
			}),
		).toMatchObject({ imported: 0, revised: 0, conflicts: 1 });
		const afterConflict = await currentNetWorth(userId);
		expect(afterConflict.netWorthMinor).toBe(after.netWorthMinor + 10000);
		expect((await listInvestmentSourceTransactions(userId))[0].isin).toBe(
			"IE00B4L5Y983",
		);
		expect((await investmentSourceStatus(userId)).lastError).toContain(
			"zurückgehalten",
		);
		await expect(
			ingestScalableCliSnapshot(userId, {
				...bundle,
				holdings: { ...identity, result: { items: [{ name: "broken" }] } },
			}),
		).rejects.toThrow();
		expect((await currentNetWorth(userId)).netWorthMinor).toBe(
			afterConflict.netWorthMinor,
		);
		await disconnectInvestmentSource(userId);
		expect((await currentNetWorth(userId)).netWorthMinor).toBe(
			afterConflict.netWorthMinor,
		);
	});

	it("does not contact a rate-limited bank again during its cooldown", async () => {
		const [row] = await db
			.insert(bankConnections)
			.values({
				userId,
				provider: "enable-banking",
				institutionName: "Testbank",
				status: "error",
				encryptedSecret: encryptSecret(
					JSON.stringify({
						sessionId: "cooldown-session",
						accountUids: ["cooldown-uid"],
					}),
				),
				automaticRetryAt: new Date(Date.now() + 6 * 60 * 60_000),
			})
			.returning({ id: bankConnections.id });
		await expect(syncConnection(userId, row.id)).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
		});
	});

	it("does not turn an unfinished bank authorization into a sync failure", async () => {
		const [pending] = await db
			.insert(bankConnections)
			.values({
				userId,
				provider: "enable-banking",
				institutionName: "Testbank",
				status: "pending",
				encryptedSecret: encryptSecret(
					JSON.stringify({ state: "test-state", authorizationId: "test-auth" }),
				),
			})
			.returning();
		await expect(syncConnection(userId, pending.id)).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		const saved = await db.query.bankConnections.findFirst({
			where: eq(bankConnections.id, pending.id),
		});
		expect(saved?.status).toBe("pending");
	});

	it("keeps a granted bank session that arrived without an account list", async () => {
		const [row] = await db
			.insert(bankConnections)
			.values({
				userId,
				provider: "enable-banking",
				institutionName: "Kontenlose Bank",
				status: "error",
				// The bank confirmed the consent; the response carried no accounts.
				encryptedSecret: encryptSecret(
					JSON.stringify({ sessionId: "granted-session", accountUids: [] }),
				),
				lastError:
					"Bankfreigabe wurde bestätigt, der erste Abruf ist aber fehlgeschlagen.",
			})
			.returning();
		// The consent must survive, so Abgleichen stays available for a retry.
		expect(hasEnableBankingSession(row.encryptedSecret)).toBe(true);
		const listed = (await listConnections(userId)).find(
			(connection) => connection.id === row.id,
		);
		expect(listed?.canSync).toBe(true);
		// And the sync must get past the "not completed" gate rather than
		// reporting an approval that never happened.
		await expect(syncConnection(userId, row.id)).rejects.not.toMatchObject({
			code: "BAD_REQUEST",
		});
	});

	it("keeps a connection active when the bank shares no account yet", async () => {
		const [row] = await db
			.insert(bankConnections)
			.values({
				userId,
				provider: "enable-banking",
				institutionName: "Neues Konto Bank",
				status: "active",
				encryptedSecret: encryptSecret(
					JSON.stringify({
						sessionId: "empty-consent",
						accountUids: ["uid-empty"],
					}),
				),
			})
			.returning();
		// An account list that is empty is a state, not an error: nothing here
		// may put the connection into the error status or stop it syncing.
		const listed = (await listConnections(userId)).find(
			(connection) => connection.id === row.id,
		);
		expect(listed?.status).toBe("active");
		expect(listed?.accountCount).toBe(0);
		expect(listed?.canSync).toBe(true);
	});

	it("removes a bank connection that never linked an account when it is disconnected", async () => {
		const [row] = await db
			.insert(bankConnections)
			.values({
				userId,
				provider: "enable-banking",
				institutionName: "Abgebrochene Bank",
				status: "error",
				encryptedSecret: encryptSecret(JSON.stringify({ state: "abandoned" })),
				lastError: "Bankabgleich fehlgeschlagen.",
			})
			.returning();
		expect(await disconnect(userId, row.id)).toEqual({ removed: true });
		expect((await listConnections(userId)).some((c) => c.id === row.id)).toBe(
			false,
		);
	});

	it("keeps accounts and transactions when a connection with data is removed", async () => {
		const [connection] = await db
			.insert(bankConnections)
			.values({
				userId,
				provider: "enable-banking",
				institutionName: "Entfernbank",
				status: "active",
				encryptedSecret: encryptSecret(
					JSON.stringify({ sessionId: "s", accountUids: ["uid-remove"] }),
				),
			})
			.returning();
		const [account] = await db
			.insert(accounts)
			.values({
				userId,
				name: "Entfernbank Giro",
				type: "current",
				currency: "EUR",
				iban: "DE44 5001 0517 5407 3249 31",
				syncStatus: "synced",
				bankConnectionId: connection.id,
				providerAccountId: "uid-remove",
			})
			.returning();
		await insertTransactions(
			userId,
			account.id,
			[
				{
					bookingDate: todayIso(),
					amountMinor: -1_250,
					currency: "EUR",
					description: "Bleibt erhalten",
				},
			],
			{ importSource: "provider:enable-banking" },
		);
		expect(await disconnect(userId, connection.id)).toEqual({ removed: false });
		expect(await removeConnection(userId, connection.id)).toEqual({
			accountsDetached: 1,
		});
		expect(
			(await listConnections(userId)).some((c) => c.id === connection.id),
		).toBe(false);
		const kept = await getAccount(userId, account.id);
		expect(kept.bankConnectionId).toBeNull();
		expect(kept.providerAccountId).toBeNull();
		expect(kept.syncStatus).toBe("manual");
		expect(
			(
				await listTransactions(userId, {
					accountId: account.id,
					limit: 10,
					offset: 0,
					sort: "date_desc",
				})
			).rows.length,
		).toBeGreaterThan(0);
		// Reconnecting the same bank must reuse the detached account by IBAN.
		const [reconnected] = await db
			.insert(bankConnections)
			.values({
				userId,
				provider: "enable-banking",
				institutionName: "Entfernbank",
			})
			.returning();
		const match = await findEnableBankingAccount(
			userId,
			reconnected,
			"uid-after-remove",
			"de44500105175407324931",
			"EUR",
		);
		expect(match).toMatchObject({
			account: { id: account.id },
			superseded: false,
		});
	});

	it("recognises an account that has no IBAN across a renewed consent", async () => {
		// PayPal is reported under scheme OTHI with the owner's email and has no
		// IBAN at all. Matching on IBAN alone left it unrecognisable, so every
		// 90-day consent renewal added another PayPal account to net worth.
		const reference = providerAccountRef({
			other: { identification: "demo@example.invalid", scheme_name: "OTHI" },
		});
		expect(reference).toBe("demo@example.invalid");

		const [first] = await db
			.insert(bankConnections)
			.values({
				userId,
				provider: "enable-banking",
				institutionName: "PayPal (Germany)",
				createdAt: new Date("2026-01-01T00:00:00Z"),
			})
			.returning();
		const [wallet] = await db
			.insert(accounts)
			.values({
				userId,
				name: "PayPal",
				type: "current",
				currency: "EUR",
				iban: null,
				bankConnectionId: first.id,
				providerAccountId: "session-1-uid",
				providerAccountRef: reference,
			})
			.returning();

		const [renewedConsent] = await db
			.insert(bankConnections)
			.values({
				userId,
				provider: "enable-banking",
				institutionName: "PayPal (Germany)",
				createdAt: new Date("2026-04-01T00:00:00Z"),
			})
			.returning();
		const match = await findEnableBankingAccount(
			userId,
			renewedConsent,
			"session-2-uid",
			reference,
			"EUR",
		);
		expect(match).toMatchObject({
			account: { id: wallet.id },
			superseded: false,
		});
		const saved = await getAccount(userId, wallet.id);
		expect(saved.providerAccountId).toBe("session-2-uid");

		// A different PayPal account is still a different account.
		expect(
			await findEnableBankingAccount(
				userId,
				renewedConsent,
				"session-3-uid",
				"jemand.anders@example.invalid",
				"EUR",
			),
		).toEqual({ account: null, superseded: false });
	});

	it("reads an IBAN in preference to an other identification", () => {
		expect(
			providerAccountRef({
				iban: "de89 3704 0044 0532 0130 00",
				other: { identification: "demo@example.invalid" },
			}),
		).toBe("DE89370400440532013000");
		expect(providerAccountRef({})).toBeNull();
		expect(providerAccountRef(null)).toBeNull();
	});

	it("keeps a Giro when a newer Enable Banking session changes its account UID", async () => {
		const [previous] = await db
			.insert(bankConnections)
			.values({
				userId,
				provider: "enable-banking",
				institutionName: "Testbank",
				createdAt: new Date("2026-01-01T00:00:00Z"),
			})
			.returning();
		const [current] = await db
			.insert(bankConnections)
			.values({
				userId,
				provider: "enable-banking",
				institutionName: "Testbank",
				createdAt: new Date("2026-01-02T00:00:00Z"),
			})
			.returning();
		const [giro] = await db
			.insert(accounts)
			.values({
				userId,
				name: "Bestehendes Giro",
				type: "current",
				currency: "EUR",
				iban: "DE89 3704 0044 0532 0130 00",
				bankConnectionId: previous.id,
				providerAccountId: "old-session-uid",
			})
			.returning();
		const renewed = await findEnableBankingAccount(
			userId,
			current,
			"new-session-uid",
			"de89370400440532013000",
			"EUR",
		);
		expect(renewed).toMatchObject({
			account: { id: giro.id },
			superseded: false,
		});
		const saved = await getAccount(userId, giro.id);
		expect(saved.bankConnectionId).toBe(current.id);
		expect(saved.providerAccountId).toBe("new-session-uid");
		expect(
			await findEnableBankingAccount(
				userId,
				previous,
				"old-session-uid",
				"DE89370400440532013000",
				"EUR",
			),
		).toEqual({ account: null, superseded: true });
		expect(
			await findEnableBankingAccount(
				userId,
				current,
				"another-uid",
				"DE02100100109307118603",
				"EUR",
			),
		).toEqual({ account: null, superseded: false });
	});

	it("stores an Enable Banking private key encrypted and exposes metadata only", async () => {
		const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
		const applicationId = randomUUID();
		const status = await storeEnableBankingCredential(userId, {
			applicationId,
			privateKeyPem: privateKey
				.export({ format: "pem", type: "pkcs8" })
				.toString(),
		});
		expect(status).toMatchObject({ configured: true, applicationId });
		expect(status.keyFingerprint).toMatch(/^[0-9a-f]{64}$/);
		const stored = await db.query.providerCredentials.findFirst({
			where: eq(providerCredentials.userId, userId),
		});
		expect(stored?.encryptedPrivateKey).toMatch(/^v1\./);
		expect(stored?.encryptedPrivateKey).not.toContain("PRIVATE KEY");

		await deleteEnableBankingCredential(userId);
		expect(await getEnableBankingCredentialStatus(userId)).toEqual({
			configured: false,
			applicationId: null,
			keyFingerprint: null,
			updatedAt: null,
		});
	});

	it("moves the account balance for rows newer than the last observation only", async () => {
		const before = (
			await listTransactions(userId, {
				accountId: giroId,
				limit: 1,
				offset: 0,
				sort: "date_desc",
			})
		).rows;
		expect(before.length).toBeGreaterThan(0);
		// 100,000 opening - 1,490 - 4,210 = 94,300 after the CSV rows.
		const history = await balanceHistory(userId, giroId, 12);
		expect(history[history.length - 1].balanceMinor).toBe(94_300);
		// An older row (before the opening observation) must not move the balance.
		await insertTransactions(
			userId,
			giroId,
			[
				{
					bookingDate: addMonths(today, -8),
					amountMinor: -99_999,
					description: "ancient",
				},
			],
			{ importSource: "test" },
		);
		const after = await balanceHistory(userId, giroId, 12);
		expect(after[after.length - 1].balanceMinor).toBe(94_300);
	});

	it("books a held payment when the bank reports it booked", async () => {
		const account = await createAccount(userId, {
			name: "Vorgemerkt",
			type: "current",
			currency: "EUR",
			openingBalanceMinor: 50_000,
			openingBalanceDate: addMonths(today, -1),
		});
		const held = await insertTransactions(
			userId,
			account.id,
			[
				{
					bookingDate: today,
					amountMinor: -4_250,
					description: "Kartenzahlung Tankstelle",
					externalId: "enable-banking:card-1",
					status: "pending",
				},
			],
			{ importSource: "test" },
		);
		expect((await getAccount(userId, account.id)).currentBalanceMinor).toBe(
			50_000,
		);
		// Same reference, booked a day later at the final amount.
		const booked = await insertTransactions(
			userId,
			account.id,
			[
				{
					bookingDate: addDays(today, -1),
					amountMinor: -4_300,
					description: "Kartenzahlung Tankstelle",
					externalId: "enable-banking:card-1",
				},
			],
			{ importSource: "test" },
		);
		expect(booked).toMatchObject({ inserted: [], duplicates: 1 });
		const row = await db.query.transactions.findFirst({
			where: eq(transactions.id, held.inserted[0]),
		});
		expect(row).toMatchObject({
			status: "booked",
			amountMinor: -4_300,
			bookingDate: addDays(today, -1),
		});
		expect((await getAccount(userId, account.id)).currentBalanceMinor).toBe(
			45_700,
		);
	});

	it("refreshes a placeholder text on that booking only", async () => {
		const account = await createAccount(userId, {
			name: "Platzhalter",
			type: "current",
			currency: "EUR",
			openingBalanceMinor: 0,
			openingBalanceDate: addMonths(today, -1),
		});
		const other = await insertTransactions(
			userId,
			account.id,
			[
				{
					bookingDate: addDays(today, -3),
					amountMinor: -1_000,
					description: "Ohne Verwendungszweck",
				},
			],
			{ importSource: "test" },
		);
		await insertTransactions(
			userId,
			account.id,
			[
				{
					bookingDate: addDays(today, -2),
					amountMinor: -2_000,
					description: "PMNT",
					externalId: "enable-banking:refresh-1",
				},
			],
			{ importSource: "test" },
		);
		await insertTransactions(
			userId,
			account.id,
			[
				{
					bookingDate: addDays(today, -2),
					amountMinor: -2_000,
					description: "Bäckerei Schmitt",
					counterpartyName: "Bäckerei Schmitt",
					externalId: "enable-banking:refresh-1",
				},
			],
			{ importSource: "test" },
		);
		const refreshed = await db.query.transactions.findFirst({
			where: eq(transactions.externalId, "enable-banking:refresh-1"),
		});
		expect(refreshed?.description).toBe("Bäckerei Schmitt");
		const untouched = await db.query.transactions.findFirst({
			where: eq(transactions.id, other.inserted[0]),
		});
		expect(untouched?.description).toBe("Ohne Verwendungszweck");
		expect(untouched?.merchantName).toBeNull();
	});

	it("restores a text changed behind its fingerprint, never an owner edit", async () => {
		const account = await createAccount(userId, {
			name: "Reparatur",
			type: "current",
			currency: "EUR",
			openingBalanceMinor: 0,
			openingBalanceDate: addMonths(today, -3),
		});
		const transfer = {
			bookingDate: addDays(today, -40),
			amountMinor: -100_000,
			description: "PMNT",
			counterpartyIban: "DE87760905000002884631",
			externalId: "enable-banking:repair-1",
		};
		const edited = {
			bookingDate: addDays(today, -41),
			amountMinor: -2_500,
			description: "Kartenzahlung 4711",
			externalId: "enable-banking:repair-2",
		};
		const first = await insertTransactions(
			userId,
			account.id,
			[transfer, edited],
			{
				importSource: "test",
			},
		);
		// What the broken refresh did: another booking's text, merchant and
		// counterparty written straight onto the row, fingerprint untouched.
		await db
			.update(transactions)
			.set({
				description: "Deutsche Post DHL",
				merchantName: "Deutsche Post DHL",
				counterpartyName: "Deutsche Post DHL",
			})
			.where(eq(transactions.externalId, "enable-banking:repair-1"));
		// What the owner does: an edit through the service.
		await updateTransaction(userId, {
			id: first.inserted[1],
			description: "Geschenk für Oma",
		});
		expect(await alteredTextSince(account.id)).toBe(transfer.bookingDate);

		const again = await insertTransactions(
			userId,
			account.id,
			[transfer, edited],
			{
				importSource: "test",
			},
		);
		expect(again.restored).toBe(1);
		const repaired = await db.query.transactions.findFirst({
			where: eq(transactions.externalId, "enable-banking:repair-1"),
		});
		expect(repaired).toMatchObject({
			description: "PMNT",
			merchantName: null,
			counterpartyName: null,
			amountMinor: -100_000,
		});
		const owners = await db.query.transactions.findFirst({
			where: eq(transactions.externalId, "enable-banking:repair-2"),
		});
		expect(owners?.description).toBe("Geschenk für Oma");
		expect(await alteredTextSince(account.id)).toBeNull();
	});

	it("records cash movements and prevents negative physical cash", async () => {
		await recordCashMovement(userId, {
			accountId: cashId,
			date: today,
			amountMinor: -1_250,
			description: "Bäcker",
		});
		await recordCashMovement(userId, {
			accountId: cashId,
			date: today,
			amountMinor: 2_000,
			description: "Geldautomat",
		});
		const history = await balanceHistory(userId, cashId, 1);
		expect(history.at(-1)?.balanceMinor).toBe(5_750);
		await expect(
			recordCashMovement(userId, {
				accountId: cashId,
				date: today,
				amountMinor: -6_000,
				description: "Zu viel",
			}),
		).rejects.toThrow("Bargeldbestand kann nicht negativ werden");
	});

	it("links internal transfers and excludes them from cashflow", async () => {
		const date = addMonths(today, -2);
		await insertTransactions(
			userId,
			giroId,
			[
				{
					bookingDate: date,
					amountMinor: -30_000,
					description: "Sparen",
					externalId: "t-out",
				},
			],
			{ importSource: "test" },
		);
		await insertTransactions(
			userId,
			savingsId,
			[
				{
					bookingDate: date,
					amountMinor: 30_000,
					description: "Sparen",
					externalId: "t-in",
				},
			],
			{ importSource: "test" },
		);
		const legs = await db
			.select()
			.from(transactions)
			.where(eq(transactions.userId, userId));
		const out = legs.find((t) => t.externalId === "t-out");
		const inn = legs.find((t) => t.externalId === "t-in");
		expect(out?.transferGroupId).toBeTruthy();
		expect(out?.transferGroupId).toBe(inn?.transferGroupId);
		const report = await cashflowReport(userId, { months: 6 });
		const month = report.months.find((m) => m.month === date.slice(0, 7));
		expect(month?.incomeMinor).toBe(0);
		expect(month?.expenseMinor).toBe(0);
	});

	it("manual categorisation survives rule re-application and can spawn a rule", async () => {
		const groceries = await findCategoryBySlug(userId, "groceries");
		const rewe = (
			await listTransactions(userId, {
				q: "rewe",
				limit: 1,
				offset: 0,
				sort: "date_desc",
			})
		).rows[0];
		const updated = await updateTransaction(userId, {
			id: rewe.id,
			categoryId: groceries?.id,
			createRule: true,
		});
		expect(updated.categorySource).toBe("manual");
		await insertTransactions(
			userId,
			giroId,
			[
				{
					bookingDate: today,
					amountMinor: -1_000,
					description: "REWE SAGT DANKE 4711",
				},
			],
			{ importSource: "test" },
		);
		const fresh = (
			await listTransactions(userId, {
				q: "REWE SAGT DANKE 4711",
				limit: 1,
				offset: 0,
				sort: "date_desc",
			})
		).rows[0];
		expect(fresh.categoryName).toBe("Lebensmittel");
	});

	it("detects recurring payments from history", async () => {
		const rows = [1, 2, 3, 4].map((i) => ({
			bookingDate: addMonths(today, -i),
			amountMinor: -1_199,
			description: "Spotify AB",
			externalId: `sp-${i}`,
		}));
		await insertTransactions(userId, giroId, rows, { importSource: "test" });
		const result = await runRecurringDetection(userId);
		expect(
			result.candidates.some(
				(c) =>
					c.name.toLowerCase().includes("spotify") && c.frequency === "monthly",
			),
		).toBe(true);
		const linked = await listTransactions(userId, {
			q: "spotify",
			limit: 10,
			offset: 0,
			sort: "date_desc",
		});
		expect(linked.rows.every((r) => r.recurringPaymentId)).toBe(true);
	});

	it("computes net worth from valuation and balance history at different dates", async () => {
		const car = await createAsset(userId, {
			name: "Car",
			category: "vehicle",
			currency: "EUR",
			acquisitionDate: addMonths(today, -12),
			acquisitionCostMinor: 2_000_000,
			currentValueMinor: 1_800_000,
			valuationDate: addMonths(today, -6),
		});
		await addValuation(userId, {
			assetId: car.id,
			date: today,
			valueMinor: 1_700_000,
		});
		const loan = await createLiability(userId, {
			name: "Car loan",
			type: "vehicle_finance",
			currency: "EUR",
			currentBalanceMinor: 1_000_000,
			balanceDate: addMonths(today, -6),
			linkedAssetId: car.id,
		});
		await recordLiabilityBalance(userId, {
			liabilityId: loan.id,
			date: today,
			balanceMinor: 900_000,
		});
		const receivable = await createReceivable(userId, {
			name: "Gemeinsamer Urlaub",
			debtorName: "Testperson",
			currency: "EUR",
			currentBalanceMinor: 25_000,
			balanceDate: addMonths(today, -6),
		});
		await recordReceivableBalance(userId, {
			receivableId: receivable.id,
			date: today,
			balanceMinor: 15_000,
		});
		const now = await currentNetWorth(userId);
		expect(now.physicalMinor).toBe(1_700_000);
		expect(now.receivablesMinor).toBe(15_000);
		expect(now.loanDebtMinor).toBe(900_000);
		expect(now.netWorthMinor).toBe(
			now.totalAssetsMinor - now.totalLiabilitiesMinor,
		);
		const earlier = await netWorthAt(userId, addMonths(today, -3));
		expect(earlier.physicalMinor).toBe(1_800_000);
		expect(earlier.receivablesMinor).toBe(25_000);
		expect(earlier.loanDebtMinor).toBe(1_000_000);
		const detail = await getAsset(userId, car.id);
		expect(detail.valuations.map((v) => v.valueMinor)).toEqual([
			2_000_000, 1_800_000, 1_700_000,
		]);
		expect(detail.currentValueMinor).toBe(1_700_000);
	});

	it("closes a receivable when the outstanding balance reaches zero", async () => {
		const receivable = await createReceivable(userId, {
			name: "Auslage",
			debtorName: "Testperson",
			currency: "EUR",
			currentBalanceMinor: 4_200,
			balanceDate: addMonths(today, -1),
		});
		await recordReceivableBalance(userId, {
			receivableId: receivable.id,
			date: today,
			balanceMinor: 0,
		});
		const closed = await getReceivable(userId, receivable.id);
		expect(closed.currentBalanceMinor).toBe(0);
		expect(closed.isActive).toBe(false);
		expect(closed.settledAt).toBe(today);
		expect(closed.balances.map((balance) => balance.balanceMinor)).toEqual([
			4_200, 0,
		]);
	});

	it("tracks a savings mission from potential to realized savings", async () => {
		const mission = await createOptimization(userId, {
			title: "Kartenentgelt sparen",
			category: "banking",
			currency: "EUR",
			currentMonthlyMinor: 2_000,
			alternativeMonthlyMinor: 0,
			oneTimeCostMinor: 0,
			status: "idea",
		});
		let row = (await listOptimizations(userId)).find(
			(candidate) => candidate.id === mission.id,
		);
		expect(row?.annualSavingsMinor).toBe(24_000);
		expect(row?.realizedSavingsMinor).toBe(0);
		await updateOptimization(userId, {
			id: mission.id,
			status: "completed",
			savingFrom: addMonths(today, -1),
		});
		row = (await listOptimizations(userId)).find(
			(candidate) => candidate.id === mission.id,
		);
		expect(row?.status).toBe("completed");
		expect(row?.realizedSavingsMinor).toBeGreaterThan(1_900);
	});

	it("offers to link the bookings of a recurring payment that has none", async () => {
		const category = await createCategory(userId, {
			name: "Streaming-Test",
			kind: "expense",
		});
		const recurring = await createRecurring(userId, {
			name: "Streamingdienst",
			direction: "outflow",
			expectedAmountMinor: -1_299,
			currency: "EUR",
			frequency: "monthly",
			categoryId: category.id,
			nextExpected: addDays(today, 10),
		});
		await insertTransactions(
			userId,
			giroId,
			[
				{
					bookingDate: addMonths(today, -2),
					amountMinor: -1_299,
					description: "Streamingdienst Abo",
					externalId: "stream-1",
					categoryId: category.id,
				},
				{
					bookingDate: addMonths(today, -1),
					amountMinor: -1_349,
					description: "Streamingdienst Abo",
					externalId: "stream-2",
					categoryId: category.id,
				},
				{
					bookingDate: addMonths(today, -1),
					amountMinor: -5_000,
					description: "Anderer Dienst Jahresabo",
					externalId: "stream-other",
					categoryId: category.id,
				},
			],
			{ importSource: "test" },
		);
		const before = (await listRecurring(userId)).find(
			(row) => row.id === recurring.id,
		);
		// Three bookings sit in the category, two of them at its price.
		expect(before?.unlinked).toEqual({ categoryBookings: 3, matches: 2 });
		expect(await linkMatchingBookings(userId, recurring.id)).toEqual({
			linked: 2,
		});
		const after = (await listRecurring(userId)).find(
			(row) => row.id === recurring.id,
		);
		expect(after?.occurrenceCount).toBe(2);
		expect(after?.unlinked).toBeNull();
		// Once it has bookings, the repair does nothing more.
		expect(await linkMatchingBookings(userId, recurring.id)).toEqual({
			linked: 0,
		});
	});

	it("proposes the first booking as a contract's start, not the latest", async () => {
		const recurring = await createRecurring(userId, {
			name: "Hausrat",
			direction: "outflow",
			expectedAmountMinor: -9_600,
			currency: "EUR",
			frequency: "yearly",
			nextExpected: addMonths(today, 10),
		});
		const firstDate = addMonths(today, -26);
		const lastDate = addMonths(today, -2);
		await insertTransactions(
			userId,
			giroId,
			[
				{
					bookingDate: firstDate,
					amountMinor: -9_600,
					description: "Hausrat Beitrag erstes Jahr",
					externalId: "hausrat-1",
				},
				{
					bookingDate: lastDate,
					amountMinor: -9_600,
					description: "Hausrat Beitrag drittes Jahr",
					externalId: "hausrat-3",
				},
			],
			{ importSource: "test" },
		);
		const bookings = await db
			.select({ id: transactions.id, externalId: transactions.externalId })
			.from(transactions)
			.where(eq(transactions.userId, userId));
		for (const booking of bookings)
			if (booking.externalId?.startsWith("hausrat-"))
				await linkTransactionToRecurring(userId, booking.id, recurring.id);
		const contract = await createContract(userId, {
			name: "Hausratversicherung",
			category: "insurance",
			status: "active",
			costMinor: 9_600,
			currency: "EUR",
			frequency: "yearly",
			recurringPaymentId: recurring.id,
		});
		const row = (await listContracts(userId)).find(
			(entry) => entry.id === contract.id,
		);
		// The proposal is labelled "Beginn"; the latest booking made a contract
		// running for two years look as if it had started two months ago.
		expect(row?.proposal?.startDate).toBe(firstDate);
	});

	it("documents a contract", async () => {
		const contract = await createContract(userId, {
			name: "Haftpflicht",
			provider: "Versicherung AG",
			contractNumber: "HP-42",
			category: "insurance",
			status: "active",
			costMinor: 6_000,
			currency: "EUR",
			frequency: "yearly",
			startDate: today,
			renewalDate: addMonths(today, 12),
			accountId: giroId,
		});
		const [attachment] = await storeCopilotAttachments(userId, [
			new File(["Versicherungsschein HP-42"], "police.txt", {
				type: "text/plain",
			}),
		]);
		const document = await attachContractDocument(userId, {
			contractId: contract.id,
			attachmentId: attachment.id,
			type: "policy",
		});
		expect(
			(await listContracts(userId)).find((row) => row.id === contract.id)
				?.completeness,
		).toBe(100);
		expect(
			(await getContractDocument(userId, document.id)).content.toString(),
		).toContain("HP-42");
		expect((await getContractDocumentText(userId, document.id)).text).toContain(
			"HP-42",
		);
		const [duplicateAttachment] = await storeCopilotAttachments(userId, [
			new File(["Versicherungsschein HP-42"], "police-kopie.txt", {
				type: "text/plain",
			}),
		]);
		const duplicate = await attachContractDocument(userId, {
			contractId: contract.id,
			attachmentId: duplicateAttachment.id,
			type: "policy",
		});
		expect(duplicate.id).toBe(document.id);
		expect(
			(await listContracts(userId)).find((row) => row.id === contract.id)
				?.documents,
		).toHaveLength(1);
	});

	it("keeps durable Copilot memories and replaces later corrections", async () => {
		const first = await remember(userId, {
			key: "contract.renewal",
			kind: "rule",
			content: "Verträge laufen ohne Kündigung weiter.",
		});
		await remember(userId, {
			key: "contract.renewal",
			kind: "rule",
			content: "Versicherungen laufen ohne Kündigung weiter.",
		});
		const memories = await listMemories(userId);
		expect(memories).toHaveLength(1);
		expect(memories[0].content).toContain("Versicherungen");
		await forget(userId, first.id);
		expect(await listMemories(userId)).toHaveLength(0);
	});

	it("keeps and resets the server-side Copilot thread mapping", async () => {
		await db.insert(copilotThreads).values({
			userId,
			threadId: `thread-${randomUUID()}`,
		});
		await resetCopilotChat(userId);
		expect(
			await db.query.copilotThreads.findFirst({
				where: eq(copilotThreads.userId, userId),
			}),
		).toBeUndefined();
	});

	it("keeps goal, reserve and split once, in the profile, and plans from them", async () => {
		await updateFinancialProfile(userId, {
			goalName: "Finanzielle Unabhängigkeit",
			targetNetWorthMinor: 50_000_000,
			targetNetWorthDate: addMonths(today, 120),
			monthlySavingsTargetMinor: 100_000,
			reserveMonths: 4,
			targetEquityBps: 9000,
			targetBondBps: 0,
			targetCashBps: 1000,
			targetOtherBps: 0,
		});
		expect(await getFinancialProfile(userId)).toMatchObject({
			goalName: "Finanzielle Unabhängigkeit",
			reserveMonths: 4,
			targetEquityBps: 9000,
		});
		// A split that does not total 100 % is refused as a whole.
		await expect(
			updateFinancialProfile(userId, { targetEquityBps: 8000 }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		const plan = await investmentPlan(userId);
		expect(plan.targets).toEqual({
			equity: 9000,
			bonds: 0,
			cash: 1000,
			other: 0,
		});
		expect(plan.reserve.reserveMonths).toBe(4);
		expect(plan.plan.ready).toBe(true);
		// Only instruments already held can be bought.
		const held = new Set(
			(await listInvestmentSourcePositions(userId)).map((row) => row.isin),
		);
		for (const buy of plan.plan.buys) expect(held.has(buy.isin)).toBe(true);
	});

	it("reports only physical cash in the cash summary", async () => {
		const summary = await cashSummary(userId);
		expect(summary.cashMinor).toBe(5_750);
		expect(summary.cashMinor).not.toBe(605_000);
	});

	it("recomputes balances across transaction edits and deletion", async () => {
		const account = await createAccount(userId, {
			name: "Recompute",
			type: "current",
			currency: "EUR",
			openingBalanceMinor: 100_000,
			openingBalanceDate: addMonths(today, -6),
		});
		const created = await insertTransactions(
			userId,
			account.id,
			[
				{
					bookingDate: addMonths(today, -1),
					amountMinor: -10_000,
					description: "Kontostandstest",
				},
			],
			{ importSource: "test" },
		);
		expect((await getAccount(userId, account.id)).currentBalanceMinor).toBe(
			90_000,
		);
		await updateTransaction(userId, {
			id: created.inserted[0],
			amountMinor: -20_000,
		});
		expect((await getAccount(userId, account.id)).currentBalanceMinor).toBe(
			80_000,
		);
		await updateTransaction(userId, {
			id: created.inserted[0],
			status: "pending",
		});
		expect((await getAccount(userId, account.id)).currentBalanceMinor).toBe(
			100_000,
		);
		await updateTransaction(userId, {
			id: created.inserted[0],
			status: "booked",
			bookingDate: addMonths(today, -7),
		});
		expect((await getAccount(userId, account.id)).currentBalanceMinor).toBe(
			100_000,
		);
		await deleteTransaction(userId, created.inserted[0]);
		expect((await getAccount(userId, account.id)).currentBalanceMinor).toBe(
			100_000,
		);
	});

	it("rejects cash movements before the latest counted balance", async () => {
		await expect(
			recordCashMovement(userId, {
				accountId: cashId,
				date: addMonths(today, -1),
				amountMinor: -100,
				description: "Zu spät nachgetragen",
			}),
		).rejects.toThrow("vor dem letzten Zählbestand");
	});

	it("imports CSV files with separate debit and credit columns", async () => {
		const result = await commitCsv(userId, {
			accountId: giroId,
			fileName: "soll-haben.csv",
			content: `Datum;Text;Soll;Haben\n${today};Lastschrift;12,34;`,
			mapping: {
				bookingDate: 0,
				description: 1,
				debit: 2,
				credit: 3,
				dateFormat: "iso",
			},
		});
		expect(result.importedRows).toBe(1);
	});

	it("prevents invalid category trees", async () => {
		const parent = await createCategory(userId, { name: "Baum Eltern" });
		const child = await createCategory(userId, {
			name: "Baum Kind",
			parentId: parent.id,
		});
		await expect(
			updateCategory(userId, { id: parent.id, parentId: child.id }),
		).rejects.toThrow("nur eine Ebene");
	});

	it("keeps a manually entered due date when transactions change", async () => {
		const account = await createAccount(userId, {
			name: "Versicherung",
			type: "current",
			currency: "EUR",
			openingBalanceMinor: 500_000,
			openingBalanceDate: addMonths(today, -12),
		});
		// A yearly payment the owner typed in has no booked occurrence yet, so
		// there is nothing to derive a date from. Clearing it on every import let
		// the forecast fall back to today and charge the whole amount on day 0.
		const manual = await createRecurring(userId, {
			name: "Kfz-Versicherung",
			direction: "outflow",
			expectedAmountMinor: -118_000,
			currency: "EUR",
			frequency: "yearly",
			nextExpected: addMonths(today, 2),
		});
		await insertTransactions(
			userId,
			account.id,
			[
				{
					bookingDate: today,
					amountMinor: -2_000,
					description: "Etwas völlig anderes",
				},
			],
			{ importSource: "test" },
		);
		const after = await db.query.recurringPayments.findFirst({
			where: eq(recurringPayments.id, manual.id),
		});
		expect(after?.nextExpected).toBe(addMonths(today, 2));
	});

	it("rejects recurring links owned by another user", async () => {
		const otherUserId = `it-${randomUUID()}`;
		await db.insert(user).values({
			id: otherUserId,
			name: "Other",
			email: `${otherUserId}@example.invalid`,
		});
		try {
			const foreign = await createRecurring(otherUserId, {
				name: "Fremd",
				direction: "outflow",
				expectedAmountMinor: 100,
				currency: "EUR",
				frequency: "monthly",
				nextExpected: today,
			});
			const ownTransaction = await db.query.transactions.findFirst({
				where: eq(transactions.userId, userId),
			});
			await expect(
				linkTransactionToRecurring(
					userId,
					ownTransaction?.id as string,
					foreign.id,
				),
			).rejects.toThrow("nicht gefunden");
		} finally {
			await db.delete(user).where(eq(user.id, otherUserId));
		}
	});

	it("explicit transfer linking and observed balances", async () => {
		await insertTransactions(
			userId,
			giroId,
			[
				{
					bookingDate: today,
					amountMinor: -5_000,
					description: "manual out",
					externalId: "m-out",
				},
			],
			{ importSource: "test" },
		);
		await insertTransactions(
			userId,
			savingsId,
			[
				{
					bookingDate: addMonths(today, -1),
					amountMinor: 5_000,
					description: "manual in far away",
					externalId: "m-in",
				},
			],
			{ importSource: "test" },
		);
		const legs = await db
			.select()
			.from(transactions)
			.where(eq(transactions.userId, userId));
		const out = legs.find((t) => t.externalId === "m-out");
		const inn = legs.find((t) => t.externalId === "m-in");
		expect(out?.transferGroupId).toBeNull();
		await linkTransfer(userId, out?.id as string, inn?.id as string);
		const relinked = await db
			.select()
			.from(transactions)
			.where(eq(transactions.id, out?.id as string));
		expect(relinked[0].transferGroupId).toBeTruthy();
		await recordBalance(userId, {
			accountId: giroId,
			date: today,
			balanceMinor: 123_456,
		});
		const nw = await currentNetWorth(userId);
		expect(nw.cashMinor).toBeGreaterThanOrEqual(123_456);
	});

	it("still pairs a transfer imported long after it happened", async () => {
		// The scan is bounded to keep every import from reading all history. The
		// window has to follow the imported rows, or a historical CSV pairs
		// nothing at all.
		const [savings] = await db
			.insert(accounts)
			.values({
				userId,
				name: "Altimport Sparkonto",
				type: "savings",
				currency: "EUR",
			})
			.returning();
		const longAgo = addMonths(today, -14);
		await insertTransactions(
			userId,
			giroId,
			[
				{
					bookingDate: longAgo,
					amountMinor: -70_000,
					description: "Alte Umbuchung raus",
					externalId: "old-out",
				},
			],
			{ importSource: "test" },
		);
		await insertTransactions(
			userId,
			savings.id,
			[
				{
					bookingDate: longAgo,
					amountMinor: 70_000,
					description: "Alte Umbuchung rein",
					externalId: "old-in",
				},
			],
			{ importSource: "test" },
		);
		const rows = await db
			.select()
			.from(transactions)
			.where(eq(transactions.userId, userId));
		const out = rows.find((row) => row.externalId === "old-out");
		expect(out?.transferGroupId).toBeTruthy();
		expect(
			rows.find((row) => row.externalId === "old-in")?.transferGroupId,
		).toBe(out?.transferGroupId);
	});

	it("releases the surviving leg when a transfer is broken", async () => {
		const [savings] = await db
			.insert(accounts)
			.values({
				userId,
				name: "Umbuchungstest Sparkonto",
				type: "savings",
				currency: "EUR",
			})
			.returning();
		const makePair = async (tag: string) => {
			await insertTransactions(
				userId,
				giroId,
				[
					{
						bookingDate: today,
						amountMinor: -50_000,
						description: `Umbuchung raus ${tag}`,
						externalId: `t-out-${tag}`,
					},
				],
				{ importSource: "test" },
			);
			await insertTransactions(
				userId,
				savings.id,
				[
					{
						bookingDate: today,
						amountMinor: 50_000,
						description: `Umbuchung rein ${tag}`,
						externalId: `t-in-${tag}`,
					},
				],
				{ importSource: "test" },
			);
			const rows = await db
				.select()
				.from(transactions)
				.where(eq(transactions.userId, userId));
			const out = rows.find((t) => t.externalId === `t-out-${tag}`);
			const inn = rows.find((t) => t.externalId === `t-in-${tag}`);
			await linkTransfer(userId, out?.id as string, inn?.id as string);
			return { outId: out?.id as string, inId: inn?.id as string };
		};
		const read = async (id: string) =>
			(await db.select().from(transactions).where(eq(transactions.id, id)))[0];

		// Deleting one leg must hand the other back to cashflow.
		const deleted = await makePair("del");
		await deleteTransaction(userId, deleted.outId);
		const survivor = await read(deleted.inId);
		expect(survivor.transferGroupId).toBeNull();
		expect(survivor.type).toBe("payment");
		expect(survivor.categoryId).toBeNull();

		// Editing one leg's amount breaks the pairing invariant.
		const edited = await makePair("edit");
		await updateTransaction(userId, {
			id: edited.outId,
			amountMinor: -45_000,
		});
		for (const id of [edited.outId, edited.inId]) {
			const row = await read(id);
			expect(row.transferGroupId).toBeNull();
			expect(row.type).toBe("payment");
		}
	});

	it("drops an asset's denormalised value with its last valuation", async () => {
		const asset = await createAsset(userId, {
			name: "Testuhr",
			category: "watch",
			currency: "EUR",
			currentValueMinor: 0,
		});
		await addValuation(userId, {
			assetId: asset.id,
			date: today,
			valueMinor: 800_000,
		});
		expect((await getAsset(userId, asset.id)).currentValueMinor).toBe(800_000);
		const valuations = await db
			.select()
			.from(assetValuations)
			.where(eq(assetValuations.assetId, asset.id));
		for (const valuation of valuations)
			await deleteValuation(userId, valuation.id);
		const stripped = await getAsset(userId, asset.id);
		expect(stripped.currentValueMinor).toBe(0);
		expect(stripped.valuationDate).toBeNull();
	});

	it("connects the hosted CLI through a device prompt, auto-syncs and revokes on disconnect", async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "fortuna-hosted-integration-"),
		);
		const binary = join(directory, "sc");
		const previous = process.env.FORTUNA_SCALABLE_CLI_BIN;
		// Both timestamps are relative to now, never a fixed hour. A quote dated
		// before its own baseline valuation is deliberately not treated as a
		// price move, so a hard-coded "08:00Z" valuation made this test pass only
		// when it happened to run after 10:05 Berlin time.
		const quoteAt = new Date().toISOString();
		const at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
		const fake = `#!/bin/sh
set -eu
dir="$XDG_CONFIG_HOME/scalable-cli"
if [ "$1" = login ]; then
  printf 'Open this URL:\\nhttps://login.scalable.capital/device?user_code=TEST-1234\\n\\nVerify the code TEST-1234 in your browser.\\n'
  printf '%s' '{"session":{"access_token":"test-access","refresh_token":"test-refresh"}}' > "$dir/session.json"
  printf '%s' '{"kty":"EC","crv":"P-256","d":"test-scalar"}' > "$dir/auth-signing-key.json"
  exit 0
fi
if [ "$1" = broker ]; then
  case "$2" in
    overview) printf '%s' '{"ok":true,"data":{"account_id":"hosted-account","portfolio_id":"hosted-portfolio","result":{"valuation":{"total":"100"},"timestamps":{"valuation_timestamp_utc":"${at}"}}}}' ;;
    holdings) printf '%s' '{"ok":true,"data":{"account_id":"hosted-account","portfolio_id":"hosted-portfolio","result":{"items":[{"isin":"IE00B4L5Y983","name":"Hosted ETF","quantity":"1","valuation":"100","valuation_currency":"EUR","quote_mid_price":"101","quote_currency":"EUR","quote_timestamp_utc":"${quoteAt}","quote_is_outdated":false}]}}}' ;;
    cash-breakdown) printf '%s' '{"ok":true,"data":{"account_id":"hosted-account","portfolio_id":"hosted-portfolio","result":{"cash_balance":"5"}}}' ;;
    transactions) printf '%s' '{"ok":true,"data":{"account_id":"hosted-account","portfolio_id":"hosted-portfolio","result":{"cursor":null,"items":[]}}}' ;;
    *) exit 9 ;;
  esac
  exit 0
fi
if [ "$1" = logout ]; then exit 0; fi
exit 9
`;
		try {
			await writeFile(binary, fake);
			await chmod(binary, 0o700);
			process.env.FORTUNA_SCALABLE_CLI_BIN = binary;
			const prompt = await beginScalableHostedConnection(userId);
			expect(prompt).toMatchObject({ code: "TEST-1234" });
			let status = await scalableHostedStatus(userId);
			for (let attempt = 0; attempt < 40 && !status.lastSyncAt; attempt++) {
				await new Promise((resolve) => setTimeout(resolve, 50));
				status = await scalableHostedStatus(userId);
			}
			expect(status).toMatchObject({
				configured: true,
				status: "active",
				syncing: false,
			});
			expect(status.lastSyncAt).toBeInstanceOf(Date);
			expect(await syncScalableHostedDue(userId)).toEqual({ attempted: false });
			const confirmed = await currentNetWorth(userId);
			const pulse = await scalableMarketPulse(userId);
			expect(pulse).toMatchObject({
				status: "available",
				deltaMinor: 100,
				confirmedNetWorthMinor: confirmed.netWorthMinor,
				indicativeNetWorthMinor: confirmed.netWorthMinor + 100,
			});
			expect((await currentNetWorth(userId)).netWorthMinor).toBe(
				confirmed.netWorthMinor,
			);
			await disconnectScalableHosted(userId);
			expect((await scalableMarketPulse(userId)).status).toBe("unavailable");
			expect(await scalableHostedStatus(userId)).toMatchObject({
				configured: false,
				status: "disconnected",
			});
		} finally {
			if (previous === undefined) delete process.env.FORTUNA_SCALABLE_CLI_BIN;
			else process.env.FORTUNA_SCALABLE_CLI_BIN = previous;
			await rm(directory, { recursive: true, force: true });
		}
	});
});
