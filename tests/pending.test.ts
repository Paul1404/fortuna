import { describe, expect, it } from "vitest";
import {
	type HeldRow,
	PENDING_EXPIRY_DAYS,
	pendingReadFrom,
	unreportedPendingIds,
} from "@/domain/pending";

const today = "2026-09-25";

function held(overrides: Partial<HeldRow> = {}): HeldRow {
	return {
		id: "p1",
		bookingDate: "2026-09-01",
		externalId: "enable-banking:hold-1",
		fingerprint: "fp-hold",
		transferGroupId: null,
		categorySource: null,
		notes: null,
		...overrides,
	};
}

// The booked version came with a new reference and a final amount, so it
// shares nothing with the held row.
const booked = {
	bookingDate: "2026-09-03",
	externalId: "enable-banking:book-9",
	fingerprint: "fp-booked",
};
const recent = {
	bookingDate: "2026-09-24",
	externalId: "enable-banking:x",
	fingerprint: "fp-x",
};

describe("held bookings the bank stopped reporting", () => {
	it("lets go of an old held row a covering read no longer reports", () => {
		expect(
			unreportedPendingIds([held()], [booked, recent], "2026-08-20", today),
		).toEqual(["p1"]);
		expect(unreportedPendingIds([held()], [recent], null, today)).toEqual([
			"p1",
		]);
	});

	it("keeps it while the bank still reports it, by reference or content", () => {
		const byRef = { ...recent, externalId: "enable-banking:hold-1" };
		const byContent = { ...recent, fingerprint: "fp-hold" };
		expect(unreportedPendingIds([held()], [byRef], null, today)).toEqual([]);
		expect(unreportedPendingIds([held()], [byContent], null, today)).toEqual(
			[],
		);
	});

	it("gives a young hold time to be reported again", () => {
		const young = held({ bookingDate: "2026-09-20" });
		expect(unreportedPendingIds([young], [recent], null, today)).toEqual([]);
		expect(PENDING_EXPIRY_DAYS).toBeGreaterThanOrEqual(14);
	});

	it("says nothing about a row the read did not reach", () => {
		// The read started after the held row's date minus the margin.
		expect(
			unreportedPendingIds([held()], [recent], "2026-08-28", today),
		).toEqual([]);
	});

	it("never clears anything on an empty or stale answer", () => {
		expect(unreportedPendingIds([held()], [], null, today)).toEqual([]);
		const older = { ...booked, bookingDate: "2026-08-15" };
		expect(unreportedPendingIds([held()], [older], null, today)).toEqual([]);
	});

	it("leaves rows the owner touched and transfer legs alone", () => {
		const rows = [
			held({ id: "manual", categorySource: "manual" }),
			held({ id: "note", notes: "Kaution Hotel" }),
			held({ id: "pair", transferGroupId: "t1" }),
		];
		expect(unreportedPendingIds(rows, [recent], null, today)).toEqual([]);
	});

	it("reaches the read back past the oldest held row", () => {
		expect(
			pendingReadFrom([
				held({ bookingDate: "2026-09-10" }),
				held({ bookingDate: "2026-09-01" }),
			]),
		).toBe("2026-08-25");
		expect(pendingReadFrom([])).toBeNull();
	});
});
