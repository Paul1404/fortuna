import { describe, expect, it } from "vitest";
import { selectBankBalance } from "@/server/services/enable-banking";

// Deutsche Bank reported a closing-booked balance of 0,00 € for an account that
// had just received 5.000,00 €: CLBD is the balance at the close of the last
// business day, so today's money is not in it yet.
describe("enable banking balance selection", () => {
	const clbdZero = {
		balance_type: "CLBD",
		reference_date: "2026-09-17",
		balance_amount: { amount: "0.00", currency: "EUR" },
	};
	const itbdToday = {
		balance_type: "ITBD",
		reference_date: "2026-09-18",
		balance_amount: { amount: "5000.00", currency: "EUR" },
	};

	it("prefers today's booked balance over the last closing balance", () => {
		expect(selectBankBalance([clbdZero, itbdToday], "EUR")).toMatchObject({
			minor: 500_000,
			currency: "EUR",
			date: "2026-09-18",
		});
	});

	it("still uses the closing balance when nothing fresher exists", () => {
		expect(selectBankBalance([clbdZero], "EUR")).toMatchObject({
			minor: 0,
			date: "2026-09-17",
		});
	});

	it("takes the newest entry of the same kind", () => {
		expect(
			selectBankBalance(
				[
					{ ...clbdZero, reference_date: "2026-09-10" },
					{
						balance_type: "CLBD",
						reference_date: "2026-09-17",
						balance_amount: { amount: "120.00", currency: "EUR" },
					},
				],
				"EUR",
			),
		).toMatchObject({ minor: 12_000, date: "2026-09-17" });
	});

	it("reports an unreadable balance as unknown rather than zero", () => {
		expect(
			selectBankBalance([{ balance_type: "CLBD" }], "EUR").minor,
		).toBeNull();
		expect(selectBankBalance([], "EUR").minor).toBeNull();
	});

	it("prefers a booked balance over an available one", () => {
		// An available balance can include an overdraft line, which is not money.
		expect(
			selectBankBalance(
				[
					{
						balance_type: "CLAV",
						balance_amount: { amount: "1500.00", currency: "EUR" },
					},
					clbdZero,
				],
				"EUR",
			),
		).toMatchObject({ minor: 0 });
	});

	it("uses the expected balance when the bank offers no interim booked one", () => {
		// Deutsche Bank returns ITAV, XPCD and CLBD. CLBD is last night's close,
		// ITAV can carry an overdraft line, so XPCD is the honest "now" figure.
		expect(
			selectBankBalance(
				[
					{
						balance_type: "ITAV",
						reference_date: "2026-09-18",
						balance_amount: { amount: "9500.00", currency: "EUR" },
					},
					{
						balance_type: "XPCD",
						reference_date: "2026-09-18",
						balance_amount: { amount: "5000.00", currency: "EUR" },
					},
					{
						balance_type: "CLBD",
						reference_date: "2026-09-18",
						balance_amount: { amount: "0.00", currency: "EUR" },
					},
				],
				"EUR",
			),
		).toMatchObject({ minor: 500_000 });
	});
});
