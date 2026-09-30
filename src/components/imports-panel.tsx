import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useFormat } from "@/lib/format";
import { reportError, useInvalidateAll } from "@/lib/forms";
import { orpc } from "@/lib/orpc";

/** What the import section needs before it renders. */
export function importsQueries() {
	return [
		orpc.imports.list.queryOptions(),
		orpc.accounts.list.queryOptions({ input: {} }),
	] as const;
}

type Preview = Awaited<ReturnType<typeof orpc.imports.preview.call>>;
type Mapping = {
	bookingDate: number;
	valueDate?: number;
	amount?: number;
	debit?: number;
	credit?: number;
	description: number;
	counterpartyName?: number;
	counterpartyIban?: number;
	currency?: number;
	externalId?: number;
	dateFormat: "iso" | "dmy" | "mdy";
};
const FIELDS: {
	key: keyof Omit<Mapping, "dateFormat">;
	label: string;
	required?: boolean;
}[] = [
	{ key: "bookingDate", label: "Buchungsdatum", required: true },
	{ key: "valueDate", label: "Wertstellung" },
	{ key: "amount", label: "Betrag mit Vorzeichen" },
	{ key: "debit", label: "Soll-Spalte (Alternative)" },
	{ key: "credit", label: "Haben-Spalte (Alternative)" },
	{
		key: "description",
		label: "Beschreibung / Verwendungszweck",
		required: true,
	},
	{ key: "counterpartyName", label: "Name der Gegenpartei" },
	{ key: "counterpartyIban", label: "IBAN der Gegenpartei" },
	{ key: "currency", label: "Währung" },
	{ key: "externalId", label: "Transaktions-ID" },
];

