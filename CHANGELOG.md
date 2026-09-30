# Changelog

Alle nennenswerten Änderungen an Fortuna. Neueste zuerst. Die Version hier
entspricht `package.json` und der Versionsanzeige in der App.

## 0.62.1 - 2026-09-30

- Öffentliche Quelltextansicht mit neuer, geprüfter Historie. Finanzdaten,
  Dokumente und Zugangsdaten bleiben privat; alle Rechte bleiben vorbehalten.
- Lokale Erstinstallation mit einzeln ausgeführten historischen Migrationen.
  Der Produktionsmigrator und angewandte SQL-Dateien bleiben unverändert.
- Demo-Daten sind auf lokale Entwicklungsdatenbanken begrenzt. Dokumentation
  unterscheidet Bank-Lesezugriff, begrenzte MCP-Schreibrechte und ausdrücklich
  bestätigte Broker-Orders.

## 0.62.0 - 2026-09-28

Für den langen Atem: Fortuna zeigt, was Sie selbst geschafft haben, und
hilft, in schwachen Momenten bei Ihren eigenen Regeln zu bleiben.

- Eigene Anlageregeln: In „Ziele & Reserve“ und unter Anlegen notieren Sie
  in Ruhe, wann Sie verkaufen und was Sie im Crash tun. Fortuna zeigt sie
  Ihnen vor jedem Verkauf.
- Vor einem Verkauf fragt Fortuna „Warum jetzt?“. Erst mit einem Satz in
  Ihren Worten lässt sich die Vorschau holen; der Grund steht danach im
  Orderprotokoll. Käufe bleiben unverändert.
- Ruhigerer Blick an schwachen Tagen: Liegt das Depot unter dem letzten
  Abgleich, zeigt die Übersicht unter dem Nettovermögen die Veränderung seit
  einem Jahr statt des Datums.
- Vermögen zeigt, woher die Veränderung kommt: Eigene Sparleistung, Markt &
  Bewertung und Sonstiges – für den laufenden Monat, den Vormonat oder das
  Jahr. Dazu die Sparserie: volle Monate in Folge mit mehr Einnahmen als
  Ausgaben.
- Die Reserve ist ein Topf: Auf dem Schreibtisch und unter Anlegen steht, wie
  weit das Geld auf den Konten sie füllt.
- Hr. Körner fasst zu Monatsbeginn den Vormonat in wenigen Sätzen zusammen.
  „Gelesen“ nimmt den Rückblick vom Schreibtisch; frühere Rückblicke stehen
  unter „Erledigt und entschieden“.
- Wachsen die Fixkosten deutlich schneller als das Einkommen, merkt
  Hr. Körner das einmal pro Quartal an – frühestens nach sechs vollen
  Monaten.
- Verträge können als „Wird über das Gehalt bezahlt (Entgeltumwandlung)“
  markiert werden. Sie stehen in den Fixkosten als „über Gehalt“, zählen aber
  nicht zur Monatssumme und nicht zur Prognose.

## 0.61.0 - 2026-09-28

Geprüft an den echten Zahlen: Nettovermögen, Zahlungsfluss, Prognose und
Anlegen gehen auf den Cent auf; diese Fehler sind behoben.

- Wiederkehrende Zahlungen werden nach jedem Bankabgleich automatisch
  erkannt. Selbst angelegte Zahlungen werden dabei nicht doppelt angelegt,
  sondern bekommen ihre passenden Buchungen zugeordnet.
- Eine monatliche Zahlung ohne Fälligkeitsdatum steht in der Prognose an
  ihrem üblichen Tag statt heute.
- Die Reserve liegt nicht mehr unter den Ausgaben, die volle Monate schon
  gezeigt haben.
- Vermögensverlauf: Verbundene Konten zählen ab ihrer ersten Buchung, nicht
  erst ab dem Tag der Verbindung; PayPal erhält dabei kein erfundenes
  Guthaben.
- „Wo das Vermögen liegt“ zeigt den Depotanteil ohne Einzelposition (Krypto),
  sodass die Summe dem Nettovermögen entspricht.
- Buchungen ohne Text gelten nicht mehr als Händler und bekommen keine
  Vorschläge voneinander. Eine erkannte Zahlung wird beim Löschen
  deaktiviert, damit sie nicht wiederkommt.
- Wechselkurse: Der neuere Kurs gilt, gleich in welcher Richtung erfasst.

## 0.60.0 - 2026-09-28

Fürs Handy gemacht: die täglichen Handgriffe mit wenigen Tipps.

- Untere Leiste mit Hr. Körner, Umsätzen, Konten, Vermögen und „Mehr“;
  Dialoge öffnen sich als Blatt von unten, Speichern bleibt über der
  Tastatur sichtbar, Eingabefelder zoomen nicht mehr.
- Forderungen & Schulden: Ein Tipp öffnet „Teilzahlung erhalten“,
  „Vollständig beglichen“, „Betrag ändern“ und den Verlauf – mit dem offenen
  Rest beim Tippen. „Vollständig beglichen“ schließt die Forderung jetzt
  wirklich. Bei Krediten zieht „Rate gezahlt“ nur die Tilgung ab.
- Neue Forderung in Sekunden: wer, wie viel, optional fällig am.
- Bargeld: „Ausgabe“, „Einnahme“ und „Zählen“ oben auf der Kontoseite, mit
  Zahlentastatur. Sachwerte: Ein Tipp auf die Zeile aktualisiert den Wert.
- Umsätze: Die Suche bleibt erreichbar, Filter stecken in einem Blatt und
  erscheinen als entfernbare Chips. Eine Buchung zuordnen: zwei Tipps mit den
  zuletzt verwendeten Kategorien.
- Zuordnen: Jeder Händler ist eine Karte mit eigenem „Übernehmen“; „Neue
  Kategorie“ ordnet jetzt alle Buchungen des Händlers zu, nicht nur die erste.
- Fixkosten: „Verknüpfen“ und „Datum eintragen“ direkt in der Zeile.
- Hr. Körner: „Fragen“ öffnet das Gespräch direkt, Hinweise entscheiden Sie
  über ein Menü. Das Eingabefeld bleibt über der Tastatur.
- Anlegen: großer Überweisungsbetrag zum Kopieren; die Scalable-Vorschau ist
  aufklappbar gegliedert, bestätigt wird erst, wenn alles geöffnet und
  gelesen ist.
- Einstellungen, Konten, Vermögen und Zahlungsfluss passen aufs Handy, ohne
  seitliches Scrollen.

## 0.59.0 - 2026-09-27

Fortuna ist deutlich schlanker: 21 Menüpunkte sind neun geworden, rund
10.000 Zeilen Code weniger.

- Der Anlageplan ist ersetzt: „Anlegen“ zeigt nur noch, was mit freiem Geld zu
  tun ist – erst die Überweisung vom Konto ins Depot, dann die Käufe nach
  Ihrer Zielaufteilung, direkt bei Scalable ausführbar. Auf dem Schreibtisch
  steht dafür eine einzige Aufgabe: „Freies Geld“.
- Ziel, Sparrate, Reserve und Zielaufteilung stehen an einer Stelle
  („Ziele & Reserve“). Die Reserve rechnet überall gleich; Monatsausgaben
  zählen erst ab drei vollen Monaten Buchungen.
- „Vermögen“ vereint Nettovermögen, Übersicht und Rückblick: ein Verlauf mit
  allen Auswahlmöglichkeiten, die Veränderung nach Zeitraum und die
  Vermögensaufteilung einmal. Gespeicherte Ansichten bleiben.
- „Fixkosten“ vereint Wiederkehrend, Verträge und Optimierung: Zahlung, Vertrag
  und Sparmission erscheinen als ein Posten. Eine Sparmission zählt erst als
  gespart, wenn die alten Kosten wirklich wegfallen. Zahlungen ohne verknüpfte
  Buchung werden angezeigt und lassen sich mit einem Klick verknüpfen.
- Bargeld steht beim Bargeldkonto unter Konten; Forderungen und
  Verbindlichkeiten teilen sich eine Seite; Verbindungen und Import & Export
  stehen unter Einstellungen › Datenquellen. Alte Adressen leiten weiter.
- Entfernt, weil nicht genutzt: Budgets, Szenarien, Konto-Schätzungen, von
  Hand erfasste Wertpapiere und die direkte PayPal-Verbindung (PayPal kommt
  weiter über die Bank). Ihre gespeicherten Daten bleiben bis zu Ihrer
  Bestätigung erhalten.
- Hr. Körner beginnt ein neues Gespräch, damit er keine entfernten Werkzeuge
  mehr anbietet; der sichtbare Verlauf bleibt.

## 0.58.0 - 2026-09-27

- Orders direkt bei Scalable: Nach einer eigenen Handelsfreigabe unter
  Verbindungen führt Fortuna freigegebene Aufträge auf Ihre Bestätigung aus –
  nur für Wertpapiere im Depot, als Marktorder, ohne Betragsgrenze.
- Vor jeder Order zeigt Fortuna Scalables vollständige Vorschau unverändert:
  Kurs, Berechnung, Handelbarkeit, Warnhinweise und alle Kosten. Ausgeführt
  wird erst nach Ihrem Klick und einer letzten Rückfrage; ein Warnhinweis muss
  vorher bestätigt werden.
- Jede berechnete und ausgeführte Order steht im Orderprotokoll auf der
  Anlageplan-Seite. „Handel sperren“ meldet die Handelsfreigabe bei Scalable
  ab; das Lesen bleibt verbunden.

## 0.57.0 - 2026-09-26

- Fortuna öffnet jetzt auf dem Schreibtisch von Hr. Körner: das Nettovermögen
  oben, darunter „Heute zu tun“ mit je einer Aktion, wie flüssig das Vermögen
  ist und das Gespräch. Die bisherige Startseite heißt „Übersicht“.
- Buchungen, die nur eine eigene Entscheidung wiederholen (Regel,
  wiederkehrende Zahlung, Händlervorgabe, durchgehende Historie), legt
  Hr. Körner selbst ab – beim Öffnen und nach dem Bankabgleich – und meldet es
  mit „Rückgängig“. Vermutungen bleiben Vorschläge; von Hand gesetzte
  Kategorien fasst er nie an.
- „Wie flüssig ist das Vermögen“: sofort, in Tagen, gebunden bis,
  verkäuflich – dazu, wie viel Geld über Reserve und Cash-Anteil hinaus auf
  den Konten liegt, mit einem Überweisungszettel fürs Depot. Überweisen tun Sie
  selbst.
- „Gespräch“ und „Erledigt und entschieden“ erreichen Sie vom Schreibtisch
  und über die Suche.

## 0.56.0 - 2026-09-26

- Das Nettovermögen und das Depot bewegen sich jetzt laufend mit dem Markt:
  Fortuna liest die Kurse alle 15 Sekunden und lässt die Zahl dazwischen
  sekündlich weiterlaufen – ohne Farben. Jeder echte Kurs wird genau
  getroffen; steht der Markt still, steht auch die Zahl.

## 0.55.0 - 2026-09-26

- Das Nettovermögen tickt mit den Kursen jetzt auch in der Seitenleiste und
  auf der Nettovermögen-Seite, und die Depotseite bewegt Depotwert,
  Positionen und Gewinne mit. Jede Kursbewegung leuchtet kurz grün oder rot
  auf.
- Der Verbindungsstatus wird nur noch während eines Abgleichs alle zehn
  Sekunden abgefragt, sonst einmal pro Minute.

## 0.54.0 - 2026-09-25

- Zeitangaben erscheinen überall in deutscher Zeit; Seiten mit Abgleich- oder
  Importzeiten laden ohne Darstellungsfehler.
- Speichern im Buchungsdialog ändert nur, was geändert wurde: Eine Notiz macht
  aus einer Regel-Kategorie keine manuelle, Umbuchungen behalten ihre
  Kategorie, und die Verknüpfung mit einer wiederkehrenden Zahlung bleibt.
- Prognose: Zahlungen zum Monatsende bleiben nach einem kurzen Monat auf dem
  richtigen Tag, wöchentliche Verträge zählen wöchentlich, und Beträge ohne
  Wechselkurs werden benannt statt weggelassen.
- Bankabgleich: Stornierte und abgelehnte Zahlungen erscheinen nicht mehr als
  vorgemerkt; Vormerkungen, die die Bank nach 14 Tagen nicht mehr meldet,
  verschwinden, sofern du sie nicht bearbeitet hast. Der erste Abruf nach der
  Bankfreigabe legt keine Konten mehr doppelt an.
