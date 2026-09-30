import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import {
	Bot,
	Brain,
	Copy,
	ExternalLink,
	FileText,
	Image,
	Paperclip,
	RotateCcw,
	Send,
	Sparkles,
	Square,
	Trash2,
	UploadCloud,
	User,
	X,
} from "lucide-react";
import {
	type DragEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { errorMessage, reportError, useInvalidateAll } from "@/lib/forms";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";

/**
 * The conversation with Hr. Körner, in pieces: `useCopilotChat` owns the
 * messages, the NDJSON stream, uploads and the browser-local history;
 * `ChatMessages` and `ChatComposer` draw it; `CopilotConnectGate` stands in
 * front until ChatGPT is connected. The full page at /copilot and the desk
 * at / both assemble these, so there is one stream client, not two.
 */

export type AttachmentSummary = {
	id?: string;
	name: string;
	type: string;
	size: number;
	kind?: "image" | "pdf" | "text";
};
export type ChatMessage = {
	role: "user" | "assistant";
	content: string;
	attachments?: AttachmentSummary[];
};
type LastRequest = {
	question: string;
	displayText: string;
	attachmentIds: string[];
	attachments: AttachmentSummary[];
};
type LoginDetails = {
	loginId: string;
	verificationUrl: string;
	userCode: string;
};

/** The chat history stays in the browser; the key is shared by every view. */
export const COPILOT_HISTORY_KEY = "fortuna-copilot-history-v1";
const MAX_FILES = 8;
export const COPILOT_SUGGESTIONS = [
	"Wo kann ich diesen Monat sinnvoll sparen?",
	"Welche laufenden Kosten überschneiden sich?",
	"Fasse meine finanzielle Lage kurz zusammen.",
];
const MEMORY_KIND_LABELS = {
	preference: "Vorliebe",
	rule: "Regel",
	fact: "Hinweis",
} as const;

export function useCopilotChat() {
	const invalidate = useInvalidateAll();
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [historyLoaded, setHistoryLoaded] = useState(false);
	const [question, setQuestion] = useState("");
	const [files, setFiles] = useState<File[]>([]);
	const [uploading, setUploading] = useState(false);
	const [streaming, setStreaming] = useState(false);
	const [toolStatus, setToolStatus] = useState<string | null>(null);
	const [chatError, setChatError] = useState<string | null>(null);
	const [lastRequest, setLastRequest] = useState<LastRequest | null>(null);
	const streamAbortRef = useRef<AbortController | null>(null);

	useEffect(() => {
		try {
			const saved = JSON.parse(
				localStorage.getItem(COPILOT_HISTORY_KEY) ?? "[]",
			) as ChatMessage[];
			setMessages(
				saved
					.filter(
						(message) =>
							(message.role === "user" || message.role === "assistant") &&
							typeof message.content === "string",
					)
					.slice(-20),
			);
		} catch {
			try {
				localStorage.removeItem(COPILOT_HISTORY_KEY);
			} catch {
				// Storage unavailable: the chat simply starts empty.
			}
		} finally {
			setHistoryLoaded(true);
		}
	}, []);

	useEffect(() => {
		if (!historyLoaded) return;
		try {
			localStorage.setItem(
				COPILOT_HISTORY_KEY,
				JSON.stringify(messages.slice(-20)),
			);
		} catch {
			// Storage full or blocked: the visible chat still works.
		}
	}, [historyLoaded, messages]);

	const resetChat = useMutation(
		orpc.copilot.resetChat.mutationOptions({
			onSuccess: () => {
				setMessages([]);
				setChatError(null);
				setLastRequest(null);
				toast.success("Neuer Chat gestartet");
			},
			onError: reportError,
		}),
	);

	const addFiles = useCallback((incoming: File[]) => {
		setFiles((current) => {
			const next = [...current];
			for (const file of incoming) {
				if (
					next.some(
						(existing) =>
							existing.name === file.name &&
							existing.size === file.size &&
							existing.lastModified === file.lastModified,
					)
				)
					continue;
				if (next.length >= MAX_FILES) {
					toast.error("Maximal 8 Anhänge pro Nachricht");
					break;
				}
				next.push(file);
			}
			return next;
		});
	}, []);

	function removeFile(index: number) {
		setFiles((current) =>
			current.filter((_, currentIndex) => currentIndex !== index),
		);
	}

	async function send(
		text: string,
		displayText = text,
		retryRequest?: LastRequest | null,
	) {
		const content = text.trim() || "Analysieren Sie die angehängten Dateien.";
		const visibleText = text.trim() ? displayText : "Anhänge analysieren";
		if ((!text.trim() && files.length === 0) || streaming || uploading) return;
		const appendMessage = !retryRequest;
		// A retry replaces the failed exchange rather than adding the question
		// a second time: the owner sees what they asked once.
		let historySource = messages;
		if (!appendMessage && historySource.at(-1)?.role === "assistant")
			historySource = historySource.slice(0, -1);
		if (
			!appendMessage &&
			historySource.at(-1)?.role === "user" &&
			historySource.at(-1)?.content === visibleText
		)
			historySource = historySource.slice(0, -1);
		const history = historySource.slice(-10);
		let attachmentIds = retryRequest?.attachmentIds ?? [];
		let attachments = retryRequest?.attachments ?? [];
		if (!retryRequest && files.length > 0) {
			setUploading(true);
			try {
				const form = new FormData();
				for (const file of files) form.append("files", file);
				const response = await fetch("/api/copilot/attachments", {
					method: "POST",
					body: form,
				});
				if (!response.ok)
					throw new Error(
						(await response.text()) ||
							"Anhänge konnten nicht hochgeladen werden",
					);
				const payload = (await response.json()) as {
					attachments: Required<AttachmentSummary>[];
				};
				const uploaded = payload.attachments;
				attachments = uploaded;
				attachmentIds = uploaded.map((attachment) => attachment.id);
			} catch (error) {
				setChatError(errorMessage(error));
				reportError(error);
				return;
			} finally {
				setUploading(false);
			}
		}
		setMessages([
			...historySource,
			{
				role: "user",
				content: visibleText,
				attachments,
			},
		]);
		setLastRequest({
			question: content,
			displayText: visibleText,
			attachmentIds,
			attachments,
		});
		setChatError(null);
		setQuestion("");
		setFiles([]);
		setStreaming(true);
		setToolStatus("Daten werden vorbereitet");
		const controller = new AbortController();
		const traceId = crypto.randomUUID();
		streamAbortRef.current = controller;
		try {
			const response = await fetch("/api/copilot/stream", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-copilot-trace-id": traceId,
				},
				body: JSON.stringify({ question: content, history, attachmentIds }),
				signal: controller.signal,
			});
			if (!response.ok)
				throw new Error(
					response.status >= 500
						? "Verbindung zu Hr. Körner unterbrochen"
						: (await response.text()) || "Anfrage an Hr. Körner fehlgeschlagen",
				);
			if (!response.body)
				throw new Error("Antwort kann nicht empfangen werden");
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let completed = false;
			for (;;) {
				const { done, value } = await reader.read();
				buffer += decoder.decode(value, { stream: !done });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					if (!line.trim()) continue;
					// The server sends a heartbeat at once and every five seconds;
					// it only keeps the connection open and is ignored here.
					const event = JSON.parse(line) as
						| { type: "heartbeat" }
						| { type: "delta"; text: string }
						| { type: "tool"; name: string; status: string }
						| { type: "done"; answer: string }
						| { type: "error"; message: string };
					if (event.type === "delta")
						setMessages((current) =>
							current.at(-1)?.role === "assistant"
								? [
										...current.slice(0, -1),
										{
											role: "assistant",
											content: `${current.at(-1)?.content ?? ""}${event.text}`,
										},
									]
								: [...current, { role: "assistant", content: event.text }],
						);
					if (event.type === "tool")
						setToolStatus(
							event.status === "running"
								? "Fortuna wird aktualisiert"
								: "Antwort wird erstellt",
						);
					if (event.type === "done") {
						completed = true;
						setMessages((current) =>
							current.at(-1)?.role === "assistant"
								? [
										...current.slice(0, -1),
										{ role: "assistant", content: event.answer },
									]
								: [...current, { role: "assistant", content: event.answer }],
						);
					}
					if (event.type === "error") throw new Error(event.message);
				}
				if (done) break;
			}
			if (!completed) throw new Error("Copilot-Antwort wurde unterbrochen");
			await invalidate();
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				setMessages((current) => {
					const last = current.at(-1);
					if (last?.role !== "assistant" || last.content.trim()) return current;
					return current.slice(0, -1);
				});
			} else {
				setChatError(`${errorMessage(error)} · Diagnose-ID: ${traceId}`);
				reportError(error);
			}
		} finally {
			setStreaming(false);
			setToolStatus(null);
			streamAbortRef.current = null;
		}
	}

	return {
		messages,
		question,
		setQuestion,
		files,
		addFiles,
		removeFile,
		uploading,
		streaming,
		toolStatus,
		chatError,
		lastRequest,
		send,
		retry: () => {
			if (lastRequest)
				void send(lastRequest.question, lastRequest.displayText, lastRequest);
		},
		abort: () => streamAbortRef.current?.abort(),
		/** Forget the visible chat, e.g. after ChatGPT was disconnected. */
		clear: () => {
			setMessages([]);
			setChatError(null);
			setLastRequest(null);
		},
		resetChat,
	};
}

