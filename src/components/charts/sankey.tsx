import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { sliceColor } from "./donut";
import { useMeasure } from "./use-measure";

// A three-column flow: individual holdings -> asset class -> net worth (and
// debts). Drawn with cubic ribbons; heights are proportional to value.

export type SankeyLeaf = {
	key: string;
	label: string;
	amountMinor: number;
	group: string;
};
export type SankeyGroup = { key: string; label: string };

export function wrapSankeyLabel(value: string, maxLength = 32): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of value.trim().split(/\s+/)) {
		if (!word) continue;
		if (line && line.length + word.length + 1 > maxLength) {
			lines.push(line);
			line = "";
		}
		if (word.length > maxLength) {
			for (let index = 0; index < word.length; index += maxLength) {
				const part = word.slice(index, index + maxLength);
				if (part.length === maxLength) lines.push(part);
				else line = part;
			}
		} else line = line ? `${line} ${word}` : word;
	}
	if (line) lines.push(line);
	return lines;
}

type Node = {
	key: string;
	label: string;
	value: number;
	y0: number;
	y1: number;
	color: string;
};

export function Sankey({
	leaves,
	groups,
	netWorthMinor,
	liabilitiesMinor,
	height = 360,
	className,
}: {
	leaves: SankeyLeaf[];
	groups: SankeyGroup[];
	netWorthMinor: number;
	liabilitiesMinor: number;
	height?: number;
	className?: string;
}) {
	const [ref, width] = useMeasure<HTMLDivElement>();
	const f = useFormat();
	const positive = leaves
		.filter((l) => l.amountMinor > 0)
		.sort(
			(a, b) => a.group.localeCompare(b.group) || b.amountMinor - a.amountMinor,
		);
	if (positive.length === 0) return null;
	const total = positive.reduce((s, l) => s + l.amountMinor, 0);
	const gap = 10;
	const canvasWidth = Math.max(width, 920);
	const labelW = Math.min(265, Math.max(205, canvasWidth * 0.22));
	const colX = [labelW, canvasWidth / 2 - 5, canvasWidth - labelW];
	const nodeW = 10;
	const usable = height - 20;
	const scale = (usable - gap * (positive.length - 1)) / total;
	const groupIndex = new Map(groups.map((g, i) => [g.key, i]));

	// Left column: leaves
	let y = 10;
	const leafNodes: (Node & { group: string })[] = positive.map((l) => {
		const h = Math.max(1, l.amountMinor * scale);
		const n = {
			key: l.key,
			label: l.label,
			value: l.amountMinor,
			y0: y,
			y1: y + h,
			color: sliceColor(groupIndex.get(l.group) ?? 0),
			group: l.group,
		};
		y += h + gap;
		return n;
	});
	// Middle column: groups
	y = 10;
	const groupNodes: Node[] = groups
		.map((g) => ({
			g,
			value: positive
				.filter((l) => l.group === g.key)
				.reduce((s, l) => s + l.amountMinor, 0),
		}))
		.filter((x) => x.value > 0)
		.map(({ g, value }) => {
			const h = value * scale;
			const n = {
				key: g.key,
				label: g.label,
				value,
				y0: y,
				y1: y + h,
				color: sliceColor(groupIndex.get(g.key) ?? 0),
			};
			y += h + gap * 2;
			return n;
		});
	// Right column: net worth + debts
	const debts = Math.max(0, liabilitiesMinor);
	const nw = Math.max(0, netWorthMinor);
	const rightNodes: Node[] = [
		{
			key: "nw",
			label: "Nettovermögen",
			value: nw,
			y0: 10,
			y1: 10 + nw * scale,
			color: "var(--fortuna-chart-1)",
		},
		...(debts > 0
			? [
					{
						key: "debt",
						label: "Verbindlichkeiten",
						value: debts,
						y0: 10 + nw * scale + gap * 2,
						y1: 10 + nw * scale + gap * 2 + debts * scale,
						color: "var(--fortuna-negative)",
					},
				]
			: []),
	];

	const ribbon = (
		x0: number,
		a0: number,
		a1: number,
		x1: number,
		b0: number,
		b1: number,
	) => {
		const c = (x1 - x0) / 2;
		return `M${x0},${a0} C${x0 + c},${a0} ${x1 - c},${b0} ${x1},${b0} L${x1},${b1} C${x1 - c},${b1} ${x0 + c},${a1} ${x0},${a1} Z`;
	};
	const ribbons: { d: string; color: string; key: string }[] = [];
	const groupCursor = new Map(groupNodes.map((g) => [g.key, g.y0]));
	for (const leaf of leafNodes) {
		const g = groupNodes.find((n) => n.key === leaf.group);
		if (!g) continue;
		const h = leaf.y1 - leaf.y0;
		const gy = groupCursor.get(g.key) ?? g.y0;
		ribbons.push({
			key: `l-${leaf.key}`,
			color: leaf.color,
			d: ribbon(colX[0] + nodeW, leaf.y0, leaf.y1, colX[1], gy, gy + h),
		});
		groupCursor.set(g.key, gy + h);
	}
	// Groups -> right: proportionally split each group between net worth and debts.
	const debtShare = total > 0 ? debts / total : 0;
	let nwCursor = rightNodes[0].y0;
	let debtCursor = rightNodes[1]?.y0 ?? 0;
	for (const g of groupNodes) {
		const h = g.y1 - g.y0;
		const hDebt = h * debtShare;
		const hNw = h - hDebt;
		ribbons.push({
			key: `g-${g.key}-nw`,
			color: g.color,
			d: ribbon(
				colX[1] + nodeW,
				g.y0,
				g.y0 + hNw,
				colX[2],
				nwCursor,
				nwCursor + hNw,
			),
		});
		nwCursor += hNw;
		if (rightNodes[1] && hDebt > 0.5) {
			ribbons.push({
				key: `g-${g.key}-debt`,
				color: "var(--fortuna-negative)",
				d: ribbon(
					colX[1] + nodeW,
					g.y0 + hNw,
					g.y1,
					colX[2],
					debtCursor,
					debtCursor + hDebt,
				),
			});
			debtCursor += hDebt;
		}
	}
	const label = (n: Node, x: number, anchor: "end" | "start") => {
		const lines = wrapSankeyLabel(n.label);
		const startY = (n.y0 + n.y1) / 2 - (lines.length * 12) / 2;
		return (
			<text
				key={`t-${n.key}`}
				x={x}
				y={startY}
				fontSize={11}
				dominantBaseline="middle"
				textAnchor={anchor}
				className="fill-text font-sans text-[11px]"
			>
				<title>{`${n.label}: ${f.money(n.value)}`}</title>
				{lines.map((line, index) => (
					<tspan
						key={`${n.key}-${index}`}
						x={x}
						dy={index ? 12 : 0}
						className="fill-text-secondary"
					>
						{line}
					</tspan>
				))}
				<tspan x={x} dy={12} className="amount fill-text font-semibold">
					{f.money(n.value, undefined, { compact: true })}
				</tspan>
			</text>
		);
	};
	return (
		<div ref={ref} className={cn("w-full overflow-x-auto", className)}>
			<svg
				width={canvasWidth}
				height={height}
				role="img"
				aria-label={`Fluss von ${positive.length} Positionen über ${groupNodes.length} Klassen zum Nettovermögen ${f.money(nw)} und zu Verbindlichkeiten ${f.money(debts)}`}
			>
				{ribbons.map((r) => (
					<path key={r.key} d={r.d} fill={r.color} fillOpacity={0.28} />
				))}
				{leafNodes.map((n) => (
					<rect
						key={n.key}
						x={colX[0]}
						y={n.y0}
						width={nodeW}
						height={Math.max(1, n.y1 - n.y0)}
						fill={n.color}
					>
						<title>{`${n.label}: ${f.money(n.value)}`}</title>
					</rect>
				))}
				{groupNodes.map((n) => (
					<rect
						key={n.key}
						x={colX[1]}
						y={n.y0}
						width={nodeW}
						height={n.y1 - n.y0}
						fill={n.color}
					/>
				))}
				{rightNodes.map((n) => (
					<rect
						key={n.key}
						x={colX[2]}
						y={n.y0}
						width={nodeW}
						height={Math.max(1, n.y1 - n.y0)}
						fill={n.color}
					/>
				))}
				{leafNodes
					.filter((n) => n.y1 - n.y0 >= 9)
					.map((n) => label(n, colX[0] - 6, "end"))}
				{groupNodes.map((n) => label(n, colX[1] + nodeW + 6, "start"))}
				{rightNodes.map((n) => label(n, colX[2] + nodeW + 6, "start"))}
			</svg>
		</div>
	);
}
