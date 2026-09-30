/** Findings are delivered in the app only: the sidebar badge. */
export type NotificationCandidate = {
	status: "open" | "dismissed" | "intentional" | "snoozed" | "resolved";
	severity: "info" | "notable" | "review" | "urgent";
};

export function inAppNotificationEligible(
	observation: NotificationCandidate,
): boolean {
	return (
		observation.status === "open" &&
		(observation.severity === "review" || observation.severity === "urgent")
	);
}
