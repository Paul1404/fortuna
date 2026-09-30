import { describe, expect, it } from "vitest";
import {
	groupFixedCosts,
	monthlyFixedCostSeries,
	payrollRecurringIds,
} from "@/domain/fixed-costs";

const lifecycle = {
	status: "active" as const,
	startDate: "2025-01-01",
	endDate: null,
	cancellationDate: null,
	renewalDate: null,
	noticePeriodDays: null,
};

const payment = {
	id: "r1",
	name: "Streaming",
	direction: "outflow" as const,
	isActive: true,
	monthlyEquivalentMinor: -1_299,
	currency: "EUR",
};
const contract = {
	id: "c1",
	name: "Streaming Premium",
	recurringPaymentId: "r1",
	phase: "running" as const,
	monthlyCostMinor: 1_299,
	bookedMonthlyCostMinor: null,
	currency: "EUR",
};
const mission = {
	id: "o1",
	title: "Streaming kündigen",
	recurringPaymentId: null,
	contractId: "c1",
	status: "planned" as const,
	currentMonthlyMinor: 1_299,
	currency: "EUR",
};

describe("Fixkosten", () => {
	it("reads a subscription stored three times as one item", () => {
		const items = groupFixedCosts([payment], [contract], [mission]);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			key: "r:r1",
			name: "Streaming Premium",
			monthlyMinor: -1_299,
			counted: true,
			divergence: null,
		});
		expect(items[0].contract?.id).toBe("c1");
		expect(items[0].mission?.id).toBe("o1");
	});

	it("shows where the contract and the bookings disagree", () => {
		const [item] = groupFixedCosts(
			[{ ...payment, monthlyEquivalentMinor: -1_599 }],
			[contract],
			[],
		);
		// The agreement said 12,99; 15,99 leaves the account. Both stay visible.
		expect(item.monthlyMinor).toBe(-1_599);
		expect(item.divergence).toEqual({
			agreedMinor: 1_299,
			bookedMinor: 1_599,
		});
	});

	it("ends the payment with its contract", () => {
		const [item] = groupFixedCosts(
			[payment],
			[{ ...contract, phase: "ended", monthlyCostMinor: 0 }],
			[],
		);
		expect(item.active).toBe(false);
		expect(item.counted).toBe(false);
		expect(item.divergence).toBeNull();
	});

	it("keeps a contract without a payment and a lone mission apart", () => {
		const items = groupFixedCosts(
			[],
			[{ ...contract, recurringPaymentId: null }],
			[{ ...mission, id: "o2", contractId: null }],
		);
		expect(items.map((item) => item.key)).toEqual(["c:c1", "o:o2"]);
		// A Sparmission alone is an idea, never a cost in the total.
		expect(items[1].counted).toBe(false);
	});

	it("never lets a dismissed mission stand as the item's status", () => {
		const [item] = groupFixedCosts(
			[payment],
			[],
			[{ ...mission, recurringPaymentId: "r1", status: "dismissed" }],
		);
		expect(item.mission).toBeNull();
		expect(item.missions).toHaveLength(1);
	});
});

describe("Fixkosten paid through the salary", () => {
	const pension = {
		id: "c9",
		name: "Direktversicherung",
		recurringPaymentId: null,
		phase: "running" as const,
		monthlyCostMinor: 33_800,
		bookedMonthlyCostMinor: null,
		currency: "EUR",
		paidVia: "payroll" as const,
	};

	it("lists a payroll-paid contract as über Gehalt but leaves it out of the total", () => {
		const items = groupFixedCosts([payment], [contract, pension], []);
		const item = items.find((row) => row.key === "c:c9");
		expect(item).toMatchObject({
			active: true,
			monthlyMinor: -33_800,
			counted: false,
			viaPayroll: true,
		});
		const total = items
			.filter((row) => row.counted)
			.reduce((sum, row) => sum + Math.abs(row.monthlyMinor ?? 0), 0);
		expect(total).toBe(1_299);
	});

	it("does not count a payment the owner linked to it either", () => {
		const manual = {
			...payment,
			id: "r9",
			name: "Direktversicherung",
			monthlyEquivalentMinor: -33_800,
		};
		const linked = { ...pension, recurringPaymentId: "r9" };
		const [item] = groupFixedCosts([manual], [linked], []);
		expect(item).toMatchObject({ counted: false, viaPayroll: true });
		expect(payrollRecurringIds([linked])).toEqual(new Set(["r9"]));
	});

	it("keeps it out of the fixed costs over time", () => {
		const series = monthlyFixedCostSeries(
			["2026-07", "2026-08"],
			[
				{
					id: "r1",
					frequency: "monthly",
					intervalDays: 30,
					bookings: [
						{ bookingDate: "2026-07-03", amountMinor: -1_299 },
						{ bookingDate: "2026-08-03", amountMinor: -1_599 },
					],
				},
			],
			[
				{
					...lifecycle,
					recurringPaymentId: null,
					costMinor: 33_800,
					frequency: "monthly",
					paidVia: "payroll",
				},
				{
					...lifecycle,
					recurringPaymentId: null,
					costMinor: 12_000,
					frequency: "yearly",
				},
			],
			new Set(["r1"]),
		);
		// 12,99 then 15,99 booked, plus a twelfth of the 120 € yearly contract.
		expect(series).toEqual([
			{ month: "2026-07", fixedCostsMinor: 1_299 + 1_000 },
			{ month: "2026-08", fixedCostsMinor: 1_599 + 1_000 },
		]);
	});

	it("smooths a yearly payment and drops one that stopped", () => {
		const series = monthlyFixedCostSeries(
			["2026-01", "2026-06", "2027-03"],
			[
				{
					id: "y",
					frequency: "yearly",
					intervalDays: 365,
					bookings: [{ bookingDate: "2026-01-10", amountMinor: -24_000 }],
				},
				{
					id: "m",
					frequency: "monthly",
					intervalDays: 30,
					bookings: [{ bookingDate: "2026-01-05", amountMinor: -1_000 }],
				},
			],
			[],
			new Set(),
		);
		expect(series.map((row) => row.fixedCostsMinor)).toEqual([
			2_000 + 1_000,
			2_000,
			2_000,
		]);
	});
});