- Hr. Körner meldet eine Gehaltserhöhung nicht mehr als „teurer geworden“,
  vergleicht nach einem Währungswechsel keine alten Schwellen mehr und bekommt
  keine IBANs mehr zu sehen.
- Der Copilot startet nach einem Absturz selbst neu; Anfragen an Hr. Körner
  laufen nicht mehr gleichzeitig, und Fehlermeldungen des KI-Anbieters
  erscheinen nicht mehr im Chat.
- Hr. Körners Zuordnung gilt für Zahlungen und Erstattungen eines Händlers,
  und seine Vorschläge für neue Kategorien erscheinen wieder.
- Eine deaktivierte Verbindlichkeit bleibt im bisherigen Verlauf und zählt ab
  heute nicht mehr. Eine mit einer Kreditkarte verknüpfte Verbindlichkeit
  zeigt Restschuld und Stand des Kontos.
- Sparmissionen: Eine Alternative, die nicht günstiger ist, zeigt „Keine
  Ersparnis“; der CSV-Export weist Ersparnisse erst aus, wenn der alte Vertrag
  geendet hat.
- Der Remise-Abgleich übernimmt keinen zweiten, ähnlich benannten Sachwert;
  der CSV-Import erkennt den eigenen Fortuna-Export.
- „Neuer Chat“, „Trennen“ und „Erinnerung vergessen“ fragen vor dem Löschen
  nach. Verbindlichkeiten und Forderungen lassen sich per Tastatur auswählen.
- Unbekannte Codes erscheinen als „—“; die Herkunft einer Buchung heißt
  „Bankabruf“, „PayPal“ oder „Bargeld“.

## 0.53.1 - 2026-09-25

- Buchungen, deren Text, Händler und Gegenpartei der Abgleichfehler vom 19.09.
  durch die einer fremden Buchung ersetzt hatte, bekommen beim nächsten
  Bankabgleich den Text der Bank zurück. Selbst geänderte Texte, Kategorien,
  Notizen und Beträge bleiben unberührt. Das reicht bis zu 90 Tage zurück.

## 0.53.0 - 2026-09-25

- Hr. Körner füllt den Anlageplan aus: Ziel, Zielbetrag und Termin,
  erträglicher Verlust, Reserve, Sparrate, Zielanteile sowie Kosten und
  Streuung der Fonds im Depot, jeweils mit kurzer Begründung. Gespeichert wird
  erst mit „Übernehmen“.
- Einzelaktien im Depot haben keine laufenden Produktkosten und gelten nicht
  als breit gestreut; das setzt Fortuna selbst.
- Kosten und Streuung jeder Depotposition lassen sich auf der
  Anlageplan-Seite pflegen.
- Ein breit gestreuter Weltfonds zählt nicht mehr als Klumpenrisiko.
- Behoben: Über die MCP-Schnittstelle erschien das Scalable-Depot als
  „unbestätigte CSV-Schätzung“, die nicht zum Vermögen zählen sollte.

## 0.52.3 - 2026-09-25

- Behoben: Ein Bankabgleich überschrieb seit dem 19.09. Text, Händler und
  Gegenpartei aller Buchungen ohne Verwendungszweck mit denen einer fremden
  Buchung. Bereits betroffene Buchungen korrigiert dieses Update nicht.
- Vorgemerkte Zahlungen werden zur Buchung, sobald die Bank sie bucht, und
  zählen dann in Zahlungsfluss und Kontostand.
- Der Bankabruf liest eine Woche zurück und verpasst keine nachträglich
  gebuchten Umsätze mehr.
- PayPal: Buchungen tragen das deutsche Datum, abgelehnte Zahlungen erscheinen
  nicht mehr, vorgemerkte bleiben vorgemerkt. Der Kontostand kommt von PayPal,
  und der Saldoabgleich schlägt an, wenn Zahlungen doppelt zählen.
- Eine abgebrochene Bankfreigabe wird nicht mehr bei jedem Seitenaufruf erneut
  versucht und nicht mehr als bestätigt gemeldet.

## 0.52.2 - 2026-09-25

- Scalable: Ein fehlgeschlagener Abgleich nennt den konkreten Grund, meldet
  denselben Fehler nicht bei jedem Seitenaufruf erneut und nennt einen
  erfolgreichen Abgleich mit Hinweis nicht mehr „fehlgeschlagen“.
- Scalable: Eine abgelaufene Anmeldung zeigt „Fehler“ statt „Verbunden“, und
  eine von Scalable abgelehnte Abfrage wird nicht mehr als „nicht erreichbar“
  gemeldet.
- Scalable: Eine während eines fehlgeschlagenen Abrufs erneuerte Anmeldung
  bleibt erhalten, statt beim nächsten Abgleich als abgelaufen zu gelten.
- Depot: Der Fehlerhinweis steht in ganzen Sätzen und nennt den Vorbehalt nur
  einmal. Liefert Scalable keine einzige lesbare Position, bleibt der letzte
  Bestand stehen.
- Die Anlageberatung zieht das Auffüllen der Reserve nicht mehr doppelt ab und
  legt den tatsächlich freien Betrag an.
- Ein Vertrag, der erst in Zukunft beginnt, erscheint in der Prognose ab
  seinem ersten Fälligkeitstag.
- Eine Zahlung zum Monatsende bleibt nach einem kurzen Monat auf dem 31.
- Wertpapiere eines deaktivierten Kontos zählen nicht mehr zum Nettovermögen.
- Der vorgeschlagene Vertragsbeginn ist die erste Abbuchung, nicht die letzte.

## 0.52.1 - 2026-09-25

- Behoben: Die Prognose sah das Konto bis Weihnachten ins Minus rutschen, und
  die Anlageberatung hielt deshalb freies Depotgeld zurück. Überweisungen ins
  Depot, Kreditkartenabrechnungen und PayPal-Aufladungen zählten dort als
  Ausgaben; jetzt gilt dieselbe Abgrenzung wie im Zahlungsfluss. Der
  Durchschnitt läuft außerdem nur noch über die Tage, für die Buchungen
  vorliegen.
- Behoben: Über Hr. Körner angelegte wiederkehrende Ausgaben wurden mit
  positivem Betrag gespeichert und in der Prognose als Einnahme gezählt.
  Vorhandene Einträge werden beim Update korrigiert.

## 0.52.0 - 2026-09-25

- Behoben: Der Scalable-Abgleich lief seit dem 23.09. ins Leere, weil
  Scalables Depotwert nicht mehr genau aus Wertpapieren und Krypto aufging und
  Fortuna deshalb den ganzen Abgleich verwarf. Enthält der Depotwert das
  Guthaben, rechnet Fortuna es heraus, damit es nicht doppelt ins
  Nettovermögen eingeht; geht er aus anderem Grund nicht auf, übernimmt
  Fortuna Scalables Wert und sagt es dazu.
- Eine einzelne unlesbare Position oder Buchung kostet nicht mehr den ganzen
  Abgleich: Sie wird übersprungen und unter der Verbindung genannt, Depot und
  Guthaben werden trotzdem aktualisiert.
- Die offizielle Scalable-Anbindung ist auf Version 1.1.0 aktualisiert
  (Sicherheitskorrekturen).

## 0.51.1 - 2026-09-25

- Behoben: Eine abgelaufene Scalable-Anmeldung wurde als „gerade nicht
  erreichbar“ gemeldet, obwohl Warten nichts ändert. Jetzt steht dort, dass
  Scalable neu verbunden werden muss.

## 0.51.0 - 2026-09-25

- Ein fehlgeschlagener Scalable-Abgleich sagt jetzt, woran es liegt und was
  zu tun ist: Anmeldung abgelaufen (neu verbinden), Scalable gerade nicht
  erreichbar (Fortuna versucht es in einer Stunde erneut) oder Daten in einer
  Form, die Fortuna nicht verarbeiten kann (Fortuna muss nachziehen). Der
  letzte Bestand bleibt in jedem Fall erhalten.
- Weniger Kleingedrucktes: Erklärungen zu Vergleichswerten, Abgleichen und
  Rechenwegen stehen nur noch einmal und an der Stelle, an der sie helfen —
  nicht mehr im Kopfbereich der Übersicht, in Kennzahlen oder Statuschips.
  „CLI“, „Snapshot“, „Token“ und Produktnamen sind aus Überschriften und
  Statusanzeigen verschwunden.
- Behoben: Ein unbekannter Buchungstyp im Depot hätte seinen internen
  englischen Namen angezeigt; jetzt steht ein Strich.

## 0.50.0 - 2026-09-23

- Anlageberatung im Anlageplan: Liegt Geld frei im Scalable-Depot, rechnet
  Fortuna mit dem ganzen Vermögen im Blick, was damit passieren soll. Zuerst
  die Liquiditätsreserve, dann Ausgaben, die die Prognose schon kommen sieht,
  dann teure Schulden. Erst was danach übrig bleibt, geht nach deiner
  Zielallokation in die untergewichteten Anlageklassen, und zwar in
  Wertpapiere, die schon im Depot liegen.
- Depot durchsehen: Liegt eine Anlageklasse außerhalb ihres Korridors, wird
  sie zuerst mit neuem Geld ausgeglichen. Verkauft wird nur, wenn ein Jahr
  Sparrate dafür nicht reicht, und dann nur bis an den Rand des Korridors,
  mit dem geringsten Gewinn zuerst. Gewinne und Verluste seit Kauf stehen
  daneben, lösen aber nichts aus. Meist lautet die Antwort: so lassen.
- Hr. Körner liest den Vorschlag gegen. Er darf Orders kürzen, streichen oder
  zum Abwarten raten, aber keine erfinden und keinen Betrag erhöhen.
- Am Ende entscheidest du. Eine Freigabe ergibt ein Order-Ticket, das du
  selbst in Scalable platzierst und danach als platziert oder verworfen
  markierst. Fortuna sendet keine Order. Eine abgeschlossene Durchsicht zählt
  als Prüfung des Anlageplans.

## 0.49.0 - 2026-09-21

- Der Ring ist jetzt eine Skala aus feinen Strichen. Bei der Runde des
  Leuchtpunkts flackert jeder Strich kurz auf, den er passiert; beim Einrasten
  auf die Eigenkapitalquote bleiben die Striche innerhalb der Quote erleuchtet,
  ein Lichtring löst sich von der Skala und die Zahl leuchtet einmal auf.
- Der Ring bleibt: nach dem Auftritt verblasst nur der durchgezogene Bogen —
  Striche, Punkt und der dünne äußere Kreis stehen, die Quote bleibt ablesbar.
  Mit der Maus darüber kommt der Bogen zurück, ein Tipp spielt alles erneut.
- Hinter dem Ring liegt ein Lichtschein, der beim Einrasten anschwillt; der
  Punkt zieht auf seiner Runde einen kurzen Schweif.

## 0.48.0 - 2026-09-21

- Die Übersicht bekommt ihren Auftritt: der Ring baut sich auf, der
  Leuchtpunkt dreht eine Runde und legt sich dann auf die Eigenkapitalquote,
  während die Zahl hochzählt. Nach einem Moment löst sich der Ring auf und
  lässt das Nettovermögen allein stehen. Mit der Maus darüber kommt er
  zurück, ein Tipp auf die Zahl spielt ihn noch einmal ab.
- Ein Lichtschein zieht beim Öffnen einmal über den dunklen Kopfbereich;
  Kennzahlen und Schnellzugriffe erscheinen nacheinander statt auf einen
  Schlag.
- Seitenwechsel blenden weich über, die Navigation bleibt dabei stehen.
- Wer im System reduzierte Bewegung eingestellt hat, bekommt nichts davon:
  der Ring steht dann still und bleibt sichtbar.

## 0.47.0 - 2026-09-20

- Neues Erscheinungsbild: tiefes Marineblau, ein leuchtendes Azur und kühle,
  helle Flächen lösen das grüne Zypressen-Thema ab. Die Farben liegen wie
  bisher in `fortuna-brand/`; jede Seite übernimmt sie automatisch.
- Die Übersicht öffnet mit einer leuchtenden Kennzahl: das Nettovermögen steht
  in einem gepunkteten Ring, dessen Füllung die Eigenkapitalquote zeigt —
  wie viel des Vermögens nach Abzug der Verbindlichkeiten übrig bleibt.
  Darunter führen runde Schnellzugriffe zu Konten, Umsätzen, Verlauf und
  Geplantem.
