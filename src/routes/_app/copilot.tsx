import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import {
	ChatComposer,
	ChatDropOverlay,
	ChatMessages,
	CopilotConnectGate,
	MemoryButton,
	NewChatButton,
	useChatFileDrop,
	useCopilotChat,
} from "@/components/copilot-chat";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { reportError, useInvalidateAll } from "@/lib/forms";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/_app/copilot")({
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(orpc.copilot.status.queryOptions()),
			context.queryClient.ensureQueryData(orpc.copilot.memories.queryOptions()),
		]),
	head: () => ({ meta: [{ title: "Gespräch mit Hr. Körner · Fortuna" }] }),
	component: CopilotPage,
});

function CopilotPage() {
	const { data: status } = useSuspenseQuery(orpc.copilot.status.queryOptions());
	return (
		<div className="space-y-5 max-sm:space-y-3">
			{/* On a phone the chat fills the screen; the heading stays for
			    screen readers. */}
			<PageHeader
				className="max-sm:sr-only"
				title="Hr. Körner"
				subtitle="Ihr privater Finanzcontroller. Fragt nach, wenn die Belege fehlen."
				actions={
					status.connected ? <Badge variant="positive">Verbunden</Badge> : null
				}
			/>
			<CopilotConnectGate>
				<FullChat email={status.email} />
				<p className="text-xs text-text-muted">
					Herr Körner sieht den aktuellen Fortuna-Stand ohne IBAN und kann
					Einträge anlegen oder ändern, aber nichts löschen und kein Geld
					bewegen.
				</p>
			</CopilotConnectGate>
		</div>
	);
}

function FullChat({ email }: { email: string | null | undefined }) {
	const chat = useCopilotChat();
	const drop = useChatFileDrop(chat);
	const invalidate = useInvalidateAll();
	const disconnect = useMutation(
		orpc.copilot.disconnect.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				chat.clear();
				toast.success("ChatGPT getrennt");
			},
			onError: reportError,
		}),
	);
	return (
		<Card
			// On a phone: exactly the visible height between the header and the
			// tab bar (or the keyboard), so the composer is never below the fold.
			className="relative h-[min(900px,calc(100dvh-10rem))] min-h-[36rem] overflow-hidden max-sm:h-[calc(var(--app-vvh,100dvh)-var(--phone-header-h)-var(--phone-tabbar-h)-3rem)] max-sm:min-h-[18rem]"
			{...drop.handlers}
		>
			<ChatDropOverlay visible={drop.dragging} />
			<CardHeader
				title="Chat"
				subtitle={
					<span className="max-sm:hidden">
						{email ?? "Mit ChatGPT verbunden"}
					</span>
				}
				className="max-sm:flex-nowrap max-sm:items-center max-sm:pb-1"
				action={
					<div className="flex flex-wrap gap-1">
						<NewChatButton chat={chat} />
						<MemoryButton />
						<Button
							variant="ghost"
							size="sm"
							disabled={disconnect.isPending}
							onClick={() => {
								if (
									confirm(
										"ChatGPT trennen? Die Anmeldung und der Chatverlauf werden gelöscht; Erinnerungen bleiben erhalten.",
									)
								)
									disconnect.mutate(undefined);
							}}
						>
							<LogOut aria-hidden />
							<span className="max-sm:sr-only">Trennen</span>
						</Button>
					</div>
				}
			/>
			<CardBody className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
				<ChatMessages chat={chat} />
				<ChatComposer chat={chat} />
			</CardBody>
		</Card>
	);
}
