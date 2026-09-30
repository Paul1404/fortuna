import { describe, expect, it } from "vitest";
import { transactionFingerprint } from "@/domain/fingerprint";
import {
	isEmptyBookingText,
	merchantKey,
	normalizeDescription,
	providerAccountName,
	slugify,
} from "@/domain/normalize";

describe("normalisation and dedupe", () => {
	it("strips references, dates and IBANs from descriptions", () => {
		expect(
			normalizeDescription(
				"SEPA-LASTSCHRIFT REWE SAGT DANKE 12345678 EREF: ABC123 IBAN: DE89370400440532013000",
			),
		).toBe("rewe sagt danke");
		expect(
			normalizeDescription("Kartenzahlung 12.09.26 14:22 Aral Tankstelle"),
		).toBe("aral tankstelle");
	});

	it("groups the same merchant across reference noise", () => {
		expect(merchantKey(null, "REWE City 1234 Kartenzahlung 01.09.26")).toBe(
			merchantKey(null, "REWE City 9876 Kartenzahlung 05.10.26"),
		);
		expect(merchantKey("Spotify AB", "anything")).toBe("spotify ab");
	});

	it("fingerprints are stable across whitespace and reference noise, but not across amount", () => {
		const a = transactionFingerprint({
			bookingDate: "2026-09-01",
			amountMinor: -1299,
			currency: "EUR",
			description: "Spotify AB EREF:1",
		});
		const b = transactionFingerprint({
			bookingDate: "2026-09-01",
			amountMinor: -1299,
			currency: "eur",
			description: "  spotify   AB EREF:2 ",
		});
		const c = transactionFingerprint({
			bookingDate: "2026-09-01",
			amountMinor: -1300,
			currency: "EUR",
			description: "Spotify AB",
		});
		expect(a).toBe(b);
		expect(a).not.toBe(c);
		expect(a).toHaveLength(32);
	});

	it("slugifies", () => {
		expect(slugify("Restaurants & Cafés")).toBe("restaurants-cafes");
	});
});

describe("provider account names", () => {
	it("names the account after the institution, not the holder", () => {
		expect(
			providerAccountName({ institution: "PayPal", taken: new Set() }),
		).toBe("PayPal");
	});

	it("adds the product only when the plain name is taken", () => {
		expect(
			providerAccountName({
				institution: "Beispielbank",
				product: "Girokonto",
				taken: new Set(),
			}),
		).toBe("Beispielbank");
		expect(
			providerAccountName({
				institution: "Beispielbank",
				product: "Girokonto",
				taken: new Set(["Beispielbank"]),
			}),
		).toBe("Beispielbank · Girokonto");
	});

	it("falls back to the account type, then to the reference", () => {
		const taken = new Set(["Beispielbank"]);
		expect(
			providerAccountName({
				institution: "Beispielbank",
				typeLabel: "Sparkonto",
				taken,
			}),
		).toBe("Beispielbank · Sparkonto");
		expect(
			providerAccountName({
				institution: "Beispielbank",
				typeLabel: "Girokonto",
				reference: "DE87760905000002884631",
				taken: new Set([...taken, "Beispielbank · Girokonto"]),
			}),
		).toBe("Beispielbank · …4631");
	});

	it("ignores a product that only repeats the institution", () => {
		expect(
			providerAccountName({
				institution: "PayPal",
				product: "paypal",
				typeLabel: "Girokonto",
				taken: new Set(["PayPal"]),
			}),
		).toBe("PayPal · Girokonto");
	});

	it("numbers rather than collides when everything is taken", () => {
		expect(
			providerAccountName({
				institution: "PayPal",
				taken: new Set(["PayPal", "PayPal 2"]),
			}),
		).toBe("PayPal 3");
	});
});

describe("empty booking text", () => {
	it("recognises what a bank writes when it has nothing to say", () => {
		// The Sparda answers with the ISO domain code; older rows carry the old
		// fallback. Neither may become a merchant.
		for (const value of [
			"PMNT",
			"CNTR",
			"Ohne Verwendungszweck",
			"Banktransaktion",
			"   ",
			"",
			null,
		])
			expect(isEmptyBookingText(value)).toBe(true);
	});

	it("leaves a real purpose alone", () => {
		for (const value of ["Rechnung 4711", "REWE Markt", "Miete September"])
			expect(isEmptyBookingText(value)).toBe(false);
	});
});
