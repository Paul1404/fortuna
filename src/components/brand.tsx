import { cn } from "@/lib/utils";

// The Crossbar F, drawn from fortuna-brand/logos/svg/fortuna-symbol-currentcolor.svg.
export function FortunaMark({
	className,
	size = 24,
}: {
	className?: string;
	size?: number;
}) {
	return (
		<svg
			viewBox="0 0 66 66"
			width={size}
			height={size}
			role="img"
			aria-label="Fortuna"
			className={cn("shrink-0", className)}
		>
			<g
				fill="none"
				stroke="currentColor"
				strokeWidth="10"
				strokeLinecap="butt"
				strokeLinejoin="miter"
			>
				<path d="M22 10V56" />
				<path d="M17.5 10H54" />
				<path d="M8 33H46" />
			</g>
		</svg>
	);
}

export function FortunaLockup({
	className,
	markClassName,
}: {
	className?: string;
	markClassName?: string;
}) {
	return (
		<span className={cn("inline-flex items-center gap-3", className)}>
			<FortunaMark size={22} className={cn("text-brand", markClassName)} />
			<span className="font-display text-[19px] font-normal tracking-[0.22em] uppercase leading-none">
				Fortuna
			</span>
		</span>
	);
}
