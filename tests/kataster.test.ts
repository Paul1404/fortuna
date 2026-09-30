import { describe, expect, it } from "vitest";
import { parseKatasterSummary } from "@/server/services/kataster";

describe("Kataster integration", () => {
	it("maps monthly cents and counts readiness issues", () => {
		const result = parseKatasterSummary(
			{
				period: "2026-09",
				rows: [
					{
						customerId: "1",
						name: "Kunde",
						costCents: 1200,
						chargeCents: 2000,
						marginCents: 800,
					},
				],
				unallocatedCostCents: 300,
				totalCostCents: 1500,
				totalChargeCents: 2000,
				totalMarginCents: 500,
			},
			{
				assetStatus: { healthy: 4 },
				openIncidents: 1,
				resources: 12,
				workerAlive: true,
			},
			{
				period: "2026-09",
				unassigned: [{}],
				unpriced: [{}, {}],
				uncoveredPools: [],
				ready: false,
			},
		);
		expect(result).toMatchObject({
			period: "2026-09",
			totalCostMinor: 1500,
			totalChargeMinor: 2000,
			totalMarginMinor: 500,
			readinessIssues: 3,
			billingReady: false,
		});
	});

	it("rejects malformed external responses", () => {
		expect(() => parseKatasterSummary({}, {}, {})).toThrow();
	});
});