export type CopilotChat = ReturnType<typeof useCopilotChat>;

/** Files dragged anywhere onto the chat card become attachments. */
export function useChatFileDrop(chat: CopilotChat) {
	const [dragging, setDragging] = useState(false);
	const dragDepthRef = useRef(0);
	useEffect(() => {
		const resetDrag = () => {
			dragDepthRef.current = 0;
			setDragging(false);
		};
		window.addEventListener("dragend", resetDrag);
		window.addEventListener("drop", resetDrag);
		return () => {
			window.removeEventListener("dragend", resetDrag);
			window.removeEventListener("drop", resetDrag);
		};
	}, []);
	const { addFiles } = chat;
	return {
		dragging,
		handlers: {
			onDragEnter: (event: DragEvent) => {
				if (!event.dataTransfer.types.includes("Files")) return;
				event.preventDefault();
				dragDepthRef.current += 1;
				setDragging(true);
			},
			onDragOver: (event: DragEvent) => {
				if (!event.dataTransfer.types.includes("Files")) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "copy";
			},
			onDragLeave: () => {
				dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
				if (dragDepthRef.current === 0) setDragging(false);
			},
			onDrop: (event: DragEvent) => {
				event.preventDefault();
				dragDepthRef.current = 0;
				setDragging(false);
				addFiles(Array.from(event.dataTransfer.files));
			},
		},
	};
}

