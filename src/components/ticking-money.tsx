import type { ComponentProps } from "react";
import { Money } from "@/lib/format";
import { useMarketTicker } from "@/lib/market-pulse";

/**
 * `Money` for a figure that moves with the quotes: it ticks every second
 * between readings and lands exactly on each one (`useMarketTicker`).
 */
export function TickingMoney({
	amountMinor,
	readingKey,
	...props
}: Omit<ComponentProps<typeof Money>, "animate"> & { readingKey: unknown }) {
	const shown = useMarketTicker(amountMinor, readingKey);
	return <Money amountMinor={shown} animate {...props} />;
}
