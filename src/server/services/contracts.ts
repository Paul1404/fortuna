import { createHash, randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import {
	type ContractCadence,
	type ContractCompletion,
	type ContractPhase,
	contractCostsUntil,
	contractMonthlyCostMinor,
	contractPhase,
	type NoticeDeadline,
	noticeDeadline,
	proposeContractDetails,
} from "@/domain/contract";
import { todayIso } from "@/domain/dates";
import { monthlyEquivalentMinor } from "@/domain/recurring";
import {
	decryptBytes,
	decryptSecret,
	encryptBytes,
	encryptSecret,
} from "@/server/crypto";
import { db } from "@/server/db";
import {
	accounts,
	type Contract,
	type ContractDocument,
	contractDocuments,
	contracts,
	recurringPayments,
	transactions,
} from "@/server/db/schema";
import { logger } from "@/server/logger";
import { providerErrorClass } from "@/server/provider-errors";
import {
	deletePrivateObject,
	getPrivateObject,
	objectStorageAvailable,
	putPrivateObject,
} from "../object-storage";
import {
	readCopilotAttachment,
	removeCopilotAttachments,
} from "./copilot-attachments";

export type ContractRow = Contract & {
	accountName: string | null;
	recurringPaymentName: string | null;
	documents: (Omit<
		ContractDocument,
		"encryptedContent" | "encryptedExtractedText" | "storageKey"
	> & { storage: "object_storage" | "database" })[];
	completeness: number;
	missingFields: string[];
	/** Derived from the dates, never read straight off `status`. */
	phase: ContractPhase;
	/** Last day it costs money, or null when no end is known. */
	costsUntil: string | null;
	/** Monthly cost while it runs; 0 once ended, null when not convertible. */
	monthlyCostMinor: number | null;
	noticeDeadline: NoticeDeadline | null;
	/**
	 * What the linked recurring payment actually costs per month, when that
	 * differs from what the contract says. The contract states the agreement;
	 * the bookings show what really leaves the account, and a gap between them
	 * is worth knowing — a price rise the owner has not noticed.
	 */
	bookedMonthlyCostMinor: number | null;
	/**
	 * Details the linked bookings could fill in, where the contract lacks them
	 * and therefore never reaches the forecast. A proposal, never applied.
	 */
	proposal: ContractCompletion | null;
};

export function contractCompleteness(
	contract: Pick<
		Contract,
		| "provider"
		| "contractNumber"
		| "costMinor"
		| "frequency"
		| "startDate"
		| "endDate"
		| "renewalDate"
		| "cancellationDate"
		| "accountId"
		| "recurringPaymentId"
		| "category"
	> &
		Partial<Pick<Contract, "paidVia">>,
	documents: Pick<ContractDocument, "type">[],
) {
	const checks = [
		{ weight: 15, ok: Boolean(contract.provider), label: "Anbieter" },
		{
			weight: 15,
			ok: Boolean(contract.contractNumber),
			label: "Vertragsnummer",
		},
		{
			weight: 20,
			ok: contract.costMinor !== null && contract.frequency !== null,
			label: "Kosten und Turnus",
		},
		{ weight: 10, ok: Boolean(contract.startDate), label: "Vertragsbeginn" },
		{
			weight: 10,
			ok: Boolean(
				contract.endDate || contract.renewalDate || contract.cancellationDate,
			),
			label: "Laufzeit oder Verlängerung",
		},
		{
			weight: 10,
			// Paid through the salary: no account is debited and no booking
			// will ever arrive, so there is nothing to link.
			ok: Boolean(
				contract.paidVia === "payroll" ||
					contract.accountId ||
					contract.recurringPaymentId,
			),
			label: "Konto oder wiederkehrende Zahlung",
		},
		{
			weight: 20,
			ok:
				documents.length > 0 &&
				(contract.category !== "insurance" ||
					documents.some((document) => document.type === "policy")),
			label:
				contract.category === "insurance"
					? "Versicherungsschein"
					: "Vertragsdokument",
		},
	];
	return {
		completeness: checks.reduce(
			(sum, check) => sum + (check.ok ? check.weight : 0),
			0,
		),
		missingFields: checks
			.filter((check) => !check.ok)
			.map((check) => check.label),
	};
}

export async function listContracts(userId: string): Promise<ContractRow[]> {
	const rows = await db.query.contracts.findMany({
		where: eq(contracts.userId, userId),
		with: { documents: true },
		orderBy: [desc(contracts.updatedAt)],
	});
	const [accountRows, recurringRows] = await Promise.all([
		db
			.select({ id: accounts.id, name: accounts.name })
			.from(accounts)
			.where(eq(accounts.userId, userId)),
		db
			.select({
				id: recurringPayments.id,
				name: recurringPayments.name,
				expectedAmountMinor: recurringPayments.expectedAmountMinor,
				frequency: recurringPayments.frequency,
				intervalDays: recurringPayments.intervalDays,
				currency: recurringPayments.currency,
				// The earliest booking, which is the evidence for a start date.
				// `last_occurrence` is the newest one: it proposed "Beginn" two
				// months ago for a contract that has been paid for years.
				firstSeen: sql<
					string | null
				>`(select min(t.booking_date)::text from ${transactions} t where t.recurring_payment_id = "recurring_payments"."id" and t.status = 'booked')`,
			})
			.from(recurringPayments)
			.where(eq(recurringPayments.userId, userId)),
	]);
	const accountNames = new Map(accountRows.map((row) => [row.id, row.name]));
	const recurringNames = new Map(
		recurringRows.map((row) => [row.id, row.name]),
	);
	const recurringEvidence = new Map(
		recurringRows.map((row) => [
			row.id,
			{
				firstSeen: row.firstSeen,
				amountMinor: row.expectedAmountMinor,
				frequency: row.frequency as ContractCadence,
				currency: row.currency,
			},
		]),
	);
	const recurringMonthly = new Map(
		recurringRows.map((row) => [
			row.id,
			// Stored signed, so an outflow is negative; compared as a magnitude.
			monthlyEquivalentMinor(
				row.expectedAmountMinor,
				row.frequency,
				row.intervalDays ?? 30,
			),
		]),
	);
	const today = todayIso();
	return rows.map(({ documents, ...contract }) => ({
		...contract,
		phase: contractPhase(contract, today),
		costsUntil: contractCostsUntil(contract),
		monthlyCostMinor: contractMonthlyCostMinor(contract, today),
		noticeDeadline: noticeDeadline(contract, today),
		bookedMonthlyCostMinor: contract.recurringPaymentId
			? (recurringMonthly.get(contract.recurringPaymentId) ?? null)
			: null,
		proposal: proposeContractDetails(
			contract,
			contract.recurringPaymentId
				? (recurringEvidence.get(contract.recurringPaymentId) ?? null)
				: null,
		),
		accountName: contract.accountId
			? (accountNames.get(contract.accountId) ?? null)
			: null,
		recurringPaymentName: contract.recurringPaymentId
			? (recurringNames.get(contract.recurringPaymentId) ?? null)
			: null,
		documents: documents.map(
			({
				encryptedContent: _content,
				encryptedExtractedText: _text,
				storageKey,
				...document
			}) => ({
				...document,
				storage: storageKey ? "object_storage" : "database",
			}),
		),
		...contractCompleteness(contract, documents),
	}));
}

async function assertReferences(
	userId: string,
	input: { accountId?: string | null; recurringPaymentId?: string | null },
) {
	if (input.accountId) {
		const row = await db.query.accounts.findFirst({
			where: and(eq(accounts.id, input.accountId), eq(accounts.userId, userId)),
		});
		if (!row)
			throw new ORPCError("BAD_REQUEST", { message: "Konto nicht gefunden" });
	}
	if (input.recurringPaymentId) {
		const row = await db.query.recurringPayments.findFirst({
			where: and(
				eq(recurringPayments.id, input.recurringPaymentId),
				eq(recurringPayments.userId, userId),
			),
		});
		if (!row)
			throw new ORPCError("BAD_REQUEST", {
				message: "Wiederkehrende Zahlung nicht gefunden",
			});
	}
}

type ContractWrite = Omit<
	typeof contracts.$inferInsert,
	"id" | "userId" | "createdAt" | "updatedAt"
>;

export async function createContract(userId: string, input: ContractWrite) {
	await assertReferences(userId, input);
	const [row] = await db
		.insert(contracts)
		.values({ ...input, userId })
		.returning();
	return row;
}

export async function updateContract(
	userId: string,
	input: { id: string } & Partial<ContractWrite>,
) {
	const { id, ...patch } = input;
	await assertReferences(userId, patch);
	const [row] = await db
		.update(contracts)
		.set(patch)
		.where(and(eq(contracts.id, id), eq(contracts.userId, userId)))
		.returning();
	if (!row)
		throw new ORPCError("NOT_FOUND", { message: "Vertrag nicht gefunden" });
	return row;
}

/**
 * Remove a contract and everything attached to it. The encrypted blobs in
 * object storage are not reachable from anywhere else once the rows are gone,
 * so they are deleted here rather than left behind.
 */
export async function deleteContract(
	userId: string,
	id: string,
): Promise<{ documentsDeleted: number }> {
	const contract = await db.query.contracts.findFirst({
		where: and(eq(contracts.id, id), eq(contracts.userId, userId)),
	});
	if (!contract)
		throw new ORPCError("NOT_FOUND", { message: "Vertrag nicht gefunden" });
	const documents = await db
		.select({
			id: contractDocuments.id,
			storageKey: contractDocuments.storageKey,
		})
		.from(contractDocuments)
		.where(eq(contractDocuments.contractId, id));
	// The rows cascade with the contract; the objects behind them do not.
	for (const document of documents) {
		if (!document.storageKey) continue;
		try {
			await deletePrivateObject(document.storageKey);
		} catch (error) {
			logger.error("Contract document object not removed", {
				event: "contract.document.delete_failed",
				contractId: id,
				errorClass: providerErrorClass(error),
			});
		}
	}
	await db
		.delete(contracts)
		.where(and(eq(contracts.id, id), eq(contracts.userId, userId)));
	logger.info("Contract deleted", {
		event: "contract.deleted",
		documentsDeleted: documents.length,
	});
	return { documentsDeleted: documents.length };
}

export async function attachContractDocument(
	userId: string,
	input: {
		contractId: string;
		attachmentId: string;
		type: ContractDocument["type"];
	},
) {
	const contract = await db.query.contracts.findFirst({
		where: and(
			eq(contracts.id, input.contractId),
			eq(contracts.userId, userId),
		),
	});
	if (!contract)
		throw new ORPCError("NOT_FOUND", { message: "Vertrag nicht gefunden" });
	const attachment = await readCopilotAttachment(userId, input.attachmentId);
	const sha256 = createHash("sha256").update(attachment.content).digest("hex");
	const existingDocument = await db.query.contractDocuments.findFirst({
		where: and(
			eq(contractDocuments.contractId, contract.id),
			eq(contractDocuments.sha256, sha256),
		),
	});
	if (existingDocument) {
		await removeCopilotAttachments([input.attachmentId]);
		return {
			id: existingDocument.id,
			fileName: existingDocument.fileName,
			type: existingDocument.type,
			sizeBytes: existingDocument.sizeBytes,
		};
	}
	const encryptedContent = encryptBytes(attachment.content);
	const storageKey = objectStorageAvailable()
		? `contract-documents/${userId}/${contract.id}/${randomUUID()}.aesgcm`
		: null;
	if (storageKey)
		await putPrivateObject(storageKey, Buffer.from(encryptedContent, "utf8"));
	let row: ContractDocument;
	try {
		[row] = await db
			.insert(contractDocuments)
			.values({
				contractId: contract.id,
				type: input.type,
				fileName: attachment.metadata.name,
				mimeType: attachment.metadata.type,
				sizeBytes: attachment.metadata.size,
				sha256,
				encryptedContent: storageKey ? null : encryptedContent,
				storageKey,
				encryptedExtractedText: attachment.extractedText
					? encryptSecret(attachment.extractedText)
					: null,
			})
			.returning();
	} catch (error) {
		if (storageKey) {
			try {
				await deletePrivateObject(storageKey);
			} catch (cleanupError) {
				// The storage key locates the document; the contract id is enough
				// to find the orphan, and the provider message can carry detail.
				logger.error("Contract document cleanup failed", {
					event: "contract.document.cleanup_failed",
					contractId: contract.id,
					errorClass: providerErrorClass(cleanupError),
				});
			}
		}
		throw error;
	}
	await removeCopilotAttachments([input.attachmentId]);
	return {
		id: row.id,
		fileName: row.fileName,
		type: row.type,
		sizeBytes: row.sizeBytes,
	};
}

export async function getContractDocument(userId: string, id: string) {
	const row = await db
		.select({ document: contractDocuments })
		.from(contractDocuments)
		.innerJoin(contracts, eq(contracts.id, contractDocuments.contractId))
		.where(and(eq(contractDocuments.id, id), eq(contracts.userId, userId)))
		.limit(1);
	if (!row[0])
		throw new ORPCError("NOT_FOUND", { message: "Dokument nicht gefunden" });
	const document = row[0].document;
	const encryptedContent = document.storageKey
		? Buffer.from(await getPrivateObject(document.storageKey)).toString("utf8")
		: document.encryptedContent;
	if (!encryptedContent)
		throw new ORPCError("NOT_FOUND", { message: "Dokument nicht gefunden" });

	// Old database-backed documents move to object storage on their next access.
	if (!document.storageKey && objectStorageAvailable()) {
		const storageKey = `contract-documents/${userId}/${document.contractId}/${document.id}.aesgcm`;
		await putPrivateObject(storageKey, Buffer.from(encryptedContent, "utf8"));
		await db
			.update(contractDocuments)
			.set({ storageKey, encryptedContent: null })
			.where(eq(contractDocuments.id, document.id));
	}
	return {
		fileName: document.fileName,
		mimeType: document.mimeType,
		content: decryptBytes(encryptedContent),
	};
}

export async function getContractDocumentText(userId: string, id: string) {
	const row = await db
		.select({ text: contractDocuments.encryptedExtractedText })
		.from(contractDocuments)
		.innerJoin(contracts, eq(contracts.id, contractDocuments.contractId))
		.where(and(eq(contractDocuments.id, id), eq(contracts.userId, userId)))
		.limit(1);
	if (!row[0])
		throw new ORPCError("NOT_FOUND", { message: "Dokument nicht gefunden" });
	return {
		id,
		text: row[0].text ? decryptSecret(row[0].text) : null,
	};
}
