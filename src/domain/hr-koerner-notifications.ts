/** Only findings with a concrete liquidity consequence interrupt the owner. */
export type ProblemObservation = {
	type: string;
	actionable: boolean;
	severity: "info" | "notable" | "review" | "urgent";
};

export function isActionableProblem(observation: ProblemObservation): boolean {
	return (
		observation.actionable &&
		(observation.type === "liquidity_below_floor" ||
			observation.type === "upcoming_large_payment") &&
		(observation.severity === "review" || observation.severity === "urgent")
	);
}

/** Apply on reads too, so old findings cannot keep nagging until the next review. */
export function observationEnabled(
	observation: ProblemObservation,
	sensitivity: "quiet" | "balanced" | "detailed" = "balanced",
): boolean {
	if (observation.type === "stale_asset_valuation") return false;
	if (isActionableProblem(observation)) return true;
	if (sensitivity === "quiet") return false;
	if (
		observation.type === "unusual_spend" ||
		observation.type === "repeated_small_leak"
	)
		return sensitivity === "detailed";
	return true;
}

export type NotificationCandidate = ProblemObservation & {
	status: "open" | "dismissed" | "intentional" | "snoozed" | "resolved";
	readAt: Date | null;
};

export function inAppNotificationEligible(
	observation: NotificationCandidate,
): boolean {
	return (
		observation.status === "open" &&
		observation.readAt === null &&
		isActionableProblem(observation)
	);
}
