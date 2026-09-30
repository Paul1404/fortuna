import { Link, type LinkProps } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The lit navy surface of the app: a deep gradient panel with soft blooms
 * drifting behind the content. It stays dark in both themes, the way a bank
 * app keeps its balance header dark above a white page.
 *
 * The blooms are their own blurred elements rather than a background layer,
 * so the heavy blur never touches the text sitting on top of them.
 */
export function HeroPanel({
	children,
	className,
	blooms = true,
}: {
	children: ReactNode;
	className?: string;
	blooms?: boolean;
}) {
	return (
		<section className={cn("hero-panel on-navy", className)}>
			{blooms ? <HeroBlooms /> : null}
			<div className="relative z-10">{children}</div>
		</section>
	);
}

function HeroBlooms() {
	return (
		<div aria-hidden className="pointer-events-none absolute inset-0 z-0">
			<div
				className="absolute -top-1/3 left-[12%] size-[55%] rounded-full opacity-80 blur-3xl"
				style={{
					background:
						"radial-gradient(circle, var(--fortuna-glow) 0%, transparent 65%)",
					animation: "fortuna-drift 14s ease-in-out infinite",
				}}
			/>
			<div
				className="absolute -bottom-1/2 right-[6%] size-[70%] rounded-full opacity-70 blur-3xl"
				style={{
					background:
						"radial-gradient(circle, var(--fortuna-glow-soft) 0%, transparent 70%)",
					animation: "fortuna-drift 19s ease-in-out infinite reverse",
				}}
			/>
			<div
				className="absolute inset-x-0 top-0 h-px"
				style={{
					background:
						"linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)",
				}}
			/>
			{/* One specular pass on entry, then it stays off-panel to the right. */}
			<div
				className="absolute inset-y-0 left-0 w-1/3"
				style={{
					background:
						"linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent)",
					animation:
						"fortuna-sheen 2.2s cubic-bezier(0.4, 0, 0.2, 1) 0.35s both",
				}}
			/>
		</div>
	);
}

/** The whole performance, in seconds; the dot's lap is the first 60% of it. */
const RING_DURATION_S = 2.6;
const LAP_FRACTION = 0.6;
const TICK_COUNT = 90;
const RING_RADIUS = 88;

/**
 * For a CSS `cubic-bezier(x1, y1, x2, y2)` with monotonic y, the fraction of
 * the animation's duration at which its progress reaches `target`. Lets a
 * tick light up at the moment the dot actually passes it, whatever the
 * easing of the settle.
 */
function bezierTimeAt(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	target: number,
): number {
	const y = (t: number) =>
		3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3;
	const x = (t: number) =>
		3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3;
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 40; i++) {
		const mid = (lo + hi) / 2;
		if (y(mid) < target) lo = mid;
		else hi = mid;
	}
	return x((lo + hi) / 2);
}

/** Seconds into the performance at which the dot passes `angle` on its lap. */
function lapPassAt(angle: number): number {
	return RING_DURATION_S * LAP_FRACTION * (angle / 360);
}

/** Seconds at which the settling dot reaches `angle`, `sweep` being its end. */
function settlePassAt(angle: number, sweep: number): number {
	const lap = RING_DURATION_S * LAP_FRACTION;
	if (sweep <= 0) return lap;
	const fraction = bezierTimeAt(0.22, 1, 0.36, 1, Math.min(angle / sweep, 1));
	return lap + (RING_DURATION_S - lap) * fraction;
}

/**
 * The gauge ring. `progress` is a real, labelled ratio between 0 and 1 —
 * never a decorative fill: a partly filled ring reads as a measurement, so
 * anything shown inside one has to be something the app actually computed.
 *
 * It performs once: the dot runs a lap and every tick flares as it passes,
 * then it settles on the ratio while the arc fills behind it and the ticks
 * inside the ratio stay lit. After a hold the solid arc fades and the ring
 * rests as ticks, dot and rim — the ratio still readable. Hovering brings the
 * arc back, a tap replays it. Under reduced motion it is simply drawn at its
 * final state and never fades.
 */
