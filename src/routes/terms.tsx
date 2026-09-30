import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalList, LegalPage, LegalSection } from "@/components/legal-page";

export const Route = createFileRoute("/terms")({
	head: () => ({
		meta: [
			{ title: "Nutzungsbedingungen · Fortuna" },
			{
				name: "description",
				content: "Nutzungsbedingungen der privaten Finanzanwendung Fortuna.",
			},
		],
	}),
	component: TermsPage,
});

function TermsPage() {
	return (
		<LegalPage title="Nutzungsbedingungen" updated="15. September 2026">
			<LegalSection title="Geltungsbereich">
				<p>
					Fortuna ist eine private, nicht öffentlich angebotene
					Einzelbenutzer-Anwendung. Die Nutzung ist ausschließlich dem
					autorisierten Eigentümer gestattet. Ein Anspruch auf Zugang für andere
					Personen besteht nicht.
				</p>
			</LegalSection>

			<LegalSection title="Leistungsumfang">
				<p className="mb-2">
					Fortuna führt Informationen über private Finanzen zusammen. Die
					Anwendung kann insbesondere:
				</p>
				<LegalList>
					<li>Konten, Kontostände und Transaktionen darstellen,</li>
					<li>Daten aus CSV-Dateien oder Bankverbindungen importieren,</li>
					<li>
						Kategorien, Vermögenswerte, Verbindlichkeiten und Prognosen
						verwalten.
					</li>
					<li>
						Verträge und Dokumente verwalten sowie regelbasierte Szenarien und
						Rückblicke erstellen.
					</li>
				</LegalList>
				<p className="mt-2">
					Bankverbindungen dienen dem Abruf von Informationen und lösen keine
					Bankzahlungen aus. Eine separat freigegebene Broker-Verbindung kann
					Wertpapieraufträge übermitteln, jedoch nur nach Anzeige der
					Anbietervorschau und ausdrücklicher Bestätigung durch den Eigentümer.
					Copilot und MCP haben keinen Zugriff auf diese Handelsfunktion.
				</p>
			</LegalSection>

			<LegalSection title="Bankverbindungen">
				<p>
					Eine Bankverbindung wird nur nach ausdrücklicher Autorisierung durch
					den Kontoinhaber hergestellt. Für den Abruf kann Enable Banking als
					regulierter Kontoinformationsdienst eingesetzt werden. Dabei gelten
					ergänzend die{" "}
					<a
						className="text-brand hover:underline"
						href="https://enablebanking.com/terms/"
					>
						Bedingungen von Enable Banking
					</a>
					. Eine Freigabe kann ablaufen oder widerrufen werden; danach ist bis
					zur erneuten Autorisierung kein weiterer Abruf möglich.
				</p>
			</LegalSection>

			<LegalSection title="Datenqualität und Verfügbarkeit">
				<p>
					Kontostände und Transaktionen stammen von Banken, Importdateien oder
					manuellen Eingaben. Verzögerungen, fehlende Buchungen oder fehlerhafte
					Angaben können nicht vollständig ausgeschlossen werden. Maßgeblich
					sind stets die Unterlagen und Anzeigen der jeweiligen Bank. Es besteht
					keine Garantie für eine unterbrechungsfreie Verfügbarkeit.
				</p>
			</LegalSection>

			<LegalSection title="Keine Beratung">
				<p>
					Auswertungen und Prognosen dienen ausschließlich der persönlichen
					Übersicht. Sie sind keine Finanz-, Anlage-, Steuer- oder
					Rechtsberatung und keine Aufforderung zu einer finanziellen
					Entscheidung.
				</p>
			</LegalSection>

			<LegalSection title="Sicherheit und Zugang">
				<p>
					Anmeldedaten, private Schlüssel und Bankfreigaben sind vertraulich zu
					behandeln. Auffällige oder unberechtigte Zugriffe sollen unverzüglich
					an{" "}
					<a
						className="text-brand hover:underline"
						href="mailto:datenschutz@pdcd.net"
					>
						datenschutz@pdcd.net
					</a>{" "}
					gemeldet werden.
				</p>
			</LegalSection>

			<LegalSection title="Datenschutz und Änderungen">
				<p>
					Einzelheiten zur Verarbeitung stehen in der{" "}
					<Link to="/privacy" className="text-brand hover:underline">
						Datenschutzinformation
					</Link>
					. Funktionen, Schnittstellen und diese Bedingungen können angepasst
					werden, wenn dies für Sicherheit, Betrieb oder geänderte rechtliche
					und technische Anforderungen erforderlich ist. Das
					Aktualisierungsdatum steht am Anfang dieser Seite.
				</p>
			</LegalSection>
		</LegalPage>
	);
}
