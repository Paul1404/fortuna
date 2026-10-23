import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useInvalidateAll } from "./forms";
import { orpc } from "./orpc";

/** Acknowledge displayed findings, whether read on the desk or in their history. */
export function useObservationReads(visibleIds?: readonly string[]) {
	const { data: observations } = useQuery(
		orpc.hrKoerner.observations.queryOptions(),
	);
	const invalidate = useInvalidateAll();
	const { mutate: markRead } = useMutation(
		orpc.hrKoerner.markObservationsRead.mutationOptions({
			onSuccess: () => invalidate(),
		}),
	);
	useEffect(() => {
		const ids =
			observations
				?.filter(
					(row) =>
						row.status === "open" &&
						row.readAt === null &&
						(visibleIds === undefined || visibleIds.includes(row.id)),
				)
				.map((row) => row.id) ?? [];
		if (ids.length) markRead({ ids });
	}, [observations, visibleIds, markRead]);
}
