import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { MoreHorizontal, Plus } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { toast } from "sonner";
import { ChangePasswordForm } from "@/components/change-password-form";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { todayIso } from "@/domain/dates";
import { useFormat } from "@/lib/format";
import {
	amount,
	CURRENCIES,
	num,
	optStr,
	reportError,
	str,
	toAmountInput,
	useInvalidateAll,
} from "@/lib/forms";
import { CATEGORY_KIND_LABELS } from "@/lib/labels";
import { orpc } from "@/lib/orpc";
import { CATEGORY_KINDS } from "@/lib/schemas";

export const Route = createFileRoute("/_app/settings")({
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(orpc.settings.get.queryOptions()),
			context.queryClient.ensureQueryData(orpc.mcpTokens.list.queryOptions()),
			context.queryClient.ensureQueryData(orpc.categories.list.queryOptions()),
			context.queryClient.ensureQueryData(orpc.rules.list.queryOptions()),
			context.queryClient.ensureQueryData(orpc.settings.fxRates.queryOptions()),
			context.queryClient.ensureQueryData(
				orpc.accounts.list.queryOptions({ input: {} }),
			),
		]);
	},
	head: () => ({ meta: [{ title: "Einstellungen · Fortuna" }] }),
	component: SettingsPage,
});

type Category = Awaited<ReturnType<typeof orpc.categories.list.call>>[number];
type Rule = Awaited<ReturnType<typeof orpc.rules.list.call>>[number];

