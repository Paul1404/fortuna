import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import {
	Building2,
	KeyRound,
	Link2,
	Plus,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { TradingAccessSection } from "@/components/broker-order";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
import { reportError, str, useInvalidateAll } from "@/lib/forms";
import { orpc } from "@/lib/orpc";

const BANK_PROVIDER_LABELS: Record<string, string> = {
	"enable-banking": "Enable Banking",
};

const SOURCE_STATUS_LABELS: Record<string, string> = {
	active: "Aktiv",
	pending: "Wartet",
	expired: "Abgelaufen",
	error: "Fehler",
	disconnected: "Getrennt",
};

/** The result a bank or Remise redirect leaves in the URL, validated. */
export type ConnectionResult = {
	bank?: "connected" | "error";
	imported?: number;
	remise?: "connected" | "error";
};

export function connectionResultSearch(
	search: Record<string, unknown>,
): ConnectionResult {
	return {
		bank:
			search.bank === "connected" || search.bank === "error"
				? search.bank
				: undefined,
		imported:
			typeof search.imported === "string" || typeof search.imported === "number"
				? Number(search.imported)
				: undefined,
		remise:
			search.remise === "connected" || search.remise === "error"
				? search.remise
				: undefined,
	};
}

/** What the connections section needs before it renders. */
export function connectionsQueries() {
	return [
		orpc.connections.list.queryOptions(),
		orpc.providerCredentials.enableBankingStatus.queryOptions(),
		orpc.remise.status.queryOptions(),
		orpc.kataster.status.queryOptions(),
		orpc.investments.sourceStatus.queryOptions(),
		orpc.scalable.status.queryOptions(),
		orpc.accounts.list.queryOptions({ input: {} }),
	] as const;
}

/** Bank, depot and service connections: a section of Einstellungen › Datenquellen. */
export function ConnectionsPanel({
	search,
	onResultShown,
}: {
	search: ConnectionResult;
	/** Clears the redirect result from the URL once it has been reported. */
	onResultShown: () => void;
}) {
	const { data: connections } = useSuspenseQuery(
		orpc.connections.list.queryOptions(),
	);
	const { data: enableBankingCredential } = useSuspenseQuery(
		orpc.providerCredentials.enableBankingStatus.queryOptions(),
	);
	const { data: remiseStatus } = useSuspenseQuery(
		orpc.remise.status.queryOptions(),
	);
	const { data: katasterStatus } = useSuspenseQuery(
		orpc.kataster.status.queryOptions(),
	);
	const { data: scalableStatus } = useSuspenseQuery(
		orpc.investments.sourceStatus.queryOptions(),
	);
	const { data: hostedStatus } = useSuspenseQuery({
		...orpc.scalable.status.queryOptions(),
		refetchInterval: 5000,
	});
	const { data: accountRows } = useSuspenseQuery(
		orpc.accounts.list.queryOptions({ input: {} }),
	);
	const f = useFormat();
	const invalidate = useInvalidateAll();
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const interval = window.setInterval(() => setNow(new Date()), 30_000);
		return () => window.clearInterval(interval);
	}, []);
	const [enableBankingOpen, setEnableBankingOpen] = useState(false);
	const [uploadingKey, setUploadingKey] = useState(false);
	const [connectingKataster, setConnectingKataster] = useState(false);
	const [scalableDevicePrompt, setScalableDevicePrompt] = useState<{
		url: string;
		code: string;
		expiresAt: number;
	} | null>(null);
	const lastHostedSyncSeen = useRef<number | null>(null);
	const connectHosted = useMutation(
		orpc.scalable.connect.mutationOptions({
			onSuccess: async (prompt) => {
				setScalableDevicePrompt(prompt);
				await invalidate();
			},
			onError: reportError,
		}),
	);
	const syncHosted = useMutation(
		orpc.scalable.sync.mutationOptions({
			onSuccess: async (result) => {
				await invalidate();
				toast.info(
					result.started
						? "Scalable-Abgleich gestartet"
						: "Scalable-Abgleich läuft bereits",
				);
			},
			onError: reportError,
		}),
	);
	const disconnectHosted = useMutation(
		orpc.scalable.disconnect.mutationOptions({
			onSuccess: async () => {
				setScalableDevicePrompt(null);
				await invalidate();
				toast.success(
					"Scalable-Zugang entfernt. Letzte Depotwerte bleiben sichtbar, bis du erneut verbindest.",
				);
			},
			onError: reportError,
		}),
	);
	const linkScalableAccount = useMutation(
		orpc.investments.linkScalableAccount.mutationOptions({
			onSuccess: () => invalidate(),
			onError: reportError,
		}),
	);
	useEffect(() => {
		if (scalableDevicePrompt && hostedStatus.status === "active") {
			setScalableDevicePrompt(null);
			void invalidate();
			toast.success("Scalable verbunden. Depotabgleich läuft.");
		}
	}, [hostedStatus.status, scalableDevicePrompt, invalidate]);
	useEffect(() => {
		const syncedAt = hostedStatus.lastSyncAt?.getTime() ?? null;
		if (syncedAt && syncedAt !== lastHostedSyncSeen.current) {
			lastHostedSyncSeen.current = syncedAt;
			void invalidate();
		}
	}, [hostedStatus.lastSyncAt, invalidate]);
	const sync = useMutation(
		orpc.connections.sync.mutationOptions({
			onSuccess: async (r) => {
				await invalidate();
				toast.success(
					`${r.imported} Transaktionen importiert, ${r.duplicates} Duplikate, ${r.accountsLinked} neue Konten`,
				);
			},
			onError: reportError,
		}),
	);
	const disconnect = useMutation(
		orpc.connections.disconnect.mutationOptions({
			onSuccess: async (result) => {
				await invalidate();
				toast.success(
					result.removed
						? "Verbindung getrennt und entfernt"
						: "Verbindung getrennt; Daten bleiben erhalten",
				);
			},
			onError: reportError,
		}),
	);
	const removeConnection = useMutation(
		orpc.connections.remove.mutationOptions({
			onSuccess: async (result) => {
				await invalidate();
				toast.success(
					result.accountsDetached
						? `Verbindung entfernt; ${result.accountsDetached} ${
								result.accountsDetached === 1
									? "Konto bleibt"
									: "Konten bleiben"
							} ohne Anbieter erhalten`
						: "Verbindung entfernt",
				);
			},
			onError: reportError,
		}),
	);
	const deleteEnableBankingCredential = useMutation(
		orpc.providerCredentials.deleteEnableBanking.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Enable-Banking-Schlüssel gelöscht");
			},
			onError: reportError,
		}),
	);
	const testEnableBankingCredential = useMutation(
		orpc.providerCredentials.testEnableBanking.mutationOptions({
			onSuccess: (result) => {
				toast.success(
					`Enable Banking erreichbar: ${result.environment}, ${result.active ? "aktiv" : "inaktiv"}, ${result.germanInstitutionCount} deutsche Institute`,
				);
			},
			onError: reportError,
		}),
	);
	const {
		data: enableBankingInstitutions = [],
		isLoading: institutionsLoading,
	} = useQuery({
		...orpc.providerCredentials.enableBankingInstitutions.queryOptions(),
		enabled: enableBankingOpen,
	});
	const beginEnableBankingConnection = useMutation(
		orpc.providerCredentials.beginEnableBankingConnection.mutationOptions({
			onSuccess: ({ redirectUrl }) => window.location.assign(redirectUrl),
			onError: reportError,
		}),
	);
	const connectRemise = useMutation(
		orpc.remise.connect.mutationOptions({
			onSuccess: ({ redirectUrl }) => window.location.assign(redirectUrl),
			onError: reportError,
		}),
	);
	const syncRemise = useMutation(
		orpc.remise.sync.mutationOptions({
			onSuccess: async (result) => {
				await invalidate();
				toast.success(
					`Remise abgeglichen: ${result.created} neu, ${result.updated} aktualisiert, ${result.merged} Dubletten zusammengeführt, ${result.deactivated} abgeschlossen`,
				);
			},
			onError: reportError,
		}),
	);
	const disconnectRemise = useMutation(
		orpc.remise.disconnect.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success(
					"Remise getrennt; synchronisierte Sachwerte bleiben erhalten",
				);
			},
			onError: reportError,
		}),
	);
	// Only worth showing once PayPal is actually connected through a bank.
	const paypalViaBank = connections.some((row) =>
		/paypal/i.test(row.institutionName),
	);
	const linkFunding = useMutation(
		orpc.paypalFunding.link.mutationOptions({
			onSuccess: async (result) => {
				await invalidate();
				toast.success(
					result.linked > 0
						? `${result.linked} ${result.linked === 1 ? "Aufladung" : "Aufladungen"} zugeordnet — sie zählen nicht mehr doppelt`
						: "Keine weiteren Paare gefunden",
				);
			},
			onError: reportError,
		}),
	);
	const disconnectKataster = useMutation(
		orpc.kataster.disconnect.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Kataster getrennt");
			},
			onError: reportError,
		}),
	);
	useEffect(() => {
		if (search.bank === "connected") {
			toast.success(
				`Bank verbunden${search.imported ? `, ${search.imported} Transaktionen importiert` : ""}`,
			);
		}
		if (search.bank === "error") {
			toast.error("Bankverbindung konnte nicht abgeschlossen werden");
		}
		if (search.remise === "connected") {
			toast.success(
				`Remise verbunden${search.imported ? `, ${search.imported} Sachwerte abgeglichen` : ""}`,
			);
		}
		if (search.remise === "error") {
			toast.error("Remise-Verbindung konnte nicht abgeschlossen werden");
		}
		// The result describes one redirect. Left in the URL it replays on every
		// reload, so an old failure keeps reporting itself as a new one.
		if (search.bank || search.remise) onResultShown();
	}, [search.bank, search.imported, search.remise, onResultShown]);

	return (
		<div className="space-y-5">
			<PageHeader
				level={2}
				title="Verbindungen"
				subtitle="Bankkonten werden automatisch abgeglichen, solange du angemeldet bist."
				actions={
					enableBankingCredential.configured ? (
						<Button onClick={() => setEnableBankingOpen(true)}>
							<Plus /> Bank verbinden
						</Button>
					) : null
				}
			/>
			<h2 className="font-display text-lg text-text">Bankverbindungen</h2>
			<Card>
				{connections.length === 0 ? (
					<EmptyState
						title="Keine Verbindungen"
						description={
							enableBankingCredential.configured
								? "Verbinde eine Bank, um Konten und Transaktionen automatisch abzugleichen."
								: "Hinterlege unten den Enable-Banking-Schlüssel, um Banken zu verbinden. Der CSV-Import bleibt vollständig verfügbar."
						}
					/>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Institut</TableHead>
								<TableHead>Anbieter</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="hidden md:table-cell">
									Letzter Abgleich
								</TableHead>
								<TableHead className="hidden md:table-cell">
									Zustimmung bis
								</TableHead>
								<TableHead className="text-right">Konten</TableHead>
								<TableHead />
							</TableRow>
						</TableHeader>
						<TableBody>
							{connections.map((c) => (
								<TableRow key={c.id}>
									<TableCell className="text-text">
										{c.institutionName}
										{c.lastError ? (
											<span className="block text-[11px] text-negative">
												{c.lastError}
											</span>
										) : null}
										{c.status === "active" &&
										c.accountCount === 0 &&
										c.lastSyncAt ? (
											<span className="block text-[11px] text-text-muted">
												Freigabe erteilt, aber die Bank teilt kein Konto: bei
												Enable Banking das Konto verknüpfen und danach hier neu
												verbinden.
											</span>
										) : null}
										{c.provider === "enable-banking" &&
										!c.canSync &&
										c.status !== "disconnected" ? (
											<span className="block text-[11px] text-text-muted">
												Freigabe in Fortuna noch offen. Bankanmeldung beenden
												oder unten erneut verbinden.
											</span>
										) : null}
										{c.automaticRetryAt && c.automaticRetryAt > now ? (
											<span className="block text-[11px] text-text-muted">
												Erneuter Versuch frühestens{" "}
												{f.dateTime(c.automaticRetryAt)}
											</span>
										) : null}
									</TableCell>
									<TableCell className="text-text-secondary">
										{BANK_PROVIDER_LABELS[c.provider] ?? c.provider}
									</TableCell>
									<TableCell>
										<Badge
											variant={
												c.status === "active"
													? "positive"
													: c.status === "error"
														? "negative"
														: "default"
											}
										>
											{{
												pending: "Wartet auf Freigabe",
												active: "Aktiv",
												expired: "Abgelaufen",
												error: "Fehler",
												disconnected: "Getrennt",
											}[c.status] ?? c.status}
										</Badge>
									</TableCell>
									<TableCell className="hidden font-mono text-xs text-text-muted md:table-cell">
										{c.lastSyncAt ? f.dateTime(c.lastSyncAt) : "nie"}
									</TableCell>
									<TableCell className="hidden font-mono text-xs text-text-muted md:table-cell">
										{c.consentExpiresAt ? f.dateTime(c.consentExpiresAt) : "—"}
									</TableCell>
									<TableCell className="text-right">{c.accountCount}</TableCell>
									<TableCell className="text-right">
										{c.canSync &&
										!(
											c.status === "active" &&
											c.lastSyncAt &&
											c.accountCount === 0
										) ? (
											<Button
												variant="ghost"
												size="sm"
												onClick={() => sync.mutate({ id: c.id })}
												disabled={
													sync.isPending ||
													Boolean(
														c.automaticRetryAt && c.automaticRetryAt > now,
													)
												}
											>
												<RefreshCw /> Abgleichen
											</Button>
										) : null}
										{c.status !== "disconnected" ? (
											<Button
												variant="ghost"
												size="sm"
												className="text-text-muted"
												disabled={disconnect.isPending}
												onClick={() => {
													if (
														confirm(
															c.accountCount
																? "Verbindung trennen? Konten und Transaktionen bleiben erhalten; das Anbieter-Token wird gelöscht."
																: "Verbindung trennen? Sie hat keine Konten angelegt und wird deshalb ganz entfernt.",
														)
													)
														disconnect.mutate({ id: c.id });
												}}
											>
												Trennen
											</Button>
										) : null}
										<Button
											variant="ghost"
											size="sm"
											className="text-text-muted"
											disabled={removeConnection.isPending}
											onClick={() => {
												if (
													confirm(
														c.accountCount
															? `Verbindung entfernen? ${c.accountCount} ${
																	c.accountCount === 1 ? "Konto" : "Konten"
																} und alle Transaktionen bleiben erhalten, verlieren aber die Anbieterverknüpfung und werden nicht mehr abgeglichen.`
															: "Verbindung entfernen? Sie verschwindet aus der Liste.",
													)
												)
													removeConnection.mutate({ id: c.id });
											}}
										>
											<Trash2 /> Entfernen
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</Card>
			<Card>
				<CardHeader
					title="Scalable Capital"
					subtitle="Automatischer Depotabgleich, nur lesend"
					action={
						<Badge
							variant={
								hostedStatus.status === "error"
									? "negative"
									: hostedStatus.status === "active" ||
											scalableStatus.status === "active"
										? "positive"
										: scalableStatus.status === "error"
											? "negative"
											: "default"
							}
						>
							{hostedStatus.status === "error"
								? "Fehler"
								: hostedStatus.status === "active"
									? "Verbunden"
									: hostedStatus.status === "pending"
										? "Freigabe läuft"
										: scalableStatus.status === "active"
											? scalableStatus.method === "cli"
												? "Verbunden"
												: "CSV importiert"
											: scalableStatus.status === "error"
												? "Fehler"
												: "nicht verbunden"}
						</Badge>
					}
				/>
				<CardBody className="space-y-3 text-sm">
					<p className="text-text-secondary">
						Aktiviere bei Scalable im Web unter Profil → Sicherheit zunächst
						„Agentic Investing“. Verbinde dann per Gerätecode. Fortuna speichert
						die Verbindung und den Signierschlüssel verschlüsselt und ruft nur
						Depot, Guthaben und Transaktionen ab. Die Freigabe bei Scalable ist
						nicht auf Lesen beschränkt; gelesen wird mit einer eigenen,
						schreibgeschützten Anmeldung. Orders führt Fortuna nur mit der
						separaten Handelsfreigabe aus und nur auf Ihre Bestätigung.
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							disabled={connectHosted.isPending}
							onClick={() => connectHosted.mutate(undefined)}
						>
							{hostedStatus.status === "pending"
								? "Anmeldecode anzeigen"
								: hostedStatus.configured
									? "Scalable neu verbinden"
									: "Mit Scalable verbinden"}
						</Button>
						{hostedStatus.configured ? (
							<Button
								type="button"
								variant="outline"
								disabled={syncHosted.isPending || hostedStatus.syncing}
								onClick={() => syncHosted.mutate(undefined)}
							>
								<RefreshCw />{" "}
								{syncHosted.isPending || hostedStatus.syncing
									? "Abgleich läuft"
									: "Jetzt abgleichen"}
							</Button>
						) : null}
						{hostedStatus.status !== "disconnected" ? (
							<Button
								type="button"
								variant="ghost"
								disabled={disconnectHosted.isPending}
								onClick={() => {
									if (
										confirm(
											"Scalable trennen? Die gespeicherte Verbindung wird entfernt; abgerufene Depotwerte bleiben erhalten. Die Freigabe selbst widerrufst du bei Scalable.",
										)
									)
										disconnectHosted.mutate(undefined);
								}}
							>
								Trennen
							</Button>
						) : null}
					</div>
					<p
						className={
							scalableStatus.stale ? "text-warning" : "text-text-muted"
						}
					>
						Letzter Abgleich:{" "}
						{hostedStatus.lastSyncAt || scalableStatus.lastSyncAt
							? f.dateTime(hostedStatus.lastSyncAt ?? scalableStatus.lastSyncAt)
							: "nie"}
						{" · Bewertung: "}
						{scalableStatus.valuationAt
							? f.dateTime(scalableStatus.valuationAt)
							: "noch nicht vorhanden"}
						{scalableStatus.stale
							? " · veraltet oder ohne aktuellen Kurs"
							: " · aktuell"}
					</p>
					<p className="text-xs text-text-muted">
						Depotwert, Guthaben und Positionen stehen unter Konten → Depots.
					</p>
					{hostedStatus.configured ? <TradingAccessSection /> : null}
					{scalableStatus.accounts.map((source) => (
						<div
							key={source.id}
							className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
						>
							<div>
								<span className="font-medium">{source.label}</span>
								<span className="block text-xs text-text-muted">
									{source.method === "cli"
										? "aktueller Depotstand"
										: "früherer CSV-Import"}{" "}
									· {SOURCE_STATUS_LABELS[source.status] ?? "—"}
								</span>
							</div>
							<Field
								label="Doppelt erfasstes Fortuna-Konto ersetzen"
								htmlFor={`scalable-link-${source.id}`}
							>
								<NativeSelect
									id={`scalable-link-${source.id}`}
									value={source.linkedAccountId ?? ""}
									onChange={(event) =>
										linkScalableAccount.mutate({
											sourceAccountId: source.id,
											linkedAccountId: event.target.value || null,
										})
									}
								>
									<option value="">Keines</option>
									{accountRows.map((account) => (
										<option key={account.id} value={account.id}>
											{account.name}
										</option>
									))}
								</NativeSelect>
							</Field>
						</div>
					))}
					{hostedStatus.lastError || scalableStatus.lastError ? (
						<p
							className={
								hostedStatus.status === "error" ||
								(!hostedStatus.lastError && scalableStatus.status === "error")
									? "text-negative"
									: "text-warning"
							}
						>
							{hostedStatus.lastError ?? scalableStatus.lastError}
						</p>
					) : null}
				</CardBody>
			</Card>
			<Dialog
				open={Boolean(scalableDevicePrompt)}
				onOpenChange={(open) => {
					if (!open) setScalableDevicePrompt(null);
				}}
			>
				<DialogContent
					title="Scalable freigeben"
					description="Öffne die Scalable-Anmeldeseite und bestätige diesen Gerätecode selbst."
				>
					<p className="text-sm text-text-secondary">
						Fortuna sieht weder dein Passwort noch deinen 2FA-Code. Die Freigabe
						läuft ungefähr zehn Minuten.
					</p>
					<p className="rounded-md border border-border bg-surface-sunken p-3 font-mono text-lg tracking-widest">
						{scalableDevicePrompt?.code}
					</p>
					{scalableDevicePrompt ? (
						<Button asChild>
							<a
								href={scalableDevicePrompt.url}
								target="_blank"
								rel="noopener noreferrer"
							>
								Scalable-Anmeldung öffnen
							</a>
						</Button>
					) : null}
					<p className="text-xs text-warning">
						Scalable gewährt der CLI keine serverseitig begrenzte
						Leseberechtigung. Fortuna speichert die Sitzung verschlüsselt und
						verwendet ausschließlich feste Lesebefehle.
					</p>
				</DialogContent>
			</Dialog>
			<Card>
				<CardHeader
					title="Kataster"
					subtitle="Hosting-Kosten, Abrechnung und Marge direkt in Fortuna"
					action={
						<Badge variant={katasterStatus.configured ? "positive" : "default"}>
							{katasterStatus.configured ? "verbunden" : "nicht verbunden"}
						</Badge>
					}
				/>
				<CardBody className="space-y-4">
					<form
						className="grid gap-3 sm:grid-cols-2"
						onSubmit={async (event) => {
							event.preventDefault();
							const form = event.currentTarget;
							setConnectingKataster(true);
							try {
								const response = await fetch("/api/integrations/kataster", {
									method: "POST",
									body: new FormData(form),
								});
								if (!response.ok)
									throw new Error(
										(await response.text()) ||
											"Kataster konnte nicht verbunden werden",
									);
								form.reset();
								await invalidate();
								toast.success("Kataster verbunden und geprüft");
							} catch (error) {
								reportError(error);
							} finally {
								setConnectingKataster(false);
							}
						}}
					>
						<Field label="Kataster-Adresse" htmlFor="kataster-url">
							<Input
								id="kataster-url"
								name="baseUrl"
								type="url"
								defaultValue={katasterStatus.baseUrl}
								required
							/>
						</Field>
						<Field
							label={
								katasterStatus.configured
									? "Neues Nur-Lese-Token"
									: "Nur-Lese-Token"
							}
							htmlFor="kataster-token"
						>
							<Input
								id="kataster-token"
								name="token"
								type="password"
								autoComplete="off"
								required
							/>
						</Field>
						<p className="text-xs text-text-muted sm:col-span-2">
							Das Token kommt aus Kataster unter Einstellungen. Fortuna prüft es
							sofort und speichert es verschlüsselt. Kosten, Abrechnung und
							Marge stehen gleich darunter; sie bleiben eine separate
							Betriebsübersicht und verändern dein Nettovermögen nicht.
						</p>
						<div className="flex flex-wrap justify-between gap-2 sm:col-span-2">
							<div className="flex gap-2">
								{katasterStatus.configured ? (
									<Button
										type="button"
										variant="ghost"
										disabled={disconnectKataster.isPending}
										onClick={() => {
											if (
												confirm(
													"Kataster trennen? Das gespeicherte Token wird gelöscht; die Betriebsübersicht ist danach leer.",
												)
											)
												disconnectKataster.mutate(undefined);
										}}
									>
										Trennen
									</Button>
								) : null}
							</div>
							<Button type="submit" disabled={connectingKataster}>
								<Building2 />{" "}
								{katasterStatus.configured ? "Token ersetzen" : "Verbinden"}
							</Button>
						</div>
					</form>
				</CardBody>
			</Card>
			{paypalViaBank ? (
				<Card>
					<CardHeader
						title="PayPal-Aufladungen"
						subtitle="Damit dieselbe Zahlung nicht zweimal als Ausgabe zählt"
					/>
					<CardBody className="space-y-3">
						<p className="text-sm text-text-secondary">
							PayPal meldet über die Bankschnittstelle nur abgehende Zahlungen,
							nie die Aufladung. Der „PayPal“-Abgang auf deinem Girokonto und
							PayPals Zahlung an den Händler sind deshalb dasselbe Geld — einmal
							als „PayPal“, einmal mit dem echten Händler. Fortuna erkennt die
							Paare und bucht die Bankseite als Aufladung um; gezählt wird nur
							noch die Zahlung an den Händler. Beim Abgleich läuft das
							automatisch mit.
						</p>
						<div>
							<Button
								variant="outline"
								disabled={linkFunding.isPending}
								onClick={() => linkFunding.mutate(undefined)}
							>
								{linkFunding.isPending
									? "Sucht Paare …"
									: "Auch rückwirkend zuordnen"}
							</Button>
						</div>
					</CardBody>
				</Card>
			) : null}
			<Card>
				<CardHeader
					title="Remise"
					subtitle="Verkaufsbestand automatisch als Sachwerte übernehmen"
					action={
						<Badge variant={remiseStatus.configured ? "positive" : "default"}>
							{remiseStatus.configured ? "verbunden" : "nicht verbunden"}
						</Badge>
					}
				/>
				<CardBody className="space-y-3">
					<p className="text-sm text-text-secondary">
						Aktive Remise-Gegenstände landen im Bereich Sachwerte unter
						„Remise“. Fortuna verwendet zuerst den Zielpreis, sonst den
						freigegebenen Angebotspreis. Abgeschlossene Gegenstände werden aus
						dem aktiven Nettovermögen genommen.
					</p>
					{remiseStatus.configured ? (
						<div className="rounded-md border border-border bg-surface-sunken p-3 text-xs text-text-secondary">
							<p>
								{remiseStatus.assetCount} Sachwerte
								{remiseStatus.lastSyncAt
									? ` · zuletzt ${f.dateTime(remiseStatus.lastSyncAt)}`
									: " · noch nicht abgeglichen"}
							</p>
							{remiseStatus.lastError ? (
								<p className="mt-1 text-negative">{remiseStatus.lastError}</p>
							) : null}
						</div>
					) : null}
					<div className="flex flex-wrap gap-2">
						{remiseStatus.configured ? (
							<>
								<Button
									type="button"
									onClick={() => syncRemise.mutate({})}
									disabled={syncRemise.isPending}
								>
									<RefreshCw /> Abgleichen
								</Button>
								<Button
									type="button"
									variant="ghost"
									onClick={() => {
										if (
											confirm(
												"Remise trennen? Übernommene Sachwerte bleiben erhalten, werden aber nicht mehr abgeglichen.",
											)
										)
											disconnectRemise.mutate({});
									}}
									disabled={disconnectRemise.isPending}
								>
									Trennen
								</Button>
							</>
						) : (
							<Button
								type="button"
								onClick={() => connectRemise.mutate({})}
								disabled={connectRemise.isPending}
							>
								<Link2 /> Mit Remise verbinden
							</Button>
						)}
					</div>
				</CardBody>
			</Card>
			<Card>
				<CardHeader
					title="Enable Banking"
					subtitle="Anwendungs-ID und privater RSA-Schlüssel für den Kontoinformationszugriff"
					action={
						<Badge
							variant={
								enableBankingCredential.configured ? "positive" : "default"
							}
						>
							{enableBankingCredential.configured
								? "eingerichtet"
								: "nicht eingerichtet"}
						</Badge>
					}
				/>
				<CardBody className="space-y-4">
					{enableBankingCredential.configured ? (
						<div className="rounded-md border border-border bg-surface-sunken p-3 text-xs text-text-secondary">
							<p>
								Anwendungs-ID:{" "}
								<code className="font-mono text-text">
									{enableBankingCredential.applicationId}
								</code>
							</p>
							<p className="mt-1">
								Schlüsselfingerabdruck:{" "}
								<code className="font-mono text-text">
									{enableBankingCredential.keyFingerprint?.slice(0, 16)}…
								</code>
							</p>
							{enableBankingCredential.updatedAt ? (
								<p className="mt-1">
									Gespeichert: {f.dateTime(enableBankingCredential.updatedAt)}
								</p>
							) : null}
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="mt-3"
								disabled={testEnableBankingCredential.isPending}
								onClick={() => testEnableBankingCredential.mutate(undefined)}
							>
								<RefreshCw /> Zugang testen
							</Button>
							<Button
								type="button"
								size="sm"
								className="mt-3 ml-2"
								onClick={() => setEnableBankingOpen(true)}
							>
								<Plus /> Bank verbinden
							</Button>
						</div>
					) : null}
					<form
						className="grid gap-3 sm:grid-cols-2"
						onSubmit={async (event) => {
							event.preventDefault();
							const form = event.currentTarget;
							setUploadingKey(true);
							try {
								const response = await fetch(
									"/api/provider-credentials/enable-banking",
									{
										method: "POST",
										body: new FormData(form),
									},
								);
								if (!response.ok) {
									throw new Error(
										(await response.text()) ||
											"Schlüssel konnte nicht gespeichert werden",
									);
								}
								form.reset();
								await invalidate();
								toast.success("Enable-Banking-Schlüssel sicher gespeichert");
							} catch (error) {
								reportError(error);
							} finally {
								setUploadingKey(false);
							}
						}}
					>
						<Field label="Anwendungs-ID" htmlFor="eb-app-id">
							<Input
								id="eb-app-id"
								name="applicationId"
								defaultValue={enableBankingCredential.applicationId ?? ""}
								placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
								required
								className="font-mono"
							/>
						</Field>
						<Field
							label={
								enableBankingCredential.configured
									? "Neue private PEM-Datei"
									: "Private PEM-Datei"
							}
							htmlFor="eb-private-key"
						>
							<Input
								id="eb-private-key"
								name="privateKey"
								type="file"
								accept=".pem,application/x-pem-file,text/plain"
								required
								className="pt-1"
							/>
						</Field>
						<p className="text-xs text-text-muted sm:col-span-2">
							Die Datei wird nur an Fortuna übertragen, serverseitig geprüft und
							AES-256-GCM-verschlüsselt gespeichert. Der Schlüssel wird danach
							nie angezeigt oder zum Download angeboten. Ob er zur Anwendungs-ID
							gehört, kann erst der erste API-Aufruf bestätigen.
						</p>
						<div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
							{enableBankingCredential.configured ? (
								<Button
									type="button"
									variant="ghost"
									className="text-negative"
									disabled={deleteEnableBankingCredential.isPending}
									onClick={() => {
										if (
											confirm(
												"Gespeicherten Enable-Banking-Schlüssel endgültig löschen?",
											)
										)
											deleteEnableBankingCredential.mutate(undefined);
									}}
								>
									<Trash2 /> Löschen
								</Button>
							) : (
								<span />
							)}
							<Button type="submit" disabled={uploadingKey}>
								<KeyRound />
								{enableBankingCredential.configured
									? "Ersetzen"
									: "Sicher speichern"}
							</Button>
						</div>
					</form>
				</CardBody>
			</Card>
			<Dialog open={enableBankingOpen} onOpenChange={setEnableBankingOpen}>
				<DialogContent
					title="Bank über Enable Banking verbinden"
					description="Du wirst zur Bank weitergeleitet und kehrst danach automatisch zu Fortuna zurück."
				>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							// Name and country travel together; two countries can hold
							// an institution of the same name.
							const [country, ...rest] = str(
								new FormData(event.currentTarget),
								"institution",
							).split("|");
							beginEnableBankingConnection.mutate({
								institutionCountry: country,
								institutionName: rest.join("|"),
							});
						}}
						className="space-y-4"
					>
						<Field
							label="Institut"
							htmlFor="eb-institution"
							hint="Nicht nur deutsche: PayPal etwa ist in Luxemburg zugelassen."
						>
							<NativeSelect
								id="eb-institution"
								name="institution"
								required
								disabled={institutionsLoading}
							>
								<option value="">
									{institutionsLoading
										? "Institute werden geladen…"
										: "Institut auswählen"}
								</option>
								{enableBankingInstitutions.map((institution) => (
									<option
										key={`${institution.country}|${institution.name}`}
										value={`${institution.country}|${institution.name}`}
									>
										{institution.name}
										{institution.country === "DE"
											? ""
											: ` · ${institution.country}`}
									</option>
								))}
							</NativeSelect>
						</Field>
						<div className="flex justify-end gap-2">
							<Button
								type="button"
								variant="ghost"
								onClick={() => setEnableBankingOpen(false)}
							>
								Abbrechen
							</Button>
							<Button
								type="submit"
								disabled={
									institutionsLoading || beginEnableBankingConnection.isPending
								}
							>
								Weiter zur Bank
							</Button>
						</div>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