/** CSV import and export: a section of Einstellungen › Datenquellen. */
export function ImportsPanel() {
	const { data: jobs } = useSuspenseQuery(orpc.imports.list.queryOptions());
	const { data: accounts } = useSuspenseQuery(
		orpc.accounts.list.queryOptions({ input: {} }),
	);
	const f = useFormat();
	const invalidate = useInvalidateAll();
	const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
	const [file, setFile] = useState<{ name: string; content: string } | null>(
		null,
	);
	const [preview, setPreview] = useState<Preview | null>(null);
	const [mapping, setMapping] = useState<Partial<Mapping>>({});
	const previewMut = useMutation(
		orpc.imports.preview.mutationOptions({
			onSuccess: (p) => {
				setPreview(p);
				setMapping({ dateFormat: "iso", ...p.suggestedMapping });
			},
			onError: reportError,
		}),
	);
	const commit = useMutation(
		orpc.imports.commit.mutationOptions({
			onSuccess: async (job) => {
				await invalidate();
				toast.success(
					`${job.importedRows} importiert, ${job.duplicateRows} Duplikate übersprungen${job.errorRows ? `, ${job.errorRows} fehlerhafte Zeilen` : ""}`,
				);
				setPreview(null);
				setFile(null);
			},
			onError: reportError,
		}),
	);

	async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
		const chosen = e.target.files?.[0];
		if (!chosen) return;
		if (chosen.size > 5_000_000)
			return toast.error("Die Datei ist größer als 5 MB");
		const content = await chosen.text();
		setFile({ name: chosen.name, content });
		setPreview(null);
	}
	const ready =
		mapping.bookingDate !== undefined &&
		mapping.description !== undefined &&
		(mapping.amount !== undefined ||
			(mapping.debit !== undefined && mapping.credit !== undefined));

	return (
		<div className="space-y-5">
			<PageHeader
				level={2}
				title="Import & Export"
				subtitle="CSV-Importe sind wiederholbar: Bereits vorhandene Zeilen werden beim erneuten Import übersprungen"
			/>
			<div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
				<Card>
					<CardHeader
						title="Transaktionen aus CSV importieren"
						subtitle="Funktioniert mit Exporten der meisten Banken, getrennt durch Semikolon oder Komma und mit deutschen oder englischen Zahlenformaten."
					/>
					<CardBody className="space-y-4">
						<div className="grid gap-3 sm:grid-cols-2">
							<Field label="Zielkonto" htmlFor="imp-account">
								<NativeSelect
									id="imp-account"
									value={accountId}
									onChange={(e) => setAccountId(e.target.value)}
								>
									{accounts.map((a) => (
										<option key={a.id} value={a.id}>
											{a.name} ({a.currency})
										</option>
									))}
								</NativeSelect>
							</Field>
							<Field label="CSV-Datei" htmlFor="imp-file">
								<Input
									id="imp-file"
									type="file"
									accept=".csv,text/csv,text/plain"
									onChange={onFile}
									className="pt-1"
								/>
							</Field>
						</div>
						{accounts.length === 0 ? (
							<p className="text-xs text-warning">Lege zuerst ein Konto an.</p>
						) : null}
						{file && !preview ? (
							<Button
								onClick={() =>
									previewMut.mutate({
										accountId,
										fileName: file.name,
										content: file.content,
									})
								}
								disabled={!accountId || previewMut.isPending}
							>
								{file.name} analysieren
							</Button>
						) : null}
						{preview && file ? (
							<div className="space-y-4">
								<p className="text-xs text-text-secondary">
									{preview.totalRows} Datenzeilen, Trennzeichen{" "}
									<code className="font-mono">
										{preview.delimiter === "\t"
											? "Tabulator"
											: preview.delimiter}
									</code>
									. Spalten zuordnen:
								</p>
								<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
									{FIELDS.map((fld) => (
										<Field
											key={fld.key}
											label={`${fld.label}${fld.required ? " *" : ""}`}
											htmlFor={`map-${fld.key}`}
										>
											<NativeSelect
												id={`map-${fld.key}`}
												value={mapping[fld.key] ?? ""}
												onChange={(e) =>
													setMapping((m) => ({
														...m,
														[fld.key]:
															e.target.value === ""
																? undefined
																: Number(e.target.value),
													}))
												}
											>
												<option value="">—</option>
												{preview.header.map((h, i) => (
													<option key={`${h}-${i}`} value={i}>
														{h || `Spalte ${i + 1}`}
													</option>
												))}
											</NativeSelect>
										</Field>
									))}
									<Field label="Datumsformat" htmlFor="map-date">
										<NativeSelect
											id="map-date"
											value={mapping.dateFormat ?? "iso"}
											onChange={(e) =>
												setMapping((m) => ({
													...m,
													dateFormat: e.target.value as Mapping["dateFormat"],
												}))
											}
										>
											<option value="iso">YYYY-MM-DD</option>
											<option value="dmy">DD.MM.YYYY</option>
											<option value="mdy">MM/DD/YYYY</option>
										</NativeSelect>
									</Field>
								</div>
								<div className="overflow-x-auto rounded-md border border-border">
									<table className="w-full text-[11px]">
										<thead>
											<tr className="bg-surface-sunken">
												{preview.header.map((h, i) => (
													<th
														key={`${h}-${i}`}
														className="break-words px-2 py-1 text-left font-medium"
													>
														{h}
													</th>
												))}
											</tr>
										</thead>
										<tbody>
											{preview.sampleRows.map((r, ri) => (
												<tr key={ri} className="border-t border-border">
													{r.map((c, ci) => (
														<td
															key={ci}
															className="max-w-[200px] break-all px-2 py-1 font-mono"
														>
															{c}
														</td>
													))}
												</tr>
											))}
										</tbody>
									</table>
								</div>
								<div className="flex gap-2">
									<Button
										onClick={() =>
											commit.mutate({
												accountId,
												fileName: file.name,
												content: file.content,
												mapping: mapping as Mapping,
												hasHeader: true,
											})
										}
										disabled={!ready || commit.isPending}
									>
										{preview.totalRows} Zeilen importieren
									</Button>
									<Button
										variant="ghost"
										onClick={() => {
											setPreview(null);
											setFile(null);
										}}
									>
										Abbrechen
									</Button>
								</div>
							</div>
						) : null}
					</CardBody>
				</Card>
				<Card>
					<CardHeader
						title="Export"
						subtitle="Vollständige CSV-Exporte deiner Daten."
					/>
					<CardBody className="grid gap-2">
						{[
							["transactions", "Transaktionen"],
							["assets", "Sachwerte mit Bewertungsverlauf"],
							["liabilities", "Verbindlichkeiten mit Schuldenverlauf"],
							["net-worth", "Nettovermögensverlauf (60 Monate)"],
						].map(([kind, label]) => (
							<Button
								key={kind}
								variant="outline"
								asChild
								className="justify-start"
							>
								<a href={`/api/export/${kind}`} download>
									<Download /> {label}
								</a>
							</Button>
						))}
					</CardBody>
				</Card>
			</div>
			<Card>
				<CardHeader title="Importverlauf" />
				{jobs.length === 0 ? (
					<EmptyState title="Noch keine Importe" />
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Zeitpunkt</TableHead>
								<TableHead>Quelle</TableHead>
								<TableHead>Konto</TableHead>
								<TableHead className="text-right">Zeilen</TableHead>
								<TableHead className="text-right">Importiert</TableHead>
								<TableHead className="text-right">Duplikate</TableHead>
								<TableHead className="text-right">Fehler</TableHead>
								<TableHead>Status</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{jobs.map((j) => (
								<TableRow key={j.id}>
									<TableCell className="font-mono text-xs text-text-muted">
										{f.dateTime(j.createdAt)}
									</TableCell>
									<TableCell>
										{j.kind === "csv" ? j.fileName : "Anbieterabgleich"}
									</TableCell>
									<TableCell className="text-text-secondary">
										{accounts.find((a) => a.id === j.accountId)?.name ?? "—"}
									</TableCell>
									<TableCell className="text-right">{j.totalRows}</TableCell>
									<TableCell className="text-right">{j.importedRows}</TableCell>
									<TableCell className="text-right text-text-secondary">
										{j.duplicateRows}
									</TableCell>
									<TableCell className="text-right text-text-secondary">
										{j.errorRows}
									</TableCell>
									<TableCell>
										<Badge
											variant={
												j.status === "completed"
													? "positive"
													: j.status === "partial"
														? "warning"
														: "negative"
											}
											title={j.log.join("\n")}
										>
											{{
												completed: "Abgeschlossen",
												partial: "Teilweise",
												failed: "Fehlgeschlagen",
											}[j.status] ?? j.status}
										</Badge>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</Card>
		</div>
	);
}
