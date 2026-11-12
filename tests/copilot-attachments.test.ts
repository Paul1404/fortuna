import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const shared = vi.hoisted(() => ({
	mode: "local" as "local" | "object_storage",
	objects: new Map<string, { body: Uint8Array; lastModified: Date | null }>(),
	failMetadataReads: false,
	pauseMetadataWrite: false,
	metadataWritePaused: false,
	releaseMetadataWrite: null as (() => void) | null,
}));

vi.mock("@/server/object-storage", () => ({
	objectStorageMode: () => shared.mode,
	putPrivateObject: async (key: string, body: Uint8Array) => {
		if (key.endsWith("/metadata.aesgcm") && shared.pauseMetadataWrite) {
			shared.pauseMetadataWrite = false;
			shared.metadataWritePaused = true;
			await new Promise<void>((resolve) => {
				shared.releaseMetadataWrite = resolve;
			});
			shared.pauseMetadataWrite = false;
			shared.metadataWritePaused = false;
		}
		shared.objects.set(key, {
			body: Uint8Array.from(body),
			lastModified: new Date(),
		});
	},
	getPrivateObject: async (key: string) => {
		if (key.endsWith("/metadata.aesgcm") && shared.failMetadataReads)
			throw new Error("temporary storage read failure");
		const object = shared.objects.get(key);
		if (!object) throw new Error("not found");
		return object.body;
	},
	deletePrivateObject: async (key: string) => {
		shared.objects.delete(key);
	},
	listPrivateObjects: async (prefix: string) =>
		Array.from(shared.objects, ([key, object]) => ({
			key,
			lastModified: object.lastModified,
		})).filter((object) => object.key.startsWith(prefix)),
}));

vi.mock("@/server/crypto", () => ({
	encryptBytes: (content: Buffer) => `test:${content.toString("base64")}`,
	decryptBytes: (payload: string) => {
		if (!payload.startsWith("test:"))
			throw new Error("invalid encrypted payload");
		return Buffer.from(payload.slice(5), "base64");
	},
}));

const {
	CopilotAttachmentError,
	removeCopilotAttachments,
	resolveCopilotAttachments,
	storeCopilotAttachments,
	sweepCopilotAttachments,
} = await import("@/server/services/copilot-attachments");

function metadataObject(id: string) {
	const stored = shared.objects.get(
		`copilot-attachments/${id}/metadata.aesgcm`,
	);
	if (!stored) throw new Error("metadata missing");
	const payload = Buffer.from(stored.body).toString("utf8").slice(5);
	return JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as Record<
		string,
		unknown
	>;
}

function setMetadata(id: string, value: Record<string, unknown>) {
	shared.objects.set(`copilot-attachments/${id}/metadata.aesgcm`, {
		body: Buffer.from(
			`test:${Buffer.from(JSON.stringify(value)).toString("base64")}`,
		),
		lastModified: new Date(),
	});
}

beforeEach(() => {
	shared.mode = "local";
	shared.objects.clear();
	shared.failMetadataReads = false;
	shared.pauseMetadataWrite = false;
	shared.metadataWritePaused = false;
	shared.releaseMetadataWrite = null;
});

afterEach(() => {
	vi.useRealTimers();
});

