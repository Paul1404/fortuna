import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import {
	INVESTMENT_RULES_MAX,
	INVESTMENT_RULES_PLACEHOLDER,
	investmentRulesProblem,
} from "@/domain/investment-rules";
import { reportError, useInvalidateAll } from "@/lib/forms";
import { orpc } from "@/lib/orpc";

/** Anchor of the rules field in "Ziele & Reserve", for links to it. */
export const INVESTMENT_RULES_ANCHOR = "anlageregeln";

/**
 * The owner's own investment rules as a form field. The examples are a
 * placeholder only: the rules must be the owner's words, never prefilled.
 */
export function InvestmentRulesField({
	id,
	value,
	onChange,
	label = "Meine Anlageregeln",
}: {
	id: string;
	value: string;
	onChange: (value: string) => void;
	label?: string;
}) {
	return (
		<Field
			label={label}
			htmlFor={id}
			hint={`Fortuna zeigt sie Ihnen vor jedem Verkauf. ${value.length.toLocaleString("de-DE")} / ${INVESTMENT_RULES_MAX.toLocaleString("de-DE")} Zeichen.`}
		>
			<Textarea
				id={id}
				name="investmentRules"
				rows={5}
				maxLength={INVESTMENT_RULES_MAX}
				value={value}
				onChange={(event) => {
					const { value: next } = event.currentTarget;
					onChange(next);
				}}
				placeholder={INVESTMENT_RULES_PLACEHOLDER}
			/>
		</Field>
	);
}

/**
 * "Meine Anlageregeln" on the Anlegen page: the same stored note as in
 * "Ziele & Reserve", editable here too.
 */
export function InvestmentRulesCard() {
	const { data } = useQuery(orpc.hrKoerner.investmentRules.queryOptions());
	if (!data) return null;
	return <InvestmentRulesForm key={data.rules ?? ""} stored={data.rules} />;
}

function InvestmentRulesForm({ stored }: { stored: string | null }) {
	const invalidate = useInvalidateAll();
	const [text, setText] = useState(stored ?? "");
	const save = useMutation(
		orpc.hrKoerner.updateProfile.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Anlageregeln gespeichert");
			},
			onError: reportError,
		}),
	);
	return (
		<Card>
			<CardHeader
				title="Meine Anlageregeln"
				subtitle={
					stored
						? undefined
						: "Schreiben Sie in einem ruhigen Moment auf, wann Sie verkaufen und was Sie im Crash tun."
				}
			/>
			<CardBody>
				<form
					className="space-y-3"
					onSubmit={(event) => {
						event.preventDefault();
						const problem = investmentRulesProblem(text);
						if (problem) return toast.error(problem);
						save.mutate({ investmentRules: text.trim() ? text : null });
					}}
				>
					<InvestmentRulesField
						id="invest-rules"
						label="Wann verkaufe ich, was tue ich im Crash?"
						value={text}
						onChange={setText}
					/>
					<Button
						type="submit"
						variant="outline"
						disabled={save.isPending || text.trim() === (stored ?? "")}
					>
						Regeln speichern
					</Button>
				</form>
			</CardBody>
		</Card>
	);
}

/**
 * The rules at the sale, before Scalable is asked for a preview. Without
 * rules, a short prompt to write them — it does not block the sale.
 */
export function InvestmentRulesReminder({ rules }: { rules: string | null }) {
	if (!rules)
		return (
			<p className="rounded-md border border-border bg-surface-sunken p-3 text-sm text-text-secondary">
				Sie haben noch keine eigenen Anlageregeln notiert.{" "}
				<Link
					to="/settings/hr-koerner"
					hash={INVESTMENT_RULES_ANCHOR}
					className="text-brand hover:underline"
				>
					Regeln aufschreiben
				</Link>
			</p>
		);
	return (
		<figure className="rounded-md border border-border-strong bg-surface-sunken p-3 sm:p-4">
			<figcaption className="label-caps text-text-secondary">
				Ihre Anlageregeln
			</figcaption>
			<blockquote className="mt-2 break-words text-base leading-relaxed whitespace-pre-wrap text-text [overflow-wrap:anywhere]">
				{rules}
			</blockquote>
		</figure>
	);
}