export function HeroRing({
	progress,
	children,
	className,
	size = "clamp(14rem, 64vw, 16.75rem)",
	restAfterMs = 4600,
}: {
	progress: number;
	children: ReactNode;
	className?: string;
	/** Any CSS length. A `clamp()` keeps the ring readable down to phone width. */
	size?: string;
	/** Hold before the solid arc fades to the resting ticks; 0 keeps it. */
	restAfterMs?: number;
}) {
	const id = useId();
	const clamped = Math.min(Math.max(progress, 0), 1);
	const circumference = 2 * Math.PI * RING_RADIUS;
	const swept = circumference * clamped;
	const sweepAngle = clamped * 360;
	const settleAt = RING_DURATION_S * LAP_FRACTION;
	const [run, setRun] = useState(0);
	const [resting, setResting] = useState(false);

	useEffect(() => {
		setResting(false);
		if (!restAfterMs) return;
		// The fade is a motion effect; without motion the arc stays.
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const timer = window.setTimeout(() => setResting(true), restAfterMs);
		return () => window.clearTimeout(timer);
	}, [run, restAfterMs]);

	const ticks = Array.from({ length: TICK_COUNT }, (_, i) => {
		const angle = (i * 360) / TICK_COUNT;
		const lit = angle < sweepAngle;
		const animation = [
			`fortuna-tick-pass 0.55s ease-out ${lapPassAt(angle).toFixed(3)}s`,
			lit
				? `fortuna-tick-lit 0.4s ease-out ${settlePassAt(angle, sweepAngle).toFixed(3)}s forwards`
				: null,
		]
			.filter(Boolean)
			.join(", ");
		return { angle, lit, animation };
	});

	return (
		<div
			className={cn("group relative shrink-0", className)}
			style={{ width: size, height: size }}
		>
			<div
				key={run}
				className="absolute inset-0"
				// `backwards`, not `both`: a held final keyframe would override
				// every opacity set later, and nothing on the ring would fade.
				style={{
					animation:
						"fortuna-ring-in 0.8s cubic-bezier(0.22, 1, 0.36, 1) backwards",
				}}
			>
				{/* Backlight: swells while the dot settles, then rests low. */}
				<div
					aria-hidden
					className="absolute -inset-[14%] rounded-full blur-2xl"
					style={{
						background:
							"radial-gradient(circle, var(--fortuna-glow) 0%, transparent 62%)",
						animation: `fortuna-backlight ${RING_DURATION_S + 0.8}s ease-in-out both`,
					}}
				/>
				<svg viewBox="0 0 200 200" className="relative size-full" aria-hidden>
					<title>Fortschrittsring</title>
					<defs>
						<filter
							id={`${id}-halo`}
							x="-60%"
							y="-60%"
							width="220%"
							height="220%"
						>
							<feGaussianBlur stdDeviation="7" />
						</filter>
						<filter
							id={`${id}-dot`}
							x="-300%"
							y="-300%"
							width="700%"
							height="700%"
						>
							<feGaussianBlur stdDeviation="3.2" />
						</filter>
					</defs>
					{/* Rim: the thin outer circle the gauge sits inside. */}
					<circle
						cx="100"
						cy="100"
						r={RING_RADIUS + 9}
						fill="none"
						stroke="var(--fortuna-hero-text)"
						strokeWidth="0.6"
						opacity="0.35"
					/>
					{/* Halo: the ring's own light spilling onto the panel. */}
					<circle
						cx="100"
						cy="100"
						r={RING_RADIUS}
						fill="none"
						stroke="var(--fortuna-glow)"
						strokeWidth="6"
						opacity="0.3"
						filter={`url(#${id}-halo)`}
						style={{ animation: "fortuna-breathe 6s ease-in-out infinite" }}
					/>
					{/* Ticks: the gauge itself. Those inside the ratio end up lit. */}
					<g
						stroke="var(--fortuna-hero-text)"
						strokeWidth="1.6"
						strokeLinecap="round"
						style={{ ["--tick-rest" as string]: "0.28" }}
					>
						{ticks.map(({ angle, lit, animation }) => (
							<line
								key={angle}
								x1="100"
								y1={100 - RING_RADIUS - 3}
								x2="100"
								y2={100 - RING_RADIUS + 3}
								transform={`rotate(${angle} 100 100)`}
								opacity={lit ? 0.95 : 0.28}
								style={{ animation }}
							/>
						))}
					</g>
					{/* Lock-in: a ring of light leaves the gauge as the dot settles. */}
					<circle
						cx="100"
						cy="100"
						r={RING_RADIUS}
						fill="none"
						stroke="var(--fortuna-glow)"
						strokeWidth="2"
						opacity="0"
						style={{
							transformBox: "view-box",
							transformOrigin: "center",
							animation: `fortuna-ping 0.9s ease-out ${settleAt.toFixed(2)}s both`,
						}}
					/>
					{/* Solid arc: the performance. It fades once the ring rests. */}
					<circle
						cx="100"
						cy="100"
						r={RING_RADIUS}
						fill="none"
						stroke="var(--fortuna-hero-text)"
						strokeWidth="3"
						strokeLinecap="round"
						strokeDasharray={`${circumference}`}
						transform="rotate(-90 100 100)"
						className={cn(
							"transition-opacity duration-1000 ease-out",
							resting &&
								"opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
						)}
						style={{
							["--sweep-from" as string]: `${circumference}`,
							["--sweep-to" as string]: `${circumference - swept}`,
							strokeDashoffset: circumference - swept,
							animation: `fortuna-sweep-lap ${RING_DURATION_S}s linear forwards`,
						}}
					/>
					{/* The dot: one lap with a comet tail, then the head of the arc. */}
					<g
						style={{
							transformBox: "view-box",
							transformOrigin: "center",
							["--marker-to" as string]: `${360 + sweepAngle}deg`,
							animation: `fortuna-marker-lap ${RING_DURATION_S}s linear forwards`,
						}}
					>
						{[1, 2, 3].map((k) => (
							<circle
								key={k}
								cx={100 + RING_RADIUS * Math.sin((-k * 5 * Math.PI) / 180)}
								cy={100 - RING_RADIUS * Math.cos((-k * 5 * Math.PI) / 180)}
								r={3.2 - k * 0.7}
								fill="var(--fortuna-glow)"
								opacity={0.8 - k * 0.22}
								style={{
									animation: `fortuna-trail-out 0.5s ease-out ${(settleAt - 0.1).toFixed(2)}s forwards`,
								}}
							/>
						))}
						<circle
							cx="100"
							cy={100 - RING_RADIUS}
							r="7"
							fill="var(--fortuna-glow)"
							filter={`url(#${id}-dot)`}
						/>
						<circle
							cx="100"
							cy={100 - RING_RADIUS}
							r="3.5"
							fill="var(--fortuna-hero-text)"
						/>
					</g>
				</svg>
			</div>
			{/* The whole disc replays the ring; the figure on top lets clicks through. */}
			<button
				type="button"
				onClick={() => setRun((n) => n + 1)}
				aria-label="Ring erneut abspielen"
				className="absolute inset-0 z-10 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-glow"
			/>
			<div
				key={`figure-${run}`}
				className="pointer-events-none absolute inset-0 z-20 grid place-items-center px-6 text-center"
				style={{
					animation: `fortuna-figure-glow 1.2s ease-out ${(settleAt - 0.1).toFixed(2)}s`,
				}}
			>
				{children}
			</div>
		</div>
	);
}