export function ChatDropOverlay({ visible }: { visible: boolean }) {
	if (!visible) return null;
	return (
		<div className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-md border-2 border-dashed border-brand bg-brand-subtle/95">
			<div className="text-center text-brand">
				<UploadCloud className="mx-auto size-9" />
				<p className="mt-2 font-medium">Dateien hier ablegen</p>
				<p className="mt-1 text-xs">Bis zu 8 Anhänge pro Nachricht</p>
			</div>
		</div>
	);
}

export function ChatMessages({
	chat,
	className,
	emptyTitle = "Was möchten Sie über Ihr Geld wissen?",
}: {
	chat: CopilotChat;
	className?: string;
	emptyTitle?: string;
}) {
	const { messages, streaming, toolStatus, chatError, lastRequest } = chat;
	const scrollRef = useRef<HTMLDivElement>(null);
	const scrolledOnce = useRef(false);
	// Whether the owner is reading the latest message. When the list shrinks
	// (the phone keyboard opens, a sheet resizes) it stays pinned to the end
	// instead of leaving the last answer below the composer.
	const atEnd = useRef(true);
	useEffect(() => {
		const el = scrollRef.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			if (atEnd.current) el.scrollTop = el.scrollHeight;
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	// Scroll the message list itself, never the page: on the desk the chat
	// sits below the fold, and scrollIntoView would drag the page down to it.
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		el.scrollTo({
			top: el.scrollHeight,
			behavior: scrolledOnce.current ? "smooth" : "auto",
		});
		scrolledOnce.current = true;
		atEnd.current = true;
	}, [messages, streaming, chatError]);
	return (
		<div
			ref={scrollRef}
			onScroll={(event) => {
				const el = event.currentTarget;
				atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
			}}
			className={cn(
				"min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1",
				className,
			)}
			aria-live="polite"
		>
			{messages.length === 0 ? (
				<div className="py-8 text-center">
					<Bot className="mx-auto size-8 text-brand" />
					<p className="mt-3 font-medium text-text">{emptyTitle}</p>
					<div className="mx-auto mt-4 flex max-w-xl flex-wrap justify-center gap-2">
						{COPILOT_SUGGESTIONS.map((suggestion) => (
							<Button
								key={suggestion}
								variant="outline"
								size="sm"
								className="h-auto min-h-7 whitespace-normal py-1 text-left"
								onClick={() => chat.send(suggestion)}
							>
								{suggestion}
							</Button>
						))}
					</div>
				</div>
			) : null}
			{messages.map((message, index) => (
				<div
					key={`${message.role}-${index}`}
					className={cn("flex gap-3", message.role === "user" && "justify-end")}
				>
					{message.role === "assistant" ? (
						<Bot className="mt-1 size-4 shrink-0 text-brand" />
					) : null}
					<div
						className={cn(
							"group min-w-0 max-w-[88%] rounded-lg px-3 py-2 text-sm",
							message.role === "user"
								? "bg-brand text-text-inverse"
								: "bg-surface-sunken text-text",
						)}
					>
						{message.attachments?.length ? (
							<div className="mb-2 flex flex-wrap gap-1.5">
								{message.attachments.map((attachment) => (
									<span
										key={`${attachment.name}-${attachment.size}`}
										className="inline-flex max-w-full items-center gap-1 rounded border border-current/20 px-1.5 py-0.5 text-[11px]"
									>
										{attachment.kind === "image" ? (
											<Image className="size-3 shrink-0" />
										) : (
											<FileText className="size-3 shrink-0" />
										)}
										<span className="break-all">{attachment.name}</span>
									</span>
								))}
							</div>
						) : null}
						{message.role === "assistant" &&
						message.content.toLowerCase().includes("buchhalterfrage") ? (
							<Badge variant="warning" className="mb-2">
								Rückfrage
							</Badge>
						) : null}
						{message.role === "assistant" ? (
							<>
								<Markdown>{message.content}</Markdown>
								<button
									type="button"
									className="mt-2 flex items-center gap-1 text-[11px] text-text-muted hover:text-text pointer-coarse:-mb-2 pointer-coarse:min-h-11"
									onClick={() => {
										navigator.clipboard.writeText(message.content);
										toast.success("Antwort kopiert");
									}}
								>
									<Copy className="size-3" /> Kopieren
								</button>
							</>
						) : (
							<p className="whitespace-pre-wrap break-words">
								{message.content}
							</p>
						)}
					</div>
					{message.role === "user" ? (
						<User className="mt-1 size-4 shrink-0 text-text-muted" />
					) : null}
				</div>
			))}
			{streaming ? (
				<div className="flex items-center gap-3 text-sm text-text-muted">
					<Bot className="size-4 text-brand" />
					<span>{toolStatus ?? "Herr Körner antwortet"}</span>
				</div>
			) : null}
			{chatError ? (
				<div className="rounded-md border border-negative/30 bg-negative-bg p-3 text-sm text-negative">
					<p className="break-words">{chatError}</p>
					{lastRequest ? (
						<Button
							variant="outline"
							size="sm"
							className="mt-2"
							onClick={chat.retry}
						>
							<RotateCcw /> Nochmal versuchen
						</Button>
					) : null}
				</div>
			) : null}
		</div>
	);
}

