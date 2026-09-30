import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
	bridgePath,
	TICK_INTERVAL_MS,
	TICK_STEP_MS,
	tickAmplitude,
} from "@/domain/market-ticker";
import { pulseMatchesConfirmed } from "@/domain/scalable-market-pulse";
import { orpc } from "@/lib/orpc";

/**
 * The Scalable market pulse, shared by every figure that ticks with it: one
 * reading every 15 s while a page is visible, whichever components ask. The
 * server caches and coalesces the read as well, so a second subscriber never
 * costs a second broker call.
 */
export function useMarketPulse() {
	return useQuery({
		...orpc.scalable.marketPulse.queryOptions(),
		refetchInterval: TICK_INTERVAL_MS,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
		staleTime: TICK_INTERVAL_MS - 1_000,
		retry: false,
	});
}

type Pulse = ReturnType<typeof useMarketPulse>["data"];

/**
 * Net worth moved by today's quotes, or the booked figure. The overlay only
 * applies to the snapshot it was computed against; anything else shows the
 * booked value until the pulse catches up.
 */
export function indicativeNetWorth(
	confirmedMinor: number,
	pulse: Pulse,
): number {
	return pulse?.status === "available" &&
		pulse.indicativeNetWorthMinor !== null &&
		pulseMatchesConfirmed(pulse, confirmedMinor)
		? pulse.indicativeNetWorthMinor
		: confirmedMinor;
}

/**
 * A quote-driven figure that ticks between readings. Each reading starts a
 * bridge from what is on screen to the new real value over the next interval
 * (`bridgePath`), so the figure moves every second and still lands exactly on
 * every reading. `readingKey` changes with every reading, including one that
 * brought no move, so a quiet market calms the motion down. Off, or under
 * reduced motion, it simply shows the real value.
 */
export function useMarketTicker(
	target: number,
	readingKey: unknown,
	enabled = true,
): number {
	const [shown, setShown] = useState(target);
	const shownRef = useRef(target);
	const baseline = useRef(target);
	const lastKey = useRef(readingKey);
	const seenReading = useRef(false);
	const moves = useRef<number[]>([]);
	useEffect(() => {
		// Only a change between two real readings is market movement. The
		// shift from the booked snapshot to the first quote, or a new snapshot
		// after a sync, moves the baseline without counting as a move.
		const newReading = readingKey !== lastKey.current;
		lastKey.current = readingKey;
		if (newReading && seenReading.current)
			moves.current = [...moves.current, target - baseline.current].slice(-8);
		if (newReading) seenReading.current = true;
		baseline.current = target;
		const reduced = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		if (!enabled || reduced) {
			shownRef.current = target;
			setShown(target);
			return;
		}
		// The path lands two steps early and rests on the real value, so the
		// next reading never cuts it short.
		const path = bridgePath(
			shownRef.current,
			target,
			TICK_INTERVAL_MS / TICK_STEP_MS - 2,
			tickAmplitude(moves.current),
		);
		let step = 0;
		const timer = window.setInterval(() => {
			const value = path[step++];
			shownRef.current = value;
			setShown(value);
			if (step >= path.length) window.clearInterval(timer);
		}, TICK_STEP_MS);
		return () => window.clearInterval(timer);
		// readingKey restarts the bridge even when the value did not change.
	}, [target, readingKey, enabled]);
	return enabled ? shown : target;
}
