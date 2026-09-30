import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, MessageCircleMore } from "lucide-react";
import { useState } from "react";
import {
	ChatComposer,
	ChatDropOverlay,
	ChatMessages,
	type CopilotChat,
	CopilotConnectGate,
	NewChatButton,
	useChatFileDrop,
	useCopilotChat,
} from "@/components/copilot-chat";
import { DeskSections, FiledNote } from "@/components/desk";
import { DeskRecapCard } from "@/components/desk-recap";
import { NetWorthHero } from "@/components/net-worth-hero";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { orpc } from "@/lib/orpc";

/**
 * Hr. Körner's desk: where Fortuna opens. Net worth on top, then what he has
 * filed himself, what is due today, how liquid the wealth is, and the
 * conversation. The full dashboard lives on at /overview.
 */
export const Route = createFileRoute("/_app/")({
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(orpc.dashboard.queryOptions()),
			context.queryClient.ensureQueryData(orpc.desk.today.queryOptions()),
			context.queryClient.ensureQueryData(orpc.copilot.status.queryOptions()),
			// Never fails the desk: without it the recap simply does not show.
			context.queryClient.prefetchQuery(orpc.desk.recap.queryOptions()),
		]);
	},
	head: () => ({ meta: [{ title: "Hr. Körner · Fortuna" }] }),
	component: Desk,
});

function Desk() {
	const { data: dashboard } = useSuspenseQuery(orpc.dashboard.queryOptions());
	const { data: today } = useSuspenseQuery(orpc.desk.today.queryOptions());
	// One conversation for the card and the phone's sheet, so a question
	// asked in one is answered in the other.
	const chat = useCopilotChat();
	const [chatOpen, setChatOpen] = useState(false);
	const nw = dashboard.netWorth;
	const hasAnything =
		dashboard.accounts.length > 0 ||
		nw.totalAssetsMinor > 0 ||
		nw.totalLiabilitiesMinor > 0;

	return (
		<div className="space-y-4 sm:space-y-5">
			<h1 className="sr-only">Hr. Körner</h1>
			{hasAnything ? (
				<NetWorthHero data={dashboard} onAsk={() => setChatOpen(true)} />
			) : (
				<>
					<Card>
						<EmptyState
							title="Fortuna ist noch leer"
							description="Legen Sie ein Konto an und importieren Sie Transaktionen, dann hat Hr. Körner etwas zu prüfen."
							action={
								<div className="flex gap-2">
									<Link
										to="/accounts"
										className="text-sm text-brand underline-offset-4 hover:underline"
									>
										Konto hinzufügen
									</Link>
									<Link
										to="/imports"
										className="text-sm text-brand underline-offset-4 hover:underline"
									>
										Transaktionen importieren
									</Link>
								</div>
							}
						/>
					</Card>
					<Button
						variant="outline"
						className="w-full sm:hidden"
						onClick={() => setChatOpen(true)}
					>
						<MessageCircleMore /> Frag Hr. Körner
					</Button>
				</>
			)}
			<DeskRecapCard />
			<FiledNote />
			<DeskSections today={today} />
			{/* On a phone the conversation is a sheet opened from the hero's
			    "Fragen": a chat box inside a long page scrolls against it, and
			    at the end of the desk it was a long way down. */}
			<div className="max-sm:hidden">
				<CopilotConnectGate>
					<DeskChat chat={chat} />
				</CopilotConnectGate>
			</div>
			<Dialog open={chatOpen} onOpenChange={setChatOpen}>
				<DialogContent
					title="Hr. Körner"
					className="h-[min(44rem,85dvh)] max-w-2xl overflow-hidden max-sm:h-[calc(var(--app-vvh,100dvh)-0.75rem)]"
				>
					<CopilotConnectGate>
						<SheetChat chat={chat} />
					</CopilotConnectGate>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function SheetChat({ chat }: { chat: CopilotChat }) {
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			<div className="-mt-2 flex flex-wrap items-center justify-end gap-1">
				<NewChatButton chat={chat} />
				<Button asChild variant="ghost" size="sm">
					<Link to="/copilot">
						Ganzes Gespräch <ArrowRight />
					</Link>
				</Button>
			</div>
			<ChatMessages chat={chat} emptyTitle="Was soll ich mir anschauen?" />
			<ChatComposer chat={chat} compact />
		</div>
	);
}

function DeskChat({ chat }: { chat: CopilotChat }) {
	const drop = useChatFileDrop(chat);
	return (
		<Card className="relative overflow-hidden" {...drop.handlers}>
			<ChatDropOverlay visible={drop.dragging} />
			<CardHeader
				title="Gespräch"
				action={
					<div className="flex flex-wrap items-center gap-1">
						<NewChatButton chat={chat} />
						<Link
							to="/copilot"
							className="inline-flex items-center gap-1 px-2 text-xs text-brand hover:underline"
						>
							Ganzes Gespräch <ArrowRight className="size-3" />
						</Link>
					</div>
				}
			/>
			<CardBody className="flex flex-col gap-3">
				<ChatMessages
					chat={chat}
					className="max-h-[26rem] min-h-[12rem] flex-none"
					emptyTitle="Was soll ich mir anschauen?"
				/>
				<ChatComposer chat={chat} compact />
			</CardBody>
		</Card>
	);
}
