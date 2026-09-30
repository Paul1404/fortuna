import { describe, expect, it } from "vitest";
import { accountUids } from "@/server/services/enable-banking";

// Enable Banking documents two shapes for the authorised account list: the
// authorisation response carries account objects, a session read carries bare
// uid strings plus accounts_data objects. Both must yield the same uids.
describe("enable banking account uids", () => {
	const uid = "497f6eca-6276-4993-bfeb-53cbbbba6f08";

	it("reads accounts given as objects (authorisation response)", () => {
		expect(
			accountUids({ accounts: [{ uid, account_id: { iban: "DE02" } }] }),
		).toEqual([uid]);
	});

	it("reads accounts given as uid strings (session read)", () => {
		expect(accountUids({ accounts: [uid] })).toEqual([uid]);
	});

	it("falls back to accounts_data when accounts is empty", () => {
		expect(
			accountUids({
				accounts: [],
				accounts_data: [{ identification_hash: "abc", uid }],
			}),
		).toEqual([uid]);
	});

	it("reports the same account once when both lists carry it", () => {
		expect(accountUids({ accounts: [uid], accounts_data: [{ uid }] })).toEqual([
			uid,
		]);
	});

	it("returns nothing for a session without accounts", () => {
		expect(accountUids({ status: "PENDING_AUTHORIZATION" })).toEqual([]);
		expect(accountUids({ accounts: [], accounts_data: [] })).toEqual([]);
	});
});
