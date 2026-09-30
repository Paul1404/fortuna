import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	CopilotAttachmentError,
	removeCopilotAttachments,
	resolveCopilotAttachments,
	storeCopilotAttachments,
} from "@/server/services/copilot-attachments";

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
});
