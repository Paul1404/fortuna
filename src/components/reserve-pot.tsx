import { ChevronDown } from "lucide-react";
import {
	type ReservePot as Pot,
	reservePotState,
	reservePotText,
} from "@/domain/progress";
import { Money } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The reserve as a pot that fills: liquid bank cash against the one reserve
 * (`requiredReserve`). A full pot says so and nothing more; the sentence on
 * how the reserve came about opens on a tap.
 */
export function ReservePot({
	pot,
	currency,
	className,
}: {
	pot: Pot;
	currency: string;
	className?: string;
}) {
	const filled = Math.min(pot.bankCashMinor, pot.reserveMinor);
	return (
		<details className={cn("group min-w-0", className)}>
			<summary
				className="cursor-pointer list-none space-y-1.5 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden"
				aria-label={`${reservePotText(pot, currency)}. Grundlage zeigen`}
			>
				<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
					<span className="flex items-center gap-1 text-text-secondary">
						Reserve
						<ChevronDown
							aria-hidden
							className="size-3.5 text-text-muted transition-transform group-open:rotate-180"
						/>
					</span>
					<span className="min-w-0 break-words text-text">
						<Money amountMinor={filled} currency={currency} weight="medium" />{" "}
						<span className="text-text-muted">von</span>{" "}
						<Money
							amountMinor={pot.reserveMinor}
							currency={currency}
							weight="normal"
						/>{" "}
						<span
							className={cn(
								"font-medium",
								pot.full ? "text-positive" : "text-text-secondary",
							)}
						>
							— {reservePotState(pot)}
						</span>
					</span>
				</div>
				<div
					aria-hidden
					className="h-1.5 w-full overflow-hidden rounded-[2px] bg-surface-sunken"
				>
					<div
						className={cn("h-full", pot.full ? "bg-positive" : "bg-brand")}
						style={{ width: `${pot.percent}%` }}
					/>
				</div>
			</summary>
			<p className="mt-1.5 break-words text-xs text-text-muted">{pot.note}</p>
		</details>
	);
}
