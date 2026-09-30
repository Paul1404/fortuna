import {
	ArrowLeft,
	Check,
	HandCoins,
	History,
	type LucideIcon,
	Pencil,
} from "lucide-react";
import { useState } from "react";
import { LineChart } from "@/components/charts/line-chart";
import { ActionItem, AmountInput } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { todayIso } from "@/domain/dates";
import {
	amountInputText,
	balanceDateProblem,
	previewPayment,
} from "@/domain/settlement";
import { Money, useFormat } from "@/lib/format";
import { parseAmountInput } from "@/lib/forms";

/**
 * The action sheet behind one receivable or liability: record a repayment,
 * close it, correct the open amount, or look at its history. It is the same
 * three jobs on both sides of Forderungen & Schulden, so one component serves
 * both and the caller supplies the words and the writes. Every write is a
 * dated balance through the history services; nothing here updates the
 * balance on the parent row.
 */

type Step = "menu" | "payment" | "settle" | "amount" | "history";

export type BalanceActionsCopy = {
	/** "Offen" or "Restschuld". */
	balanceLabel: string;
	/** "Danach offen" or "Danach Restschuld". */
	afterLabel: string;
	payment: { label: string; detail?: string; field: string; hint?: string };
	settle: { label: string; detail: string; submit: string };
	amount: { label: string; field: string };
};

