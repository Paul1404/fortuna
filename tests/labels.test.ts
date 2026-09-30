import { describe, expect, it } from "vitest";
import { assetCategoryLabel, liabilityTypeLabel } from "@/domain/net-worth";
import {
	assetClassLabel,
	importSourceLabel,
	investmentStatusLabel,
} from "@/lib/labels";

describe("label fallbacks", () => {
	it("translates the codes it knows", () => {
		expect(investmentStatusLabel("booked")).toBe("Gebucht");
		expect(assetClassLabel("etf")).toBe("ETF");
		expect(assetCategoryLabel("watch")).toBe("Uhren");
		expect(liabilityTypeLabel("mortgage")).toBe("Immobiliendarlehen");
	});

	it("shows a dash, never the raw code, for one it does not", () => {
		// "PARTIALLY_FILLED" used to reach a German table as "partially filled".
		expect(investmentStatusLabel("PARTIALLY_FILLED")).toBe("—");
		expect(assetClassLabel("STRUCTURED_PRODUCT")).toBe("—");
		expect(assetCategoryLabel("art")).toBe("—");
		expect(liabilityTypeLabel("student_loan")).toBe("—");
		expect(importSourceLabel("test")).toBe("—");
	});

	it("names every known source in German", () => {
		expect(importSourceLabel("provider:enable-banking")).toBe("Bankabruf");
		expect(importSourceLabel("provider:unknown")).toBe("—");
		expect(importSourceLabel("paypal")).toBe("PayPal");
		expect(importSourceLabel("cash")).toBe("Bargeld");
	});
});
