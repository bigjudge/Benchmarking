# Bank-Benchmarking

Ein lokaler Flask-Server, der Geschäftsberichte von Banken als PDF einliest,
die Kennzahlen per OCR und Gemini extrahiert und sie gegeneinander auswertet.
Ersetzt das frühere statische Dashboard `benchmarking (1) 1.html`, dessen Daten
beim ersten Start übernommen wurden.

## Start

```powershell
pip install -r requirements.txt
python app.py
```

Der Server läuft dann auf <http://127.0.0.1:5000> und öffnet den Browser
automatisch. Optionen: `--port`, `--host`, `--debug`, `--no-browser`.

Beim ersten Start ist der Datenbestand bereits gefüllt: neun liechtensteinische
Banken, zwei Berichtsjahre, rund 290 belegte Kennzahlwerte. Wurde `data/store.json`
gelöscht, lässt sich der Ausgangsstand neu erzeugen:

```powershell
python tools/seed_from_html.py --force
```

## Gemini-Schlüssel

Für OCR und Extraktion wird ein Google-Gemini-Schlüssel benötigt. Ohne ihn
funktioniert alles andere, nur das Einlesen neuer Berichte nicht.

Schlüssel erstellen unter <https://aistudio.google.com/apikey>, dann entweder in
der Anwendung unter **Einstellungen → Gemini-API** eintragen oder in eine Datei
`.env` schreiben:

```
GEMINI_API_KEY=AIza...
```

Der Schlüssel bleibt lokal. Er wird ausschliesslich für Aufrufe an die
Gemini-API verwendet und steht in `.gitignore`.

## Wie das Einlesen funktioniert

1. **Textebene lesen.** PyMuPDF holt den Text jeder Seite direkt aus dem PDF.
2. **Scan erkennen.** Seiten unter 140 Zeichen gelten als Bild ohne Textebene.
3. **Seiten auswählen.** Ein Stichwortverfahren bewertet jede Seite nach
   Begriffen wie „Kennzahlen“, „Erfolgsrechnung“ oder „Eigenmittel“ und nach
   Ziffernanteil. Nur die relevantesten Seiten gehen an das Modell, standardmässig
   höchstens 40. Das begrenzt Laufzeit und Kosten deutlich.
4. **OCR.** Seiten ohne Textebene werden als PNG gerendert und von Gemini
   gelesen. Der Text erscheint anschliessend im Prüfdialog, Seite für Seite.
5. **Extraktion.** Aus dem Seitentext extrahiert das Modell die Kennzahlen als
   strukturiertes JSON, jeweils mit Seitenzahl, wörtlichem Beleg und Konfidenz.
6. **Plausibilitätsprüfung.** Der Server prüft die Werte gegeneinander und
   markiert Auffälligkeiten, etwa einen Personalaufwand über der Bilanzsumme.
   Der häufigste Extraktionsfehler ist eine verwechselte Einheit; genau den
   fängt diese Stufe ab.
7. **Prüfen und übernehmen.** Erst nach Ihrer Freigabe landen Werte im
   Datenbestand. Jeder Wert lässt sich vorher korrigieren oder abwählen.

Nichts wird automatisch übernommen, und nichts wird geschätzt. Fehlende Werte
bleiben leer statt gefüllt zu werden.

## Aufbau

| Bereich | Inhalt |
|---|---|
| `app.py` | Serverstart, Routen für Oberfläche und Gesundheitsprüfung |
| `bench/schema.py` | Kennzahlenkatalog, abgeleitete Kennzahlen, Untersuchungsbereiche |
| `bench/store.py` | JSON-Datenspeicher mit Sperre, Sicherungspunkten und Protokoll |
| `bench/analytics.py` | Rangfolgen, Perzentile, Stärken/Schwächen, Abdeckung |
| `bench/extraction.py` | PDF-Analyse, Seitenauswahl, OCR, Plausibilitätsprüfung |
| `bench/gemini.py` | REST-Client für die Gemini-API |
| `bench/jobs.py` | Hintergrundjobs mit Fortschrittsmeldung |
| `bench/exporters.py` | Export als Excel, CSV und Markdown |
| `bench/api.py` | REST-Schnittstelle |
| `static/js/` | Oberfläche als ES-Module, ohne Framework |
| `data/` | Datenbestand, Uploads, Sicherungspunkte (nicht im Repository) |

