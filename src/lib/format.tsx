import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { formatDateTime } from "@/domain/dates";
import { formatMoney, formatNumber, formatPercent } from "@/domain/money";
import { cn } from "@/lib/utils";

type FormatSettings = { locale: string; baseCurrency: string };

const FormatContext = createContext<FormatSettings>({
	locale: "de-DE",
	baseCurrency: "EUR",
});

export function FormatProvider({
	value,
	children,
}: {
	value: FormatSettings;
	children: ReactNode;
}) {
	return (
		<FormatContext.Provider value={value}>{children}</FormatContext.Provider>
	);
}

export function useFormat() {
	const s = useContext(FormatContext);
	return {
		...s,
		money: (
			amountMinor: number,
			currency?: string,
			options: { compact?: boolean; signed?: boolean } = {},
		) =>
			formatMoney(amountMinor, currency ?? s.baseCurrency, {
				locale: s.locale,
				...options,
			}),
		percent: (value: number, digits = 1) =>
			formatPercent(value, s.locale, digits),
		number: (value: number, digits = 2) =>
			formatNumber(value, s.locale, digits),
		date: (
			iso: string | null | undefined,
			style: "short" | "medium" | "month" = "medium",
		) => {
			if (!iso) return "";
			const d = new Date(`${iso}T00:00:00Z`);
			const opts: Intl.DateTimeFormatOptions =
				style === "short"
					? { day: "2-digit", month: "short" }
					: style === "month"
						? { month: "short", year: "numeric" }
						: { day: "2-digit", month: "short", year: "numeric" };
			return new Intl.DateTimeFormat(s.locale, {
				...opts,
				timeZone: "UTC",
			}).format(d);
		},
		dateTime: (value: Date | string | null | undefined) =>
			value ? formatDateTime(value, s.locale) : "",
	};
}

type Tone = "auto" | "default" | "muted" | "positive" | "negative" | "accent";

const COUNT_DURATION_MS = 850;

function AnimatedAmount({
	amountMinor,
	compact,
	format,
	countUp = true,
}: {
	amountMinor: number;
	compact?: boolean;
	format: (value: number) => string;
	/** Count up from zero on mount; off for rows and chips that only tick. */
	countUp?: boolean;
}) {
	const [displayed, setDisplayed] = useState(amountMinor);
	const displayedRef = useRef(amountMinor);
	const firstRun = useRef(countUp);
	const finalText = format(amountMinor);
	const thresholdText =
		compact && Math.abs(amountMinor) >= 1_000_000
			? format(Math.sign(amountMinor) * 999_999)
			: null;

	useEffect(() => {
		const reducedMotion = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		if (reducedMotion || document.hidden || !Number.isFinite(amountMinor)) {
			displayedRef.current = amountMinor;
			setDisplayed(amountMinor);
			firstRun.current = false;
			return;
		}

		const counting = firstRun.current;
		const from = counting ? 0 : displayedRef.current;
		firstRun.current = false;
		if (from === amountMinor) return;
		let frame = 0;
		let startedAt: number | null = null;
		displayedRef.current = from;
		setDisplayed(from);
		const tick = (time: number) => {
			startedAt ??= time;
			const progress = Math.min((time - startedAt) / COUNT_DURATION_MS, 1);
			const eased = 1 - (1 - progress) ** 3;
			const next = Math.round(from + (amountMinor - from) * eased);
			displayedRef.current = next;
			setDisplayed(next);
			if (progress < 1) frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [amountMinor]);

	return (
		<span className="inline-grid align-baseline">
			<span className="sr-only">{finalText}</span>
			<span aria-hidden="true" className="invisible col-start-1 row-start-1">
				{finalText}
			</span>
			{thresholdText && (
				<span aria-hidden="true" className="invisible col-start-1 row-start-1">
					{thresholdText}
				</span>
			)}
			<span aria-hidden="true" className="col-start-1 row-start-1">
				{format(displayed)}
			</span>
		</span>
	);
}

export function Money({
	amountMinor,
	currency,
	tone = "default",
	signed,
	compact,
	animate = false,
	countUp = true,
	className,
	weight = "semibold",
}: {
	amountMinor: number;
	currency?: string;
	tone?: Tone;
	signed?: boolean;
	compact?: boolean;
	animate?: boolean;
	/** With `animate`: count up from zero on mount (default) or only tick. */
	countUp?: boolean;
	className?: string;
	weight?: "normal" | "medium" | "semibold";
}) {
	const f = useFormat();
	const resolved: Exclude<Tone, "auto"> =
		tone === "auto"
			? amountMinor < 0
				? "negative"
				: amountMinor > 0
					? "positive"
					: "muted"
			: tone;
	return (
		<span
			className={cn(
				"amount",
				weight === "semibold" && "font-semibold",
				weight === "medium" && "font-medium",
				resolved === "muted" && "text-text-muted",
				resolved === "positive" && "text-positive",
				resolved === "negative" && "text-negative",
				resolved === "accent" && "text-accent",
				className,
			)}
		>
			{animate ? (
				<AnimatedAmount
					amountMinor={amountMinor}
					compact={compact}
					countUp={countUp}
					format={(value) => f.money(value, currency, { signed, compact })}
				/>
			) : (
				f.money(amountMinor, currency, { signed, compact })
			)}
		</span>
	);
}

export function Delta({
	amountMinor,
	currency,
	pct,
	className,
}: {
	amountMinor: number | null;
	currency?: string;
	pct?: number | null;
	className?: string;
}) {
	const f = useFormat();
	if (amountMinor === null)
		return (
			<span className={cn("text-xs text-text-muted", className)}>
				kein Vergleich
			</span>
		);
	const tone =
		amountMinor < 0
			? "text-negative"
			: amountMinor > 0
				? "text-positive"
				: "text-text-muted";
	return (
		<span className={cn("amount text-xs font-semibold", tone, className)}>
			{f.money(amountMinor, currency, { signed: true })}
			{pct !== null && pct !== undefined ? (
				<span className="ml-1.5 font-medium text-text-muted">
					{f.percent(pct)}
				</span>
			) : null}
		</span>
	);
}
