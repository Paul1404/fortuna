import { useEffect, useRef, useState } from "react";

/** Width of a container in CSS pixels; charts render in pixel space so text stays crisp. */
export function useMeasure<T extends HTMLElement>(
	fallback = 600,
): [React.RefObject<T | null>, number] {
	const ref = useRef<T | null>(null);
	const [width, setWidth] = useState(fallback);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const update = () =>
			setWidth(Math.max(120, Math.floor(el.getBoundingClientRect().width)));
		update();
		const observer = new ResizeObserver(update);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	return [ref, width];
}

export function niceTicks(min: number, max: number, count = 4): number[] {
	if (max === min) return [min];
	const span = max - min;
	const rough = span / count;
	const mag = 10 ** Math.floor(Math.log10(rough));
	const norm = rough / mag;
	const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
	const start = Math.ceil(min / step) * step;
	const ticks: number[] = [];
	for (let v = start; v <= max + step * 0.001; v += step) {
		const tick = Math.round(v * 1e6) / 1e6;
		ticks.push(tick === 0 ? 0 : tick);
	}
	return ticks.filter((tick) => tick >= min && tick <= max);
}

/**
 * Keep the final date visible without squeezing it against its neighbour.
 * Labels are centred on their anchor, so the spacing has to exceed the label
 * itself: a German month label such as "Sept. 2026" measures about 72px, which
 * a 70px spacing let collide into a single run at phone width.
 */
export function visibleAxisLabelIndices(
	length: number,
	pointSpacing: number,
	minGap = 88,
): number[] {
	if (length <= 0) return [];
	if (length === 1) return [0];
	const every = Math.max(1, Math.ceil(minGap / Math.max(1, pointSpacing)));
	const indices: number[] = [];
	for (let index = 0; index < length - 1; index += every) {
		if ((length - 1 - index) * pointSpacing >= minGap) indices.push(index);
	}
	indices.push(length - 1);
	return indices;
}

export function compactMoneyLabel(
	minor: number,
	currency: string,
	locale: string,
): string {
	const abs = Math.abs(minor) / 100;
	const sign = minor < 0 ? "−" : "";
	const symbol =
		new Intl.NumberFormat(locale, { style: "currency", currency })
			.formatToParts(0)
			.find((p) => p.type === "currency")?.value ?? currency;
	// A German tick must read 1,5k, not 1.5k — the point would be a thousands
	// separator there and turn 1.500 € into fifteen hundred thousand.
	const decimal = (value: number, digits: number) =>
		new Intl.NumberFormat(locale, {
			minimumFractionDigits: digits,
			maximumFractionDigits: digits,
		}).format(value);
	if (abs >= 1_000_000)
		return `${sign}${symbol}${decimal(abs / 1_000_000, 1)}M`;
	if (abs >= 10_000) return `${sign}${symbol}${decimal(abs / 1000, 0)}k`;
	if (abs >= 1_000) return `${sign}${symbol}${decimal(abs / 1000, 1)}k`;
	return `${sign}${symbol}${decimal(abs, 0)}`;
}
