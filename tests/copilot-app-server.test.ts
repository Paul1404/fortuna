import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A scripted stand-in for the Codex App Server child, so the lifecycle in
// `copilot.ts` runs without spawning anything or touching the real state
// directory under /tmp.

type Request = { id: number; method: string; params: Record<string, unknown> };
type Script = (request: Request, server: FakeServer) => void;

class FakeServer extends EventEmitter {
	stdin = new PassThrough();
	stdout = new PassThrough();
	stderr = new PassThrough();
	requests: Request[] = [];
	constructor(private script: Script) {
		super();
		let buffer = "";
		this.stdin.on("data", (chunk: Buffer) => {
			buffer += chunk.toString();
			let index = buffer.indexOf("\n");
			while (index !== -1) {
				const line = buffer.slice(0, index);
				buffer = buffer.slice(index + 1);
				index = buffer.indexOf("\n");
				const message = JSON.parse(line) as Partial<Request>;
				if (typeof message.id !== "number" || !message.method) continue;
				const request = message as Request;
				this.requests.push(request);
				if (request.method === "initialize") this.reply(request.id, {});
				else this.script(request, this);
			}
		});
	}
	reply(id: number, result: unknown) {
		this.stdout.write(`${JSON.stringify({ id, result })}\n`);
	}
	fail(id: number, message: string) {
		this.stdout.write(`${JSON.stringify({ id, error: { message } })}\n`);
	}
	notify(method: string, params: Record<string, unknown>) {
		this.stdout.write(`${JSON.stringify({ method, params })}\n`);
	}
	kill() {
		this.emit("exit", null, "SIGTERM");
	}
}

const children: FakeServer[] = [];
let script: Script = () => undefined;

vi.mock("node:child_process", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:child_process")>()),
	spawn: vi.fn(() => {
		const child = new FakeServer((request, server) => script(request, server));
		children.push(child);
		return child;
	}),
}));
vi.mock("node:fs", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:fs")>()),
	existsSync: () => true,
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:fs/promises")>()),
	mkdir: vi.fn(async () => undefined),
	rm: vi.fn(async () => undefined),
	writeFile: vi.fn(async () => undefined),
}));
vi.mock("@/server/db", () => ({
	db: {
		query: { externalConnections: { findFirst: async () => undefined } },
		update: () => ({ set: () => ({ where: async () => undefined }) }),
		delete: () => ({ where: async () => undefined }),
	},
}));

const {
	FAILED_TURN_MESSAGE,
	disconnectCopilot,
	getCopilotStatus,
	isolatedTurn,
} = await import("@/server/services/copilot");

/** Answers like a signed-out App Server that completes every turn. */
function answering(text: string, status = "completed"): Script {
	return (request, server) => {
		if (request.method === "account/read")
			server.reply(request.id, { account: null });
		if (request.method === "thread/start")
			server.reply(request.id, { thread: { id: "thread-1" } });
		if (request.method === "turn/start") {
			server.reply(request.id, { turn: { id: "turn-1" } });
			setTimeout(() => {
				server.notify("item/completed", {
					threadId: request.params.threadId,
					item: { type: "agentMessage", text },
				});
				server.notify("turn/completed", {
					threadId: request.params.threadId,
					turn: {
						status,
						error:
							status === "failed"
								? {
										message:
											'unexpected status 401 Unauthorized: {"detail":"secret provider body"}',
									}
								: undefined,
					},
				});
			}, 5);
		}
	};
}

beforeEach(async () => {
	script = (request, server) => {
		if (request.method === "account/logout") server.reply(request.id, {});
	};
	await disconnectCopilot("owner");
	children.length = 0;
});
afterEach(() => {
	script = () => undefined;
});

describe("Copilot App Server lifecycle", () => {
	it("starts a new App Server after the old one exited", async () => {
		script = answering("{}");
		expect(await getCopilotStatus("owner")).toMatchObject({
			available: true,
		});
		children[0].kill();
		// A dead child used to be handed out again, so every later request
		// failed with "nicht verfügbar" until the process restarted.
		expect(await getCopilotStatus("owner")).toMatchObject({
			available: true,
		});
		expect(children).toHaveLength(2);
	});

	it("claims the owner before starting the thread, so two turns cannot overlap", async () => {
		script = answering('{"ok":true}');
		const first = isolatedTurn("owner", { instructions: "x", prompt: "a" });
		const second = isolatedTurn("owner", { instructions: "x", prompt: "b" });
		await expect(second).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(first).resolves.toEqual({
			threadId: "thread-1",
			text: '{"ok":true}',
		});
		// Released again once the turn is over.
		await expect(
			isolatedTurn("owner", { instructions: "x", prompt: "c" }),
		).resolves.toMatchObject({ threadId: "thread-1" });
	});

	it("releases the claim when the thread cannot be started", async () => {
		script = (request, server) => {
			if (request.method === "thread/start")
				server.fail(request.id, "upstream said: secret provider body");
		};
		const failed = isolatedTurn("owner", { instructions: "x", prompt: "a" });
		await expect(failed).rejects.toThrow("thread/start");
		await expect(failed).rejects.not.toThrow("secret");
		script = answering("{}");
		await expect(
			isolatedTurn("owner", { instructions: "x", prompt: "b" }),
		).resolves.toMatchObject({ text: "{}" });
	});

	it("never passes the provider's error text on from a failed turn", async () => {
		script = answering("", "failed");
		const failed = isolatedTurn("owner", { instructions: "x", prompt: "a" });
		await expect(failed).rejects.toThrow(FAILED_TURN_MESSAGE);
		await expect(failed).rejects.not.toThrow("secret");
	});
});
