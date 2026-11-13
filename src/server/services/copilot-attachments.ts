import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import { decryptBytes, encryptBytes } from "@/server/crypto";
import {
	deletePrivateObject,
	getPrivateObject,
	listPrivateObjects,
	objectStorageMode,
	putPrivateObject,
} from "@/server/object-storage";

const execFileAsync = promisify(execFile);
const UPLOAD_ROOT = "/tmp/fortuna-copilot-uploads";
const OBJECT_PREFIX = "copilot-attachments/";
const MAX_FILES = 8;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_CONTEXT_CHARS = 300_000;
const MAX_IMAGE_INPUTS = 8;
const EXPIRES_MS = 30 * 60 * 1000;
const ID_PATTERN = /^[0-9a-f-]{36}$/i;

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const IMAGE_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
]);
const TEXT_EXTENSIONS = new Set([
	".txt",
	".md",
	".csv",
	".json",
	".tsv",
	".xml",
]);

type AttachmentKind = "image" | "pdf" | "text";
type AttachmentMetadata = {
	id: string;
	userId: string;
	name: string;
	type: string;
	size: number;
	kind: AttachmentKind;
	createdAt: number;
	fileName: string;
};

type AttachmentStorageMode = "local" | "object_storage";
export type CopilotAttachmentSweepResult = {
	mode: AttachmentStorageMode;
	checked: number;
	deleted: number;
	deferred: number;
	skipped: number;
	errors: number;
};

export type CopilotAttachmentSummary = Pick<
	AttachmentMetadata,
	"id" | "name" | "type" | "size" | "kind"
>;
export type CopilotTurnAttachmentInput =
	| { type: "localImage"; path: string }
	| { type: "text"; text: string };

export class CopilotAttachmentError extends Error {}

function classify(file: File): AttachmentKind | null {
	const extension = extname(file.name).toLowerCase();
	if (IMAGE_TYPES.has(file.type) || IMAGE_EXTENSIONS.has(extension))
		return "image";
	if (file.type === "application/pdf" || extension === ".pdf") return "pdf";
	if (
		file.type.startsWith("text/") ||
		file.type === "application/json" ||
		TEXT_EXTENSIONS.has(extension)
	)
		return "text";
	return null;
}

function safeName(name: string) {
	return (
		name
			.replace(/[\r\n\0]/g, " ")
			.trim()
			.slice(0, 180) || "Anhang"
	);
}

function directoryFor(id: string) {
	if (!ID_PATTERN.test(id))
		throw new CopilotAttachmentError("Ungültiger Anhang");
	return join(UPLOAD_ROOT, id);
}

function objectKey(id: string, part: "metadata" | "content") {
	if (!ID_PATTERN.test(id))
		throw new CopilotAttachmentError("Ungültiger Anhang");
	return `${OBJECT_PREFIX}${id}/${part}.aesgcm`;
}

function attachmentStorageMode(): AttachmentStorageMode {
	const mode = objectStorageMode();
	if (mode === "invalid")
		throw new CopilotAttachmentError("Der Anhangsspeicher ist nicht verfügbar");
	return mode === "object_storage" ? "object_storage" : "local";
}

async function readStoredMetadata(id: string, mode: AttachmentStorageMode) {
	let raw: string;
	if (mode === "object_storage") {
		const encrypted = Buffer.from(
			await getPrivateObject(objectKey(id, "metadata")),
		).toString("utf8");
		raw = decryptBytes(encrypted).toString("utf8");
	} else raw = await readFile(join(directoryFor(id), "meta.json"), "utf8");
	try {
		return JSON.parse(raw) as AttachmentMetadata;
	} catch {
		throw new CopilotAttachmentError("Anhang nicht gefunden");
	}
}

async function readMetadata(id: string): Promise<AttachmentMetadata> {
	const mode = attachmentStorageMode();
	let raw: AttachmentMetadata;
	try {
		raw = await readStoredMetadata(id, mode);
	} catch {
		throw new CopilotAttachmentError("Anhang nicht gefunden");
	}
	if (
		raw.id !== id ||
		typeof raw.userId !== "string" ||
		typeof raw.name !== "string" ||
		typeof raw.type !== "string" ||
		!Number.isInteger(raw.size) ||
		raw.size <= 0 ||
		raw.size > MAX_FILE_BYTES ||
		!new Set<AttachmentKind>(["image", "pdf", "text"]).has(raw.kind) ||
		basename(raw.fileName) !== raw.fileName ||
		!Number.isFinite(raw.createdAt) ||
		Date.now() - raw.createdAt < 0 ||
		Date.now() - raw.createdAt > EXPIRES_MS
	) {
		await removeCopilotAttachments([id]);
		throw new CopilotAttachmentError("Der Anhang ist abgelaufen");
	}
	return raw;
}

