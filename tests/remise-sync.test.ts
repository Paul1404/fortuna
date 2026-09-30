import { describe, expect, it } from "vitest";
import {
	findRemiseAssetMatch,
	isActiveRemiseItem,
	type RemiseSnapshotItem,
	remiseAcquisitionCostMinor,
	remiseValueMinor,
} from "@/domain/remise-sync";

const item: RemiseSnapshotItem = {
	slug: "2026-09-14-rolex",
	sku: "REM-1",
	title: "Rolex Datejust Uhr",
	lifecycle: "published",
	quantity: 2,
	valuation: 4999.95,
	valuationBasis: "target-price",
	acquisitionCost: 3500,
	updatedAt: "2026-09-14T17:00:00.000Z",
};

describe("Remise-Synchronisierung", () => {
	it("multipliziert Geld erst nach der Cent-Rundung mit der Stückzahl", () => {
		expect(remiseValueMinor(item)).toBe(999_990);
		expect(remiseAcquisitionCostMinor(item)).toBe(700_000);
	});

	it("entfernt abgeschlossene Bestände aus dem aktiven Vermögen", () => {
		expect(isActiveRemiseItem(item)).toBe(true);
		expect(isActiveRemiseItem({ ...item, lifecycle: "sold" })).toBe(false);
		expect(isActiveRemiseItem({ ...item, lifecycle: "archived" })).toBe(false);
	});

	it("verknüpft nur eindeutige bestehende Sachwerte", () => {
		expect(
			findRemiseAssetMatch(
				{
					title:
						"Rolex Oyster Perpetual 36 116034 Weißgold Diamant-Zifferblatt Full Set",
				},
				[
					{
						id: "oyster",
						name: "Rolex Oyster Perpetual 36 116034 Diamond Dial Full Set",
					},
					{ id: "date", name: "Rolex Date 115234 34mm Weißgold LC100" },
				],
			),
		).toBe("oyster");
		expect(
			findRemiseAssetMatch(
				{
					title:
						"Montblanc 1858 Iced Sea Automatic Date MB129369 Full Set Stahl 2022",
				},
				[{ id: "watch", name: "Montblanc 1858 Iced Sea Automatic" }],
			),
		).toBe("watch");
	});

	it("lässt mehrdeutige generische Namen getrennt", () => {
		expect(
			findRemiseAssetMatch({ title: "Samsung 16GB DDR4 ECC Server RAM" }, [
				{ id: "one", name: "Samsung 16GB DDR4 ECC RAM Modul" },
				{ id: "two", name: "Samsung 16GB DDR4 ECC Server Speicher" },
			]),
		).toBeNull();
	});
});
