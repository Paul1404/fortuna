import { createFileRoute } from "@tanstack/react-router";
import { LegalList, LegalPage, LegalSection } from "@/components/legal-page";

export const Route = createFileRoute("/privacy")({
	head: () => ({
		meta: [
			{ title: "Datenschutz · Fortuna" },
			{
				name: "description",
				content:
					"Datenschutzinformationen der privaten Finanzanwendung Fortuna.",
			},
		],
	}),
	component: PrivacyPage,
});

function PrivacyPage() {
	return (
		<LegalPage title="Datenschutz" updated="15. September 2026">
			<LegalSection title="Verantwortung und Kontakt">
				<p>
					Fortuna ist eine private, nicht öffentlich angebotene
					Einzelbenutzer-Anwendung. Sie wird ausschließlich vom Eigentümer zur
					Verwaltung der eigenen Finanzen betrieben. Fragen zum Datenschutz
					können an{" "}
					<a
						className="text-brand hover:underline"
						href="mailto:datenschutz@pdcd.net"
					>
						datenschutz@pdcd.net
					</a>{" "}
					gerichtet werden.
				</p>
			</LegalSection>

			<LegalSection title="Verarbeitete Daten">
				<p className="mb-2">
					Fortuna verarbeitet nur Daten, die der Eigentümer selbst eingibt,
					importiert oder über eine ausdrücklich freigegebene Bankverbindung
					abruft. Dazu können gehören:
				</p>
				<LegalList>
					<li>
						Kontobezeichnungen, Institute, IBAN, Währungen und Kontostände,
					</li>
					<li>
						Transaktionen mit Datum, Betrag, Beschreibung und Angaben zur
						Gegenpartei,
					</li>
					<li>
						Kategorien, Budgets, wiederkehrende Zahlungen und Bewertungen,
					</li>
					<li>
						Anlageziele, Risikoleitplanken, Zielallokation und Produktkosten,
					</li>
					<li>
						Vertragsdaten, vom Eigentümer hochgeladene Vertragsdokumente und
						ausdrücklich bestätigte Copilot-Erinnerungen,
					</li>
					<li>
						technische Verbindungs-, Zustimmungs-, Sicherheits- und Fehlerdaten.
					</li>
				</LegalList>
			</LegalSection>

			<LegalSection title="Fortuna Copilot">
				<p>
					Wenn der Eigentümer den Copilot verwendet, werden die aktuelle Frage,
					ein begrenzter Finanzkontext ohne IBAN sowie ausdrücklich angehängte
					Dateien zur Verarbeitung an OpenAI übermittelt. Die Verbindung erfolgt
					über das persönlich freigegebene ChatGPT-Konto. Temporäre Chat-Anhänge
					werden nach erfolgreicher Verarbeitung oder spätestens nach 30 Minuten
					entfernt. Dokumente, die der Eigentümer einem Vertrag zuordnet, werden
					verschlüsselt dauerhaft in einem privaten, S3-kompatiblen
					Objektspeicher gespeichert. Bereits vorhandene Dokumente können bis
					zum nächsten Abruf verschlüsselt in PostgreSQL verbleiben.
				</p>
			</LegalSection>

			<LegalSection title="Zweck und Freigabe">
				<p>
					Die Daten werden ausschließlich dargestellt, geordnet und für private
					Finanzübersichten, Auswertungen und Prognosen verwendet. Fortuna löst
					keine Bankzahlungen aus. Separat freigegebene Broker-Aufträge werden
					nur nach Anbietervorschau und ausdrücklicher Bestätigung übermittelt.
					Dabei werden die erforderlichen Orderdaten an den Broker übertragen.
					Der Zugriff auf ein Bankkonto erfolgt nur nach ausdrücklicher Freigabe
					durch den Kontoinhaber und kann widerrufen werden. Soweit die DSGVO
					anwendbar ist, beruht die Bankanbindung auf dieser Einwilligung nach
					Artikel 6 Absatz 1 Buchstabe a DSGVO.
				</p>
			</LegalSection>

			<LegalSection title="Bankanbindung und Dienstleister">
				<p>
					Für die Bankanbindung wird Enable Banking Oy, Otakaari 5, 02150 Espoo,
					Finnland, als regulierter Kontoinformationsdienst eingesetzt. Die
					Authentifizierung findet bei der jeweiligen Bank statt. Enable Banking
					übermittelt die freigegebenen Konto- und Transaktionsdaten an Fortuna.
					Weitere Informationen stehen in der{" "}
					<a
						className="text-brand hover:underline"
						href="https://enablebanking.com/privacy/"
					>
						Datenschutzinformation von Enable Banking
					</a>
					. Fortuna wird auf Infrastruktur von Railway betrieben. Daten werden
					nicht für Werbung verkauft und nicht zu Werbeprofilen zusammengeführt.
				</p>
			</LegalSection>

			<LegalSection title="Speicherung und Löschung">
				<p>
					Importierte Finanzdaten bleiben gespeichert, bis der Eigentümer sie
					löscht. Private Anwendungsschlüssel, Zugangsdaten und Token externer
					Anbieter sowie Vertragsdokumente werden verschlüsselt gespeichert.
					Beim Trennen einer Bankverbindung wird das gespeicherte Anbieter-Token
					entfernt; bereits importierte Daten bleiben für die private
					Finanzhistorie erhalten, bis sie separat gelöscht werden.
				</p>
			</LegalSection>

			<LegalSection title="Cookies und Protokolle">
				<p>
					Fortuna verwendet ausschließlich technisch notwendige Sitzungsdaten
					für die Anmeldung und speichert die gewählte Darstellung lokal im
					Browser. Es gibt keine Werbe- oder Analyse-Tracker. Technische
					Protokolle dienen nur dem sicheren Betrieb und der Fehlerbehebung.
				</p>
			</LegalSection>

			<LegalSection title="Rechte und Widerruf">
				<p>
					Betroffene Personen können Auskunft, Berichtigung, Löschung,
					Einschränkung und Datenübertragbarkeit verlangen sowie eine erteilte
					Einwilligung für die Zukunft widerrufen. Der Widerruf einer
					Bankfreigabe ist auch bei der Bank oder über die Consent-Verwaltung
					von{" "}
					<a
						className="text-brand hover:underline"
						href="https://enablebanking.com/data-sharing-consents/"
					>
						Enable Banking
					</a>{" "}
					möglich. Datenschutzanfragen gehen an die oben genannte
					Kontaktadresse.
				</p>
			</LegalSection>
		</LegalPage>
	);
}