async function readContent(metadata: AttachmentMetadata) {
	let content: Buffer;
	try {
		if (attachmentStorageMode() === "object_storage") {
			const encrypted = Buffer.from(
				await getPrivateObject(objectKey(metadata.id, "content")),
			).toString("utf8");
			content = decryptBytes(encrypted);
		} else
			content = await readFile(
				join(directoryFor(metadata.id), metadata.fileName),
			);
	} catch {
		throw new CopilotAttachmentError("Anhang nicht gefunden");
	}
	if (
		content.byteLength > MAX_FILE_BYTES ||
		content.byteLength !== metadata.size
	)
		throw new CopilotAttachmentError("Anhang nicht gefunden");
	return content;
}

function scheduleLocalCleanup(directory: string) {
	const timer = setTimeout(() => {
		void rm(directory, { recursive: true, force: true });
	}, EXPIRES_MS);
	timer.unref?.();
}

async function stageLocalAttachment(
	metadata: AttachmentMetadata,
	content: Uint8Array,
) {
	const directory = directoryFor(metadata.id);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await writeFile(join(directory, metadata.fileName), content, { mode: 0o600 });
	await writeFile(join(directory, "meta.json"), JSON.stringify(metadata), {
		mode: 0o600,
	});
	scheduleLocalCleanup(directory);
	return join(directory, metadata.fileName);
}

export async function storeCopilotAttachments(
	userId: string,
	files: File[],
): Promise<CopilotAttachmentSummary[]> {
	if (files.length === 0)
		throw new CopilotAttachmentError("Keine Datei ausgewählt");
	if (files.length > MAX_FILES)
		throw new CopilotAttachmentError("Maximal 8 Anhänge pro Nachricht");
	if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES)
		throw new CopilotAttachmentError("Anhänge sind zusammen größer als 25 MB");
	const classified = files.map((file) => {
		const kind = classify(file);
		if (!kind)
			throw new CopilotAttachmentError(
				`${safeName(file.name)} wird nicht unterstützt. Möglich sind Bilder, PDF, Text, Markdown, CSV, TSV, JSON und XML.`,
			);
		if (file.size <= 0 || file.size > MAX_FILE_BYTES)
			throw new CopilotAttachmentError(
				`${safeName(file.name)} ist leer oder größer als 10 MB`,
			);
		if (kind === "text" && file.size > MAX_TEXT_BYTES)
			throw new CopilotAttachmentError(
				`${safeName(file.name)} ist als Textdatei größer als 2 MB`,
			);
		return { file, kind };
	});
	const mode = attachmentStorageMode();
	if (mode === "local")
		await mkdir(UPLOAD_ROOT, { recursive: true, mode: 0o700 });
	await sweepExpiredUploads(mode);
	const stored: CopilotAttachmentSummary[] = [];
	for (const { file, kind } of classified) {
		const id = randomUUID();
		const inferredExtension =
			file.type === "image/png"
				? ".png"
				: file.type === "image/jpeg"
					? ".jpg"
					: file.type === "image/webp"
						? ".webp"
						: file.type === "image/gif"
							? ".gif"
							: file.type === "application/pdf"
								? ".pdf"
								: "";
		const extension =
			extname(file.name)
				.toLowerCase()
				.replace(/[^.a-z0-9]/g, "")
				.slice(0, 10) || inferredExtension;
		const fileName = `attachment${extension}`;
		const content = Buffer.from(await file.arrayBuffer());
		const metadata: AttachmentMetadata = {
			id,
			userId,
			name: safeName(file.name),
			type: file.type || "application/octet-stream",
			size: file.size,
			kind,
			createdAt: Date.now(),
			fileName,
		};
		if (mode === "object_storage") {
			try {
				await putPrivateObject(
					objectKey(id, "content"),
					Buffer.from(encryptBytes(content), "utf8"),
				);
				await putPrivateObject(
					objectKey(id, "metadata"),
					Buffer.from(
						encryptBytes(Buffer.from(JSON.stringify(metadata))),
						"utf8",
					),
				);
			} catch {
				await Promise.all([
					deletePrivateObject(objectKey(id, "content")).catch(() => undefined),
					deletePrivateObject(objectKey(id, "metadata")).catch(() => undefined),
				]);
				throw new CopilotAttachmentError(
					"Der Anhang konnte nicht sicher gespeichert werden",
				);
			}
		} else {
			const directory = directoryFor(id);
			await mkdir(directory, { recursive: true, mode: 0o700 });
			await writeFile(join(directory, fileName), content, { mode: 0o600 });
			await writeFile(join(directory, "meta.json"), JSON.stringify(metadata), {
				mode: 0o600,
			});
		}
		stored.push(metadata);
		if (mode === "local") scheduleLocalCleanup(directoryFor(id));
	}
	return stored;
}