/** Label above a hero figure — the muted small-caps line on the navy. */
export function HeroLabel({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<p
			className={cn(
				"text-[11px] font-medium uppercase leading-tight tracking-[0.13em] text-hero-muted",
				className,
			)}
		>
			{children}
		</p>
	);
}

/** A figure beside the ring: label, amount, and an optional explanation. */
export function HeroStat({
	label,
	value,
	detail,
	className,
}: {
	label: ReactNode;
	value: ReactNode;
	detail?: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("min-w-0", className)}>
			<HeroLabel>{label}</HeroLabel>
			<p className="amount mt-1.5 max-w-full overflow-x-auto text-xl font-semibold text-hero-text">
				{value}
			</p>
			{detail ? (
				<p className="mt-0.5 text-[11px] text-hero-muted">{detail}</p>
			) : null}
		</div>
	);
}

/** The row of circular quick actions under a hero figure. */
export function HeroActions({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"hero-stagger flex flex-wrap items-start justify-center gap-3 sm:gap-7",
				className,
			)}
		>
			{children}
		</div>
	);
}

const ACTION_CIRCLE =
	"grid size-12 place-items-center rounded-full border border-hero-border/80 bg-hero-text/10 text-hero-text transition-[background-color,box-shadow,transform] group-hover:bg-glow group-hover:shadow-glow group-active:scale-95 sm:size-14";
const ACTION_WRAPPER =
	"group flex w-[4.5rem] flex-col items-center gap-2 rounded-md text-center outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow disabled:opacity-50 sm:w-20";

/**
 * One circular quick action under a hero figure. Renders a router link when
 * `to` is given and a plain button otherwise, so the same circle serves
 * navigation and in-page actions.
 */
export function HeroAction({
	icon: Icon,
	label,
	to,
	search,
	onClick,
	disabled,
	className,
}: {
	icon: LucideIcon;
	label: string;
	to?: LinkProps["to"];
	search?: Record<string, unknown>;
	onClick?: () => void;
	disabled?: boolean;
	className?: string;
}) {
	const inner = (
		<>
			<span className={ACTION_CIRCLE}>
				<Icon className="size-5" aria-hidden />
			</span>
			<span className="text-[11px] leading-tight text-hero-muted group-hover:text-hero-text">
				{label}
			</span>
		</>
	);
	if (to)
		return (
			// The search shape belongs to the target route, which this generic
			// action cannot know; the caller owns that contract.
			<Link
				to={to}
				search={search as never}
				className={cn(ACTION_WRAPPER, className)}
			>
				{inner}
			</Link>
		);
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={cn(ACTION_WRAPPER, className)}
		>
			{inner}
		</button>
	);
}
