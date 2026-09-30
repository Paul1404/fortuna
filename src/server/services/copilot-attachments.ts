import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const UPLOAD_ROOT = "/tmp/fortuna-copilot-uploads";
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

async function readMetadata(id: string): Promise<AttachmentMetadata> {
	const raw = JSON.parse(
		await readFile(join(directoryFor(id), "meta.json"), "utf8"),
	) as AttachmentMetadata;
	if (raw.id !== id || Date.now() - raw.createdAt > EXPIRES_MS) {
		await rm(directoryFor(id), { recursive: true, force: true });
		throw new CopilotAttachmentError("Der Anhang ist abgelaufen");
	}
	return raw;
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
	await mkdir(UPLOAD_ROOT, { recursive: true, mode: 0o700 });
	await sweepExpiredUploads();
	const stored: CopilotAttachmentSummary[] = [];
	for (const { file, kind } of classified) {
		const id = randomUUID();
		const directory = directoryFor(id);
		await mkdir(directory, { recursive: true, mode: 0o700 });
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
		await writeFile(
			join(directory, fileName),
			Buffer.from(await file.arrayBuffer()),
			{ mode: 0o600 },
		);
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
		await writeFile(join(directory, "meta.json"), JSON.stringify(metadata), {
			mode: 0o600,
		});
		stored.push(metadata);
		const timer = setTimeout(() => {
			void rm(directory, { recursive: true, force: true });
		}, EXPIRES_MS);
		timer.unref?.();
	}
	return stored;
}

/**
 * The per-upload timer only lives as long as the process. Uploaded statements
 * and policies are plaintext on disk, so every new upload also clears anything
 * older than the expiry that a crash or restart left behind.
 */
async function sweepExpiredUploads(): Promise<void> {
	try {
		const entries = await readdir(UPLOAD_ROOT, { withFileTypes: true });
		const cutoff = Date.now() - EXPIRES_MS;
		await Promise.all(
			entries
				.filter((entry) => entry.isDirectory() && ID_PATTERN.test(entry.name))
				.map(async (entry) => {
					const directory = join(UPLOAD_ROOT, entry.name);
					try {
						const raw = JSON.parse(
							await readFile(join(directory, "meta.json"), "utf8"),
						) as { createdAt?: number };
						if (typeof raw.createdAt === "number" && raw.createdAt > cutoff)
							return;
					} catch {
						// Unreadable metadata: the directory cannot be used anyway.
					}
					await rm(directory, { recursive: true, force: true });
				}),
		);
	} catch {
		// A missing or unreadable upload root is not worth failing an upload for.
	}
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
		const path = join(directoryFor(id), metadata.fileName);
		if (metadata.kind === "image") {
			promptText += `\nAnhang ${metadata.name} (attachment_id=${metadata.id}): Bilddatei.`;
			if (inputs.length < MAX_IMAGE_INPUTS)
				inputs.push({ type: "localImage", path });
		} else if (metadata.kind === "pdf") {
			const pdf = await pdfInputs(metadata, path);
			const remaining = Math.max(0, MAX_CONTEXT_CHARS - promptText.length);
			promptText += pdf.text.slice(0, remaining);
			inputs.push(
				...pdf.images.slice(0, Math.max(0, MAX_IMAGE_INPUTS - inputs.length)),
			);
		} else {
			const text = (await readFile(path)).toString("utf8").replaceAll("\0", "");
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
	const path = join(directoryFor(id), metadata.fileName);
	const content = await readFile(path);
	let extractedText: string | null = null;
	if (metadata.kind === "text") {
		extractedText = content
			.toString("utf8")
			.replaceAll("\0", "")
			.slice(0, MAX_CONTEXT_CHARS);
	} else if (metadata.kind === "pdf") {
		try {
			const { stdout } = await execFileAsync(
				"pdftotext",
				["-f", "1", "-l", "20", "-layout", path, "-"],
				{ encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 20_000 },
			);
			extractedText = stdout.trim() ? stdout.slice(0, MAX_CONTEXT_CHARS) : null;
		} catch {
			extractedText = null;
		}
	}
	return { metadata, content, extractedText };
}

export async function removeCopilotAttachments(ids: string[]) {
	await Promise.all(
		ids
			.filter((id) => ID_PATTERN.test(id))
			.map((id) => rm(directoryFor(id), { recursive: true, force: true })),
	);
}
