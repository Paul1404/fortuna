import { ORPCError } from "@orpc/server";
import { desc, eq } from "drizzle-orm";
import {
	type ColumnMapping,
	guessDateFormat,
	guessMapping,
	mapRows,
	parseCsv,
} from "@/domain/csv";
import { db } from "@/server/db";
import { type ImportJob, importJobs } from "@/server/db/schema";
import { logger } from "@/server/logger";
import { getAccount } from "./accounts";
import { insertTransactions } from "./transactions";

export type CsvPreview = {
	header: string[];
	sampleRows: string[][];
	totalRows: number;
	suggestedMapping: Partial<ColumnMapping>;
	delimiter: string;
};

export async function previewCsv(
	userId: string,
	input: { accountId: string; content: string },
): Promise<CsvPreview> {
	await getAccount(userId, input.accountId);
	const rows = parseCsv(input.content);
	if (rows.length < 2)
		throw new ORPCError("BAD_REQUEST", {
			message: "Die Datei enthält keine Datenzeilen",
		});
	const header = rows[0];
	const guess = guessMapping(header);
	if (guess.bookingDate !== undefined) {
		guess.dateFormat = guessDateFormat(
			rows.slice(1, 20).map((r) => r[guess.bookingDate as number] ?? ""),
		);
	}
	const delimiter = input.content.split("\n")[0].includes(";")
		? ";"
		: input.content.split("\n")[0].includes("\t")
			? "\t"
			: ",";
	return {
		header,
		sampleRows: rows.slice(1, 6),
		totalRows: rows.length - 1,
		suggestedMapping: guess,
		delimiter,
	};
}

export async function commitCsv(
	userId: string,
	input: {
		accountId: string;
		fileName: string;
		content: string;
		mapping: ColumnMapping;
		hasHeader?: boolean;
	},
): Promise<ImportJob> {
	await getAccount(userId, input.accountId);
	const parsed = parseCsv(input.content);
	const { rows, errors } = mapRows(parsed, input.mapping, {
		hasHeader: input.hasHeader ?? true,
	});
	const log = errors.slice(0, 50).map((e) => `Zeile ${e.row}: ${e.message}`);
	if (rows.length === 0) {
		const [job] = await db
			.insert(importJobs)
			.values({
				userId,
				kind: "csv",
				accountId: input.accountId,
				fileName: input.fileName,
				status: "failed",
				totalRows: parsed.length - 1,
				errorRows: errors.length,
				log: ["Keine importierbaren Zeilen", ...log],
			})
			.returning();
		return job;
	}
	const job = await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(importJobs)
			.values({
				userId,
				kind: "csv",
				accountId: input.accountId,
				fileName: input.fileName,
				status: "completed",
				totalRows: rows.length + errors.length,
			})
			.returning();
		const result = await insertTransactions(
			userId,
			input.accountId,
			rows,
			{ importSource: "csv", importJobId: created.id },
			tx,
		);
		const [updated] = await tx
			.update(importJobs)
			.set({
				importedRows: result.inserted.length,
				duplicateRows: result.duplicates,
				errorRows: errors.length,
				status: errors.length > 0 ? "partial" : "completed",
				log: [
					`${result.inserted.length} importiert, ${result.duplicates} Duplikate übersprungen`,
					...log,
				],
			})
			.where(eq(importJobs.id, created.id))
			.returning();
		return updated;
	});
	logger.info("CSV import completed", {
		event: "import.csv.completed",
		jobId: job.id,
		imported: job.importedRows,
		duplicates: job.duplicateRows,
		errors: job.errorRows,
	});
	return job;
}

export async function listImportJobs(
	userId: string,
	limit = 50,
): Promise<ImportJob[]> {
	return db
		.select()
		.from(importJobs)
		.where(eq(importJobs.userId, userId))
		.orderBy(desc(importJobs.createdAt))
		.limit(limit);
}
