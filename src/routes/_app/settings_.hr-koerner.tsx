import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
	INVESTMENT_RULES_ANCHOR,
	InvestmentRulesField,
} from "@/components/investment-rules";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings-tabs";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { BUCKET_LABELS, BUCKETS } from "@/domain/capital-advice";
import { estimateGoalDelayDays } from "@/domain/hr-koerner";
import { investmentRulesProblem } from "@/domain/investment-rules";
import { Money, useFormat } from "@/lib/format";
import {
	amount,
	num,
	optStr,
	reportError,
	str,
	toAmountInput,
	useInvalidateAll,
} from "@/lib/forms";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/_app/settings_/hr-koerner")({
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(
				orpc.hrKoerner.profile.queryOptions(),
			),
			context.queryClient.ensureQueryData(orpc.categories.list.queryOptions()),
			context.queryClient.ensureQueryData(
				orpc.hrKoerner.investmentRules.queryOptions(),
			),
		]),
	head: () => ({ meta: [{ title: "Hr. Körner: Finanzregeln · Fortuna" }] }),
	component: KoernerSettings,
});

type Profile = Awaited<ReturnType<typeof orpc.hrKoerner.profile.call>>;

const SPLIT_FIELDS = {
	equity: "targetEquityBps",
	bonds: "targetBondBps",
	cash: "targetCashBps",
	other: "targetOtherBps",
} as const;

function percentBps(form: FormData, key: string) {
	const value = Number(str(form, key).replace(",", "."));
	return Number.isFinite(value) ? Math.round(value * 100) : Number.NaN;
}

function useSaveProfile(message: string) {
	const invalidate = useInvalidateAll();
	const review = useMutation(
		orpc.hrKoerner.reviewNow.mutationOptions({
			onSuccess: () => invalidate(),
			onError: reportError,
		}),
	);
	return useMutation(
		orpc.hrKoerner.updateProfile.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				review.mutate(undefined);
				toast.success(message);
			},
			onError: reportError,
		}),
	);
}

function KoernerSettings() {
	const { data: profile } = useSuspenseQuery(
		orpc.hrKoerner.profile.queryOptions(),
	);
	const { data: rules } = useSuspenseQuery(
		orpc.hrKoerner.investmentRules.queryOptions(),
	);
	const f = useFormat();
	return (
		<div className="space-y-5">
			<PageHeader
				title="Hr. Körner: Finanzregeln"
				subtitle="Nur ausdrücklich gespeicherte Ziele und Grenzen gelten als Ihre Vorgaben."
				actions={
					<Button asChild variant="outline">
						<Link to="/hr-koerner">Zu den Beobachtungen</Link>
					</Button>
				}
			/>
			<SettingsTabs />
			{profile.currency !== f.baseCurrency ? (
				<p className="text-sm text-warning">
					Die Basiswährung ist jetzt {f.baseCurrency}. Die bisherigen Beträge in{" "}
					{profile.currency} werden bis zur erneuten Eingabe nicht verglichen.
				</p>
			) : null}
			<GoalsCard profile={profile} rules={rules.rules} />
			<AlertsCard profile={profile} />
		</div>
	);
}

/**
 * Goal, reserve and target split, stored once. "Anlegen", the desk and
 * Hr. Körner's observations read them from here.
 */