export function ChatComposer({
	chat,
	compact = false,
}: {
	chat: CopilotChat;
	compact?: boolean;
}) {
	const { files, question, streaming, uploading } = chat;
	const fileInputRef = useRef<HTMLInputElement>(null);
	return (
		<>
			{files.length > 0 ? (
				<div className="flex flex-wrap gap-2">
					{files.map((file, index) => (
						<span
							key={`${file.name}-${file.size}-${file.lastModified}`}
							className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-surface-sunken px-2 py-1 text-xs text-text-secondary"
						>
							{file.type.startsWith("image/") ? (
								<Image className="size-3.5 shrink-0" />
							) : (
								<FileText className="size-3.5 shrink-0" />
							)}
							<span className="break-all">{file.name}</span>
							<button
								type="button"
								aria-label={`${file.name} entfernen`}
								className="grid min-h-11 min-w-11 place-items-center rounded p-0.5 hover:bg-bg sm:min-h-0 sm:min-w-0"
								onClick={() => chat.removeFile(index)}
							>
								<X className="size-3" />
							</button>
						</span>
					))}
				</div>
			) : null}
			<form
				className="sticky bottom-0 flex items-end gap-2 border-t border-border bg-surface pt-4"
				onSubmit={(event) => {
					event.preventDefault();
					chat.send(question);
				}}
			>
				<input
					ref={fileInputRef}
					type="file"
					multiple
					accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown,text/csv,text/tab-separated-values,application/json,application/xml,text/xml"
					className="hidden"
					onChange={(event) => {
						chat.addFiles(Array.from(event.target.files ?? []));
						event.target.value = "";
					}}
				/>
				<Button
					type="button"
					variant="outline"
					size="icon"
					disabled={streaming || uploading || files.length >= MAX_FILES}
					aria-label="Dateien anhängen"
					onClick={() => fileInputRef.current?.click()}
				>
					<Paperclip />
				</Button>
				<Textarea
					value={question}
					onChange={(event) => chat.setQuestion(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							chat.send(question);
						}
					}}
					onPaste={(event) => {
						const pasted = Array.from(event.clipboardData.files);
						if (pasted.length > 0) {
							event.preventDefault();
							chat.addFiles(pasted);
						}
					}}
					placeholder={compact ? "Hr. Körner fragen…" : "Frag Fortuna…"}
					enterKeyHint="send"
					rows={compact ? 1 : 2}
					className={cn(compact ? "min-h-10" : "max-sm:min-h-11")}
					maxLength={2_000}
					disabled={streaming || uploading}
					aria-label="Nachricht an Fortuna"
				/>
				<Button
					type={streaming ? "button" : "submit"}
					size="icon"
					disabled={
						!streaming &&
						((!question.trim() && files.length === 0) || uploading)
					}
					onClick={streaming ? chat.abort : undefined}
					aria-label={streaming ? "Antwort stoppen" : "Nachricht senden"}
				>
					{streaming ? <Square /> : uploading ? <Paperclip /> : <Send />}
				</Button>
			</form>
			{compact ? null : (
				<div className="flex flex-wrap justify-between gap-2 text-[11px] text-text-muted">
					<span className="pointer-coarse:hidden">
						Dateien hierher ziehen oder mit der Büroklammer wählen
					</span>
					<span className="hidden pointer-coarse:inline">
						Dateien mit der Büroklammer anhängen
					</span>
					<span>{question.length}/2.000 Zeichen</span>
				</div>
			)}
		</>
	);
}