## Kennzahlen

Rund 40 berichtete Kennzahlen in fünf Kategorien und 24 daraus berechnete.
Berechnete sind überall mit `ƒ` markiert und zeigen ihre Formel. Die Trennung ist
bewusst: Die ursprüngliche Auswertung hat nichts gerechnet, weil die Berichte
unterschiedlich definierte Kennzahlen ausweisen. Die berechneten Werte machen den
Vergleich möglich, ohne die berichteten Zahlen zu verfälschen.

Absolute Grössenkennzahlen wie Bilanzsumme oder verwaltete Kundenvermögen sind
von der Stärken-/Schwächen-Auswertung ausgenommen. Sie messen, wie gross ein
Institut ist, nicht wie gut es wirtschaftet, und würden jedes kleinere Haus
pauschal als schwach erscheinen lassen. Über einen Schalter lassen sie sich
einblenden.

## Funktionen der Oberfläche

**Dashboard** – Kennzahl und Jahr wählen, Positionierung der Zielbank, Rangfolge
mit Peer-Durchschnitt und -Median, Verteilung, Veränderung zum Vorjahr,
Zeitverlauf. Bei extremen Grössenunterschieden schaltet die Rangfolge
automatisch auf eine logarithmische Skala.

**Vergleich** – Gesamtbewertung nach Perzentilrang je Kategorie, vollständige
Kennzahlenmatrix mit Einfärbung nach Position, Ertragsstruktur, Streudiagramm
für Zusammenhänge zwischen zwei beliebigen Kennzahlen.

**Analyse** – Stärken und Schwächen nach statistischer Auffälligkeit sortiert,
die sieben Untersuchungsbereiche mit ihrem Abdeckungsgrad und den dokumentierten
Datenlücken, Datenqualität je Bank und je Kennzahl.

**Berichte** – PDF hochladen, Fortschritt verfolgen, Extraktion prüfen. Links die
erkannten Werte, rechts der zugrunde liegende Seitentext; ein Klick auf die
Seitenzahl springt zum Beleg und hebt ihn hervor.

**Datenpflege** – Banken anlegen und bearbeiten, Zielbank festlegen, jeden Wert
manuell korrigieren samt Quellenangabe. Herkunft und Konfidenz bleiben jederzeit
sichtbar.

**Einstellungen** – Schlüssel und Modelle, Verarbeitungsparameter, Export,
Methodiktexte, Sicherungspunkte, Änderungsprotokoll.

Tastaturkürzel: `1` bis `6` wechseln die Ansicht, `b` öffnet die Bankauswahl.

## Datenhaltung

Alles liegt in `data/store.json`. Vor jeder Änderung entsteht automatisch ein
Sicherungspunkt unter `data/backups/`; die jüngsten 30 bleiben erhalten und
lassen sich in den Einstellungen zurückspielen. Jede Änderung steht im
Änderungsprotokoll.

## Grenzen

Der eingebaute Server ist für den lokalen Einsatz gedacht, nicht für den Betrieb
im Netz. Es gibt keine Benutzerverwaltung: Wer die Adresse erreicht, kann alles
lesen und ändern.

Die Extraktion ist ein Vorschlag, keine geprüfte Zahl. Ein Sprachmodell kann
Werte aus der falschen Spalte oder dem falschen Berichtsjahr ziehen. Die
Plausibilitätsprüfung fängt grobe Fehler ab, feine nicht. Deshalb steht zwischen
Extraktion und Datenbestand immer Ihre Freigabe, und jeder Wert führt seinen
Beleg mit sich.
