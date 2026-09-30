import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Money } from "@/lib/format";
import { orpc } from "@/lib/orpc";

/**
 * Kataster's hosting costs, charges and margin for the current period. An
 * operational view only: none of it reaches accounts, bookings or net worth.
 * It sat on the Optimierung page; it belongs beside the connection it reads.
 */
export function KatasterSummary() {
	const { data: status } = useQuery(orpc.kataster.status.queryOptions());
	const {
		data: kataster,
		isFetching,
		refetch,
	} = useQuery({
		...orpc.kataster.summary.queryOptions(),
		enabled: Boolean(status?.configured),
		retry: false,
	});
	if (!status?.configured || !kataster?.configured) return null;
	return (
		<Card>
			<CardHeader
				title="Kataster"
				subtitle={`Hosting und Dienste · ${kataster.period}`}
				action={
					<Button
						variant="ghost"
						size="sm"
						disabled={isFetching}
						onClick={() => refetch()}
					>
						<RefreshCw /> Aktualisieren
					</Button>
				}
			/>
			<CardBody>
				<div className="grid gap-4 min-[430px]:grid-cols-2 lg:grid-cols-4">
					<div>
						<p className="label-caps">Kosten</p>
						<Money
							amountMinor={kataster.totalCostMinor}
							currency="EUR"
							weight="semibold"
						/>
					</div>
					<div>
						<p className="label-caps">Abgerechnet</p>
						<Money
							amountMinor={kataster.totalChargeMinor}
							currency="EUR"
							weight="semibold"
						/>
					</div>
					<div>
						<p className="label-caps">Marge</p>
						<Money
							amountMinor={kataster.totalMarginMinor}
							currency="EUR"
							weight="semibold"
							tone="auto"
						/>
					</div>
					<div>
						<p className="label-caps">Abrechnungscheck</p>
						<p className="font-semibold text-text">
							{kataster.billingReady
								? "Bereit"
								: `${kataster.readinessIssues} offene Punkte`}
						</p>
						<p className="text-xs text-text-muted">
							{kataster.openIncidents} Vorfälle · {kataster.resources}{" "}
							Ressourcen
						</p>
					</div>
				</div>
			</CardBody>
		</Card>
	);
}