function SettingsPage() {
	const { data: settings } = useSuspenseQuery(orpc.settings.get.queryOptions());
	const { data: categories } = useSuspenseQuery(
		orpc.categories.list.queryOptions(),
	);
	const { data: rules } = useSuspenseQuery(orpc.rules.list.queryOptions());
	const { data: fx } = useSuspenseQuery(orpc.settings.fxRates.queryOptions());
	const { data: accounts } = useSuspenseQuery(
		orpc.accounts.list.queryOptions({ input: {} }),
	);
	const f = useFormat();
	const invalidate = useInvalidateAll();
	const update = useMutation(
		orpc.settings.update.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Einstellungen gespeichert");
			},
			onError: reportError,
		}),
	);
	const upsertFx = useMutation(
		orpc.settings.upsertFxRate.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Wechselkurs gespeichert");
			},
			onError: reportError,
		}),
	);
	const deleteCategory = useMutation(
		orpc.categories.delete.mutationOptions({
			onSuccess: () => invalidate(),
			onError: reportError,
		}),
	);
	const deleteRule = useMutation(
		orpc.rules.delete.mutationOptions({
			onSuccess: () => invalidate(),
			onError: reportError,
		}),
	);
	const toggleRule = useMutation(
		orpc.rules.update.mutationOptions({
			onSuccess: () => invalidate(),
			onError: reportError,
		}),
	);
	const [catDialog, setCatDialog] = useState<Category | null | "new">(null);
	const { data: mcpTokens } = useSuspenseQuery(
		orpc.mcpTokens.list.queryOptions(),
	);
	// Held only until the owner has copied it: the plain token exists nowhere
	// else, and asking again would mean storing it somewhere it could leak.
	const [createdToken, setCreatedToken] = useState<string | null>(null);
	const createToken = useMutation(
		orpc.mcpTokens.create.mutationOptions({
			onSuccess: async (result) => {
				await invalidate();
				setCreatedToken(result.snippet);
			},
			onError: reportError,
		}),
	);
	const revokeToken = useMutation(
		orpc.mcpTokens.revoke.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Zugang zurückgezogen");
			},
			onError: reportError,
		}),
	);
	const [ruleDialog, setRuleDialog] = useState<Rule | null | "new">(null);
	const parents = categories.filter((c) => !c.parentId);
	const catName = (id: string) =>
		categories.find((c) => c.id === id)?.name ?? "?";

	return (
		<div className="space-y-5">
			<PageHeader title="Einstellungen" />
			<SettingsTabs />
			<div className="grid gap-5 xl:grid-cols-2">
				<Card>
					<CardHeader title="Voreinstellungen" />
					<CardBody>
						<form
							onSubmit={(e) => {
								e.preventDefault();
								const form = new FormData(e.currentTarget);
								update.mutate({
									baseCurrency: str(form, "baseCurrency"),
									locale: str(form, "locale") as "en-GB",
									analysisMonths: num(form, "analysisMonths") ?? 12,
								});
							}}
							className="grid gap-3 sm:grid-cols-3"
						>
							<Field
								label="Basiswährung"
								htmlFor="st-cur"
								hint="Summen und Diagramme werden in dieser Währung angezeigt."
							>
								<NativeSelect
									id="st-cur"
									name="baseCurrency"
									defaultValue={settings.baseCurrency}
								>
									{CURRENCIES.map((c) => (
										<option key={c}>{c}</option>
									))}
								</NativeSelect>
							</Field>
							<Field label="Zahlen- und Datumsformat" htmlFor="st-loc">
								<NativeSelect
									id="st-loc"
									name="locale"
									defaultValue={settings.locale}
								>
									{[
										"en-GB",
										"en-US",
										"de-DE",
										"de-CH",
										"de-AT",
										"fr-FR",
										"nl-NL",
									].map((l) => (
										<option key={l}>{l}</option>
									))}
								</NativeSelect>
							</Field>
							<Field label="Analysezeitraum (Monate)" htmlFor="st-months">
								<Input
									id="st-months"
									name="analysisMonths"
									type="number"
									min={3}
									max={60}
									defaultValue={settings.analysisMonths}
								/>
							</Field>
							<div className="sm:col-span-3">
								<Button type="submit" disabled={update.isPending}>
									Speichern
								</Button>
							</div>
						</form>
					</CardBody>
				</Card>
				<Card>
					<CardHeader
						title="Wechselkurse"
						subtitle={`1 ${settings.baseCurrency} = Kurs in der Zielwährung; verwendet wird der neueste Kurs am oder vor dem jeweiligen Datum.`}
					/>
					<CardBody className="space-y-3">
						<form
							onSubmit={(e) => {
								e.preventDefault();
								const form = new FormData(e.currentTarget);
								const rate = num(form, "rate");
								if (rate === null) return toast.error("Wechselkurs eingeben");
								upsertFx.mutate({
									date: str(form, "date"),
									base: str(form, "base"),
									quote: str(form, "quote"),
									rate,
								});
								e.currentTarget.reset();
							}}
							className="grid gap-2 sm:grid-cols-2"
						>
							<Field label="Datum" htmlFor="fx-date">
								<Input
									id="fx-date"
									name="date"
									type="date"
									defaultValue={todayIso()}
									required
								/>
							</Field>
							<Field label="Basis" htmlFor="fx-base">
								<NativeSelect
									id="fx-base"
									name="base"
									defaultValue={settings.baseCurrency}
								>
									{CURRENCIES.map((c) => (
										<option key={c}>{c}</option>
									))}
								</NativeSelect>
							</Field>
							<Field label="Zielwährung" htmlFor="fx-quote">
								<NativeSelect id="fx-quote" name="quote" defaultValue="USD">
									{CURRENCIES.map((c) => (
										<option key={c}>{c}</option>
									))}
								</NativeSelect>
							</Field>
							<Field label="Kurs" htmlFor="fx-rate">
								<Input
									id="fx-rate"
									name="rate"
									type="number"
									step="any"
									min={0}
									required
								/>
							</Field>
							<div className="flex items-end">
								<Button
									type="submit"
									variant="outline"
									disabled={upsertFx.isPending}
								>
									Hinzufügen
								</Button>
							</div>
						</form>
						{fx.length ? (
							<ul className="max-h-40 divide-y divide-border overflow-y-auto text-xs">
								{fx.slice(0, 50).map((r) => (
									<li
										key={`${r.base}${r.quote}${r.date}`}
										className="flex justify-between py-1"
									>
										<span className="font-mono text-text-muted">
											{f.date(r.date)}
										</span>
										<span>
											{r.base}/{r.quote}
										</span>
										<span className="amount">{f.number(r.rate, 6)}</span>
									</li>
								))}
							</ul>
						) : (
							<p className="text-xs text-text-muted">
								Keine Wechselkurse gespeichert. Nur für Positionen außerhalb von{" "}
								{settings.baseCurrency}.
							</p>
						)}
					</CardBody>
				</Card>
			</div>

			<Card>
				<CardHeader
					title="Kategorisierungsregeln"
					subtitle="Auswertung nach Priorität, niedrigste zuerst. Die erste passende Regel gewinnt. Manuell gesetzte Kategorien werden nie überschrieben."
					action={
						<Button size="sm" onClick={() => setRuleDialog("new")}>
							<Plus /> Regel
						</Button>
					}
				/>
				{rules.length === 0 ? (
					<EmptyState
						title="Noch keine Regeln"
						description='Beispiel: Beschreibung enthält "HETZNER" → Technologie. Regeln lassen sich auch direkt aus einer Transaktion anlegen.'
					/>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Priorität</TableHead>
								<TableHead>Regel</TableHead>
								<TableHead className="hidden md:table-cell">
									Bedingungen
								</TableHead>
								<TableHead>Kategorie</TableHead>
								<TableHead className="text-right">Treffer</TableHead>
								<TableHead />
							</TableRow>
						</TableHeader>
						<TableBody>
							{rules.map((r) => (
								<TableRow
									key={r.id}
									className={!r.isActive ? "opacity-50" : undefined}
									onActivate={() => setRuleDialog(r)}
								>
									<TableCell className="font-mono text-xs">
										{r.priority}
									</TableCell>
									<TableCell className="text-text">{r.name}</TableCell>
									<TableCell className="hidden text-xs text-text-secondary md:table-cell">
										{[
											r.descriptionContains &&
												`Beschreibung ∋ "${r.descriptionContains}"`,
											r.merchantContains && `Händler ∋ "${r.merchantContains}"`,
											r.counterpartyIban && `IBAN = ${r.counterpartyIban}`,
											r.amountMinMinor !== null &&
												`≥ ${f.money(r.amountMinMinor)}`,
											r.amountMaxMinor !== null &&
												`≤ ${f.money(r.amountMaxMinor)}`,
											r.direction &&
												(r.direction === "outflow" ? "Ausgabe" : "Einnahme"),
											r.accountId &&
												`Konto ${accounts.find((a) => a.id === r.accountId)?.name ?? "?"}`,
										]
											.filter(Boolean)
											.join(" · ")}
									</TableCell>
									<TableCell>
										{catName(r.categoryId)}
										{r.setMerchantName ? (
											<Badge className="ml-1">→ {r.setMerchantName}</Badge>
										) : null}
									</TableCell>
									<TableCell className="text-right text-text-secondary">
										{r.matchCount}
									</TableCell>
									<RowActions label={`Aktionen für ${r.name}`}>
										<MenuItem
											onSelect={() =>
												toggleRule.mutate({ id: r.id, isActive: !r.isActive })
											}
										>
											{r.isActive ? "Deaktivieren" : "Aktivieren"}
										</MenuItem>
										<MenuItem onSelect={() => setRuleDialog(r)}>
											Bearbeiten
										</MenuItem>
										<MenuItem
											className="text-negative"
											onSelect={() => {
												if (confirm("Diese Regel löschen?"))
													deleteRule.mutate({ id: r.id });
											}}
										>
											Löschen
										</MenuItem>
									</RowActions>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</Card>

			<Card>
				<CardHeader
					title="Kategorien"
					subtitle="Zwei Ebenen: eine Kategorie und optionale Unterkategorien. Beim Löschen rücken Unterkategorien eine Ebene hoch; Transaktionen bleiben unkategorisiert."
					action={
						<Button size="sm" onClick={() => setCatDialog("new")}>
							<Plus /> Kategorie
						</Button>
					}
				/>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Art</TableHead>
							<TableHead className="text-right">Transaktionen</TableHead>
							<TableHead />
						</TableRow>
					</TableHeader>
					<TableBody>
						{parents.map((p) =>
							[p, ...categories.filter((c) => c.parentId === p.id)].map((c) => (
								<TableRow key={c.id} onActivate={() => setCatDialog(c)}>
									<TableCell
										className={
											c.parentId
												? "pl-8 text-text-secondary"
												: "font-medium text-text"
										}
									>
										{c.name}
										{c.isSystem ? (
											<Badge className="ml-1.5">Standard</Badge>
										) : null}
									</TableCell>
									<TableCell className="text-text-secondary">
										{CATEGORY_KIND_LABELS[c.kind]}
									</TableCell>
									<TableCell className="text-right text-text-secondary">
										{c.transactionCount}
									</TableCell>
									<RowActions label={`Aktionen für ${c.name}`}>
										<MenuItem onSelect={() => setCatDialog(c)}>
											Bearbeiten
										</MenuItem>
										<MenuItem
											className="text-negative"
											onSelect={() => {
												// Rules for this category are deleted with it; the
												// old wording did not say so.
												if (
													confirm(
														`„${c.name}“ löschen? Regeln dieser Kategorie werden mitgelöscht. Buchungen bleiben erhalten und verlieren die Kategorie.`,
													)
												)
													deleteCategory.mutate({ id: c.id });
											}}
										>
											Löschen
										</MenuItem>
									</RowActions>
								</TableRow>
							)),
						)}
					</TableBody>
				</Table>
			</Card>

			<Card>
				<CardHeader
					title="Passwort"
					subtitle="Eine Änderung meldet alle anderen Sitzungen ab."
				/>
				<CardBody>
					<ChangePasswordForm />
				</CardBody>
			</Card>

			<Card>
				<CardHeader
					title="KI-Zugriff"
					subtitle="Claude Code oder Codex direkt mit Fortuna verbinden"
				/>
				<CardBody className="space-y-4 text-sm">
					<p className="text-text-secondary">
						Leg unten einen Zugang an, kopier den Text und füg ihn in Claude
						Code oder Codex ein — der Assistent richtet sich damit selbst ein.
					</p>

					{createdToken ? (
						<div className="space-y-2 rounded-md border border-brand-subtle bg-brand-subtle/30 p-3">
							<p className="text-sm font-medium text-text">
								Einmal sichtbar — jetzt kopieren.
							</p>
							<p className="text-xs text-text-secondary">
								Der Zugang lässt sich später nicht wieder anzeigen. Geht er
								verloren, ziehst du ihn zurück und legst einen neuen an.
							</p>
							<Textarea
								readOnly
								rows={12}
								value={createdToken}
								className="font-mono text-[11px]"
								onFocus={(event: React.FocusEvent<HTMLTextAreaElement>) =>
									event.currentTarget.select()
								}
							/>
							<div className="flex gap-2">
								<Button
									size="sm"
									onClick={() => {
										navigator.clipboard
											.writeText(createdToken)
											.then(() => toast.success("Kopiert"))
											.catch(() => toast.error("Kopieren nicht möglich"));
									}}
								>
									Kopieren
								</Button>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => setCreatedToken(null)}
								>
									Fertig
								</Button>
							</div>
						</div>
					) : (
						<form
							className="flex flex-wrap items-end gap-2"
							onSubmit={(event) => {
								event.preventDefault();
								const form = new FormData(event.currentTarget);
								createToken.mutate({
									name: str(form, "name"),
									scope:
										form.get("scope") === "read_write" ? "read_write" : "read",
								});
								event.currentTarget.reset();
							}}
						>
							<Field
								label="Wofür"
								htmlFor="mcp-name"
								className="min-w-[200px] flex-1"
							>
								<Input
									id="mcp-name"
									name="name"
									required
									maxLength={80}
									placeholder="z. B. Claude Code auf dem MacBook"
								/>
							</Field>
							<Field label="Zugriff" htmlFor="mcp-scope">
								<NativeSelect id="mcp-scope" name="scope">
									<option value="read">Nur lesen</option>
									<option value="read_write">Lesen und ändern</option>
								</NativeSelect>
							</Field>
							<Button type="submit" disabled={createToken.isPending}>
								Zugang anlegen
							</Button>
						</form>
					)}

					{mcpTokens.length ? (
						<ul className="divide-y divide-border rounded-md border border-border">
							{mcpTokens.map((token) => (
								<li
									key={token.id}
									className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
								>
									<div>
										<p className="text-sm text-text">{token.name}</p>
										<p className="text-xs text-text-muted">
											{token.scope === "read_write"
												? "lesen und ändern"
												: "nur lesen"}{" "}
											· angelegt {f.dateTime(token.createdAt)} ·{" "}
											{token.lastUsedAt
												? `zuletzt benutzt ${f.dateTime(token.lastUsedAt)}`
												: "noch nicht benutzt"}
										</p>
									</div>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => {
											if (
												confirm(
													`„${token.name}" zurückziehen? Der Assistent verliert sofort den Zugriff.`,
												)
											)
												revokeToken.mutate({ id: token.id });
										}}
									>
										Zurückziehen
									</Button>
								</li>
							))}
						</ul>
					) : null}

					<p className="text-xs text-text-muted">
						Gelesen werden kann alles außer Zugangsdaten und Dokumentinhalten.
						Ein Zugang mit Änderungsrecht darf anlegen und bearbeiten —{" "}
						<strong>löschen kann er nichts</strong>, und an Bankverbindungen,
						gespeicherte Schlüssel oder Hr. Körner selbst kommt er nicht heran.
					</p>
				</CardBody>
			</Card>

			{catDialog ? (
				<CategoryDialog
					row={catDialog === "new" ? null : catDialog}
					parents={parents}
					onClose={() => setCatDialog(null)}
				/>
			) : null}
			{ruleDialog ? (
				<RuleDialog
					row={ruleDialog === "new" ? null : ruleDialog}
					categories={categories}
					accounts={accounts}
					onClose={() => setRuleDialog(null)}
				/>
			) : null}
		</div>
	);
}

function CategoryDialog({
	row,
	parents,
	onClose,
}: {
	row: Category | null;
	parents: Category[];
	onClose: () => void;
}) {
	const invalidate = useInvalidateAll();
	const done = async (m: string) => {
		await invalidate();
		toast.success(m);
		onClose();
	};
	const create = useMutation(
		orpc.categories.create.mutationOptions({
			onSuccess: () => done("Kategorie hinzugefügt"),
			onError: reportError,
		}),
	);
	const update = useMutation(
		orpc.categories.update.mutationOptions({
			onSuccess: () => done("Gespeichert"),
			onError: reportError,
		}),
	);
	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent
				title={row ? `${row.name} bearbeiten` : "Kategorie hinzufügen"}
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						const form = new FormData(e.currentTarget);
						const payload = {
							name: str(form, "name"),
							kind: str(form, "kind") as (typeof CATEGORY_KINDS)[number],
							parentId: optStr(form, "parentId"),
							icon: optStr(form, "icon"),
						};
						if (row) update.mutate({ id: row.id, ...payload });
						else create.mutate(payload);
					}}
					className="grid gap-3 sm:grid-cols-2"
				>
					<Field label="Name" htmlFor="c-name" className="sm:col-span-2">
						<Input
							id="c-name"
							name="name"
							defaultValue={row?.name ?? ""}
							required
							autoFocus
						/>
					</Field>
					<Field
						label="Art"
						htmlFor="c-kind"
						hint="Umbuchungen zählen nie als Einnahme oder Ausgabe."
					>
						<NativeSelect
							id="c-kind"
							name="kind"
							defaultValue={row?.kind ?? "expense"}
						>
							{CATEGORY_KINDS.map((k) => (
								<option key={k} value={k}>
									{CATEGORY_KIND_LABELS[k]}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="Übergeordnete Kategorie" htmlFor="c-parent">
						<NativeSelect
							id="c-parent"
							name="parentId"
							defaultValue={row?.parentId ?? ""}
						>
							<option value="">Keine (oberste Ebene)</option>
							{parents
								.filter((p) => p.id !== row?.id)
								.map((p) => (
									<option key={p.id} value={p.id}>
										{p.name}
									</option>
								))}
						</NativeSelect>
					</Field>
					<Field
						label="Icon"
						htmlFor="c-icon"
						hint="Optionaler Name eines Lucide-Symbols."
					>
						<Input
							id="c-icon"
							name="icon"
							defaultValue={row?.icon ?? ""}
							className="font-mono"
						/>
					</Field>
					<DialogFooter className="sm:col-span-2">
						<Button type="button" variant="ghost" onClick={onClose}>
							Abbrechen
						</Button>
						<Button type="submit">Speichern</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function RuleDialog({
	row,
	categories,
	accounts,
	onClose,
}: {
	row: Rule | null;
	categories: Category[];
	accounts: { id: string; name: string }[];
	onClose: () => void;
}) {
	const invalidate = useInvalidateAll();
	const done = async (m: string) => {
		await invalidate();
		toast.success(m);
		onClose();
	};
	const create = useMutation(
		orpc.rules.create.mutationOptions({
			onSuccess: () =>
				done(
					"Regel hinzugefügt. Sie gilt für neue Buchungen und belegt offene in der Durchsicht vor.",
				),
			onError: reportError,
		}),
	);
	const update = useMutation(
		orpc.rules.update.mutationOptions({
			onSuccess: () => done("Gespeichert"),
			onError: reportError,
		}),
	);
	const options = categories
		.filter((c) => !c.parentId)
		.flatMap((p) => [p, ...categories.filter((c) => c.parentId === p.id)]);
	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent
				title={row ? "Regel bearbeiten" : "Regel hinzufügen"}
				description="Alle ausgefüllten Bedingungen müssen zutreffen. Textabgleiche suchen ohne Beachtung der Groß- und Kleinschreibung nach Teilzeichenfolgen."
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						const form = new FormData(e.currentTarget);
						const payload = {
							name: str(form, "name"),
							priority: num(form, "priority") ?? 100,
							isActive: true,
							descriptionContains: optStr(form, "descriptionContains"),
							merchantContains: optStr(form, "merchantContains"),
							counterpartyIban: optStr(form, "counterpartyIban"),
							amountMinMinor: amount(form, "amountMin"),
							amountMaxMinor: amount(form, "amountMax"),
							accountId: optStr(form, "accountId"),
							direction: (optStr(form, "direction") ?? null) as
								| "inflow"
								| "outflow"
								| null,
							categoryId: str(form, "categoryId"),
							setMerchantName: optStr(form, "setMerchantName"),
						};
						if (row)
							update.mutate({ id: row.id, ...payload, isActive: row.isActive });
						else create.mutate(payload);
					}}
					className="grid gap-3 sm:grid-cols-2"
				>
					<Field label="Name" htmlFor="ru-name">
						<Input
							id="ru-name"
							name="name"
							defaultValue={row?.name ?? ""}
							required
							autoFocus
						/>
					</Field>
					<Field
						label="Priorität"
						htmlFor="ru-prio"
						hint="Niedrigere Werte werden zuerst ausgeführt."
					>
						<Input
							id="ru-prio"
							name="priority"
							type="number"
							min={1}
							max={10000}
							defaultValue={row?.priority ?? 100}
						/>
					</Field>
					<Field label="Beschreibung enthält" htmlFor="ru-desc">
						<Input
							id="ru-desc"
							name="descriptionContains"
							defaultValue={row?.descriptionContains ?? ""}
						/>
					</Field>
					<Field label="Händler / Gegenpartei enthält" htmlFor="ru-merch">
						<Input
							id="ru-merch"
							name="merchantContains"
							defaultValue={row?.merchantContains ?? ""}
						/>
					</Field>
					<Field label="IBAN der Gegenpartei" htmlFor="ru-iban">
						<Input
							id="ru-iban"
							name="counterpartyIban"
							defaultValue={row?.counterpartyIban ?? ""}
							className="font-mono"
						/>
					</Field>
					<Field label="Richtung" htmlFor="ru-dir">
						<NativeSelect
							id="ru-dir"
							name="direction"
							defaultValue={row?.direction ?? ""}
						>
							<option value="">Beliebig</option>
							<option value="outflow">Ausgabe</option>
							<option value="inflow">Einnahme</option>
						</NativeSelect>
					</Field>
					<Field label="Mindestbetrag" htmlFor="ru-min">
						<Input
							id="ru-min"
							name="amountMin"
							inputMode="decimal"
							defaultValue={toAmountInput(row?.amountMinMinor)}
							className="amount"
						/>
					</Field>
					<Field label="Höchstbetrag" htmlFor="ru-max">
						<Input
							id="ru-max"
							name="amountMax"
							inputMode="decimal"
							defaultValue={toAmountInput(row?.amountMaxMinor)}
							className="amount"
						/>
					</Field>
					<Field label="Konto" htmlFor="ru-acc">
						<NativeSelect
							id="ru-acc"
							name="accountId"
							defaultValue={row?.accountId ?? ""}
						>
							<option value="">Beliebig</option>
							{accounts.map((a) => (
								<option key={a.id} value={a.id}>
									{a.name}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="Kategorie zuweisen" htmlFor="ru-cat">
						<NativeSelect
							id="ru-cat"
							name="categoryId"
							defaultValue={row?.categoryId ?? options[0]?.id}
							required
						>
							{options.map((c) => (
								<option key={c.id} value={c.id}>
									{c.parentId ? `  ${c.name}` : c.name}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field
						label="Händlernamen setzen"
						htmlFor="ru-set"
						hint="Optionaler vereinheitlichter Name, z. B. „Hetzner“."
						className="sm:col-span-2"
					>
						<Input
							id="ru-set"
							name="setMerchantName"
							defaultValue={row?.setMerchantName ?? ""}
						/>
					</Field>
					<DialogFooter className="sm:col-span-2">
						<Button type="button" variant="ghost" onClick={onClose}>
							Abbrechen
						</Button>
						<Button type="submit">Speichern</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/**
 * A row's actions behind one "⋯": three ghost buttons per row wrapped into
 * a column on a phone and made every row a screen tall. The row itself
 * opens the edit dialog. Clicks inside stop here, including those in the
 * menu's portal, which React still bubbles to the row.
 */
function RowActions({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<TableCell
			className="w-0 text-right"
			onClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => event.stopPropagation()}
		>
			<Menu>
				<MenuTrigger asChild>
					<Button variant="ghost" size="icon-sm" aria-label={label}>
						<MoreHorizontal />
					</Button>
				</MenuTrigger>
				<MenuContent>{children}</MenuContent>
			</Menu>
		</TableCell>
	);
}