/**
 * Remove expired local uploads and shared attachment objects.
 */
async function sweepExpiredUploads(
	mode: AttachmentStorageMode,
): Promise<CopilotAttachmentSweepResult> {
	const result: CopilotAttachmentSweepResult = {
		mode,
		checked: 0,
		deleted: 0,
		deferred: 0,
		skipped: 0,
		errors: 0,
	};
	if (mode === "object_storage") {
		let objects: Awaited<ReturnType<typeof listPrivateObjects>>;
		try {
			objects = await listPrivateObjects(OBJECT_PREFIX);
		} catch {
			result.errors += 1;
			return result;
		}
		const byId = new Map<string, Map<string, Date | null>>();
		for (const object of objects) {
			const match = object.key.match(
				/^copilot-attachments\/([0-9a-f-]{36})\/(metadata|content)\.aesgcm$/i,
			);
			if (!match) continue;
			const parts = byId.get(match[1]) ?? new Map();
			parts.set(match[2], object.lastModified);
			byId.set(match[1], parts);
		}
		for (const [id, parts] of byId) {
			result.checked += 1;
			if (!parts.has("metadata")) {
				// Allow five extra minutes for uploads to write metadata.
				const lastModified = parts.get("content")?.getTime();
				if (lastModified === undefined || !Number.isFinite(lastModified)) {
					result.skipped += 1;
					continue;
				}
				if (Date.now() - lastModified <= EXPIRES_MS + 5 * 60 * 1000) {
					result.deferred += 1;
					continue;
				}
				try {
					await removeCopilotAttachments([id]);
					result.deleted += 1;
				} catch {
					result.errors += 1;
				}
				continue;
			}
			try {
				const metadata = await readStoredMetadata(id, mode);
				if (
					metadata.id === id &&
					Number.isFinite(metadata.createdAt) &&
					Date.now() - metadata.createdAt >= 0 &&
					Date.now() - metadata.createdAt > EXPIRES_MS
				) {
					await removeCopilotAttachments([id]);
					result.deleted += 1;
				} else result.deferred += 1;
			} catch {
				// Leave unreadable metadata for the next sweep.
				result.skipped += 1;
			}
		}
		return result;
	}
	let entries: Dirent[];
	try {
		entries = await readdir(UPLOAD_ROOT, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return result;
		result.errors += 1;
		return result;
	}
	for (const entry of entries.filter(
		(entry) => entry.isDirectory() && ID_PATTERN.test(entry.name),
	)) {
		result.checked += 1;
		const directory = join(UPLOAD_ROOT, entry.name);
		let createdAt: number | undefined;
		try {
			const raw = JSON.parse(
				await readFile(join(directory, "meta.json"), "utf8"),
			) as { createdAt?: number };
			createdAt = raw.createdAt;
		} catch {
			// Allow time for an upload to write its metadata.
		}
		if (typeof createdAt === "number" && Date.now() - createdAt <= EXPIRES_MS) {
			result.deferred += 1;
			continue;
		}
		if (createdAt === undefined) {
			try {
				const info = await stat(directory);
				if (Date.now() - info.mtimeMs <= EXPIRES_MS + 5 * 60 * 1000) {
					result.deferred += 1;
					continue;
				}
			} catch {
				result.errors += 1;
				continue;
			}
		}
		try {
			await rm(directory, { recursive: true, force: true });
			result.deleted += 1;
		} catch {
			result.errors += 1;
		}
	}
	return result;
}

/** Run one TTL sweep. Strict callers can fail their job when cleanup is incomplete. */
export async function sweepCopilotAttachments(
	options: { strict?: boolean } = {},
) {
	const mode = attachmentStorageMode();
	if (mode === "local")
		await mkdir(UPLOAD_ROOT, { recursive: true, mode: 0o700 });
	const result = await sweepExpiredUploads(mode);
	if (options.strict && (result.errors > 0 || result.skipped > 0))
		throw new Error(
			`Attachment cleanup incomplete: ${result.errors} error(s), ${result.skipped} skipped`,
		);
	return result;
}

async function pdfInputs(metadata: AttachmentMetadata, path: string) {
	try {
		const { stdout } = await execFileAsync(
			"pdftotext",
			["-f", "1", "-l", "20", "-layout", path, "-"],
			{ encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 20_000 },
		);
		if (stdout.trim().length >= 40) {
			return {
				text: `\n<attachment id="${metadata.id}" name=${JSON.stringify(metadata.name)} type="pdf">\n${stdout.slice(0, MAX_CONTEXT_CHARS)}\n</attachment>`,
				images: [] as CopilotTurnAttachmentInput[],
			};
		}
	} catch {
		// Scanned PDFs fall back to images below.
	}
	const pagesDirectory = join(directoryFor(metadata.id), "pages");
	await mkdir(pagesDirectory, { recursive: true, mode: 0o700 });
	try {
		await execFileAsync(
			"pdftoppm",
			[
				"-f",
				"1",
				"-l",
				"4",
				"-jpeg",
				"-scale-to",
				"1600",
				path,
				join(pagesDirectory, "page"),
			],
			{ timeout: 30_000 },
		);
	} catch {
		throw new CopilotAttachmentError(
			`${metadata.name} konnte nicht gelesen werden`,
		);
	}
	const pages = (await readdir(pagesDirectory))
		.filter((name) => name.endsWith(".jpg"))
		.sort()
		.map((name) => ({
			type: "localImage" as const,
			path: join(pagesDirectory, name),
		}));
	if (pages.length === 0)
		throw new CopilotAttachmentError(
			`${metadata.name} enthält keine lesbaren Seiten`,
		);
	return {
		text: `\nAnhang ${metadata.name} (attachment_id=${metadata.id}): gescanntes PDF, Seiten als Bilder.`,
		images: pages,
	};
}

export async function resolveCopilotAttachments(
	userId: string,
	ids: string[],
): Promise<{ promptText: string; inputs: CopilotTurnAttachmentInput[] }> {
	if (ids.length > MAX_FILES)
		throw new CopilotAttachmentError("Maximal 8 Anhänge pro Nachricht");
	let promptText = "";
	const inputs: CopilotTurnAttachmentInput[] = [];
	for (const id of ids) {
		const metadata = await readMetadata(id);
		if (metadata.userId !== userId)
			throw new CopilotAttachmentError("Anhang nicht gefunden");
		const content = await readContent(metadata);
		if (metadata.kind === "image") {
			promptText += `\nAnhang ${metadata.name} (attachment_id=${metadata.id}): Bilddatei.`;
			if (inputs.length < MAX_IMAGE_INPUTS) {
				const path = await stageLocalAttachment(metadata, content);
				inputs.push({ type: "localImage", path });
			}
		} else if (metadata.kind === "pdf") {
			const path = await stageLocalAttachment(metadata, content);
			const pdf = await pdfInputs(metadata, path);
			const remaining = Math.max(0, MAX_CONTEXT_CHARS - promptText.length);
			promptText += pdf.text.slice(0, remaining);
			inputs.push(
				...pdf.images.slice(0, Math.max(0, MAX_IMAGE_INPUTS - inputs.length)),
			);
		} else {
			const text = content.toString("utf8").replaceAll("\0", "");
			const remaining = Math.max(0, MAX_CONTEXT_CHARS - promptText.length);
			promptText += `\n<attachment id="${metadata.id}" name=${JSON.stringify(metadata.name)} type="text">\n${text.slice(0, remaining)}\n</attachment>`;
		}
	}
	return { promptText, inputs };
}

export async function readCopilotAttachment(
	userId: string,
	id: string,
): Promise<{
	metadata: CopilotAttachmentSummary;
	content: Buffer;
	extractedText: string | null;
}> {
	const metadata = await readMetadata(id);
	if (metadata.userId !== userId)
		throw new CopilotAttachmentError("Anhang nicht gefunden");
	const content = await readContent(metadata);
	let extractedText: string | null = null;
	if (metadata.kind === "text") {
		extractedText = content
			.toString("utf8")
			.replaceAll("\0", "")
			.slice(0, MAX_CONTEXT_CHARS);
	} else if (metadata.kind === "pdf") {
		const path = await stageLocalAttachment(metadata, content);
		try {
			const { stdout } = await execFileAsync(
				"pdftotext",
				["-f", "1", "-l", "20", "-layout", path, "-"],
				{ encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 20_000 },
			);
			extractedText = stdout.trim() ? stdout.slice(0, MAX_CONTEXT_CHARS) : null;
		} catch {
			extractedText = null;
		} finally {
			await rm(directoryFor(id), { recursive: true, force: true });
		}
	}
	return { metadata, content, extractedText };
}

export async function removeCopilotAttachments(ids: string[]) {
	await Promise.all(
		ids
			.filter((id) => ID_PATTERN.test(id))
			.map(async (id) => {
				await Promise.all([
					rm(directoryFor(id), { recursive: true, force: true }),
					deletePrivateObject(objectKey(id, "metadata")),
					deletePrivateObject(objectKey(id, "content")),
				]);
			}),
	);
}
