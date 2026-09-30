import { useId, useState } from "react";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
	compactMoneyLabel,
	niceTicks,
	useMeasure,
	visibleAxisLabelIndices,
} from "./use-measure";

export type LinePoint = { x: string; y: number };
export type LineSeries = {
	key: string;
	label: string;
	points: LinePoint[];
	color?: string;
	dashed?: boolean;
	area?: boolean;
	width?: number;
};
export type Band = { x: string; low: number; high: number };

type Props = {
	series: LineSeries[];
	band?: Band[];
	height?: number;
	currency?: string;
	xLabel?: (x: string, index: number, all: string[]) => string | null;
	className?: string;
	zeroLine?: boolean;
	ariaLabel: string;
};

const PAD = { top: 16, right: 12, bottom: 32, left: 52 };

export function LineChart({
	series,
	band,
	height = 220,
	currency,
	xLabel,
	className,
	zeroLine = true,
	ariaLabel,
}: Props) {
	const [ref, width] = useMeasure<HTMLDivElement>();
	const f = useFormat();
	const gradientId = useId();
	const [hover, setHover] = useState<number | null>(null);
	const xs = Array.from(
		new Set(
			series
				.flatMap((s) => s.points.map((p) => p.x))
				.concat(band?.map((b) => b.x) ?? []),
		),
	).sort();
	if (xs.length === 0)
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
	const ys = series
		.flatMap((s) => s.points.map((p) => p.y))
		.concat(band?.flatMap((b) => [b.low, b.high]) ?? []);
	let minY = Math.min(...ys, zeroLine ? 0 : Number.POSITIVE_INFINITY);
	let maxY = Math.max(...ys, zeroLine ? 0 : Number.NEGATIVE_INFINITY);
	if (minY === maxY) {
		minY -= 100;
		maxY += 100;
	}
	const padY = (maxY - minY) * 0.08;
	minY -= padY;
	maxY += padY;
	const ticks = niceTicks(minY, maxY, 4);
	const plotW = width - PAD.left - PAD.right;
	const plotH = height - PAD.top - PAD.bottom;
	const xIndex = new Map(xs.map((x, i) => [x, i]));
	const px = (x: string) =>
		PAD.left + ((xIndex.get(x) ?? 0) / Math.max(1, xs.length - 1)) * plotW;
	const py = (y: number) => PAD.top + (1 - (y - minY) / (maxY - minY)) * plotH;
	const areaBaselineY = py(Math.max(minY, Math.min(0, maxY)));
	const cur = currency ?? f.baseCurrency;
	const line = (pts: LinePoint[]) =>
		pts
			.map(
				(p, i) =>
					`${i === 0 ? "M" : "L"}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`,
			)
			.join(" ");
	const visibleLabels = new Set(
		visibleAxisLabelIndices(xs.length, plotW / Math.max(1, xs.length - 1)),
	);

	function onMove(e: React.PointerEvent<SVGSVGElement>) {
		const rect = e.currentTarget.getBoundingClientRect();
		const x = e.clientX - rect.left - PAD.left;
		const idx = Math.round((x / plotW) * (xs.length - 1));
		setHover(Math.max(0, Math.min(xs.length - 1, idx)));
	}
	const hoverX = hover !== null ? xs[hover] : null;

	return (
		<div ref={ref} className={cn("relative w-full", className)}>
			<svg
				width={width}
				height={height}
				role="img"
				aria-label={ariaLabel}
				onPointerMove={onMove}
				onPointerDown={onMove}
				onPointerLeave={(event) => {
					if (event.pointerType !== "touch") setHover(null);
				}}
				className="block"
			>
				<defs>
					{series.map((s) => (
						<linearGradient
							key={s.key}
							id={`${gradientId}-${s.key}`}
							x1="0"
							x2="0"
							y1="0"
							y2="1"
						>
							<stop
								offset="0%"
								stopColor={s.color ?? "var(--fortuna-chart-1)"}
								stopOpacity="0.28"
							/>
							<stop
								offset="100%"
								stopColor={s.color ?? "var(--fortuna-chart-1)"}
								stopOpacity="0.02"
							/>
						</linearGradient>
					))}
				</defs>
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
							strokeWidth={1}
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
				{band && band.length > 1 ? (
					<path
						d={`${band.map((b, i) => `${i === 0 ? "M" : "L"}${px(b.x).toFixed(1)},${py(b.high).toFixed(1)}`).join(" ")} ${[
							...band,
						]
							.reverse()
							.map((b) => `L${px(b.x).toFixed(1)},${py(b.low).toFixed(1)}`)
							.join(" ")} Z`}
						fill="var(--fortuna-accent)"
						fillOpacity={0.12}
					/>
				) : null}
				{series.map((s) =>
					s.area && s.points.length > 1 ? (
						<path
							key={`${s.key}-area`}
							d={`${line(s.points)} L${px(s.points[s.points.length - 1].x).toFixed(1)},${areaBaselineY.toFixed(1)} L${px(s.points[0].x).toFixed(1)},${areaBaselineY.toFixed(1)} Z`}
							fill={`url(#${gradientId}-${s.key})`}
						/>
					) : null,
				)}
				{series.map((s) => (
					<path
						key={s.key}
						d={line(s.points)}
						fill="none"
						stroke={s.color ?? "var(--fortuna-chart-1)"}
						strokeWidth={s.width ?? 1.75}
						strokeDasharray={s.dashed ? "4 4" : undefined}
						strokeLinejoin="round"
						strokeLinecap="round"
					/>
				))}
				{xs.map((x, i) =>
					visibleLabels.has(i) ? (
						<text
							key={x}
							x={px(x)}
							y={height - 10}
							textAnchor={
								i === xs.length - 1 ? "end" : i === 0 ? "start" : "middle"
							}
							className="fill-text-muted font-sans text-[10px]"
						>
							{xLabel ? xLabel(x, i, xs) : f.date(x, "short")}
						</text>
					) : null,
				)}
				{hoverX !== null ? (
					<g>
						<line
							x1={px(hoverX)}
							x2={px(hoverX)}
							y1={PAD.top}
							y2={height - PAD.bottom}
							stroke="var(--fortuna-border-strong)"
							strokeDasharray="2 3"
						/>
						{series.map((s) => {
							const p = s.points.find((pt) => pt.x === hoverX);
							return p ? (
								<circle
									key={s.key}
									cx={px(p.x)}
									cy={py(p.y)}
									r={3.5}
									fill={s.color ?? "var(--fortuna-chart-1)"}
									stroke="var(--fortuna-surface)"
									strokeWidth={1.5}
								/>
							) : null;
						})}
					</g>
				) : null}
			</svg>
			{hoverX !== null ? (
				<div
					className="pointer-events-none absolute top-2 z-10 w-[170px] max-w-[calc(100%-8px)] rounded-sm border border-border bg-surface px-2.5 py-1.5 text-xs shadow-overlay"
					style={{
						left: Math.min(
							Math.max(px(hoverX) - 60, 0),
							Math.max(0, width - 170),
						),
					}}
				>
					<p className="text-text-muted">{f.date(hoverX)}</p>
					{series.map((s) => {
						const p = s.points.find((pt) => pt.x === hoverX);
						return p ? (
							<p
								key={s.key}
								className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
							>
								<span className="flex min-w-0 items-center gap-1.5 break-words text-text-secondary">
									<span
										className="inline-block size-2 rounded-full"
										style={{ background: s.color ?? "var(--fortuna-chart-1)" }}
									/>
									{s.label}
								</span>
								<span className="amount ml-auto font-semibold">
									{f.money(p.y, cur)}
								</span>
							</p>
						) : null;
					})}
				</div>
			) : null}
		</div>
	);
}
