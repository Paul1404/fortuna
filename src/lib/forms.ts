import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { minorToDecimalString, parseDecimalToMinor } from "@/domain/money";

export function parseAmountInput(value: string): number | null {
	return parseDecimalToMinor(value);
}

export function toAmountInput(minor: number | null | undefined): string {
	return minor === null || minor === undefined
		? ""
		: minorToDecimalString(minor);
}

export function errorMessage(err: unknown): string {
	if (
		err &&
		typeof err === "object" &&
		"message" in err &&
		typeof (err as { message: unknown }).message === "string"
	) {
		return (err as { message: string }).message;
	}
	return "Etwas ist schiefgelaufen";
}

/** Invalidate every query after a mutation; the dataset is small enough. */
export function useInvalidateAll() {
	const qc = useQueryClient();
	return useCallback(() => qc.invalidateQueries(), [qc]);
}

export function reportError(err: unknown): void {
	toast.error(errorMessage(err));
}

export function str(form: FormData, key: string): string {
	const v = form.get(key);
	return typeof v === "string" ? v.trim() : "";
}

export function optStr(form: FormData, key: string): string | null {
	const v = str(form, key);
	return v === "" ? null : v;
}

export function num(form: FormData, key: string): number | null {
	const v = str(form, key);
	if (v === "") return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

export function amount(form: FormData, key: string): number | null {
	return parseAmountInput(str(form, key));
}

export const CURRENCIES = [
	"EUR",
	"USD",
	"GBP",
	"CHF",
	"JPY",
	"SEK",
	"NOK",
	"DKK",
	"PLN",
	"CZK",
] as const;