- Die Kontoseite trägt denselben dunklen Kopf: Saldo groß, Stand darunter,
  Kontostand erfassen, Umsätze und Bearbeiten als runde Aktionen.
- Navigation und Anmeldeseite sind dauerhaft dunkelblau — auch im hellen
  Thema, wie der dunkle Kopfbereich einer Bank-App über einer weißen Seite.
- Diagramme, Tabellen und Kennzahlen folgen der neuen Palette. Rot und Grün
  bleiben auf dem Marineblau klar lesbar statt ins Rosa zu kippen.
- Behoben: In der Ringgrafik konnte eine lange Bezeichnung unter den
  Prozentwert rutschen statt umzubrechen.

## 0.46.0 - 2026-09-20

- Neu: KI-Zugriff zum Einfügen. Unter Einstellungen legst du einen Zugang an,
  kopierst den Text und fügst ihn in Claude Code oder Codex ein — der Assistent
  richtet sich damit selbst ein. Keine Konfigurationsdatei von Hand.
- Zugänge sind benannt, einzeln widerrufbar und wahlweise nur lesend oder
  lesend und ändern. Der Zugang ist genau einmal sichtbar; geht er verloren,
  ziehst du ihn zurück und legst einen neuen an.
- Ein Zugang mit Änderungsrecht darf anlegen und bearbeiten — Buchungen,
  Kategorien, Verträge, Budgets, Sachwerte und mehr. Löschen kann er nichts,
  und an Bankverbindungen, gespeicherte Schlüssel oder Hr. Körner kommt er
  nicht heran.
- Ein Nur-Lese-Zugang sieht die Änderungswerkzeuge gar nicht erst.

## 0.45.0 - 2026-09-20

- Das Gespräch mit Hr. Körner läuft jetzt weiter, bis nichts mehr offen ist.
  Bisher hörte er nach einer Rückfrage auf und ließ den größten Posten
  unangetastet — bei 21 offenen Gruppen wurden vier zugeordnet.
- Er übergeht keinen Händler mehr: Jeder bekommt entweder eine Zuordnung oder
  eine Rückfrage. Die größten Beträge kommen zuerst dran, und er stellt bis zu
  drei Fragen auf einmal statt einer.
- Nach jeder Antwort bekommt er die noch offene Liste — abzüglich dessen, was
  du inzwischen selbst zugeordnet hast. Vorher arbeitete er an Erledigtem
  weiter, weil er deine Auswahl im Browser nicht sehen konnte.
- Du siehst, wie viel noch aussteht, und kannst jederzeit weitermachen.

## 0.44.0 - 2026-09-20

- Wird eine wiederkehrende Zahlung teurer, sagt Hr. Körner es: was sie jetzt
  kostet, was vorher, seit wann und was das im Jahr ausmacht. Wie jeder seiner
  Hinweise lässt sich das zurückstellen, vertagen oder als gewollt abhaken.
  Dieselbe Erhöhung wird nie zweimal gemeldet, eine spätere schon.
- Verträge, denen Beginn, Kosten oder Turnus fehlen, bekommen einen Vorschlag
  aus den verknüpften Buchungen: „Fehlt für die Prognose. Laut Buchungen:
  Beginn 15. März 2024 · 1.180,00 € · jährlich." Ein Klick übernimmt es —
  automatisch eingetragen wird nichts.

## 0.43.0 - 2026-09-20

- Die Erkennung findet jetzt auch Zahlungen, die sich einen Händler teilen.
  Unter „Telekom" steckten ein Mobilfunkvertrag um 35 € und Magenta TV für
  10 € — zusammen sahen die Beträge unregelmäßig aus, also wurde beides
  verworfen. Beide werden jetzt getrennt gefunden und so benannt, dass man sie
  auseinanderhält.
- Preiserhöhungen fallen nicht mehr unter den Tisch. Bisher wurde der Betrag
  still nachgeführt; jetzt merkt sich Fortuna, dass etwas teurer geworden ist,
  seit wann, und was das im Jahr ausmacht.
- Nebenbei wird die Prognose genauer: Gerechnet wird mit dem Preis, der jetzt
  gilt, nicht mehr mit dem Mittel über alt und neu — einem Betrag, der nie
  abgebucht wurde.

## 0.42.0 - 2026-09-19

- Verträge zählen jetzt in der Prognose mit. Eine jährliche Versicherung kann
  die automatische Erkennung nie finden — aus ein, zwei Buchungen lässt sich
  kein Rhythmus ableiten —, aber als Vertrag ist sie vollständig beschrieben.
  Fällig wird sie am Jahrestag ihres Beginns und nur bis zum Vertragsende.
- Hängt an einem Vertrag bereits eine erkannte wiederkehrende Zahlung, bleibt
  der Vertrag draußen. Sonst stünde dasselbe Geld zweimal in der Prognose.
- Verträge, denen Beginn, Turnus oder Kosten fehlen, werden nicht stillschweigend
  weggelassen: Der Zahlungsfluss nennt sie samt Grund.
- Weicht ab, was abgebucht wird, von dem, was im Vertrag steht, sagt die
  Vertragsseite das — meist eine Preiserhöhung, von der niemand erzählt hat.

## 0.41.0 - 2026-09-19

- Die Stapelzuordnung fasst Buchungen pro Händler zusammen. Statt fünfzehnmal
  dasselbe für eBay auszuwählen, steht da jetzt „eBay S.a.r.l. · 15 Buchungen ·
  zusammen −842,00 €" mit einem Auswahlfeld für alle. Einzelne Buchungen sind
  weiter einen Klick entfernt, falls eine anders einsortiert gehört.
- Bestehende Buchungen bekommen beim Abgleich einen besseren Text, wenn die
  Bank inzwischen einen liefert. Ersetzt wird nur, was ohnehin nichts aussagt —
  ein ISO-Code wie „PMNT" oder gar nichts. Was du selbst geschrieben hast,
  bleibt.
- Steht in einer Buchung dein eigener Name als Gegenpartei — das schreiben
  Banken, wenn es keine gibt —, wird daraus kein Händler mehr. Vorher liefen
  vier zusammenhanglose Buchungen unter „ALEX BEISPIEL" und wären als ein
  Händler mit eigener Historie behandelt worden.

## 0.40.0 - 2026-09-19

- PayPal ist kein Girokonto. Es gibt jetzt die Kontoart „Bezahldienst"; das
  bestehende PayPal-Konto wird umgestellt. Am Geld ändert sich nichts — es
  zählt weiter als liquide, auch in der Prognose.
- Buchungen ohne Verwendungszweck zeigten „PMNT" — den ISO-Code für „Zahlung",
  den manche Banken statt eines Textes liefern. Betroffen waren unter anderem
  eine Gutschrift über 5.000 €, die damit weder du noch Hr. Körner zuordnen
  konnte. Jetzt steht dort die Gegenpartei, sonst „Ohne Verwendungszweck".

## 0.39.0 - 2026-09-19

- Konten, die über eine Bankverbindung entstehen, heißen jetzt nach ihrer Bank.
  Banken liefern als Kontonamen den Kontoinhaber, weshalb PayPal, Deutsche Bank
  und Sparda-Bank alle „Alex Beispiel" hießen — nicht auseinanderzuhalten, und
  verwechselbar mit einem selbst angelegten Konto gleichen Namens.
- Bestehende Konten werden einmalig umbenannt. Angefasst wird nur, was von
  einer Bankverbindung angelegt wurde und sich seinen Namen mit einem anderen
  Konto teilt; was du selbst benannt hast, bleibt wie es ist.
