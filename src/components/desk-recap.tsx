import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { MonthlyRecap } from "@/domain/monthly-recap";
import { reportError } from "@/lib/forms";
import { orpc } from "@/lib/orpc";

/** The three sentences, as Hr. Körner wrote them. */
export function RecapSentences({ recap }: { recap: MonthlyRecap }) {
	return (
		<ol className="space-y-1.5 text-sm leading-relaxed text-text">
			{recap.sentences.map((sentence) => (
				<li key={sentence} className="break-words">
					{sentence}
				</li>
			))}
		</ol>
	);
}

/**
 * "Ihr August in drei Sätzen", on the desk in a month's first days until
 * the owner has read it. Both "Gelesen" and the close button mark it read on
 * the server, so it does not come back on another device.
 */
export function DeskRecapCard() {
	const queryClient = useQueryClient();
	const { data: recap } = useQuery(orpc.desk.recap.queryOptions());
	const read = useMutation(
		orpc.desk.recapRead.mutationOptions({
			onSuccess: () => {
				queryClient.setQueryData(orpc.desk.recap.queryKey(), null);
			},
			onError: reportError,
		}),
	);
	if (!recap) return null;
	const markRead = () => read.mutate({ month: recap.month });
	return (
		<Card aria-label={recap.title}>
			<CardHeader
				title={recap.title}
				subtitle="Hr. Körners Monatsrückblick"
				action={
					<Button
						variant="ghost"
						size="sm"
						aria-label="Rückblick schließen"
						onClick={markRead}
						disabled={read.isPending}
					>
						<X />
					</Button>
				}
			/>
			<CardBody className="space-y-3">
				<RecapSentences recap={recap} />
				<div className="flex flex-wrap items-center gap-x-4 gap-y-2 max-sm:[&>button]:w-full">
					<Button
						variant="outline"
						size="sm"
						onClick={markRead}
						disabled={read.isPending}
					>
						<Check /> Gelesen
					</Button>
					<Link
						to="/hr-koerner"
						search={{ recap: recap.month }}
						className="inline-flex items-center gap-1 text-xs text-brand hover:underline pointer-coarse:min-h-11"
					>
						Frühere Rückblicke <ArrowRight className="size-3" />
					</Link>
				</div>
			</CardBody>
		</Card>
	);
}
