import { describe, expect, it } from "vitest";
import {
	type ContractLifecycleInput,
	contractForecastEntry,
	contractIsCosting,
	contractMonthlyCostMinor,
	contractPhase,
	noticeDeadline,
	proposeContractDetails,
} from "@/domain/contract";

const base: ContractLifecycleInput = {
	status: "active",
	startDate: "2024-01-01",
	endDate: null,
	cancellationDate: null,
	renewalDate: null,
	noticePeriodDays: null,
};

describe("contract lifecycle", () => {
	it("keeps a cancelled contract costing money until its end date", () => {
		const cancelled: ContractLifecycleInput = {
			...base,
			status: "cancelled",
			cancellationDate: "2026-09-15",
			endDate: "2026-10-31",
		};
		expect(contractPhase(cancelled, "2026-09-19")).toBe("cancelled_running");
		expect(contractIsCosting(cancelled, "2026-09-19")).toBe(true);
		expect(
			contractMonthlyCostMinor(
				{ ...cancelled, costMinor: 8900, frequency: "monthly" },
				"2026-09-19",
			),
		).toBe(8900);
	});

	it("ends it the day after, without anyone flipping the status", () => {
		const cancelled: ContractLifecycleInput = {
			...base,
			status: "cancelled",
			cancellationDate: "2026-09-15",
			endDate: "2026-10-31",
		};
		expect(contractPhase(cancelled, "2026-11-01")).toBe("ended");
		expect(contractIsCosting(cancelled, "2026-11-01")).toBe(false);
		expect(
			contractMonthlyCostMinor(
				{ ...cancelled, costMinor: 8900, frequency: "monthly" },
				"2026-11-01",
			),
		).toBe(0);
	});

	it("costs nothing before it starts", () => {
		expect(
			contractIsCosting({ ...base, startDate: "2027-01-01" }, "2026-09-19"),
		).toBe(false);
	});

	it("reports an unconvertible cadence instead of guessing a month", () => {
		expect(
			contractMonthlyCostMinor(
				{ ...base, costMinor: 120_000, frequency: "custom" },
				"2026-09-19",
			),
		).toBeNull();
		expect(
			contractMonthlyCostMinor(
				{ ...base, costMinor: 120_000, frequency: null },
				"2026-09-19",
			),
		).toBeNull();
		// A yearly contract is a twelfth of its cost, not the cost itself.
		expect(
			contractMonthlyCostMinor(
				{ ...base, costMinor: 120_000, frequency: "yearly" },
				"2026-09-19",
			),
		).toBe(10_000);
	});

	describe("notice deadline", () => {
		const renewing: ContractLifecycleInput = {
			...base,
			renewalDate: "2026-12-31",
			noticePeriodDays: 90,
		};

		it("counts back from the renewal date", () => {
			const deadline = noticeDeadline(renewing, "2026-09-19");
			expect(deadline?.date).toBe("2026-10-02");
			expect(deadline?.daysLeft).toBe(13);
			expect(deadline?.renewsOn).toBe("2026-12-31");
		});

		it("goes negative once missed rather than disappearing", () => {
			expect(noticeDeadline(renewing, "2026-10-20")?.daysLeft).toBe(-18);
		});

		it("has nothing to warn about once notice is given", () => {
			expect(
				noticeDeadline({ ...renewing, status: "cancelled" }, "2026-09-19"),
			).toBeNull();
		});

		it("invents no deadline without a notice period or a term date", () => {
			expect(
				noticeDeadline({ ...renewing, noticePeriodDays: null }, "2026-09-19"),
			).toBeNull();
			expect(
				noticeDeadline(
					{ ...renewing, renewalDate: null, endDate: null },
					"2026-09-19",
				),
			).toBeNull();
		});
	});
});

