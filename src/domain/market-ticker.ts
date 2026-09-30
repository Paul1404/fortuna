/**
 * The motion a quote-driven figure makes between two real readings.
 *
 * The owner asked for net worth to tick continuously, not once per reading.
 * Between readings nothing is known, so the path is simulated, but only its
 * shape: it is a Brownian bridge that starts at what is on screen and ends
 * exactly on the new real value, so every reading is shown as it is and the
 * figure never drifts away from the market. Its wobble is scaled from how much
 * the real readings actually moved, so a quiet or closed market stands still.
 * It is display only: never stored, never used in a calculation.
 */

export const TICK_INTERVAL_MS = 15_000;
export const TICK_STEP_MS = 1_000;

/**
 * How far the path may wander, from the real moves seen so far. Half the
 * typical recent move keeps it lively without inventing a trend; nothing moves
 * when the last two readings did not.
 */
export function tickAmplitude(recentMoves: readonly number[]): number {
	const moves = recentMoves.slice(-8).map(Math.abs);
	if (moves.length === 0) return 0;
	const lastTwo = moves.slice(-2);
	if (lastTwo.every((move) => move === 0)) return 0;
	const sorted = [...moves].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)];
	return Math.round(Math.max(median, moves[moves.length - 1]) * 0.5);
}

/**
 * Integer values for `steps` ticks from `from` to `to`. The last value is
 * always exactly `to`; the others follow the straight line plus a bridge
 * whose largest excursion is at most `amplitude`.
 */
export function bridgePath(
	from: number,
	to: number,
	steps: number,
	amplitude: number,
	random: () => number = Math.random,
): number[] {
	const n = Math.max(1, Math.floor(steps));
	if (amplitude <= 0 || n === 1)
		return Array.from({ length: n }, (_, i) =>
			Math.round(from + ((to - from) * (i + 1)) / n),
		);
	const walk = [0];
	for (let i = 1; i <= n; i++) walk.push(walk[i - 1] + (random() * 2 - 1));
	// Pin both ends: subtract the straight line through the walk's endpoint.
	const bridge = walk.map((value, i) => value - (walk[n] * i) / n);
	const peak = Math.max(...bridge.map(Math.abs)) || 1;
	const scale = amplitude / peak;
	const path: number[] = [];
	for (let i = 1; i <= n; i++)
		path.push(
			i === n
				? to
				: Math.round(from + ((to - from) * i) / n + bridge[i] * scale),
		);
	return path;
}