describe("Copilot attachments", () => {
	it("stores and resolves pasted text files only for their owner", async () => {
		const [stored] = await storeCopilotAttachments("owner-a", [
			new File(["Betrag;Text\n12,50;Bäcker"], "umsatz.csv", {
				type: "text/csv",
			}),
		]);
		const resolved = await resolveCopilotAttachments("owner-a", [stored.id]);
		expect(resolved.promptText).toContain("umsatz.csv");
		expect(resolved.promptText).toContain("12,50;Bäcker");
		expect(resolved.inputs).toEqual([]);
		await expect(
			resolveCopilotAttachments("owner-b", [stored.id]),
		).rejects.toThrow("Anhang nicht gefunden");
		await removeCopilotAttachments([stored.id]);
	});

	it("passes supported images as local image inputs", async () => {
		const [stored] = await storeCopilotAttachments("owner-a", [
			new File([new Uint8Array([137, 80, 78, 71])], "beleg.png", {
				type: "image/png",
			}),
		]);
		const resolved = await resolveCopilotAttachments("owner-a", [stored.id]);
		expect(resolved.inputs[0]?.type).toBe("localImage");
		if (resolved.inputs[0]?.type === "localImage") {
			expect(existsSync(resolved.inputs[0].path)).toBe(true);
		}
		await removeCopilotAttachments([stored.id]);
	});

	it("rejects unsupported binary documents", async () => {
		await expect(
			storeCopilotAttachments("owner-a", [
				new File(["binary"], "vertrag.docx", {
					type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				}),
			]),
		).rejects.toBeInstanceOf(CopilotAttachmentError);
	});

	it("stores encrypted shared objects that another replica can resolve", async () => {
		shared.mode = "object_storage";
		const [stored] = await storeCopilotAttachments("owner-a", [
			new File(["private statement text"], "statement.csv", {
				type: "text/csv",
			}),
		]);
		const contentObject = shared.objects.get(
			`copilot-attachments/${stored.id}/content.aesgcm`,
		);
		expect(contentObject).toBeDefined();
		expect(
			Buffer.from(contentObject?.body ?? []).toString("utf8"),
		).not.toContain("private statement text");
		expect(existsSync(`/tmp/fortuna-copilot-uploads/${stored.id}`)).toBe(false);
		const fromAnotherReplica = await resolveCopilotAttachments("owner-a", [
			stored.id,
		]);
		expect(fromAnotherReplica.promptText).toContain("private statement text");
		await expect(
			resolveCopilotAttachments("owner-b", [stored.id]),
		).rejects.toThrow("Anhang nicht gefunden");
		await removeCopilotAttachments([stored.id]);
	});

	it("cleans staged images after an interrupted turn while retaining the shared upload", async () => {
		shared.mode = "object_storage";
		vi.useFakeTimers();
		const [stored] = await storeCopilotAttachments("owner-a", [
			new File([new Uint8Array([137, 80, 78, 71])], "beleg.png", {
				type: "image/png",
			}),
		]);
		const resolved = await resolveCopilotAttachments("owner-a", [stored.id]);
		const imageInput = resolved.inputs[0];
		if (imageInput?.type !== "localImage") throw new Error("image missing");
		expect(existsSync(imageInput.path)).toBe(true);
		await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
		await vi.waitFor(() => expect(existsSync(imageInput.path)).toBe(false));
		expect(
			shared.objects.has(`copilot-attachments/${stored.id}/content.aesgcm`),
		).toBe(true);
		await removeCopilotAttachments([stored.id]);
	});

	it("does not delete a partial object while a concurrent upload writes metadata", async () => {
		shared.mode = "object_storage";
		shared.pauseMetadataWrite = true;
		const firstUpload = storeCopilotAttachments("owner-a", [
			new File(["first"], "first.txt", { type: "text/plain" }),
		]);
		await vi.waitFor(() => expect(shared.metadataWritePaused).toBe(true));
		const second = await storeCopilotAttachments("owner-a", [
			new File(["second"], "second.txt", { type: "text/plain" }),
		]);
		const firstId = Array.from(shared.objects.keys())
			.map((key) => key.match(/^copilot-attachments\/([0-9a-f-]{36})\/content/))
			.find(Boolean)?.[1];
		expect(firstId).toBeDefined();
		expect(
			shared.objects.has(`copilot-attachments/${firstId}/content.aesgcm`),
		).toBe(true);
		shared.releaseMetadataWrite?.();
		const [first] = await firstUpload;
		await expect(
			resolveCopilotAttachments("owner-a", [first.id, second[0].id]),
		).resolves.toMatchObject({ promptText: expect.stringContaining("first") });
		await removeCopilotAttachments([first.id, second[0].id]);
	});

	it("preserves partial objects when S3 omits LastModified", async () => {
		shared.mode = "object_storage";
		const id = "00000000-0000-4000-8000-000000000001";
		shared.objects.set(`copilot-attachments/${id}/content.aesgcm`, {
			body: Buffer.from("encrypted partial"),
			lastModified: null,
		});
		const result = await sweepCopilotAttachments({ strict: false });
		expect(result.skipped).toBe(1);
		expect(shared.objects.has(`copilot-attachments/${id}/content.aesgcm`)).toBe(
			true,
		);
	});

	it("keeps objects after transient metadata reads and cleans expired data on a later sweep", async () => {
		shared.mode = "object_storage";
		const [stored] = await storeCopilotAttachments("owner-a", [
			new File(["expiring"], "short.txt", { type: "text/plain" }),
		]);
		setMetadata(stored.id, {
			...metadataObject(stored.id),
			createdAt: Date.now() - 31 * 60 * 1000,
		});
		shared.failMetadataReads = true;
		await sweepCopilotAttachments();
		expect(
			shared.objects.has(`copilot-attachments/${stored.id}/content.aesgcm`),
		).toBe(true);
		shared.failMetadataReads = false;
		await sweepCopilotAttachments();
		expect(
			shared.objects.has(`copilot-attachments/${stored.id}/content.aesgcm`),
		).toBe(false);
	});
});