export function NewChatButton({ chat }: { chat: CopilotChat }) {
	return (
		<Button
			variant="ghost"
			size="sm"
			disabled={
				chat.messages.length === 0 || chat.streaming || chat.resetChat.isPending
			}
			onClick={() => {
				if (
					confirm("Neuen Chat beginnen? Der bisherige Verlauf wird gelöscht.")
				)
					chat.resetChat.mutate(undefined);
			}}
		>
			<Trash2 aria-hidden />
			<span className="max-sm:sr-only">Neuer Chat</span>
		</Button>
	);
}

/** What Hr. Körner remembers, for inspection and deletion. */
export function MemoryButton() {
	const { data: memories } = useSuspenseQuery(
		orpc.copilot.memories.queryOptions(),
	);
	const invalidate = useInvalidateAll();
	const [open, setOpen] = useState(false);
	const forgetMemory = useMutation(
		orpc.copilot.forgetMemory.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Erinnerung vergessen");
			},
			onError: reportError,
		}),
	);
	return (
		<>
			<Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
				<Brain aria-hidden />
				<span className="max-sm:sr-only">Gedächtnis ({memories.length})</span>
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent title="Körners Gedächtnis" className="max-w-md">
					<div className="space-y-2">
						{memories.length ? (
							memories.map((memory) => (
								<div
									key={memory.id}
									className="flex items-start gap-2 rounded border border-border bg-surface-sunken p-2"
								>
									<div className="min-w-0 flex-1">
										<p className="break-words text-sm text-text">
											{memory.content}
										</p>
										<p className="mt-1 text-[10px] text-text-muted">
											{MEMORY_KIND_LABELS[memory.kind] ?? "—"}
										</p>
									</div>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										aria-label="Erinnerung vergessen"
										disabled={forgetMemory.isPending}
										onClick={() => {
											if (confirm("Diese Erinnerung vergessen?"))
												forgetMemory.mutate({ id: memory.id });
										}}
									>
										<Trash2 />
									</Button>
								</div>
							))
						) : (
							<p className="text-sm text-text-muted">
								Noch leer. Dauerhafte Hinweise und Korrekturen merkt sich Herr
								Körner künftig selbst.
							</p>
						)}
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}