function GoalsCard({
	profile,
	rules,
}: {
	profile: Profile;
	rules: string | null;
}) {
	const f = useFormat();
	const save = useSaveProfile("Ziele gespeichert");
	const [rulesText, setRulesText] = useState(rules ?? "");
	const { data: plan } = useQuery(orpc.investmentAdvice.plan.queryOptions());
	const profileAmount = (minor: number | null) =>
		profile.currency === f.baseCurrency ? toAmountInput(minor) : "";
	const exampleDelay = estimateGoalDelayDays(
		180_000,
		profile.monthlySavingsTargetMinor,
	);
	return (
		<Card>
			<CardHeader title="Ziele & Reserve" />
			<CardBody>
				<form
					className="space-y-5"
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						for (const field of ["target", "savings", "reserve"]) {
							if (str(form, field) && amount(form, field) === null) {
								toast.error("Bitte gültige Geldbeträge eingeben");
								return;
							}
						}
						const split = BUCKETS.map((key) => percentBps(form, key));
						if (split.some((value) => !Number.isFinite(value) || value < 0))
							return toast.error("Alle Anteile als Prozentzahl eingeben");
						if (split.reduce((sum, value) => sum + value, 0) !== 10_000)
							return toast.error("Die Zielaufteilung muss genau 100 % ergeben");
						const rulesProblem = investmentRulesProblem(rulesText);
						if (rulesProblem) return toast.error(rulesProblem);
						save.mutate({
							goalName: optStr(form, "goalName"),
							targetNetWorthMinor: amount(form, "target"),
							targetNetWorthDate: optStr(form, "targetDate"),
							monthlySavingsTargetMinor: amount(form, "savings"),
							minimumCashReserveMinor: amount(form, "reserve"),
							reserveMonths: num(form, "reserveMonths") ?? 3,
							targetEquityBps: split[0],
							targetBondBps: split[1],
							targetCashBps: split[2],
							targetOtherBps: split[3],
							investmentRules: rulesText.trim() ? rulesText : null,
						});
					}}
				>
					<div className="grid gap-3 sm:grid-cols-2">
						<Field label="Ziel" htmlFor="k-goal">
							<Input
								id="k-goal"
								name="goalName"
								defaultValue={profile.goalName ?? ""}
								placeholder="z. B. Altersvorsorge"
							/>
						</Field>
						<Field label="Zielbetrag" htmlFor="k-target">
							<Input
								id="k-target"
								name="target"
								inputMode="decimal"
								defaultValue={profileAmount(profile.targetNetWorthMinor)}
							/>
						</Field>
						<Field label="Zieltermin" htmlFor="k-target-date">
							<Input
								id="k-target-date"
								name="targetDate"
								type="date"
								defaultValue={profile.targetNetWorthDate ?? ""}
							/>
						</Field>
						<Field
							label="Monatliche Sparrate"
							htmlFor="k-savings"
							hint={
								exampleDelay === null
									? "Ohne Sparrate schätzt Hr. Körner keine Zielverzögerung."
									: `Eine Ausgabe von ${f.money(180_000, profile.currency)} verschiebt das Ziel grob um ${exampleDelay} Tage.`
							}
						>
							<Input
								id="k-savings"
								name="savings"
								inputMode="decimal"
								defaultValue={profileAmount(profile.monthlySavingsTargetMinor)}
							/>
						</Field>
						<Field label="Reserve in Monatsausgaben" htmlFor="k-months">
							<Input
								id="k-months"
								name="reserveMonths"
								type="number"
								min={0}
								max={24}
								defaultValue={profile.reserveMonths}
								required
							/>
						</Field>
						<Field
							label="Mindestreserve"
							htmlFor="k-reserve"
							hint="Es gilt der größere Betrag: Monatsausgaben oder Mindestreserve."
						>
							<Input
								id="k-reserve"
								name="reserve"
								inputMode="decimal"
								defaultValue={profileAmount(profile.minimumCashReserveMinor)}
								placeholder="z. B. 10000"
							/>
						</Field>
					</div>
					<fieldset className="space-y-2">
						<legend className="mb-2 text-sm font-medium">
							Zielaufteilung in %
						</legend>
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
							{BUCKETS.map((key) => (
								<Field
									key={key}
									label={BUCKET_LABELS[key]}
									htmlFor={`k-split-${key}`}
								>
									<Input
										id={`k-split-${key}`}
										name={key}
										inputMode="decimal"
										defaultValue={String(
											profile[SPLIT_FIELDS[key]] / 100,
										).replace(".", ",")}
										required
									/>
								</Field>
							))}
						</div>
					</fieldset>
					<div id={INVESTMENT_RULES_ANCHOR} className="scroll-mt-24">
						<InvestmentRulesField
							id="k-rules"
							value={rulesText}
							onChange={setRulesText}
						/>
					</div>
					{plan ? (
						<p className="text-xs text-text-muted">
							Reserve heute:{" "}
							{plan.reserve.reserveMinor === null ? (
								"—"
							) : (
								<Money
									amountMinor={plan.reserve.reserveMinor}
									currency={plan.baseCurrency}
									weight="normal"
								/>
							)}
							. {plan.reserve.note}
						</p>
					) : null}
					<Button type="submit" disabled={save.isPending}>
						Ziele speichern
					</Button>
				</form>
			</CardBody>
		</Card>
	);
}