- Gibt es mehrere Konten bei derselben Bank, kommt die Kontoart dazu
  („Beispielbank · Sparkonto"), sonst die letzten Stellen der IBAN.

## 0.38.0 - 2026-09-19

- PayPal-Zahlungen zählten doppelt. PayPal meldet über die Bankschnittstelle
  nur abgehende Zahlungen, nie die Aufladung — der „PayPal"-Abgang auf dem
  Girokonto und PayPals Zahlung an den Händler sind aber dasselbe Geld. Beide
  standen als Ausgabe im Zahlungsfluss.
- Fortuna erkennt die Paare jetzt über Betrag, Währung und Abstand und bucht
  die Bankseite als „PayPal-Aufladung" um. Gezählt wird nur noch die Zahlung
  an den echten Händler. Was du selbst kategorisiert hast, bleibt unangetastet.
- Beim Bankabgleich läuft das automatisch mit; unter Verbindungen kannst du es
  einmal rückwirkend über die bestehenden Buchungen laufen lassen.

## 0.37.0 - 2026-09-19

- Konten ohne IBAN werden bei einer erneuerten Bankfreigabe wiedererkannt.
  PayPal hat keine IBAN — Enable Banking meldet es mit deiner E-Mail-Adresse —
  und Fortuna hat Konten bisher ausschließlich über die IBAN zugeordnet. Beim
  Erneuern der Freigabe wäre alle 90 Tage ein weiteres PayPal-Konto entstanden,
  jedes davon im Nettovermögen mitgezählt.

## 0.36.0 - 2026-09-19

- Neu: PayPal als eigene Verbindung. Auf dem Kontoauszug steht bei jeder
  PayPal-Zahlung nur „PayPal (Europe) S.à r.l. et Cie, S.C.A." — wer der
  Händler war, weiß nur PayPal selbst. Fortuna liest das jetzt direkt aus,
  inklusive gekaufter Posten, wo PayPal sie mitliefert.
- PayPal läuft als eigenes Konto. Die Aufladung von deiner Bank wird als
  Umbuchung erkannt und fällt aus dem Zahlungsfluss; übrig bleibt die Zahlung
  an den echten Händler. Nichts wird doppelt gezählt.
- Nach jedem Abgleich vergleicht Fortuna den errechneten mit dem von PayPal
  gemeldeten Saldo. Weichen sie ab, steht das rot bei der Verbindung, statt
  dass deine Ausgaben still zu hoch erscheinen.
- Nötig ist ein PayPal-Geschäftskonto mit der Berechtigung „Transaction
  Search"; ein Privatkonto bekommt sie nicht. Gelesen wird in 31-Tage-Schritten,
  nur lesend, und das Secret liegt verschlüsselt.

## 0.35.0 - 2026-09-19

- Die Bankauswahl zeigt nicht mehr nur deutsche Institute. Fortuna hat bisher
  ausschließlich nach deutschen gefragt — PayPal Europe ist aber in Luxemburg
  zugelassen, Revolut in Litauen, bunq in den Niederlanden. Die konnten gar
  nicht erst auftauchen, egal wie gut der Rest funktionierte.
- Institute aus anderen Ländern stehen jetzt mit Länderkürzel in der Liste.
  Ob deine Enable-Banking-Anwendung PayPal tatsächlich anbietet, siehst du
  jetzt direkt in der Auswahl.

## 0.34.0 - 2026-09-19

- Beim Zuordnen kannst du jetzt direkt eine neue Kategorie anlegen: „＋ Neue
  Kategorie …" im Auswahlfeld, Namen tippen, fertig. Bisher musstest du dafür in
  die Einstellungen und hast die angefangene Durchsicht verloren.
- Aus der einmaligen Einschätzung von Hr. Körner ist ein Gespräch geworden. Er
  ordnet zu, was er zuordnen kann, schlägt neue Kategorien vor, wo keine deiner
  bestehenden passt („Vereinsbeitrag" für den Sportverein), und fragt nach, wo
  er es nicht wissen kann — etwa bei Zahlungen an Privatpersonen. Du antwortest
  mit einem Klick oder in eigenen Worten, und er macht damit weiter.
- Angelegt wird eine vorgeschlagene Kategorie erst, wenn du auf „Anlegen"
  drückst. Seine Zuordnungen füllen das Formular vor, angehakt wird nichts.

## 0.33.0 - 2026-09-19

- Für Händler, zu denen es in deinen Daten nichts gibt, kannst du in der
  Stapelzuordnung jetzt Hr. Körner fragen. Er kennt dabei nur den Namen und die
  Richtung der Buchung, und seine Antwort ist als „Vermutung" gekennzeichnet:
  Sie füllt das Auswahlfeld vor, hakt aber nichts an — entschieden wird von dir.
- Gefragt wird nur auf Knopfdruck, einmal je Händler statt je Buchung, und nur
  dort, wo es keine eigenen Anhaltspunkte gibt. Wo du einen Händler bisher
  unterschiedlich zugeordnet hast, fragt Fortuna gar nicht erst.
- Der Knopf erscheint nur, wenn der Copilot verbunden ist. Antwortet er nicht,
  steht das da — statt „nichts gefunden".

## 0.32.0 - 2026-09-19

- Neu: Buchungen zuordnen im Stapel. „Zuordnen lassen" auf der Seite
  Transaktionen zeigt alle Buchungen ohne Kategorie auf einmal, mit Hr. Körners
  Vorschlag und dem Grund daneben.
- Angehakt ist nur, was auf einer Entscheidung beruht, die du schon getroffen
  hast: eine deiner Regeln, ein hinterlegter Händler, eine wiederkehrende
  Zahlung, oder ein Händler, den du bisher immer gleich zugeordnet hast
  („Alle 7 früheren Buchungen von REWE sind „Lebensmittel""). Alles andere
  wählst du selbst.
- Wo du einen Händler bisher unterschiedlich zugeordnet hast, sagt Fortuna das,
  statt so zu tun, als kenne es ihn nicht.
- Gespeichert wird erst, wenn du bestätigst — und dann als deine eigene
  Zuordnung, die keine Regel und keine Erkennung später überschreibt.
- Optional merkt sich Fortuna einen Händler („REWE künftig immer so"), damit
  dieselbe Frage nicht wiederkommt. Standardmäßig aus.
- Die hinterlegte Standardkategorie eines Händlers wurde bisher nirgends
  benutzt. Jetzt schon.

## 0.31.0 - 2026-09-19

Verträge haben jetzt einen Lebenslauf, und Sparmissionen richten sich danach.

- Ein gekündigter Vertrag kostet weiter, bis er wirklich endet. Bisher fiel er
  am Tag der Kündigung aus „Monatliche Kosten" und aus der Liste — oft Monate,
  bevor die letzte Abbuchung kam. Er bleibt jetzt stehen, mit dem Hinweis
  „gekündigt, läuft und kostet noch bis …".
- Ein Vertrag, dessen Enddatum vorbei ist, gilt als beendet, auch wenn niemand
  den Status umgestellt hat.
- Neu: Kündigungsfristen. Fortuna rechnet aus Verlängerungsdatum und Frist aus,
  bis wann du kündigen musst, und warnt rechtzeitig — bisher standen beide
  Felder im Formular, ohne dass irgendetwas sie gelesen hätte.
- Die Prognose hört auf, eine wiederkehrende Zahlung ewig abzubuchen: Endet der
  Vertrag dahinter, endet auch die Zahlung.
- Eine Sparmission kann jetzt mit dem alten Vertrag verknüpft werden. Dann
  beginnt die Ersparnis, wenn dieser Vertrag endet, statt am Tag der Kündigung.
- Sparmissionen zeigen, woran sie gerade sind, statt nur einer Zahl:
  „Läuft an" mit Countdown bis zum Vertragsende, „Rechnet sich bald" mit dem
  Rest der Wechselkosten und dem Datum, ab dem es echtes Plus ist, dann
  „Spart". Bisher stand in beiden Fällen 0,00 € — eine Mission, die gut lief,
  sah aus wie eine, die feststeckte.

## 0.30.0 - 2026-09-18

Sieben typische Wege durch die App, im Browser nachgelaufen. Was dabei auffiel:

- Ein inaktives Konto verschwand aus der Kontenliste und aus deren Summe, blieb
  aber im Nettovermögen — und die Kontoseite behauptete weiter „Im
  Nettovermögen: Ja". Inaktiv heißt jetzt überall dasselbe, wie bei
  Gegenständen und Forderungen schon immer.
- „Regel anlegen" beim Kategorisieren sagte, sie gelte für künftige Buchungen,
  ordnete aber auch ältere Buchungen ohne Kategorie neu zu — und die Regelliste
  zeigte danach „0 Treffer". Die Meldung nennt jetzt die Zahl, die Regel zählt
  sie, und sie heißt nach dem Händler statt „Kiosk → Kategorie".
- Ein Budget, das du direkt in der Liste änderst, wurde beim Klick daneben
  stillschweigend verworfen — ohne Speichern-Knopf war das der einzige Weg,
  fertig zu werden. Es wird jetzt gespeichert und bestätigt.
- In „Budget hinzufügen" standen Unterkategorien unter der falschen
  Überschrift; „Kleidung" sah aus, als gehöre es zu „Versicherungen".
- „Entfernen" fragt jetzt, ob das Budget aus allen Monaten verschwinden soll —
  denn genau das tut es.
- Die Kosten-Checks boten an, eine günstigere Alternative für Miete, Hypothek,
  Autokredit und Sparplan zu suchen, und die Vorschau zeigte schon vor der
  ersten Eingabe „5 Jahre +76.800 €" fürs Nichtzahlen der Miete.
- Der Anlageplan sagte „0 % Aktien" und nannte zwei Kästen weiter einen
  Welt-ETF als größte Position. Er sagt jetzt, welche Positionen unter
  „Sonstige" landen und wo du das änderst. Prozentwerte lauten dort nicht mehr
  „75.5 Prozent", sondern „75,5 Prozent".
- „Letzte Transaktionen" auf der Übersicht führte mit einer Zahlung, die erst
  in zwölf Tagen kommt. Sie ist jetzt als solche gekennzeichnet.
- Der Kontoverlauf beschriftete Jahresschritte mit Tag und Monat ohne Jahr, was
  aussah, als liefe die Zeit rückwärts.
- Der Kategorievergleich im Zahlungsfluss verglich gegen einen Zeitraum, in dem
  fast nichts erfasst war, und meldete „+1.813,5 %". Er sagt jetzt, dass ein
  Vergleich nicht möglich ist.
- Kleinigkeiten: „Kreditrahmen" erscheint nur noch bei Kreditkarten, Verträge
  melden nicht mehr „0/0 — 100 Prozent erreicht", der Meilenstein unter
  Optimierung zeigt nichts mehr an, solange nichts gespart wurde, und die
  Kontenübersicht zählt nur verbundene Depots als Depots.

## 0.29.0 - 2026-09-18

Diese Version korrigiert Zahlen, die anders hießen als sie gemeint waren.

- Ein CSV-Import löschte das selbst eingetragene Fälligkeitsdatum jeder
  wiederkehrenden Zahlung, die noch keine gebuchte Buchung hat. Die Prognose
  belastete die Jahresrechnung daraufhin am ersten Tag. Selbst gepflegte
  Termine bleiben jetzt stehen.
- Wiederkehrende Zahlungen ohne Konto („Beliebig", die Vorgabe des Formulars)
  fehlten in der Prognose, obwohl daneben „in der Prognose enthalten" stand.
  Sie zählen jetzt mit.
- „Gewinn (selbst erfasst)" erfand Verluste: Der Kaufwert einer Position ohne
  Kurs zählte mit, ihr Wert nicht. Ohne Kurs zählt jetzt beides nicht.
- Rückblick, Hr. Körners Wochenbericht und die beiden Veränderungstabellen
  unter „Nettovermögen" zeigten den Depotwert als Zuwachs. Sie sagen jetzt,
  warum die Zahl fehlt – wie es die Übersicht und die Kopfzeile schon taten.
- „Breite Streuung" im Anlageplan galt als nicht erfüllt, sobald Depotbestände
  im Spiel waren. Für sie ist schlicht nicht hinterlegt, ob sie breit gestreut
  sind; der Punkt bleibt jetzt offen und nennt die Positionen.
- Verträge mit Turnus „individuell" wurden in „Monatliche Kosten" wie
  monatliche behandelt – ein Jahresvertrag über 1.200 € schlug mit 1.218 €
  im Monat zu Buche. Sie bleiben jetzt draußen und werden gezählt.
- Ein Szenario mit drei Jahren Horizont zeigte unter „5 Jahre" den Dreijahres-
  wert. Einmalige Ereignisse dieses Monats wurden auf den heutigen Stand
  gebucht, sodass die Kurve unter dem Nettovermögen der Übersicht startete.
- Ein Budget für einen früheren Monat überlappte ein bestehendes und
  verdoppelte „Budgetiert".
- „Datenstand" nennt jetzt auch veraltete oder fehlende Wechselkurse, sagt wie
  viele Einträge nicht in die Liste passen und lässt Wertpapiere weg, die du
  nicht mehr hältst.

## 0.28.0 - 2026-09-18

- Die Übersicht zeigt keine Veränderungen und keine Jahresrate mehr, solange
  für das Scalable-Depot keine Vergangenheitswerte vorliegen. Bisher erschien
  der gesamte Depotwert als Zuwachs – bei „1 Tag“, „1 Woche“, „1 Monat“ und
  „seit Jahresbeginn“ jeweils derselbe Betrag. Die Seite sagt jetzt, warum die
  Felder leer bleiben; das Nettovermögen tat das bereits.
- Der Anlageplan berücksichtigt jetzt auch die Bestände im Depot. Wer seine
  Wertpapiere bei Scalable hält, bekam bisher „0 % Aktien“ angezeigt und den
  Rat, alles in Aktien umzuschichten, die er bereits besaß.
- „Prüfung abschließen“ heißt jetzt „Durchsicht bestätigen“ und sagt vorher,
  dass Fortuna dabei nichts selbst prüft, sondern nur das Datum festhält.

## 0.27.0 - 2026-09-18

- Auf dem Telefon wird die Positionsliste unter Wertpapiere als Karte je Zeile
  dargestellt: jede Angabe mit Bezeichnung in einer eigenen Zeile. Bisher waren
  42 Prozent der Tabelle nicht sichtbar, und Beträge endeten mitten in der
  Zahl. Auf größeren Bildschirmen bleibt die Tabelle unverändert.

## 0.26.1 - 2026-09-18

- Neuer Befehl `bun run smoke`: Er öffnet jede angemeldete Seite in einem
  Browser und meldet Fehlerseiten, abgebrochene Ladevorgänge und Serverfehler.
  Die reinen Code-Prüfungen laden keine Seite und hätten die defekte
  Vertragsseite nie bemerkt.

## 0.26.0 - 2026-09-18

- Die Umbuchungserkennung liest nicht mehr bei jedem Import die gesamte
  Historie, sondern nur das Zeitfenster um die neu hinzugekommenen Buchungen.
  Beide Seiten einer Umbuchung liegen ohnehin höchstens drei Tage auseinander;
  auch ein nachträglicher Import alter Buchungen wird weiterhin zugeordnet.
  Die vollständige Prüfung über alle Buchungen bleibt über „Umbuchungen
  erkennen“ verfügbar.
- Die Transaktionssuche nutzt jetzt einen Index statt jede Buchung zu lesen.

## 0.25.1 - 2026-09-18

- Ein Test prüft jetzt, dass keine Seite ein Node-Modul in den Browser zieht.
  Genau daran war die Vertragsseite unbenutzbar, während alle Prüfungen grün
  blieben; der Test nennt im Fehlerfall die Importkette.

## 0.25.0 - 2026-09-18

- Verträge lassen sich jetzt löschen. Die Abfrage nennt, wie viele hinterlegte
  Dateien dabei mit entfernt werden; die verschlüsselten Dokumente werden auch
  aus dem Objektspeicher gelöscht.
- Beendete und gekündigte Verträge erscheinen nicht mehr in der Liste, sondern
  erst auf Wunsch. Die Summen zählten sie ohnehin nie mit.
- Die Demodaten werden vollständig zurückgesetzt. Bisher blieben Forderungen,
  Verträge, Szenarien, Optimierungen, Verbindungen und Einstellungen stehen,
  sodass der Datensatz sich selbst widersprach.

## 0.24.1 - 2026-09-18

- Eine IBAN gehört jetzt zu genau einem Konto. Damit kann ein Bankabgleich kein
  zweites Konto für eine bereits vorhandene IBAN anlegen, dessen Saldo im
  Nettovermögen zusätzlich gezählt würde.
- Dasselbe Dokument kann nicht mehr zweimal an denselben Vertrag gehängt
  werden. Die Regel galt bisher nur in der Entwicklungsdatenbank.

## 0.24.0 - 2026-09-18

- Aufräumen: zehn Schnittstellen ohne Aufrufer, ein MCP-Werkzeug, das exakt
  dasselbe lieferte wie ein anderes, und einige tote Hilfsfunktionen sind
  entfernt. Gespeicherte Daten und Spalten bleiben unverändert.
- Die Werkzeugliste unter Einstellungen wird jetzt aus der tatsächlichen
  Werkzeugtabelle erzeugt. Die handgepflegte Liste war zwei Einträge veraltet.
- Eine erkannte wiederkehrende Zahlung kann nicht mehr doppelt angelegt werden.
  Vorhandene Doppel werden beim Update zusammengeführt, Buchungen und Verträge
  zeigen danach auf den verbleibenden Eintrag.
- Findet der Bankabgleich zu einer IBAN mehrere vorhandene Konten, legt er kein
  weiteres an. Ein zusätzliches Konto hätte im Nettovermögen doppelt gezählt.

## 0.23.2 - 2026-09-18

- Auf schmalen Bildschirmen wurden die Schaltflächen im Seitenkopf auf gleiche
  Breite gezwungen und waren damit schmaler als ihre eigene Beschriftung. Der
  Text lief aus der Schaltfläche heraus über die nächste; auf „Transaktionen“
  fehlte der erste Buchstabe. Die Schaltflächen behalten jetzt ihre Breite und
  rutschen in die nächste Zeile.
- Die Kategorieauswahl in der Transaktionsliste schnitt lange Kategorienamen
  mitten im Wort ab, ebenso die Sortierauswahl ihre eigene Voreinstellung.
- Die Jahreszahlen unter den Diagrammen berührten sich auf dem Telefon und
  lasen sich als eine Zeichenfolge. Der Mindestabstand richtet sich jetzt nach
  der tatsächlichen Breite einer Monatsbeschriftung.

## 0.23.1 - 2026-09-18

- Ein zweites Budget für dieselbe Kategorie beendet jetzt das vorherige, statt
  sich dauerhaft mit ihm zu überlappen. Bisher zählte die Monatssumme beide
  Beträge, während die Ausgaben nur einmal zählten.
- Lässt sich der Kontostand einer Bank nicht lesen, behauptet Fortuna kein
  Datum mehr dafür. Das Konto bleibt damit als zu prüfen sichtbar, statt mit
  einem erfundenen Stand von 0,00 € von heute im Nettovermögen zu stehen.
- „Kategorie löschen“ sagt jetzt, dass Budgets und Regeln dieser Kategorie
  mitgelöscht werden. Buchungen bleiben erhalten.
- Wertpapierpositionen werden centgenau bewertet; Menge mal Kurs lief bisher
  über eine Fließkommarundung.
- Die Händlersuche und der Händlerfilter haben einen Index bekommen. Eine
  ungenutzte Auswertung, die Beträge verschiedener Währungen addierte, ist
  entfernt.

## 0.23.0 - 2026-09-18

- Eine überfällige wiederkehrende Zahlung wurde in der Prognose doppelt
  berechnet, wenn ihr Rhythmus genau auf den ersten Tag des Zeitraums fiel –
  also bei einer wöchentlichen Zahlung an einem von sieben Tagen. Der
  Tiefpunkt lag dadurch um eine volle Rate zu niedrig.
- Vorgemerkte Buchungen, die im Kontostand der Bank bereits enthalten sind,
  zählen in der Prognose nicht mehr zusätzlich als künftige Bewegung.
- Der Abrufabstand richtet sich jetzt danach, ob eine Bank tatsächlich ein
  Limit meldet, und nicht mehr danach, ob Fortuna Anwesenheitsnachweise senden
  konnte. Meldet eine Bank trotz Nachweis ein Limit, gilt für sie wieder der
  Sechs-Stunden-Abstand.
- Eine Freigabe ohne Konten wird nicht mehr bei jedem Seitenaufruf erneut
  abgefragt. Die Kontenliste steht bei der Freigabe fest; erneutes Lesen kann
  daran nichts ändern und verbraucht nur Abrufe.
- Ist die Anbieterliste kurz nicht erreichbar, scheitert der Abgleich nicht
  mehr daran. Er läuft dann ohne Anwesenheitsnachweis weiter.
- Nach einer bestätigten Freigabe mit fehlgeschlagenem Erstabruf erscheint
  wieder die richtige Meldung statt eines allgemeinen Fehlers.
- Budgets: Ober- und Unterbudget werden in der Monatssumme nicht mehr doppelt
  gezählt. Budget und Ausgaben beziehen sich wieder auf dieselbe Menge.

## 0.22.9 - 2026-09-18

- Fortuna bevorzugt jetzt den erwarteten Saldo (ISO 20022 XPCD) vor dem
  Schlusssaldo des letzten Abrechnungszeitraums. Die Deutsche Bank liefert
  keinen tagesaktuellen gebuchten Saldo; der Schlusssaldo bleibt den ganzen Tag
  auf dem Stand der letzten Nacht und zeigte deshalb 0,00 €.
- Verfügbarkeitssalden bleiben nachrangig: Sie können einen eingeräumten Dispo
  enthalten, der kein Guthaben ist.

## 0.22.8 - 2026-09-18

- Die Bankdiagnose zeigt jetzt, wie viele Buchungen eines Kontos gebucht und
  wie viele vorgemerkt sind und auf welchen Stichtag sich der Saldo bezieht.
  Damit lässt sich ein veralteter Saldo von einem Konto unterscheiden, auf dem
  das Geld schlicht noch nicht gebucht ist. Beträge werden nicht protokolliert.

## 0.22.7 - 2026-09-18

- Fortuna verwendet jetzt den tagesaktuellen gebuchten Kontostand statt des
  Schlusssaldos des letzten Bankarbeitstags. Ein Konto, auf dem heute Geld
  eingegangen ist, zeigte dadurch noch den Stand von gestern – bei einem neuen
  Konto also 0,00 €, obwohl die Buchung bereits sichtbar war.
- Verfügbarkeitssalden werden weiterhin nachrangig behandelt, weil sie einen
  eingeräumten Dispo enthalten können, der kein Guthaben ist.

## 0.22.6 - 2026-09-18

- Eine Bankfreigabe, die zweimal zurückgemeldet wird, gilt nicht mehr als
  Fehler. Der erste Aufruf erledigt die Arbeit; der zweite meldete bisher einen
  Fehlschlag für eine Anmeldung, die gerade erfolgreich war.
- Ein Kontostand, den Fortuna nicht lesen kann, wird nicht mehr als 0,00 €
  verbucht. Eine erfundene Null als heutiger Stand hätte jede importierte
  Buchung dauerhaft daran gehindert, den Saldo zu bewegen.
- Die Diagnose hält fest, welche Saldoarten die Bank geliefert hat und ob
  Betrag und Stichtag lesbar waren. Der Betrag selbst wird nicht protokolliert.

## 0.22.5 - 2026-09-18

- Bei einer Freigabe ohne Konto bietet Fortuna kein „Abgleichen“ mehr an. Die
  Kontenliste steht bei der Freigabe fest, ein Abgleich kann sie nicht ändern;
  nötig ist eine neue Verbindung. Der Hinweis sagt das jetzt auch.

## 0.22.4 - 2026-09-18

- Der Hinweis zu einer Freigabe ohne Konto nennt jetzt die wahrscheinliche
  Ursache: Eine Enable-Banking-Anwendung im eingeschränkten Modus liefert nur
  Konten, die im Control Panel verknüpft wurden. Ohne Verknüpfung bestätigt die
  Bank die Freigabe, die Kontenliste bleibt aber leer.

## 0.22.3 - 2026-09-18

- Der Hinweis zu einer Freigabe ohne Konto ist korrigiert. Welche Konten eine
  Bankfreigabe umfasst, legt die Bank bei der Anmeldung fest; ein späterer
  Abgleich findet ein neu verfügbares Konto nicht. Fortuna sagt jetzt, dass
  dafür neu verbunden werden muss, statt auf den nächsten Abgleich zu vertrösten.

## 0.22.2 - 2026-09-18

- Die Diagnose hält fest, ob eine Bank die Anwesenheitsnachweise verlangt,
  welche davon Fortuna gesendet hat und ob der Abruf damit als anwesend galt.
  Adresse und Browserkennung selbst werden weiterhin nur an die Bank
  übermittelt und nie protokolliert.

## 0.22.1 - 2026-09-18

- Eine gültige Bankfreigabe, zu der die Bank noch kein Konto teilt, gilt nicht
  mehr als Fehler. Die Verbindung bleibt aktiv und erklärt, dass neue Konten
  oft erst nach einigen Tagen für den Zugriff freigegeben werden. Sobald die
  Bank das Konto teilt, übernimmt Fortuna es beim nächsten Abgleich von selbst.

## 0.22.0 - 2026-09-18

- Bankabgleiche laufen nur noch, während du in Fortuna angemeldet bist, und
  sagen der Bank das auch. PSD2 begrenzt nur Abrufe ohne dich; Abrufe, die du
  auslöst, sind unbegrenzt. Fortuna übermittelt dafür die Angaben deines
  Browsers als Anwesenheitsnachweis.
- Dadurch gleicht Fortuna Konten alle fünf Minuten statt alle 15 ab, solange du
  die App offen hast. Akzeptiert eine Bank die Anwesenheit nicht, bleibt es bei
  sechs Stunden, damit die erlaubten vier Abrufe pro Tag den Tag abdecken.
- Fortuna merkt sich pro Verbindung, wie die Bank reagiert hat, und wählt den
  Abstand entsprechend. Adresse und Browserkennung werden ausschließlich an die
  Bank übermittelt und niemals protokolliert.

## 0.21.6 - 2026-09-18

- Die Bankdiagnose hält jetzt fest, an welches Institut und mit welchem
  Anmeldetyp eine Freigabe tatsächlich ging und welchen Umfang die Bank
  gewährt hat. Kontodaten bleiben weiterhin ungeloggt.

## 0.21.5 - 2026-09-18

- Fortuna fordert bei der Bankfreigabe jetzt ausdrücklich Kontostände und
  Umsätze an. Ohne diese Angabe überlässt die Schnittstelle den Umfang der Bank,
  und die Deutsche Bank bestätigte die Freigabe daraufhin ohne ein einziges
  Konto. Bestehende Freigaben müssen dafür einmal neu erteilt werden.

## 0.21.4 - 2026-09-18

- Bestätigt die Bank eine Freigabe, ohne ein Konto dafür freizugeben, sagt
  Fortuna das jetzt deutlich und weist darauf hin, bei der Bankanmeldung
  ausdrücklich ein Konto auszuwählen.
- Die Diagnose unterscheidet, ob die Bank wirklich keine Konten geliefert hat
  oder ob die Antwort eine unbekannte Form hat: Es werden Anzahl und Feldnamen
  der Einträge protokolliert, weiterhin keine Kontodaten.

## 0.21.3 - 2026-09-18

- Das Ergebnis einer Bankanmeldung bleibt nicht mehr in der Adresse stehen.
  Bisher zeigte jedes erneute Laden der Verbindungsseite dieselbe alte Meldung
  „Bankverbindung konnte nicht abgeschlossen werden“, auch wenn seitdem nichts
  passiert war.

## 0.21.2 - 2026-09-18

- Konten einer Bankfreigabe werden jetzt aus beiden von Enable Banking
  dokumentierten Feldern gelesen. Bisher las Fortuna nur `accounts`; liefert die
  Bank die Konten in `accounts_data`, galt die Freigabe fälschlich als leer.
- Bleibt eine Freigabe wirklich ohne Konten, nennt die Meldung den
  Sitzungsstatus der Bank, statt nur „keine Konten übermittelt“ zu sagen.
- Die Diagnose protokolliert Sitzungsstatus, Kontenanzahl und die Feldnamen der
  Antwort. Kontodaten, Kennungen und Anbieterantworten bleiben ungeloggt.

## 0.21.1 - 2026-09-18

- Eine bestätigte Bankfreigabe geht nicht mehr verloren, wenn die Bank in der
  Rückmeldung noch keine Kontenliste mitschickt. Fortuna behält die Sitzung und
  liest die Konten beim nächsten „Abgleichen“ direkt aus der Freigabe nach.
- Scheitert eine Rückmeldung doch, nennt Fortuna den tatsächlichen Grund. Bisher
  stand immer „Bankfreigabe wurde nicht abgeschlossen“, auch wenn die Freigabe
  bei der Bank erteilt war und erst der erste Abruf fehlschlug.
- Die Diagnose protokolliert den Grund als festen Code. Bankdaten, Sitzungen und
  Anbieterantworten stehen weiterhin in keinem Protokoll.

## 0.21.0 - 2026-09-18

Vier Prüfläufe durch Finanzlogik, Serverdienste, Oberfläche und
Anbieteranbindungen. Die wichtigsten Korrekturen:

- Die Seite „Verträge“ ließ sich überhaupt nicht öffnen und zeigte nur die
  Fehlerseite. Ursache war ein Node-Modul, das über einen Import im Browser
  landete.
- Das Nettovermögen war zu hoch, wenn eine Verbindlichkeit mit einem Konto
  verknüpft ist, das nicht mitzählt oder im Rückblick noch nicht existierte.
  Die Schuld wird jetzt gezählt, statt zu verschwinden.
- Die Prognose zählte eine vorgemerkte Buchung doppelt, wenn sie zu einer
  wiederkehrenden Zahlung gehört. Der Tiefpunkt lag dadurch um eine volle
  Rate zu niedrig.
- Hr. Körners Hinweise zu anstehenden großen Zahlungen und zu vielen kleinen
  Abos konnten nie erscheinen: Sie verglichen negative Beträge mit positiven
  Schwellen.
- Monatliche Termine am Monatsende wanderten dauerhaft nach vorn: Aus dem 31.
  wurde im Februar der 28. und blieb es.
- Die Monatslinks im Zahlungsfluss führten für Februar, April, Juni, September
  und November auf die Fehlerseite.
- Summen in Sachwerten, Verbindlichkeiten, Wiederkehrend, Verträgen und
  Optimierung addierten verschiedene Währungen zu einem Euro-Betrag.
  Optimierung zeigte außerdem alle Beträge in der Basiswährung statt in der
  des Eintrags.
- Prozentwerte und Achsenbeschriftungen erschienen mit englischem Dezimalpunkt
  („3.75%“, „1.5k“).
- Wird eine Umbuchung gelöscht oder ihr Betrag geändert, ist die Gegenbuchung
  wieder eine normale Buchung. Bisher blieb sie als Umbuchung stehen und fehlte
  dauerhaft im Zahlungsfluss.
- Budget-Summen zählten eine Buchung doppelt, wenn Ober- und Unterkategorie
  ein Budget haben. Beträge werden beim Löschen der letzten Bewertung nicht
  mehr als Sachwert stehen gelassen.
- „Kurse aktualisieren“ hätte nie etwas tun können und ist entfernt; Kurse
  werden manuell gepflegt.
- Szenario-Regel löschen, Schätzung entfernen sowie Kataster und Remise trennen
  fragen jetzt nach. Tabellenzeilen lassen sich mit der Tastatur bedienen.
- Fehlermeldungen von Kataster und Remise enthalten keine Antwortinhalte des
  Anbieters mehr, weder in der App noch in den Protokollen.
- Beträge mit halben Cent werden korrekt gerundet, und ein unlesbarer Betrag im
  CSV-Import wird gemeldet statt als 0,00 € übernommen.

## 0.20.6 - 2026-09-18

- Scalable wird nur noch über die offizielle CLI im Fortuna-Server
  abgeglichen. Der lokale CLI-Relay und der CSV-Upload sind entfernt: beide
  waren zweite Wege zum selben Ergebnis, der CSV-Leser wurde nie mit einem
  echten Scalable-Export geprüft. Früher importierte Daten bleiben lesbar.
- Bankverbindungen laufen ausschließlich über Enable Banking. Der bisher
  dauerhaft deaktivierte „Verbinden“-Knopf oben rechts öffnet jetzt diesen
  Weg; der Demo-Adapter, der Testbuchungen anlegen konnte, ist entfernt.
- „Kurse aktualisieren“ und das Feld „Referenz beim Kursanbieter“ sind
  entfernt. Es gab keinen Kursanbieter, die Meldung lautete immer „0 Kurse
  aktualisiert“. Wertpapierkurse werden weiterhin manuell gepflegt.
- Die Regel-Option „als Umbuchung markieren“ ist entfernt. Sie ließ sich nie
  setzen und wurde auch nirgends ausgewertet; eine Regel kennzeichnet eine
  Umbuchung über eine Kategorie der Art „transfer“.
- Kosten, Abrechnung und Marge aus Kataster stehen nur noch unter
  Optimierung, Depotwert und Positionen nur noch unter Konten → Depots. Die
  Verbindungsseite zeigt, was zur Einrichtung gehört.

## 0.20.5 - 2026-09-18

- „Trennen“ lässt keine leere Bankverbindung mehr in der Liste zurück. Eine
  Verbindung ohne angelegte Konten verschwindet sofort; alle übrigen lassen
  sich mit „Entfernen“ endgültig aus der Liste löschen.
- Beim Entfernen bleiben Konten und Transaktionen vollständig erhalten. Sie
  verlieren nur die Anbieterverknüpfung und werden als manuell geführt. Wird
  dieselbe Bank später erneut verbunden, erkennt Fortuna das Konto an IBAN und
  Währung wieder und legt es nicht doppelt an.

## 0.20.4 - 2026-09-18

- Eine noch offene Bankfreigabe kann nicht mehr per „Abgleichen“ als Fehler
  behandelt werden. Fortuna zeigt, dass die Bankanmeldung erst abgeschlossen
  werden muss; eine verspätete Rückkehr von der Bank wird weiter angenommen.
- Neue Bankfreigaben zeigen Fehler beim ersten Kontoabruf zuverlässig an.
  Diagnoseprotokolle nennen nur den fehlgeschlagenen Schritt und eine sichere
  Fehlerklasse, keine Bankdaten oder Zugangsdaten.
- Bei einer erneuten Enable-Banking-Freigabe erkennt Fortuna ein bestehendes
  Konto an IBAN und Währung und übernimmt es ohne doppelte Buchführung. Das
  tatsächliche Ende der Bankfreigabe wird angezeigt.

## 0.20.3 - 2026-09-17

- Geänderte Scalable-Brokerbuchungen mit derselben Anbieter-ID werden bei
  übereinstimmender Identität aktualisiert. Die vorherige Version bleibt
  verschlüsselt für die Prüfung erhalten. Widersprüchliche Identitäten werden
  zurückgehalten, während Depotwert und Guthaben weiter abgeglichen werden.
- Nach einem Banklimit (HTTP 429) verhindert Fortuna auch manuelle Abrufe bis
  zum angezeigten Retry-Zeitpunkt. Die letzten Kontostände bleiben erhalten;
  Fehlerdiagnosen enthalten nur freigegebene Status- und Vorgangsklassen.

## 0.20.2 - 2026-09-17

- Die Übersicht sieht wieder aus wie vor dem Scalable-Marktpuls. Das
  Nettovermögen zählt beim Öffnen mit Fortunas gewohnter Animation hoch und
  reagiert frühestens zwei Sekunden später mit derselben Animation auf den
  tatsächlich gelesenen Depotkurs, auch nach unten.
- Zusätzliche Live-Beschriftungen, Kursdetails und die separate Marktpuls-Karte
  sind aus der Übersicht entfernt. Depotabgleich und Sicherheitsgrenzen
  bleiben unverändert.

## 0.20.1 - 2026-09-17

- Ein neuer vollständiger Scalable-Abgleich setzt den kursindikativen Aufschlag
  sofort aus, bis er zum aktualisierten bestätigten Vermögensstand neu
  berechnet wurde. So stehen während eines Abgleichs keine Werte aus
  unterschiedlichen Depotständen nebeneinander.

## 0.20.0 - 2026-09-17

- Die Übersicht zeigt bei frischen offiziellen Scalable-Kursen ein klar als
  indikativ markiertes Nettovermögen. Die Zahl bewegt sich sekündlich zum
  tatsächlich gelesenen Kursstand; es werden keine Kurse simuliert. Der
  bestätigte Wert und dessen Vermögenshistorie bleiben unverändert.
- „Wer war’s?“ zeigt die Kursbeiträge einzelner Depotpositionen. Käufe,
  veraltete Kurse und nicht bewertbare Positionen werden nicht als Kursbewegung
  ausgegeben. Hr. Körner kommentiert den Befund knapp; ein hinterlegtes
  Vermögensziel erhält eine lineare, als Schätzung gekennzeichnete Zieluhr.
- Bei geöffneter App und frischem Kurs nach 22:15 Uhr wird ein separater
  Tagesabschluss erfasst. Ohne Anwesenheit oder frischen Kurs gibt es keinen
  erfundenen Abschluss. Ein Kaufsimulator und Handelsfunktionen gehören nicht
  zu diesem Release.

## 0.19.4 - 2026-09-17

- Das Seitenmenü lässt sich anpassen. Ausgeblendete Bereiche bleiben über
  direkte Links erreichbar; die Auswahl wird im Benutzerkonto gespeichert.
- Jedes Konto zeigt seine vollständige, seitenweise durchblätterbare
  Buchungshistorie. Die globale Transaktionsseite macht die Historie aller
  Bankkonten sichtbar und führt Depotbuchungen separat mit eigener Pagination,
  ohne sie dem Bank-Zahlungsfluss zuzuschlagen.

## 0.19.3 - 2026-09-17

- Der von Scalable gemeldete Krypto-Gesamtwert erscheint nun separat im Depot,
  wenn die CLI dafür keine einzelnen Positionen liefert. Er war bereits im
  Depotgesamtwert enthalten und wird nicht ein zweites Mal gezählt.

## 0.19.2 - 2026-09-17

- Scalable-Depots stehen unter Konten und öffnen eine eigene Ansicht mit allen
  Positionen und seitenweise aufgelisteten Brokerbuchungen. Die Darstellung
  verwendet den bereits gezählten Depotbestand und erzeugt keinen zweiten
  Vermögenswert.
- Bei einem Banklimit (HTTP 429) wartet der automatische Abgleich sechs
  Stunden statt stündlich erneut anzufragen. Der letzte Kontostand bleibt
  erhalten; Fehler und nächster Versuch erscheinen ohne rohe Anbieterantwort.

## 0.19.1 - 2026-09-17

- Körners Prüfung wartet nach dem Scalable-Abgleich auf den tatsächlich
  abgeschlossenen Depot-Sync. Das Vermögensziel zeigt Zielwert, Abstand und
  eine ausdrücklich lineare Sparratenrechnung statt einer Renditeprognose.

## 0.19.0 - 2026-09-17

- Herr Körner prüft Finanzdaten beim angemeldeten Besuch auf belegbare
  Auffälligkeiten und zeigt sie mit Grundlage, Sicherheit und Entscheidung im
  neuen Prüfbereich an. Ausblenden, als absichtlich markieren und Pausieren
  ändern keine Bank- oder Vertragsdaten.
- Unter Einstellungen lassen sich Liquiditätsreserve, Vermögensziel, Sparrate,
  Ausgabenschwellen und ignorierte Kategorien ausdrücklich festlegen. Der
  Wochenbericht zeigt Zahlungsfluss und Vermögensänderung nur mit belastbarer
  Vergleichsbasis.
- Das bestehende Gespräch nutzt Finanzregeln, Beobachtungen und einen
  typisierten Wochenbericht. Zahlungen, Orders und Kündigungen bleiben
  außerhalb von Körners Aktionsmöglichkeiten.

## 0.18.2 - 2026-09-17

- Scalable lässt sich direkt in Fortuna mit dem Gerätecode der offiziellen CLI
  freigeben. Nach der persönlichen Scalable-Bestätigung speichert Fortuna die
  Sitzung verschlüsselt und gleicht Depot, Guthaben und Buchungen automatisch
  beim Öffnen ab; ein manueller Abgleich bleibt möglich.
- Der bisherige lokale Relay ist nur noch ein optionaler Fallback. Fortuna
  entschlüsselt Scalable-Zugangsdaten ausschließlich für fest vorgegebene
  Lesebefehle in einem kurzlebigen, speicherbasierten Arbeitsverzeichnis.
- Die echte JSON-Hülle der Scalable CLI wird korrekt verarbeitet. Handelsbefehle
  bleiben aus Fortuna ausgeschlossen.

## 0.18.1 - 2026-09-17

- Scalable-Depotwerte und Guthaben zählen jetzt zum Nettovermögen. Auch
  geschätzte oder veraltete Werte bleiben sichtbar und wirksam; fehlende
  Geldwerte werden nicht erfunden.
- Die offizielle Scalable CLI kann per lokalem Leseskript Depot, Guthaben und
  Transaktionen an Fortuna übergeben. CSV bleibt als Rückfallebene erhalten.
- Verbindungen und Wertpapiere zeigen Herkunft, Bewertungszeitpunkt und
  Datenalter. Ein ausdrücklich verknüpftes manuelles Konto wird nicht doppelt
  gezählt.

## 0.18.0 - 2026-09-17

- Scalable-Transaktionen lassen sich über den offiziellen CSV-Export wiederholt
  importieren. Buchungen und daraus geschätzte Positionen bleiben getrennt
  vom belegten Depotwert und verändern das Nettovermögen nicht.
- Die Verbindung zeigt Importstatus und Fehler; Körners Lesewerkzeuge sehen
  die importierten Investmentbuchungen getrennt von Bankumsätzen.

## 0.17.7 - 2026-09-16

- Die großen Geldbeträge in Übersicht, Nettovermögen und Rückblick zählen beim
  Öffnen und bei Änderungen sanft zum aktuellen Wert hoch. Bei reduzierter
  Bewegung erscheinen sie sofort.

## 0.17.6 - 2026-09-16

- Diagrammachsen zeichnen keine Werte mehr außerhalb des sichtbaren Bereichs.
  Datumsbeschriftungen bleiben innerhalb der Karte und überlagern keine
  Hinweise darunter.
- Monatsbeschriftungen bekommen genügend Abstand; schwebende Werteboxen passen
  auch in schmale Karten.

## 0.17.5 - 2026-09-16

- Die Vermögensgrafik nutzt mehr Platz für ihre Flüsse; lange Positionsnamen
  bleiben durch Zeilenumbruch lesbar.
- Forderungen zeigen ihren aktuellen Betrag auch im Seitenmenü.
- Statt einer unklaren Datenqualitätszahl nennen Übersicht und Rückblick
  veraltete oder undatierte Positionen samt Grund und direktem Einstieg.

## 0.17.4 - 2026-09-16

- Die Buchhalterprüfung verschwindet aus dem Copilot-Chat. Körners Gedächtnis
  öffnet sich über einen kleinen Button neben „Neuer Chat“.
- Fehlgeschlagene automatische Bankabgleiche werden nicht mehr bei jedem
  Neuladen erneut versucht. Fortuna wartet eine Stunde, zeigt das Ergebnis
  verständlich an und protokolliert sichere Fehlermerkmale; „Abgleichen“ unter
  Verbindungen bleibt jederzeit möglich.

## 0.17.3 - 2026-09-16

- Der Copilot-Stream sendet sofort und während längerer Denkphasen kleine
  Lebenszeichen. So bleibt die Verbindung offen, bis Körner antwortet oder die
  Anfrage regulär beendet wird.

## 0.17.2 - 2026-09-16

- Copilot-Anfragen erhalten eine Diagnose-ID. Bei Verbindungsabbrüchen zeigt
  Fortuna eine kurze Fehlermeldung statt einer technischen Rohantwort.
- Zeitpunkte und Phasen des Antwort-Streams werden ohne Finanzinhalte oder
  Zugangsdaten protokolliert, damit sich erneute 502-Fehler eingrenzen lassen.

## 0.17.1 - 2026-09-15

- Policen- und Rückkaufswerte werden als eigene Anlagekonten im Gesamtvermögen
  geführt. Herr Körner darf dafür keine bestehenden Giro- oder Bargeldkonten
  mehr zweckentfremden.
- Falsch zugeordnete Kontoschätzungen lassen sich in der Kontoseite entfernen;
  Körner besitzt dafür ebenfalls eine gezielt begrenzte Korrekturfunktion.

## 0.17.0 - 2026-09-15

- Konten besitzen jetzt optionale Wertschätzungen mit Monatsbeitrag,
  investiertem Beitragsanteil, Zeithorizont und drei Renditeszenarien.
- Der letzte echte Kontostand bleibt der feste Anker. Vorsichtige, erwartete
  und günstige Verläufe erscheinen gestrichelt und werden niemals als echte
  Salden oder Vermögen verbucht.
- Meilensteine zeigen den erwarteten Wert und die Bandbreite nach einem, fünf,
  zehn sowie am Ende des gewählten Horizonts.
- Herr Körner kann diese Annahmen anlegen und aktualisieren, muss sie aber
  ausdrücklich als Schätzung kennzeichnen und darf fehlende Werte nicht
  erfinden.

## 0.16.2 - 2026-09-15

- Herr Körners verzögert geladene Spezialwerkzeuge liegen jetzt im vom Codex
  App Server vorgeschriebenen Fortuna-Namensraum. Fragen und Änderungen können
  dadurch wieder ausgeführt werden, ohne alle Werkzeugschemata vorab zu laden.

## 0.16.1 - 2026-09-15

- Beim Öffnen der angemeldeten Webapp gleicht Fortuna alle fälligen
  Bankverbindungen automatisch ab und aktualisiert neue Konten und Buchungen.
- Wiederholtes Öffnen innerhalb von 15 Minuten löst keinen unnötigen
  Anbieterabruf aus. Parallele manuelle und automatische Abgleiche derselben
  Verbindung teilen sich denselben laufenden Vorgang.
- Abgelaufene Bankfreigaben werden erkannt und sichtbar als abgelaufen
  markiert. Der manuelle Sofortabgleich bleibt erhalten.

## 0.16.0 - 2026-09-15

- Herr Körner antwortet jetzt live, während die Antwort entsteht. Laufende
  Anfragen lassen sich sofort abbrechen und blockieren keine zweite Aktion.
- Die Unterhaltung wird serverseitig als dauerhafter App-Server-Thread
  fortgesetzt. Ein neuer Chat verwirft diesen Faden kontrolliert, statt bloß
  die sichtbaren Nachrichten zu leeren.
- Nur ein kleiner Kern der Fortuna-Werkzeuge wird sofort geladen. Alle
  Fachwerkzeuge bleiben vollständig verfügbar und werden erst bei Bedarf über
  die verzögerte Werkzeug-Suche zugeschaltet.
- Körner erhält je nach Frage nur den passenden Finanzkontext. Konten,
  Transaktionen, Verträge, Anlagen, Vermögen, Planung und Optimierungen werden
  gezielt und parallel geladen, statt immer den kompletten Datenbestand zu
  übertragen.
- Unveränderte Finanz-Snapshots werden kurzzeitig wiederverwendet und nach
  jeder App- oder Körner-Änderung automatisch verworfen. Kurze Standardantworten
  sowie Laufzeitmessungen für Kontext, erstes Wort und Gesamtantwort ergänzen
  die Beschleunigung.

## 0.15.0 - 2026-09-15

- Der neue Anlageplan macht aus Ziel, Zeithorizont, Liquiditätsreserve,
  Verlusttragfähigkeit, Zielallokation, Streuung, Kosten, Klumpenrisiko,
  Rebalancing und Prüfturnus einen verbindlichen Prozess.
- Fortuna bewertet den echten Bestand gegen diese Leitplanken, trennt die
  Notfallreserve vom investierbaren Portfolio und nennt genau den nächsten
  offenen Schritt.
- Die monatliche Sparrate wird zuerst auf untergewichtete Anlageklassen
  verteilt. Kurzfristige Marktbewegungen ändern den Plan nicht automatisch.
- Wertpapiere dokumentieren nun Anlageklasse, laufende Kosten, Risikoklasse und
  breite Streuung. Fehlende Produktdaten verhindern eine grüne Kosten- oder
  Diversifikationsprüfung.
- Herr Körner kennt denselben Anlageprozess, kann die Investment Policy pflegen
  und muss Empfehlungen an Ziel, Verlusttragfähigkeit, Kosten, Streuung und
  Rebalancing-Korridor begründen.
- Das read-only MCP stellt Anlageplan, Prüfstatus, Abweichungen und
  Beitragsverteilung ebenfalls bereit.

## 0.14.1 - 2026-09-15

- Kontostände werden nach Änderungen an Betrag, Datum oder Buchungsstatus sowie
  nach Löschungen aus der letzten Beobachtung zuverlässig neu berechnet.
- Historische Bargeldbewegungen können nicht mehr einen später gezählten
  Bestand verfälschen. Sachwerte und Bargeld zeigen in der Navigation wieder
  ausschließlich ihre eigenen Werte.
- Wiederkehrende Zahlungen, Kategorien und manuelle Umbuchungen prüfen ihre
  Verknüpfungen strenger. Fremde Datensätze, Kategoriezyklen und unplausible
  Transferpaare werden abgewiesen.
- Soll/Haben-CSV-Dateien lassen sich ohne zusätzliche Betragsspalte importieren.
  Suche und Budgetlinks halten ihre gewählten Ergebnis- und Datumsgrenzen ein.
- Heutige Prognoseereignisse und einmalige Szenarioereignisse werden nicht mehr
  übersprungen. Szenarioregeln verlangen die für ihren Typ nötigen Angaben und
  akzeptieren deutsche Kommazahlen.
- Rückblick, Vermögensdetails, Wachstumswerte, Tabellen, Diagramme und mehrere
  Touch-Ziele wurden für korrekte Werte und mobile Bedienung nachgebessert.
- Vertragsdokumente sind beim erneuten Anhängen idempotent. Speicherstörungen
  erscheinen als solche, die Bereitschaft wird real geprüft und Herr Körner kann
  abgelegte Dokumenttexte für Folgefragen erneut lesen.
- Der Chat begrenzt PDF- und Bildkontext global, behält bei Anhang-Retries die
  richtige Nachricht und bietet einen stabileren mobilen Verlauf und Drag-and-Drop.

## 0.14.0 - 2026-09-15

- Herr Körner besitzt jetzt ein dauerhaftes, serverseitiges Gedächtnis für
  ausdrücklich genannte Präferenzen, Bezeichnungen und fachliche Regeln.
  Spätere Korrekturen ersetzen die alte Erinnerung; Einträge können in der
  Copilot-Ansicht eingesehen und vergessen werden.
- Der gesamte Chat ist eine sichtbare Drag-and-Drop-Zone für Bilder, PDFs und
  Textdateien. Dateiauswahl und Einfügen aus der Zwischenablage bleiben erhalten.
- Vertragsdokumente werden vor dem Upload mit AES-256-GCM verschlüsselt und in
  einem privaten S3-kompatiblen Objektspeicher abgelegt. Bereits vorhandene
  Datenbankdateien werden beim nächsten Abruf automatisch umgezogen.
- Die Bargeldsumme in der Navigation umfasst nur noch echte Bargeldkonten und
  rechnet mehrere Währungen über die vorhandenen Wechselkurse um.
- Der Dateispeicher verwendet den schlanken AWS-SDK-v3-S3-Client. Fortunas
  bestehende TanStack-Query- und lokale Komponentenstruktur bleibt erhalten,
  statt für diese Änderung eine zweite Zustands- oder UI-Schicht einzuführen.

## 0.13.0 - 2026-09-15

- Der neue Rückblick kombiniert Kennzahl, Zeitraum, Intervall und Gesamt- oder
  Veränderungsansicht. Eigene Konfigurationen lassen sich als Ansichten speichern.
- Die Datenqualität bewertet Aktualität von Konten, Bewertungen und Kursen sowie
  die Dokumentationsqualität der Verträge. Unreife Verläufe und Wachstumsraten
  werden erst nach ausreichender Historie gezeigt.
- Die neue Szenarioansicht vergleicht vorsichtige, normale und optimistische
  Entwicklungen. Regeln modellieren Wachstum, Einnahmen, Ausgaben,
  Einmalereignisse, Schuldentilgung und Inflation über bis zu 50 Jahre.
- Zielwerte lassen sich in Cash, Wertpapiere, Sachwerte, Forderungen, Schulden,
  Nominalwert und heutige Kaufkraft zerlegen.
- Der neue Vertragsbereich dokumentiert Anbieter, Nummer, Kosten, Turnus,
  Laufzeit, Kündigung, Konten- und Zahlungsbezug sowie einen nachvollziehbaren
  Vollständigkeitsgrad.
- Vertragsdokumente werden verschlüsselt in PostgreSQL gespeichert und nur über
  eine angemeldete, nicht cachebare Downloadroute ausgeliefert.
- Herr Körner kann Verträge aus Buchungen oder Anhängen erkennen, anlegen,
  fehlende Dokumente einzeln anfordern, hochgeladene Nachweise auswerten und
  dauerhaft dem Vertrag zuordnen. Szenarien kann er ebenfalls per Chat anlegen.
- Navigation und Suche kennen Rückblick, Szenarien und Verträge; wichtige
  Vermögenssummen erscheinen direkt in der Navigation.

## 0.12.0 - 2026-09-15

- Der Copilot-Chat nimmt bis zu acht Anhänge per Dateiauswahl, Drag & Drop oder
  direkt aus der Zwischenablage an.
- Bilder werden Luna visuell übergeben; Text, Markdown, CSV, TSV, JSON und XML
  werden als begrenzter Dokumentkontext gelesen.
- PDFs werden serverseitig extrahiert. Gescannte PDFs fallen automatisch auf
  bis zu vier gerenderte Seiten als Bildkontext zurück.
- Anhänge sind benutzergebunden, auf 10 MB je Datei und 25 MB je Nachricht
  begrenzt, werden nie protokolliert und nach Verwendung oder spätestens nach
  30 Minuten entfernt.
- Dateichips lassen sich vor dem Senden einzeln entfernen und bleiben danach als
  nachvollziehbare Metadaten an der Benutzernachricht sichtbar.

## 0.11.0 - 2026-09-14

- Herr Körner spricht den angemeldeten Eigentümer konsequent mit „Sie“ und
  seinem Nachnamen an, in dieser Installation also „Herr Dresch“.
- Copilot-Antworten rendern jetzt sicheres GitHub-Flavored Markdown mit
  Überschriften, Listen, Tabellen, Zitaten, Links und Code.
- Buchhalterfragen tragen ein sichtbares Rückfrage-Kennzeichen; jede Antwort
  lässt sich kopieren und der lokale Verlauf über „Neuer Chat“ zurücksetzen.
- Fehlgeschlagene Fragen zeigen ihre Ursache direkt im Chat und können ohne
  doppelten Benutzerbeitrag erneut ausgeführt werden.
- Eingabehilfe, Zeichenzähler, Speicherhinweis und präzisere Ladeanzeige runden
  die Bedienung auf Desktop und Mobilgerät ab.

## 0.10.0 - 2026-09-14

- Herr Körner ist Fortunas strenger unterfränkischer Buchhalter: trocken,
  penibel und hilfreich, mit klarer Sprache statt austauschbarem Assistententon.
- Der neue Buchhalter-Prüflauf räumt eindeutige Fälle selbstständig auf und
  stellt bei unklaren Buchungen genau eine Frage mit Referenz, Datum, Betrag und
  Originaltext.
- Antworten werden sofort am betroffenen Eintrag verbucht; anschließend fragt
  der Copilot direkt den nächsten unklaren Posten ab.
- Die letzten 60 Buchungen erhalten im Copilot eindeutige Kurzreferenzen wie
  „Ausgabe 32“ sowie ein eindeutiges Kennzeichen für Klärungsbedarf.

## 0.9.2 - 2026-09-14

- Copilot-Unterhaltungen verwenden fest `gpt-5.6-luna` mit niedrigem
  Reasoning-Aufwand für schnelle, sparsame Alltagsaktionen.
- Der App-Server erhält den korrekten Sandbox-Wert `read-only`; der zuvor in
  Produktion abgelehnte Wert `readOnly` ist behoben.
- Copilot-Fehler erscheinen mit ihrer konkreten Ursache in der Oberfläche,
  statt als nichtssagendes „Etwas ist schiefgelaufen“.

## 0.9.1 - 2026-09-14

- Der Fortuna Copilot kann die App jetzt tatsächlich bedienen: Einstellungen,
  Konten, Buchungen, Kategorien, Regeln, wiederkehrende Zahlungen, Budgets,
  Sparmissionen, Sachwerte, Forderungen, Verbindlichkeiten und Wertpapiere lassen
  sich im Chat anlegen oder aktualisieren.
- Nach Aktionen lädt der Copilot den neuen Zustand bei Bedarf erneut und die
  Oberfläche aktualisiert alle betroffenen Bereiche automatisch.
- Löschvorgänge und Aktionen außerhalb Fortunas bleiben ausgeschlossen;
  importierte Beschreibungen werden ausdrücklich als Daten statt als
  Anweisungen behandelt.

## 0.9.0 - 2026-09-14

- Der neue Fortuna Copilot verbindet das persönliche ChatGPT-Konto per
  offiziellem Device-Code-Login und nutzt den vorhandenen ChatGPT-Tarif statt
  eines gesonderten API-Schlüssels.
- Der Chat beantwortet Fragen auf Basis eines begrenzten, aktuellen
  Finanz-Snapshots ohne IBAN und ohne Schreibzugriff. Er kann weder Buchungen
  verändern noch Zahlungen ausführen.
- OpenAI-Anmeldedaten bleiben im isolierten Codex App Server, werden für
  Neustarts verschlüsselt gespeichert und niemals an den Browser zurückgegeben.
- Der lokale Chatverlauf bleibt im Browser; pro Frage werden höchstens die zehn
  letzten Nachrichten und 60 aktuelle Buchungen als Kontext verwendet.

## 0.8.1 - 2026-09-14

- Die Übersicht bleibt auf schmalen Smartphones vollständig innerhalb des
  Viewports. Kennzahlen stapeln sich, Wachstum bricht sauber um und Zeiträume
  erscheinen als echte mobile Liste statt als abgeschnittene Desktop-Tabelle.
- Unbrauchbare Milliarden-Prozentwerte aus einem fast leeren historischen
  Startpunkt werden nicht mehr als Jahreswachstum ausgegeben.

## 0.8.0 - 2026-09-14

- Fortuna ist auf kleinen Displays durch größere Bedienelemente, mobile Dialoge,
  umbrechende Kopfbereiche und kompakte Diagramm-Alternativen vollständig nutzbar.
- Der neue Bereich „Bargeld“ verwaltet Portemonnaie und Kassen mit schnellen Ein-
  und Ausgaben, Kassensturz und einem eigenen Bewegungsverlauf.
- Kataster lässt sich mit einem schreibgeschützten Token direkt in Fortuna
  verbinden. Kosten, Abrechnung, Marge, Betriebsstatus und offene
  Abrechnungspunkte erscheinen live unter Verbindungen und Optimierung.
- Kataster bleibt eine separate Betriebsübersicht und verändert weder Konten
  noch Nettovermögen. Das Token wird vor dem Speichern geprüft und verschlüsselt.

## 0.7.0 - 2026-09-14

- Der neue Bereich „Optimierung“ verwaltet Kosten-Checks als Sparmissionen mit
  Status, Kontenbezug, Zieldatum und Notizen.
- Die Eingabe vergleicht heutige Monatskosten, Alternative und einmalige
  Wechselkosten live und zeigt die Ersparnis nach einem, drei und fünf Jahren.
- Umgesetzte Missionen berechnen die bisherige und laufende Ersparnis ab ihrem
  Umsetzungsdatum; echte Euro-Meilensteine machen den Fortschritt sichtbar.
- Erkannte wiederkehrende Ausgaben können direkt als Kosten-Check übernommen
  werden. Missionen sind global suchbar sowie per CSV und `get_optimizations`
  verfügbar.

## 0.6.0 - 2026-09-14

- Der neue Bereich „Forderungen“ zeigt, wer dir aus welchem Grund noch Geld
  schuldet, einschließlich ursprünglichem Betrag, offenem Rest, Fälligkeit,
  Zins, erwarteter Monatsrate und Notizen.
- Teilzahlungen werden als datierter Verlauf gespeichert. Ein Restbetrag von
  null markiert die Forderung automatisch als beglichen.
- Offene Forderungen zählen positiv zum Nettovermögen, zur Vermögensaufteilung
  und zum historischen Verlauf.
- Forderungen sind in der globalen Suche, im CSV-Export und über das
  schreibgeschützte MCP-Werkzeug `get_receivables` verfügbar.

## 0.5.4 - 2026-09-14

- Tabellenüberschriften, Namen, Beschreibungen, Notizen, Listen und
  Diagrammtexte werden nicht mehr mit abgeschnittenen Ellipsen dargestellt.
- Datumsfelder reservieren auch in Safari genug Platz für das vollständige
  lokalisierte Datum und den Kalenderknopf.
- Breite Tabellen lassen sich vollständig horizontal lesen; die kompakte
  Übersichtsstatistik nutzt die verfügbare Breite statt Spalten abzuschneiden.
- Der Remise-Verkaufsbestand erscheint im Vermögensfluss als eine lesbare
  Gesamtposition statt als überlagerte Liste einzelner Artikel.

## 0.5.3 - 2026-09-14

- Neu aus Remise übernommene Gegenstände erhalten die eigene Sachwertklasse
  „Verkaufsbestand“ statt erratener Kategorien wie Sammlerstück oder Edelmetall.
- Bereits manuell gepflegte und mit Remise verknüpfte Sachwerte behalten ihre
  echte Kategorie; nur automatisch angelegte Remise-Positionen werden umgestellt.

## 0.5.2 - 2026-09-14

- Fortuna erkennt eindeutig passende bestehende Sachwerte und verknüpft sie
  mit Remise, statt eine zweite Position anzulegen. Manuelle Kosten,
  Bezeichnungen, Kategorien und Abschnitte bleiben erhalten.
- Bereits erzeugte eindeutige Dubletten werden beim nächsten Abgleich
  zusammengeführt; mehrdeutige Treffer bleiben unangetastet.

## 0.5.1 - 2026-09-14

- Die Remise-Zuordnung verwechselt technische Begriffe wie „Xeon Gold“ und
  „Auto-Tracking“ nicht mehr mit Edelmetallen oder Fahrzeugen.
- Ein erneuter Abgleich korrigiert die Kategorie bereits synchronisierter
  Remise-Sachwerte automatisch.

## 0.5.0 - 2026-09-14

- Remise lässt sich unter Verbindungen mit einer einmaligen OAuth-Lesefreigabe
  direkt an Fortuna anbinden.
- Aktive Remise-Gegenstände werden als Sachwerte im Abschnitt „Remise“
  angelegt und mit Zielpreis oder freigegebenem Angebotspreis bewertet.
- Weitere Abgleiche schreiben Bewertungsverläufe; verkaufte, stornierte oder
  archivierte Gegenstände scheiden automatisch aus dem aktiven Nettovermögen aus.
- Zugriffs- und Erneuerungstokens bleiben verschlüsselt in Fortuna. Die
  Verbindung besitzt ausschließlich Remise-Lesezugriff.

## 0.4.0 - 2026-09-14

- Deutsche Banken lassen sich jetzt direkt über Enable Banking auswählen und
  mit ihrer eigenen PSD2-Anmeldung freigeben.
- Nach der Rückkehr zu Fortuna werden Konten, aktuelle Salden und alle von der
  Bank gelieferten Transaktionen automatisch importiert und dedupliziert.
- Weitere Abgleiche laufen über den bestehenden Verbindungen-Bereich;
  mehrseitige Transaktionsantworten werden vollständig eingelesen.

## 0.3.1 - 2026-09-14

- Der gespeicherte Enable-Banking-Zugang lässt sich direkt unter Verbindungen
  testen. Fortuna signiert dafür im Server ein fünf Minuten gültiges JWT.
- Der Test liest nur Anwendungsstatus und die Anzahl verfügbarer deutscher
  Institute. Private Schlüssel, JWT und Kontodaten verlassen Fortuna nicht.

## 0.3.0 - 2026-09-14

- Unter Verbindungen lassen sich die Enable-Banking-Anwendungs-ID und der
  private RSA-Schlüssel jetzt direkt in Fortuna hinterlegen.
- Fortuna prüft PEM-Format, RSA-Typ und eine Mindestlänge von 2048 Bit,
  verschlüsselt den Schlüssel mit AES-256-GCM und gibt ihn nie wieder aus.
- Angezeigt werden nur Konfigurationsstatus, Anwendungs-ID, Zeitpunkt und ein
  Fingerabdruck des öffentlichen Schlüssels. Der Zugang kann sicher ersetzt
  oder gelöscht werden.

## 0.2.1 - 2026-09-14

- Öffentliche Datenschutzinformationen und Nutzungsbedingungen sind jetzt
  ohne Anmeldung unter `/privacy` und `/terms` erreichbar.
- Beide Seiten beschreiben den privaten, schreibgeschützten Betrieb von Fortuna
  und die vorgesehene Bankanbindung über Enable Banking.

## 0.2.0 - 2026-09-14

- Die komplette Benutzeroberfläche ist jetzt auf Deutsch verfügbar, inklusive
  Navigation, Formulare, Tabellen, Meldungen, Hilfetexte und Standardkategorien.
- Zahlen und Datumsangaben verwenden für neue Einstellungen standardmäßig das
  deutsche Format.
- Die Versionsanzeige öffnet jetzt direkt in der App diese Versionshinweise.

## 0.1.0 - 2026-09-14

- Erste vollständige Version von Fortuna mit Konten, Transaktionen,
  Kategorisierung, Budgets, Zahlungsfluss und Prognose.
- Sachwerte, Verbindlichkeiten, Wertpapiere und Nettovermögen werden mit ihrer
  Historie abgebildet.
- CSV-Import und -Export, Bankanbindungen sowie eine schreibgeschützte
  MCP-Schnittstelle sind enthalten.