export function BalanceActionsDialog({
	title,
	subtitle,
	currency,
	balanceMinor,
	balanceAsOf,
	originalMinor,
	copy,
	tone = "default",
	canRecord,
	canSettle,
	readOnlyNote,
	defaultPaymentMinor,
	history,
	onRecord,
	onSettle,
	onEdit,
	onClose,
	extraActions,
}: {
	title: string;
	subtitle?: string;
	currency: string;
	balanceMinor: number;
	balanceAsOf: string | null;
	originalMinor: number | null;
	copy: BalanceActionsCopy;
	tone?: "default" | "negative";
	/** Payment and amount changes are offered. */
	canRecord: boolean;
	/** "Vollständig beglichen" / "Abgelöst" is offered. */
	canSettle: boolean;
	/** Shown in place of the actions a row cannot take, e.g. a linked card. */
	readOnlyNote?: React.ReactNode;
	defaultPaymentMinor?: number | null;
	history: { date: string; balanceMinor: number }[] | undefined;
	onRecord: (input: {
		date: string;
		balanceMinor: number;
		kind: "payment" | "amount";
	}) => Promise<unknown>;
	onSettle: (date: string) => Promise<unknown>;
	onEdit: () => void;
	onClose: () => void;
	extraActions?: {
		icon: LucideIcon;
		label: string;
		detail?: string;
		onClick: () => void;
	}[];
}) {
	const f = useFormat();
	const [step, setStep] = useState<Step>("menu");
	const [amountText, setAmountText] = useState("");
	const [date, setDate] = useState(todayIso());
	const [pending, setPending] = useState(false);
	const today = todayIso();
	const parsed = parseAmountInput(amountText);
	const dateProblem = balanceDateProblem(date, { balanceAsOf, today });

	const open = (next: Step) => {
		setDate(today);
		setAmountText(
			next === "payment"
				? amountInputText(defaultPaymentMinor)
				: next === "amount"
					? amountInputText(balanceMinor)
					: "",
		);
		setStep(next);
	};
	const run = async (write: () => Promise<unknown>) => {
		setPending(true);
		try {
			await write();
			onClose();
		} catch {
			// The mutation reports its own error; the sheet stays open to retry.
		} finally {
			setPending(false);
		}
	};

	const shown = (minor: number) => (tone === "negative" ? -minor : minor);
	const stepTitle: Record<Step, string> = {
		menu: title,
		payment: copy.payment.label,
		settle: copy.settle.label,
		amount: copy.amount.label,
		history: "Verlauf",
	};
	const back =
		step === "menu" ? null : (
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="-ml-2 self-start"
				onClick={() => setStep("menu")}
			>
				<ArrowLeft /> {title}
			</Button>
		);

	return (
		<Dialog open onOpenChange={(value) => !value && onClose()}>
			<DialogContent
				title={stepTitle[step]}
				description={step === "menu" ? subtitle : undefined}
			>
				{back}
				{step === "menu" ? (
					<div className="space-y-4">
						<div className="rounded-md bg-surface-sunken/60 px-4 py-3">
							<p className="label-caps">{copy.balanceLabel}</p>
							<p className="mt-1 text-2xl">
								<Money
									amountMinor={shown(balanceMinor)}
									currency={currency}
									tone={
										tone === "negative" && balanceMinor > 0
											? "negative"
											: "default"
									}
								/>
							</p>
							<p className="mt-1 text-xs text-text-muted">
								{balanceAsOf ? `Stand ${f.date(balanceAsOf)}` : "ohne Datum"}
								{originalMinor !== null
									? ` · ursprünglich ${f.money(originalMinor, currency)}`
									: ""}
							</p>
						</div>
						{readOnlyNote ? (
							<p className="text-sm text-text-secondary">{readOnlyNote}</p>
						) : null}
						<div className="grid gap-2">
							{canRecord && canSettle ? (
								<ActionItem
									icon={HandCoins}
									tone="primary"
									label={copy.payment.label}
									detail={copy.payment.detail}
									onClick={() => open("payment")}
								/>
							) : null}
							{canSettle ? (
								<ActionItem
									icon={Check}
									label={copy.settle.label}
									detail={copy.settle.detail}
									onClick={() => open("settle")}
								/>
							) : null}
							{canRecord ? (
								<ActionItem
									icon={Pencil}
									label={copy.amount.label}
									onClick={() => open("amount")}
								/>
							) : null}
							{extraActions?.map((action) => (
								<ActionItem
									key={action.label}
									icon={action.icon}
									label={action.label}
									detail={action.detail}
									onClick={action.onClick}
								/>
							))}
							<ActionItem
								icon={History}
								label="Verlauf"
								detail={
									history
										? `${history.length} ${history.length === 1 ? "Eintrag" : "Einträge"}`
										: undefined
								}
								onClick={() => setStep("history")}
							/>
						</div>
						<div className="flex justify-end">
							<Button type="button" variant="ghost" onClick={onEdit}>
								Alle Angaben bearbeiten
							</Button>
						</div>
					</div>
				) : null}

				{step === "payment" || step === "amount" ? (
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (parsed === null || parsed < 0 || dateProblem) return;
							const next =
								step === "payment"
									? previewPayment(balanceMinor, parsed).remainingMinor
									: parsed;
							if (step === "payment" && parsed === 0) return;
							run(() =>
								next === 0 && canSettle
									? onSettle(date)
									: onRecord({ date, balanceMinor: next, kind: step }),
							);
						}}
					>
						<AmountInput
							id="balance-action-amount"
							label={
								step === "payment" ? copy.payment.field : copy.amount.field
							}
							value={amountText}
							onChange={setAmountText}
							currency={currency}
						/>
						{step === "payment" && copy.payment.hint ? (
							<p className="-mt-2 text-xs text-text-muted">
								{copy.payment.hint}
							</p>
						) : null}
						<Preview
							step={step}
							balanceMinor={balanceMinor}
							parsed={parsed}
							currency={currency}
							afterLabel={copy.afterLabel}
						/>
						<DateField
							value={date}
							onChange={setDate}
							min={balanceAsOf ?? undefined}
							max={today}
							error={dateProblem}
						/>
						<Button
							type="submit"
							size="lg"
							className="w-full"
							disabled={
								pending ||
								parsed === null ||
								parsed < 0 ||
								(step === "payment" && parsed === 0) ||
								Boolean(dateProblem)
							}
						>
							Speichern
						</Button>
					</form>
				) : null}

				{step === "settle" ? (
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (dateProblem) return;
							run(() => onSettle(date));
						}}
					>
						<p className="text-sm text-text-secondary">
							{copy.balanceLabel} ist dann{" "}
							<Money amountMinor={0} currency={currency} />, bisher{" "}
							<Money amountMinor={shown(balanceMinor)} currency={currency} />.
						</p>
						<DateField
							value={date}
							onChange={setDate}
							min={balanceAsOf ?? undefined}
							max={today}
							error={dateProblem}
						/>
						<Button
							type="submit"
							size="lg"
							className="w-full"
							disabled={pending || Boolean(dateProblem)}
						>
							<Check /> {copy.settle.submit}
						</Button>
					</form>
				) : null}

				{step === "history" ? (
					<HistoryView
						history={history}
						currency={currency}
						tone={tone}
						label={copy.balanceLabel}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function Preview({
	step,
	balanceMinor,
	parsed,
	currency,
	afterLabel,
}: {
	step: "payment" | "amount";
	balanceMinor: number;
	parsed: number | null;
	currency: string;
	afterLabel: string;
}) {
	const f = useFormat();
	if (step === "amount") {
		const diff = parsed === null ? 0 : parsed - balanceMinor;
		return (
			<p className="text-sm text-text-secondary" aria-live="polite">
				Bisher {f.money(balanceMinor, currency)}
				{parsed !== null && diff !== 0 ? (
					<>
						{" · "}
						<Money amountMinor={diff} currency={currency} signed tone="auto" />
					</>
				) : null}
			</p>
		);
	}
	const preview = previewPayment(balanceMinor, parsed ?? 0);
	return (
		<div
			className="flex items-baseline justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
			aria-live="polite"
		>
			<span className="text-text-secondary">
				{preview.settles ? "Damit erledigt" : afterLabel}
			</span>
			<span className="text-right">
				<Money amountMinor={preview.remainingMinor} currency={currency} />
				{preview.overpaidMinor > 0 ? (
					<span className="block text-xs text-warning">
						{f.money(preview.overpaidMinor, currency)} mehr als offen
					</span>
				) : null}
			</span>
		</div>
	);
}

function DateField({
	value,
	onChange,
	min,
	max,
	error,
}: {
	value: string;
	onChange: (value: string) => void;
	min?: string;
	max: string;
	error: string | null;
}) {
	return (
		<Field label="Datum" htmlFor="balance-action-date" error={error}>
			<Input
				id="balance-action-date"
				type="date"
				value={value}
				min={min}
				max={max}
				onChange={(event) => onChange(event.target.value)}
				required
			/>
		</Field>
	);
}

function HistoryView({
	history,
	currency,
	tone,
	label,
}: {
	history: { date: string; balanceMinor: number }[] | undefined;
	currency: string;
	tone: "default" | "negative";
	label: string;
}) {
	const f = useFormat();
	if (!history) return <p className="text-sm text-text-muted">Lädt …</p>;
	if (history.length === 0)
		return <p className="text-sm text-text-muted">Kein Verlauf vorhanden.</p>;
	const rows = [...history].reverse();
	return (
		<div className="space-y-3">
			{history.length > 1 ? (
				<LineChart
					ariaLabel={`Verlauf ${label}`}
					series={[
						{
							key: "balance",
							label,
							points: history.map((point) => ({
								x: point.date,
								y: point.balanceMinor,
							})),
							area: true,
							color:
								tone === "negative"
									? "var(--fortuna-negative)"
									: "var(--fortuna-chart-3)",
						},
					]}
					currency={currency}
					height={160}
				/>
			) : null}
			<ul className="divide-y divide-border rounded-md border border-border">
				{rows.map((point, index) => {
					const previous = rows[index + 1];
					return (
						<li
							key={point.date}
							className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm"
						>
							<span className="text-text-secondary">{f.date(point.date)}</span>
							<span className="text-right">
								<Money amountMinor={point.balanceMinor} currency={currency} />
								{previous ? (
									<Money
										amountMinor={point.balanceMinor - previous.balanceMinor}
										currency={currency}
										signed
										tone="muted"
										weight="normal"
										className="block text-xs"
									/>
								) : null}
							</span>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
