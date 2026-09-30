import { useState } from "react";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
	compactMoneyLabel,
	niceTicks,
	useMeasure,
	visibleAxisLabelIndices,
} from "./use-measure";

export type BarGroup = {
	x: string;
	label: string;
	values: { key: string; value: number }[];
};

type Props = {
	groups: BarGroup[];
	series: { key: string; label: string; color: string }[];
	line?: { label: string; values: { x: string; y: number }[]; color?: string };
	height?: number;
	currency?: string;
	className?: string;
	ariaLabel: string;
};

const PAD = { top: 16, right: 12, bottom: 32, left: 52 };

export function BarChart({
	groups,
	series,
	line,
	height = 220,
	currency,
	className,
	ariaLabel,
}: Props) {
	const [ref, width] = useMeasure<HTMLDivElement>();
	const f = useFormat();
	const [hover, setHover] = useState<number | null>(null);
	const cur = currency ?? f.baseCurrency;
	if (groups.length === 0)
		return (
			<div
				className={cn(
					"flex items-center justify-center text-xs text-text-muted",
					className,
				)}
				style={{ height }}
			>
				Keine Daten
			</div>
		);
	const all = groups
		.flatMap((g) => g.values.map((v) => v.value))
		.concat(line?.values.map((v) => v.y) ?? [], [0]);
	let minY = Math.min(...all);
	let maxY = Math.max(...all);
	if (minY === maxY) maxY = minY + 100;
	const padY = (maxY - minY) * 0.08;
	maxY += padY;
	if (minY < 0) minY -= padY;
	const ticks = niceTicks(minY, maxY, 4);
	const plotW = width - PAD.left - PAD.right;
	const plotH = height - PAD.top - PAD.bottom;
	const slot = plotW / groups.length;
	const barW = Math.max(3, Math.min(22, (slot * 0.7) / series.length));
	const py = (y: number) => PAD.top + (1 - (y - minY) / (maxY - minY)) * plotH;
	const gx = (i: number) => PAD.left + slot * i + slot / 2;
	const visibleLabels = new Set(visibleAxisLabelIndices(groups.length, slot));

	return (
		<div ref={ref} className={cn("relative w-full", className)}>
			<svg
				width={width}
				height={height}
				role="img"
				aria-label={ariaLabel}
				onPointerLeave={(event) => {
					if (event.pointerType !== "touch") setHover(null);
				}}
				className="block"
			>
				{ticks.map((t) => (
					<g key={t}>
						<line
							x1={PAD.left}
							x2={width - PAD.right}
							y1={py(t)}
							y2={py(t)}
							stroke={
								t === 0
									? "var(--fortuna-border-strong)"
									: "var(--fortuna-border)"
							}
						/>
						<text
							x={PAD.left - 8}
							y={py(t)}
							textAnchor="end"
							dominantBaseline="middle"
							className="fill-text-muted font-sans text-[10px]"
						>
							{compactMoneyLabel(t, cur, f.locale)}
						</text>
					</g>
				))}
				{groups.map((g, i) => (
					<g
						key={g.x}
						onPointerEnter={() => setHover(i)}
						onPointerDown={() => setHover(i)}
					>
						<rect
							x={PAD.left + slot * i}
							y={PAD.top}
							width={slot}
							height={plotH}
							fill={
								hover === i ? "var(--fortuna-surface-sunken)" : "transparent"
							}
						/>
						{series.map((s, si) => {
							const v = g.values.find((x) => x.key === s.key)?.value ?? 0;
							const x = gx(i) - (series.length * barW) / 2 + si * barW;
							const y0 = py(0);
							const y1 = py(v);
							return (
								<rect
									key={s.key}
									x={x + 0.5}
									y={Math.min(y0, y1)}
									width={barW - 1}
									height={Math.max(1, Math.abs(y1 - y0))}
									fill={s.color}
									rx={1}
								/>
							);
						})}
						{visibleLabels.has(i) ? (
							<text
								x={gx(i)}
								y={height - 10}
								textAnchor="middle"
								className="fill-text-muted font-sans text-[10px]"
							>
								{g.label}
							</text>
						) : null}
					</g>
				))}
				{line && line.values.length > 1 ? (
					<path
						d={line.values
							.map(
								(v, i) =>
									`${i === 0 ? "M" : "L"}${gx(groups.findIndex((g) => g.x === v.x)).toFixed(1)},${py(v.y).toFixed(1)}`,
							)
							.join(" ")}
						fill="none"
						stroke={line.color ?? "var(--fortuna-accent)"}
						strokeWidth={1.75}
						strokeLinejoin="round"
					/>
				) : null}
			</svg>
			{hover !== null ? (
				<div
					className="pointer-events-none absolute top-2 z-10 w-[180px] max-w-[calc(100%-8px)] rounded-sm border border-border bg-surface px-2.5 py-1.5 text-xs shadow-overlay"
					style={{
						left: Math.min(
							Math.max(gx(hover) - 70, 0),
							Math.max(0, width - 180),
						),
					}}
				>
					<p className="text-text-muted">{groups[hover].label}</p>
					{series.map((s) => (
						<p
							key={s.key}
							className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
						>
							<span className="flex min-w-0 items-center gap-1.5 break-words text-text-secondary">
								<span
									className="inline-block size-2 rounded-sm"
									style={{ background: s.color }}
								/>
								{s.label}
							</span>
							<span className="amount ml-auto font-semibold">
								{f.money(
									groups[hover].values.find((v) => v.key === s.key)?.value ?? 0,
									cur,
								)}
							</span>
						</p>
					))}
					{line ? (
						<p className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
							<span className="text-text-secondary">{line.label}</span>
							<span className="amount ml-auto font-semibold">
								{f.money(
									line.values.find((v) => v.x === groups[hover].x)?.y ?? 0,
									cur,
								)}
							</span>
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