/**
 * Stands in front of the chat until the Copilot can answer: an explanation
 * when the App Server is unavailable, the ChatGPT device-code login when it
 * is not connected, and the chat itself once it is.
 */
export function CopilotConnectGate({ children }: { children: ReactNode }) {
	const { data: status, refetch } = useSuspenseQuery(
		orpc.copilot.status.queryOptions(),
	);
	const invalidate = useInvalidateAll();
	const [login, setLogin] = useState<LoginDetails | null>(null);

	useEffect(() => {
		if (!login) return;
		const timer = window.setInterval(async () => {
			const result = await refetch();
			if (result.data?.connected) {
				setLogin(null);
				toast.success("ChatGPT verbunden");
			}
		}, 2_500);
		return () => window.clearInterval(timer);
	}, [login, refetch]);

	const startLogin = useMutation(
		orpc.copilot.startLogin.mutationOptions({
			onSuccess: async (result) => {
				if (result.alreadyConnected) {
					await invalidate();
					return;
				}
				setLogin(result);
			},
			onError: reportError,
		}),
	);

	if (!status.available)
		return (
			<Card>
				<CardHeader title="Gespräch nicht verfügbar" />
				<CardBody>
					<p className="break-words text-sm text-negative">
						{status.lastError}
					</p>
				</CardBody>
			</Card>
		);
	if (status.connected) return <>{children}</>;
	return (
		<Card>
			<CardHeader
				title="ChatGPT-Konto verbinden"
				subtitle="Keine API-Kosten. Die Nutzung läuft innerhalb Ihres ChatGPT-Tarifs."
			/>
			<CardBody className="space-y-4">
				{login ? (
					<div className="rounded-md border border-brand/30 bg-brand-subtle p-4">
						<p className="text-sm font-medium text-text">
							1. OpenAI öffnen und 2. diesen Code eingeben
						</p>
						<div className="mt-3 flex flex-wrap items-center gap-2">
							<code className="rounded-md border border-border-strong bg-surface px-4 py-2 font-mono text-xl font-semibold tracking-[0.18em] text-text">
								{login.userCode}
							</code>
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									navigator.clipboard.writeText(login.userCode);
									toast.success("Code kopiert");
								}}
							>
								<Copy /> Kopieren
							</Button>
						</div>
						<Button asChild className="mt-3">
							<a href={login.verificationUrl} target="_blank" rel="noreferrer">
								<ExternalLink /> OpenAI öffnen
							</a>
						</Button>
						<p className="mt-3 text-xs text-text-muted">
							Fortuna erkennt die Freigabe automatisch. Diese Seite kann offen
							bleiben.
						</p>
					</div>
				) : (
					<>
						<p className="text-sm text-text-secondary">
							Sie melden sich direkt bei OpenAI an. Fortuna erhält keine
							Zugangsdaten und speichert die erneuerbare Sitzung verschlüsselt.
						</p>
						<Button
							onClick={() => startLogin.mutate(undefined)}
							disabled={startLogin.isPending}
						>
							<Sparkles /> Mit ChatGPT verbinden
						</Button>
					</>
				)}
			</CardBody>
		</Card>
	);
}