function AlertsCard({ profile }: { profile: Profile }) {
	const f = useFormat();
	const save = useSaveProfile("Hinweise gespeichert");
	const { data: categories } = useSuspenseQuery(
		orpc.categories.list.queryOptions(),
	);
	return (
		<Card>
			<CardHeader title="Hinweise" />
			<CardBody>
				<form
					className="space-y-5"
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						if (str(form, "purchase") && amount(form, "purchase") === null) {
							toast.error("Bitte einen gültigen Geldbetrag eingeben");
							return;
						}
						save.mutate({
							largePurchaseThresholdMinor: amount(form, "purchase"),
							unusualSpendMultiplierBps: Math.round(
								(num(form, "multiplier") ?? 2.5) * 10000,
							),
							alertSensitivity: (form.get("sensitivity") ?? "balanced") as
								| "quiet"
								| "balanced"
								| "detailed",
							ignoredCategoryIds: form.getAll("ignoredCategories").map(String),
							weeklyReportEnabled: form.get("weeklyReport") === "on",
						});
					}}
				>
					<div className="grid gap-3 sm:grid-cols-2">
						<Field label="Schwelle für größere Ausgaben" htmlFor="k-purchase">
							<Input
								id="k-purchase"
								name="purchase"
								inputMode="decimal"
								defaultValue={
									profile.currency === f.baseCurrency
										? toAmountInput(profile.largePurchaseThresholdMinor)
										: ""
								}
								placeholder="Standard: 50"
							/>
						</Field>
						<Field
							label="Auffällig ab Faktor"
							htmlFor="k-multiplier"
							hint="Vergleich mit dem Median früherer Ausgaben beim selben Händler."
						>
							<Input
								id="k-multiplier"
								name="multiplier"
								type="number"
								min="1.1"
								max="10"
								step="0.1"
								defaultValue={profile.unusualSpendMultiplierBps / 10000}
							/>
						</Field>
						<Field label="Hinweisempfindlichkeit" htmlFor="k-sensitivity">
							<NativeSelect
								id="k-sensitivity"
								name="sensitivity"
								defaultValue={profile.alertSensitivity}
							>
								<option value="quiet">Ruhig</option>
								<option value="balanced">Ausgewogen</option>
								<option value="detailed">Ausführlich</option>
							</NativeSelect>
						</Field>
					</div>
					<div>
						<p className="mb-2 text-sm font-medium">
							Kategorien aus der Ausgabenprüfung ausnehmen
						</p>
						<div className="grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">
							{categories
								.filter((row) => row.kind === "expense")
								.map((row) => (
									<label
										key={row.id}
										className="flex items-center gap-2 text-sm"
									>
										<input
											type="checkbox"
											name="ignoredCategories"
											value={row.id}
											defaultChecked={profile.ignoredCategoryIds.includes(
												row.id,
											)}
										/>
										{row.name}
									</label>
								))}
						</div>
					</div>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							name="weeklyReport"
							defaultChecked={profile.weeklyReportEnabled}
						/>
						Wochenbericht anzeigen
					</label>
					<Button type="submit" disabled={save.isPending}>
						Hinweise speichern
					</Button>
				</form>
			</CardBody>
		</Card>
	);
}
