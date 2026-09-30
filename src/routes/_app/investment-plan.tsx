import { createFileRoute, Link } from "@tanstack/react-router";
import { OrderLogCard } from "@/components/broker-order";
import { InvestPanel } from "@/components/investment-advice";
import { InvestmentRulesCard } from "@/components/investment-rules";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { orpc } from "@/lib/orpc";

/**
 * "Anlegen": the same proposal the desk opens as a dialog, plus the log of
 * every order Fortuna previewed or placed at Scalable. Goal, reserve and
 * the split are set under Hr. Körner's settings; the split and the owner's
 * own investment rules also here.
 */
export const Route = createFileRoute("/_app/investment-plan")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(
			orpc.investmentAdvice.plan.queryOptions(),
		),
	head: () => ({ meta: [{ title: "Anlegen · Fortuna" }] }),
	component: InvestPage,
});

function InvestPage() {
	return (
		<div className="space-y-5">
			<PageHeader
				title="Anlegen"
				actions={
					<Button asChild variant="outline">
						<Link to="/settings/hr-koerner">Ziele & Reserve</Link>
					</Button>
				}
			/>
			<Card>
				<CardBody className="pt-4">
					<InvestPanel />
				</CardBody>
			</Card>
			<InvestmentRulesCard />
			<OrderLogCard />
		</div>
	);
}