describe("contracts in the forecast", () => {
	const yearly = {
		...base,
		id: "c1",
		name: "Kfz-Versicherung",
		costMinor: 118_000,
		currency: "EUR",
		frequency: "yearly",
		startDate: "2024-03-15",
	};

	it("leaves a contract paid through the salary out of the forecast", () => {
		// Entgeltumwandlung: the employer pays it before the salary arrives, so
		// no money for it ever leaves the account — and no gap is reported.
		expect(
			contractForecastEntry(
				{
					...yearly,
					frequency: "monthly",
					costMinor: 33_800,
					paidVia: "payroll",
				},
				"2026-09-19",
			),
		).toBeNull();
		expect(
			contractForecastEntry(
				{ ...yearly, startDate: null, paidVia: "payroll" },
				"2026-09-19",
			),
		).toBeNull();
		expect(
			contractForecastEntry({ ...yearly, paidVia: "account" }, "2026-09-19"),
		).not.toBeNull();
	});

	it("projects a yearly contract detection can never find", () => {
		// One or two bookings give no cadence to infer, but the contract says it.
		const result = contractForecastEntry(yearly, "2026-09-19");
		expect(result).toEqual({
			entry: {
				contractId: "c1",
				name: "Kfz-Versicherung",
				amountMinor: -118_000,
				currency: "EUR",
				frequency: "yearly",
				nextDue: "2027-03-15",
				intervalDays: 365,
				typicalDay: 15,
				endsAfter: null,
			},
		});
	});

	it("keeps the start date's day when the next due date is clamped", () => {
		// Started on the 31st: the September due date is the 30th, and the
		// forecast must still put October on the 31st.
		const result = contractForecastEntry(
			{ ...yearly, frequency: "monthly", startDate: "2026-01-31" },
			"2026-09-02",
		);
		expect(result).toMatchObject({
			entry: { nextDue: "2026-09-30", typicalDay: 31, intervalDays: 30 },
		});
	});

	it("steps a weekly contract by a week, not by a month", () => {
		expect(
			contractForecastEntry(
				{ ...yearly, frequency: "weekly", startDate: "2026-09-01" },
				"2026-09-19",
			),
		).toMatchObject({ entry: { nextDue: "2026-09-22", intervalDays: 7 } });
	});

	it("takes the next date still ahead, not the first one ever", () => {
		expect(contractForecastEntry(yearly, "2026-01-05")).toMatchObject({
			entry: { nextDue: "2026-03-15" },
		});
	});

	it("counts a contract that starts inside the horizon from its first due day", () => {
		// Signed today for November: it costs nothing yet, but the forecast looks
		// ahead, and dropping it hid the first premium without naming a gap.
		expect(
			contractForecastEntry(
				{ ...yearly, startDate: "2026-11-01" },
				"2026-09-19",
			),
		).toMatchObject({ entry: { nextDue: "2026-11-01" } });
	});

	it("stays out when a recurring payment already carries it", () => {
		// Otherwise the same money is counted twice in the same forecast.
		expect(
			contractForecastEntry(
				{ ...yearly, recurringPaymentId: "r1" },
				"2026-09-19",
			),
		).toBeNull();
	});

	it("stops at the contract's end", () => {
		expect(
			contractForecastEntry(
				{ ...yearly, status: "cancelled", endDate: "2026-12-31" },
				"2026-09-19",
			),
		).toBeNull();
		expect(
			contractForecastEntry({ ...yearly, status: "ended" }, "2026-09-19"),
		).toBeNull();
	});

	it("names what is missing instead of guessing it", () => {
		expect(
			contractForecastEntry({ ...yearly, costMinor: null }, "2026-09-19"),
		).toEqual({ gap: "no_cost" });
		expect(
			contractForecastEntry({ ...yearly, frequency: null }, "2026-09-19"),
		).toEqual({ gap: "no_cadence" });
		expect(
			contractForecastEntry({ ...yearly, frequency: "custom" }, "2026-09-19"),
		).toEqual({ gap: "custom_cadence" });
		expect(
			contractForecastEntry({ ...yearly, startDate: null }, "2026-09-19"),
		).toEqual({ gap: "no_start" });
	});
});

describe("completing a contract from its bookings", () => {
	const evidence = {
		firstSeen: "2024-03-15",
		amountMinor: -118_000,
		frequency: "yearly" as const,
		currency: "EUR",
	};

	it("offers only what the contract is actually missing", () => {
		expect(
			proposeContractDetails(
				{ startDate: null, costMinor: null, frequency: null, currency: "EUR" },
				evidence,
			),
		).toEqual({
			startDate: "2024-03-15",
			costMinor: 118_000,
			frequency: "yearly",
		});
		expect(
			proposeContractDetails(
				{
					startDate: "2023-01-01",
					costMinor: 100_000,
					frequency: "yearly",
					currency: "EUR",
				},
				evidence,
			),
		).toBeNull();
	});

	it("proposes the cost as a positive amount", () => {
		// Recurring amounts are stored signed; a contract cost is not.
		const proposal = proposeContractDetails(
			{
				startDate: "2024-01-01",
				costMinor: null,
				frequency: "yearly",
				currency: "EUR",
			},
			evidence,
		);
		expect(proposal).toEqual({ costMinor: 118_000 });
	});

	it("refuses to reconcile two currencies", () => {
		expect(
			proposeContractDetails(
				{ startDate: null, costMinor: null, frequency: null, currency: "CHF" },
				evidence,
			),
		).toBeNull();
	});

	it("has nothing to say without a linked payment", () => {
		expect(
			proposeContractDetails(
				{ startDate: null, costMinor: null, frequency: null, currency: "EUR" },
				null,
			),
		).toBeNull();
	});
});
