import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import {
	ConnectionsPanel,
	connectionResultSearch,
	connectionsQueries,
} from "@/components/connections-panel";
import { ImportsPanel, importsQueries } from "@/components/imports-panel";
import { KatasterSummary } from "@/components/kataster-summary";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings-tabs";

/**
 * Einstellungen › Datenquellen: where data comes into Fortuna and leaves it
 * again — bank, depot and service connections, the Kataster figures and CSV
 * import/export. The bank and Remise callbacks land here with their result.
 */
export const Route = createFileRoute("/_app/settings_/data-sources")({
	validateSearch: connectionResultSearch,
	loader: async ({ context }) => {
		await Promise.all(
			[...connectionsQueries(), ...importsQueries()].map((query) =>
				context.queryClient.ensureQueryData(
					query as Parameters<typeof context.queryClient.ensureQueryData>[0],
				),
			),
		);
	},
	head: () => ({ meta: [{ title: "Datenquellen · Fortuna" }] }),
	component: DataSourcesPage,
});

function DataSourcesPage() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	// The result describes one redirect. Left in the URL it replays on every
	// reload, so an old failure keeps reporting itself as a new one.
	const clearResult = useCallback(() => {
		void navigate({
			search: () => ({
				bank: undefined,
				imported: undefined,
				remise: undefined,
			}),
			replace: true,
		});
	}, [navigate]);
	return (
		<div className="space-y-5">
			<PageHeader title="Einstellungen" />
			<SettingsTabs />
			<ConnectionsPanel search={search} onResultShown={clearResult} />
			<KatasterSummary />
			<ImportsPanel />
		</div>
	);
}
