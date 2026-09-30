import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CommandPalette } from "@/components/command-palette";
import { Sidebar } from "@/components/sidebar";
import { FormatProvider } from "@/lib/format";
import { useInvalidateAll } from "@/lib/forms";
import { orpc } from "@/lib/orpc";
import {
	type ScalableSyncNoticeState,
	scalableSyncNotice,
} from "@/lib/scalable-sync-notice";
import { fetchSession } from "@/lib/server-fns";

export const Route = createFileRoute("/_app")({
	beforeLoad: async ({ location }) => {
		const user = await fetchSession();
		if (!user)
			throw redirect({ to: "/login", search: { from: location.href } });
		return { user };
	},
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(orpc.settings.get.queryOptions());
	},
	component: AppLayout,
});

function AppLayout() {
	const { user } = Route.useRouteContext();
	const { data: settings } = useQuery(orpc.settings.get.queryOptions());
	const { data: scalableStatus } = useQuery({
		...orpc.scalable.status.queryOptions(),
		// Close watch only while a sync runs; it was polled every ten seconds
		// for as long as any page was open.
		refetchInterval: (query) => (query.state.data?.syncing ? 10_000 : 60_000),
	});
	const invalidate = useInvalidateAll();
	const automaticSyncStarted = useRef(false);
	const lastScalableSyncSeen = useRef<number | null>(null);
	const scalableStatusInitialized = useRef(false);
	const scalableNotice = useRef<ScalableSyncNoticeState | null>(null);
	const koernerReview = useMutation(
		orpc.hrKoerner.reviewDue.mutationOptions({
			onSuccess: async (result) => {
				if (result.attempted) await invalidate();
			},
		}),
	);
	const koernerPostSyncReview = useMutation(
		orpc.hrKoerner.reviewNow.mutationOptions({
			onSuccess: () => invalidate(),
		}),
	);
	const unfileAfterSync = useMutation(
		orpc.desk.unfile.mutationOptions({
			onSuccess: async (result) => {
				await invalidate();
				toast.success(
					result.cleared === 1
						? "1 Buchung ist wieder offen"
						: `${result.cleared} Buchungen sind wieder offen`,
				);
			},
			onError: () => toast.error("Rückgängig ging nicht"),
		}),
	);
	const automaticSync = useMutation(
		orpc.connections.syncDue.mutationOptions({
			onSuccess: async (result) => {
				if (result.attempted > 0 || result.expired > 0) await invalidate();
				if (result.imported > 0 || result.accountsLinked > 0)
					koernerPostSyncReview.mutate(undefined);
				if (result.imported > 0 || result.accountsLinked > 0)
					toast.success(
						`Bank automatisch aktualisiert: ${result.imported} neue Buchungen`,
					);
				else if (result.attempted > 0 && result.failed === 0)
					toast.info("Bank geprüft: keine neuen Buchungen");
				// Hr. Körner filed what repeats the owner's own decisions straight
				// after the import; say so once, with the undo beside it.
				const filed = result.filed;
				if (filed && filed.count > 0)
					toast(
						filed.count === 1
							? "Hr. Körner hat 1 Buchung abgelegt"
							: `Hr. Körner hat ${filed.count} Buchungen abgelegt`,
						{
							action: {
								label: "Rückgängig",
								onClick: () =>
									unfileAfterSync.mutate({
										transactionIds: filed.transactionIds,
									}),
							},
						},
					);
				if (result.expired > 0) toast.error("Eine Bankfreigabe ist abgelaufen");
				else if (result.failed > 0)
					toast.error("Automatischer Bankabgleich fehlgeschlagen");
			},
			onError: () => toast.error("Automatischer Bankabgleich fehlgeschlagen"),
		}),
	);
	const scalableSync = useMutation(
		orpc.scalable.syncDue.mutationOptions({
			onSuccess: async (result) => {
				if (result.attempted) await invalidate();
			},
			onError: () =>
				toast.error("Automatischer Scalable-Abgleich fehlgeschlagen"),
		}),
	);
	const [searchOpen, setSearchOpen] = useState(false);
	useEffect(() => {
		if (automaticSyncStarted.current) return;
		automaticSyncStarted.current = true;
		automaticSync.mutate(undefined);
		scalableSync.mutate(undefined);
		koernerReview.mutate(undefined);
	}, [automaticSync, scalableSync, koernerReview]);
	useEffect(() => {
		if (scalableStatus === undefined) return;
		const completedAt = scalableStatus?.lastSyncAt?.getTime() ?? null;
		if (!scalableStatusInitialized.current) {
			scalableStatusInitialized.current = true;
			lastScalableSyncSeen.current = completedAt;
			return;
		}
		if (completedAt && completedAt !== lastScalableSyncSeen.current) {
			lastScalableSyncSeen.current = completedAt;
			void invalidate();
			koernerPostSyncReview.mutate(undefined);
		}
	}, [scalableStatus, invalidate, koernerPostSyncReview]);
	useEffect(() => {
		if (!scalableStatus) return;
		const { state, notice } = scalableSyncNotice(
			scalableNotice.current,
			scalableStatus,
		);
		scalableNotice.current = state;
		// The stored message is Fortuna's own wording, never provider text.
		if (notice?.kind === "error") toast.error(notice.message);
		else if (notice) toast.warning(notice.message);
	}, [scalableStatus]);
	return (
		<FormatProvider
			value={{
				locale: settings?.locale ?? "de-DE",
				baseCurrency: settings?.baseCurrency ?? "EUR",
			}}
		>
			<div className="flex min-h-dvh max-w-full flex-col overflow-x-clip lg:flex-row">
				<Sidebar
					userName={user.name}
					onOpenSearch={() => setSearchOpen(true)}
				/>
				<CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
				<main
					id="main-content"
					tabIndex={-1}
					className="min-w-0 flex-1 outline-none"
				>
					{/* Bottom padding clears the phone tab bar; the side padding the
					    notch in landscape. */}
					<div className="mx-auto w-full min-w-0 max-w-[1280px] pt-4 pr-[max(0.75rem,env(safe-area-inset-right))] pb-[calc(var(--phone-tabbar-h)+1.25rem)] pl-[max(0.75rem,env(safe-area-inset-left))] sm:pt-6 sm:pr-[max(1.5rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] lg:px-8 lg:py-8">
						<Outlet />
					</div>
				</main>
			</div>
		</FormatProvider>
	);
}
