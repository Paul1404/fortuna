import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";

export type Slice = {
	key: string;
	label: string;
	amountMinor: number;
	share: number;
};

const COLORS = [
	"var(--fortuna-chart-1)",
	"var(--fortuna-chart-2)",
	"var(--fortuna-chart-3)",
	"var(--fortuna-chart-4)",
	"var(--fortuna-chart-5)",
	"var(--fortuna-chart-6)",
	"var(--fortuna-chart-7)",
	"var(--fortuna-chart-neutral-3)",
];

export function sliceColor(i: number): string {
	return COLORS[i % COLORS.length];
}

export function Donut({
	slices,
	totalMinor,
	currency,
	size = 150,
	className,
	centerLabel,
}: {
	slices: Slice[];
	totalMinor: number;
	currency?: string;
	size?: number;
	className?: string;
	centerLabel?: string;
}) {
	const f = useFormat();
	const r = size / 2 - 6;
	const stroke = 18;
	const c = 2 * Math.PI * (r - stroke / 2);
	let offset = 0;
	const positive = slices.filter((s) => s.amountMinor > 0);
	const sum = positive.reduce((s, x) => s + x.amountMinor, 0) || 1;
	return (
		<div className={cn("flex flex-wrap items-center gap-5", className)}>
			<svg
				width={size}
				height={size}
				viewBox={`0 0 ${size} ${size}`}
				role="img"
				aria-label={`Aufteilung: ${positive.map((s) => `${s.label} ${f.percent(s.share * 100).replace("+", "")}`).join(", ")}`}
			>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={r - stroke / 2}
					fill="none"
					stroke="var(--fortuna-chart-neutral-1)"
					strokeWidth={stroke}
				/>
				{positive.map((s, i) => {
					const len = (s.amountMinor / sum) * c;
					const el = (
						<circle
							key={s.key}
							cx={size / 2}
							cy={size / 2}
							r={r - stroke / 2}
							fill="none"
							stroke={sliceColor(i)}
							strokeWidth={stroke}
							strokeDasharray={`${Math.max(0, len - 1.5)} ${c - Math.max(0, len - 1.5)}`}
							strokeDashoffset={-offset}
							transform={`rotate(-90 ${size / 2} ${size / 2})`}
						/>
					);
					offset += len;
					return el;
				})}
				<text
					x={size / 2}
					y={size / 2 - 6}
					textAnchor="middle"
					className="fill-text-muted font-sans text-[9px] uppercase tracking-[0.13em]"
				>
					{centerLabel ?? "Summe"}
				</text>
				<text
					x={size / 2}
					y={size / 2 + 10}
					textAnchor="middle"
					className="amount fill-text font-sans text-[13px] font-semibold"
				>
					{f.money(totalMinor, currency, { compact: true })}
				</text>
			</svg>
			<ul className="min-w-56 flex-1 space-y-1.5 text-xs">
				{positive.map((s, i) => (
					<li key={s.key} className="flex items-center justify-between gap-3">
						<span className="flex min-w-0 items-center gap-2 text-text-secondary">
							<span
								className="inline-block size-2 shrink-0 rounded-sm"
								style={{ background: sliceColor(i) }}
							/>
							<span className="min-w-0 break-words">{s.label}</span>
						</span>
						<span className="flex shrink-0 items-center gap-3">
							<span className="amount text-text-muted">
								{f.percent(s.share * 100).replace("+", "")}
							</span>
							<span className="amount w-20 text-right font-semibold">
								{f.money(s.amountMinor, currency, { compact: true })}
							</span>
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}
