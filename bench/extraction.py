"""PDF-Aufbereitung, OCR und KI-gestuetzte Kennzahlenextraktion.

Ablauf:
  1. PDF oeffnen, Textebene je Seite auslesen (PyMuPDF).
  2. Textdichte pruefen. Ist die Seite praktisch leer -> Scan, also OCR noetig.
  3. Relevante Seiten anhand eines Stichwort-Scores auswaehlen.
  4. Fehlende Seitentexte per Gemini-Vision OCR nachziehen (Seitenbilder).
  5. Aus dem Seitentext die Kennzahlen als strukturiertes JSON extrahieren.

Jeder Zwischenschritt wird festgehalten, damit im UI sichtbar ist,
was gelesen und woraus ein Wert abgeleitet wurde.
"""

from __future__ import annotations

import base64
import re
import unicodedata

import pymupdf as fitz

from . import schema
from .config import get_settings
from .gemini import GeminiError, generate, generate_json

# --------------------------------------------------------------------------
# Seitenrelevanz
# --------------------------------------------------------------------------
KEYWORDS: dict[str, int] = {
    # Kennzahlenuebersichten - hoechste Prioritaet
    "kennzahlen": 14, "key figures": 14, "kennzahlenübersicht": 16,
    "auf einen blick": 12, "at a glance": 12, "financial highlights": 12,
    "fünfjahresübersicht": 10, "mehrjahresübersicht": 10,
    # Rechenwerke
    "bilanz": 10, "balance sheet": 10, "erfolgsrechnung": 12,
    "income statement": 12, "gewinn- und verlustrechnung": 12,
    "profit and loss": 10, "aktiven": 6, "passiven": 6,
    "total assets": 9, "bilanzsumme": 12,
    # Ertrag / Aufwand
    "zinsengeschäft": 8, "net interest income": 8, "kommissions": 8,
    "personalaufwand": 10, "sachaufwand": 10, "geschäftsaufwand": 9,
    "betriebsertrag": 9, "bruttoertrag": 9, "operating income": 8,
    "personnel expenses": 8, "administrative expenses": 8,
    # Kapital / Liquiditaet
    "eigenmittel": 10, "eigenkapital": 8, "tier 1": 10, "cet1": 10,
    "leverage ratio": 9, "liquidity coverage": 9, "lcr": 7, "nsfr": 7,
    "risikogewichtete": 8, "offenlegung": 6, "own funds": 8,
    # Risiko
    "gefährdete forderungen": 9, "wertberichtigung": 8, "impaired": 7,
    "erwartete kreditverluste": 8, "expected credit loss": 8,
    # Organisation
    "mitarbeitende": 8, "personalbestand": 9, "vollzeitstellen": 9,
    "fte": 6, "geschäftsleitung": 8, "verwaltungsrat": 8,
    "board of directors": 7, "organe": 6, "corporate governance": 6,
    # Vermoegen
    "kundenvermögen": 10, "assets under management": 10,
    "verwaltete vermögen": 10, "client assets": 9, "neugeld": 8,
    "net new money": 8, "cost-income": 12, "eigenkapitalrendite": 10,
    "kapitalrendite": 9, "return on equity": 10,
}

NUM_RE = re.compile(r"\d")


def _norm(text: str) -> str:
    return unicodedata.normalize("NFKC", text or "").casefold()


def page_score(text: str) -> int:
    low = _norm(text)
    if not low.strip():
        return 0
    score = sum(weight for kw, weight in KEYWORDS.items() if kw in low)
    digits = sum(1 for ch in low if ch.isdigit())
    density = digits / max(len(low), 1)
    if density > 0.06:
        score += 8
    elif density > 0.03:
        score += 4
    return score


# --------------------------------------------------------------------------
# PDF-Analyse
# --------------------------------------------------------------------------
def analyse_pdf(path, max_pages: int | None = None,
                density_threshold: int | None = None) -> dict:
    settings = get_settings()
    max_pages = max_pages or settings["maxPages"]
    density_threshold = density_threshold or settings["textDensityThreshold"]

    doc = fitz.open(str(path))
    try:
        pages = []
        for i, page in enumerate(doc):
            text = page.get_text("text") or ""
            stripped = text.strip()
            pages.append({
                "seite": i + 1,
                "text": text,
                "zeichen": len(stripped),
                "score": page_score(text),
                "ocrNoetig": len(stripped) < density_threshold,
            })
        gesamt = len(pages)
        leer = sum(1 for p in pages if p["ocrNoetig"])
        avg_chars = (sum(p["zeichen"] for p in pages) / gesamt) if gesamt else 0
        gescannt = gesamt > 0 and (leer / gesamt) > 0.5

        ausgewaehlt = select_pages(pages, max_pages, gescannt)
        return {
            "seitenGesamt": gesamt,
            "seitenOhneText": leer,
            "durchschnittZeichen": round(avg_chars, 1),
            "istScan": gescannt,
            "seiten": pages,
            "ausgewaehlteSeiten": ausgewaehlt,
            "metadaten": {k: v for k, v in (doc.metadata or {}).items() if v},
        }
    finally:
        doc.close()


def select_pages(pages: list[dict], max_pages: int, gescannt: bool) -> list[int]:
    """Waehlt die fuer Kennzahlen relevantesten Seiten aus."""
    total = len(pages)
    if total <= max_pages:
        return [p["seite"] for p in pages]

    gewaehlt: set[int] = set()
    # Deckblatt/Kennzahlenteil steht fast immer vorne
    vorn = min(8, max_pages // 4)
    for p in pages[:vorn]:
        gewaehlt.add(p["seite"])

    if gescannt:
        # Ohne Textebene ist kein Score moeglich -> gleichmaessig verteilen
        rest = max_pages - len(gewaehlt)
        if rest > 0:
            step = max(1, (total - vorn) // rest)
            for p in pages[vorn::step]:
                if len(gewaehlt) >= max_pages:
                    break
                gewaehlt.add(p["seite"])
    else:
        kandidaten = sorted((p for p in pages if p["seite"] not in gewaehlt),
                            key=lambda p: (-p["score"], p["seite"]))
        for p in kandidaten:
            if len(gewaehlt) >= max_pages or p["score"] <= 0:
                break
            gewaehlt.add(p["seite"])
        # Falls zu wenig Treffer: mit dichten Seiten auffuellen
        if len(gewaehlt) < max_pages:
            for p in sorted(pages, key=lambda p: -p["zeichen"]):
                if len(gewaehlt) >= max_pages:
                    break
                gewaehlt.add(p["seite"])
    return sorted(gewaehlt)


def render_pages(path, seiten: list[int], dpi: int | None = None) -> list[dict]:
    """Rendert Seiten als PNG fuer die Vision-OCR."""
    dpi = dpi or get_settings()["ocrDpi"]
    doc = fitz.open(str(path))
    try:
        out = []
        for nr in seiten:
            if nr < 1 or nr > doc.page_count:
                continue
            pix = doc.load_page(nr - 1).get_pixmap(dpi=dpi)
            out.append({"seite": nr, "png": pix.tobytes("png")})
        return out
    finally:
        doc.close()


# --------------------------------------------------------------------------
# OCR via Gemini Vision
# --------------------------------------------------------------------------
OCR_SYSTEM = (
    "Du bist eine praezise OCR-Engine fuer Geschaeftsberichte von Banken. "
    "Gib den Seiteninhalt vollstaendig und unveraendert als Text wieder. "
    "Tabellen gibst du zeilenweise mit Pipe-Zeichen als Spaltentrenner aus. "
    "Zahlen uebernimmst du exakt inklusive Tausender- und Dezimaltrennzeichen sowie "
    "Vorzeichen und Klammern. Du interpretierst, korrigierst und rundest nichts. "
    "Kannst du etwas nicht lesen, schreibst du [unleserlich]."
)


def ocr_pages(path, seiten: list[int], model: str | None = None,
              batch_size: int | None = None, progress=None) -> dict:
    """OCR ueber Gemini-Vision. -> {seite: text}, plus Nutzungsstatistik."""
    settings = get_settings()
    model = model or settings["geminiOcrModel"]
    batch_size = batch_size or settings["ocrBatchSize"]

    texte: dict[int, str] = {}
    usage = {"prompt": 0, "output": 0, "total": 0, "aufrufe": 0}
    batches = [seiten[i:i + batch_size] for i in range(0, len(seiten), batch_size)]

    for idx, batch in enumerate(batches, start=1):
        if progress:
            progress(f"OCR-Durchgang {idx}/{len(batches)} "
                     f"(Seiten {batch[0]}–{batch[-1]})",
                     30 + int(35 * (idx - 1) / max(len(batches), 1)))
        bilder = render_pages(path, batch)
        parts: list[dict] = [{
            "text": "Lies die folgenden " + str(len(bilder)) + " Seiten aus einem "
                    "Geschaeftsbericht. Gib fuer jede Seite exakt diesen Block aus:\n"
                    "<<<SEITE n>>>\n(vollstaendiger Seitentext)\n<<<ENDE n>>>\n"
                    "Seitennummern in dieser Reihenfolge: "
                    + ", ".join(str(b["seite"]) for b in bilder)
        }]
        for bild in bilder:
            parts.append({"text": f"--- Seite {bild['seite']} ---"})
            parts.append({"inlineData": {
                "mimeType": "image/png",
                "data": base64.b64encode(bild["png"]).decode("ascii"),
            }})

        res = generate(parts, model=model, system_instruction=OCR_SYSTEM,
                       temperature=0.0)
        for k in ("prompt", "output", "total"):
            usage[k] += res["usage"].get(k) or 0
        usage["aufrufe"] += 1
        texte.update(_split_ocr(res["text"], [b["seite"] for b in bilder]))

    return {"texte": texte, "usage": usage, "model": model}


def _split_ocr(text: str, seiten: list[int]) -> dict[int, str]:
    """Zerlegt die OCR-Antwort anhand der Seitenmarker.

    Modelle halten sich nicht immer an das vorgegebene Markerformat, deshalb
    mehrere Stufen: erst die verlangten <<<SEITE n>>>-Blöcke, dann eine
    tolerantere Variante, zuletzt eine Aufteilung anhand der Reihenfolge.
    """
    out: dict[int, str] = {}
    for nr in seiten:
        m = re.search(rf"<<<\s*SEITE\s*{nr}\s*>>>(.*?)(?:<<<\s*ENDE\s*{nr}\s*>>>|<<<\s*SEITE|\Z)",
                      text, re.DOTALL | re.IGNORECASE)
        if m and m.group(1).strip():
            out[nr] = m.group(1).strip()
    if out:
        return out

    # Zweite Stufe: Marker ohne spitze Klammern, etwa "--- Seite 12 ---"
    treffer = list(re.finditer(r"(?:^|\n)[^\S\n]*[-–—=#*\s]*seite\s*(\d{1,4})[^\S\n]*[-–—=:*\s]*(?:\n|$)",
                               text, re.IGNORECASE))
    if treffer:
        for i, m in enumerate(treffer):
            nr = int(m.group(1))
            if nr not in seiten:
                continue
            ende = treffer[i + 1].start() if i + 1 < len(treffer) else len(text)
            block = text[m.end():ende].strip()
            if block:
                out[nr] = block
        if out:
            return out

    # Letzte Stufe: ein einzelnes Blatt im Durchgang ist eindeutig zuordenbar
    if len(seiten) == 1 and text.strip():
        out[seiten[0]] = text.strip()
    return out


# --------------------------------------------------------------------------
# Kennzahlenextraktion
# --------------------------------------------------------------------------
EXTRACT_SYSTEM = (
    "Du bist Analyst fuer Bankenbenchmarking und extrahierst Kennzahlen aus "
    "Geschaeftsberichten.\n\n"
    "EISERNE REGELN:\n"
    "1. Du uebernimmst ausschliesslich Werte, die im Text ausgewiesen sind. "
    "Du rechnest, schaetzt und interpolierst nichts. Fehlt eine Kennzahl, "
    "laesst du sie weg oder setzt value auf null.\n"
    "2. Betraege rechnest du auf Millionen der Berichtswaehrung um. Steht im "
    "Bericht 'in CHF 1000' und der Wert 977'612, ist das 977.612 Millionen. "
    "Steht der Wert bereits in Millionen, uebernimmst du ihn unveraendert.\n"
    "3. Prozentwerte gibst du als Zahl ohne Prozentzeichen an (24.1 fuer 24,1 %).\n"
    "4. Schweizer und deutsche Zahlformate normalisierst du: 1'234.5 und 1.234,5 "
    "werden beide zu 1234.5. Werte in Klammern sind negativ.\n"
    "5. Eine 'Kapitalrendite' oder 'Return on Investment', die als Gewinn durch "
    "Bilanzsumme definiert ist, gehoert zu 'roa', niemals zu 'roe'. 'roe' "
    "befuellst du nur, wenn der Bericht eine echte Eigenkapitalrendite ausweist.\n"
    "6. Liegen konsolidierte Konzernzahlen UND Einzelabschlusszahlen vor, nimmst du "
    "die konsolidierten und vermerkst das in 'basis'.\n"
    "7. Zu jedem Wert nennst du die Seitenzahl und das woertliche Textfragment, "
    "aus dem er stammt. Ohne Beleg kein Wert.\n"
    "8. confidence ist 0.9-1.0 bei einer klaren Tabellen- oder Textangabe, "
    "0.6-0.8 bei Ableitung aus Fliesstext, unter 0.6 bei Unsicherheit etwa aus "
    "einer Grafik.\n"
    "Du antwortest ausschliesslich mit JSON."
)


def _kpi_katalog() -> str:
    zeilen = []
    for key in schema.REPORTED_KEYS:
        d = schema.all_kpi_defs()[key]
        alias = "; ".join(d["aliases"][:4])
        zeilen.append(f"- {key} | {d['label']} | Einheit: {d['unit']}"
                      + (f" | typische Bezeichnungen: {alias}" if alias else ""))
    return "\n".join(zeilen)


def build_extraction_prompt(seitentexte: dict[int, str], jahre: list[str],
                            bankname: str | None) -> str:
    teile = [
        "Extrahiere aus den folgenden Seiten eines Bank-Geschaeftsberichts die "
        "Kennzahlen je Berichtsjahr.",
        "",
        f"Gesuchte Berichtsjahre: {', '.join(jahre)}. Viele Berichte fuehren eine "
        "Vorjahresspalte – nutze sie fuer das aeltere Jahr.",
    ]
    if bankname:
        teile.append(f"Erwartete Bank: {bankname}. Weicht der Bericht davon ab, "
                     "trage den tatsaechlichen Namen ein.")
    teile += [
        "",
        "KENNZAHLENKATALOG (nur diese Schluessel verwenden):",
        _kpi_katalog(),
        "",
        "ANTWORTFORMAT (exakt dieses JSON):",
        """{
  "bankname": "offizieller Name laut Titelblatt",
  "basis": "Einzelabschluss | Konsolidiert (Konzern) | ...",
  "waehrung": "CHF",
  "berichtsjahr": "2025",
  "einheitHinweis": "z.B. 'Betraege in CHF 1000' – wie im Bericht angegeben",
  "jahre": {
    "2025": {
      "bilanzsumme": {"value": 977.6, "unit": "CHF Mio.", "seite": 15,
                      "beleg": "Total Aktiven 977'612", "confidence": 0.97},
      "cir": {"value": null, "seite": null, "beleg": "",
              "hinweis": "im Bericht nicht ausgewiesen", "confidence": null}
    },
    "2024": { }
  },
  "besonderheiten": ["kurze Hinweise auf Abweichungen, Restatements, Diskrepanzen"],
  "nichtGefunden": ["Liste der Kennzahlen, die der Bericht nicht ausweist"]
}""",
        "",
        "SEITENTEXTE:",
    ]
    for nr in sorted(seitentexte):
        text = (seitentexte[nr] or "").strip()
        if not text:
            continue
        teile.append(f"\n===== SEITE {nr} =====\n{text}")
    return "\n".join(teile)


def extract_metrics(seitentexte: dict[int, str], jahre: list[str],
                    bankname: str | None = None, model: str | None = None,
                    progress=None) -> dict:
    """Ruft Gemini fuer die strukturierte Extraktion auf."""
    if progress:
        progress("Kennzahlen werden analysiert", 75)
    prompt = build_extraction_prompt(seitentexte, jahre, bankname)
    daten, meta = generate_json([{"text": prompt}], model=model,
                                system_instruction=EXTRACT_SYSTEM, temperature=0.0)
    daten = normalise_extraction(daten, jahre)
    daten["_meta"] = {"model": meta["model"], "usage": meta["usage"],
                      "promptZeichen": len(prompt)}
    return daten


# --------------------------------------------------------------------------
# Normalisierung der Modellantwort
# --------------------------------------------------------------------------
# Erste zusammenhaengende Zahl im Text, inklusive Tausender- und Dezimaltrennern
_ZAHL_RE = re.compile(r"\d[\d'’.,   ]*\d|\d")


def parse_number(raw):
    """Akzeptiert 1'234.5 / 1.234,5 / (123) / '12,3 %' / 'CHF 28.7 Mio.' -> float|None"""
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    text = str(raw).strip()
    if not text or text.lower() in {"n/a", "na", "null", "none", "-", "–", "—", "k.a."}:
        return None

    negativ = (text.startswith("(") and text.endswith(")")) or bool(
        re.match(r"^\s*[-−]", text))

    treffer = _ZAHL_RE.search(text)
    if not treffer:
        return None
    kern = treffer.group(0)

    # Tausendertrenner entfernen, Dezimaltrenner vereinheitlichen
    kern = (kern.replace("'", "").replace("’", "")
            .replace(" ", "").replace(" ", "").replace(" ", ""))
    if "," in kern and "." in kern:
        # Das weiter hinten stehende Zeichen trennt die Dezimalstellen
        if kern.rfind(",") > kern.rfind("."):
            kern = kern.replace(".", "").replace(",", ".")
        else:
            kern = kern.replace(",", "")
    elif "," in kern:
        teile = kern.split(",")
        # 1,234 mit dreistelligem Rest ist ein Tausendertrenner, 1,23 nicht
        kern = (kern.replace(",", "") if len(teile) > 2 or len(teile[-1]) == 3
                else kern.replace(",", "."))
    elif kern.count(".") > 1:
        kern = kern.replace(".", "")  # 1.234.567 ist eine Tausenderkette
    kern = kern.rstrip(".").lstrip(".")

    if not NUM_RE.search(kern):
        return None
    try:
        wert = float(kern)
    except ValueError:
        return None
    return -wert if negativ else wert


def normalise_extraction(daten: dict, jahre: list[str]) -> dict:
    gueltig = set(schema.REPORTED_KEYS)
    defs = schema.all_kpi_defs()
    roh_jahre = daten.get("jahre")
    if not isinstance(roh_jahre, dict):
        roh_jahre = {}

    # Manche Antworten liefern die Kennzahlen flach statt unter "jahre"
    if not roh_jahre:
        flach = {k: v for k, v in daten.items() if k in gueltig}
        if flach:
            roh_jahre = {jahre[0] if jahre else "unbekannt": flach}

    sauber: dict[str, dict] = {}
    verworfen: list[str] = []
    for jahr, felder in roh_jahre.items():
        if not isinstance(felder, dict):
            continue
        jahr_key = str(jahr).strip()
        m = re.search(r"(19|20)\d{2}", jahr_key)
        if m:
            jahr_key = m.group(0)
        ziel: dict[str, dict] = {}
        for key, payload in felder.items():
            if key not in gueltig:
                verworfen.append(key)
                continue
            if isinstance(payload, dict):
                wert = parse_number(payload.get("value"))
                seite = payload.get("seite") or payload.get("page")
                beleg = (payload.get("beleg") or payload.get("snippet")
                         or payload.get("quelle") or "")
                conf = payload.get("confidence")
                hinweis = payload.get("hinweis", "")
            else:
                wert = parse_number(payload)
                seite, beleg, conf, hinweis = None, "", None, ""
            try:
                conf = float(conf) if conf is not None else None
            except (TypeError, ValueError):
                conf = None
            if conf is not None:
                conf = max(0.0, min(1.0, conf if conf <= 1 else conf / 100))
            try:
                seite = int(seite) if seite not in (None, "") else None
            except (TypeError, ValueError):
                seite = None
            ziel[key] = {
                "value": wert,
                "unit": defs[key]["unit"],
                "seite": seite,
                "beleg": str(beleg)[:400],
                "confidence": conf,
                "hinweis": str(hinweis)[:300],
            }
        if ziel:
            sauber[jahr_key] = ziel

    for jahr, felder in sauber.items():
        for key, warnung in pruefe_plausibilitaet(felder).items():
            felder[key]["warnung"] = warnung

    return {
        "bankname": (daten.get("bankname") or "").strip(),
        "basis": (daten.get("basis") or "").strip(),
        "waehrung": (daten.get("waehrung") or "CHF").strip(),
        "berichtsjahr": str(daten.get("berichtsjahr") or "").strip(),
        "einheitHinweis": (daten.get("einheitHinweis") or "").strip(),
        "jahre": sauber,
        "besonderheiten": [str(x)[:400] for x in (daten.get("besonderheiten") or [])
                           if str(x).strip()][:20],
        "nichtGefunden": [str(x)[:120] for x in (daten.get("nichtGefunden") or [])
                          if str(x).strip()][:60],
        "unbekannteFelder": sorted(set(verworfen))[:40],
    }


# --------------------------------------------------------------------------
# Plausibilitaetspruefung
#
# Der haeufigste Extraktionsfehler ist eine verwechselte Einheit: der Bericht
# weist "in CHF 1000" aus, der Wert landet aber ungerechnet als Millionenbetrag
# im Datensatz. Solche Fehler sind in einer langen Zahlenliste unsichtbar,
# verzerren aber jede abgeleitete Kennzahl. Diese Pruefungen machen sie im
# Pruefdialog sichtbar, ohne den Wert zu veraendern.
# --------------------------------------------------------------------------
_PROZENT_GRENZEN = {
    "cir": (0, 300), "roe": (-200, 200), "roa": (-100, 100),
    "cet1Quote": (0, 200), "eigenkapitalquote": (0, 100),
    "leverageRatio": (0, 100), "lcr": (0, 5000), "nsfr": (0, 2000),
    "nplQuote": (0, 100), "nettozinsmarge": (-20, 50),
    "frauenanteilFuehrung": (0, 100),
}


def pruefe_plausibilitaet(felder: dict) -> dict[str, str]:
    """felder: {kpiKey: {'value': ..}} -> {kpiKey: Warntext}"""
    def val(key):
        eintrag = felder.get(key) or {}
        v = eintrag.get("value")
        return v if isinstance(v, (int, float)) else None

    warnungen: dict[str, str] = {}
    bilanz = val("bilanzsumme")

    for key, (unten, oben) in _PROZENT_GRENZEN.items():
        v = val(key)
        if v is not None and not (unten <= v <= oben):
            warnungen[key] = (f"Prozentwert {v:g} liegt ausserhalb des erwarteten "
                              f"Bereichs {unten} bis {oben}.")

    # Groessenverhaeltnisse innerhalb der Bilanz
    if bilanz:
        for key, label in (("kreditvolumen", "Kreditvolumen"),
                           ("kundeneinlagen", "Kundeneinlagen")):
            v = val(key)
            if v is not None and v > bilanz * 1.05:
                warnungen[key] = (f"{label} übersteigt die Bilanzsumme. "
                                  "Möglicherweise eine verwechselte Einheit.")
        for key, label in (("personalaufwand", "Personalaufwand"),
                           ("sachaufwand", "Sachaufwand"),
                           ("jahresueberschuss", "Jahresüberschuss"),
                           ("eigenkapital", "Eigenkapital")):
            v = val(key)
            if v is not None and abs(v) > bilanz * 0.6:
                warnungen[key] = (f"{label} ist im Verhältnis zur Bilanzsumme "
                                  "ungewöhnlich hoch. Einheit prüfen.")

    # Aufwand gegen Ertrag
    ertrag = schema.ertrag_basis({k: val(k) for k in
                                  ("bruttoertrag", "zinserfolg", "kommissionserfolg",
                                   "handelserfolg", "uebrigerErfolg")})
    if ertrag and ertrag > 0:
        for key, label in (("personalaufwand", "Personalaufwand"),
                           ("sachaufwand", "Sachaufwand")):
            v = val(key)
            if v is not None and v > ertrag * 5:
                warnungen[key] = (f"{label} ist mehr als fünfmal so hoch wie der "
                                  "Bruttoertrag. Vermutlich in Tausend statt Millionen.")

    # Personalzahlen
    fte = val("mitarbeiterzahl")
    kopf = val("mitarbeiterKopfzahl")
    if fte is not None and (fte < 0 or fte > 500000):
        warnungen["mitarbeiterzahl"] = f"Personalbestand {fte:g} FTE wirkt unrealistisch."
    if fte is not None and kopf is not None and fte > kopf * 1.05:
        warnungen["mitarbeiterzahl"] = ("FTE liegt über der Kopfzahl. "
                                        "Die beiden Werte sind vermutlich vertauscht.")

    # Gremiengroessen
    for key, label in (("anzahlGeschaeftsleitung", "Geschäftsleitung"),
                       ("anzahlVerwaltungsrat", "Verwaltungsrat")):
        v = val(key)
        if v is not None and (v < 1 or v > 40):
            warnungen[key] = f"{label} mit {v:g} Mitgliedern ist unplausibel."

    return warnungen


# --------------------------------------------------------------------------
# Gesamtpipeline
# --------------------------------------------------------------------------
def run_pipeline(path, jahre: list[str], bankname: str | None = None,
                 force_ocr: bool = False, model: str | None = None,
                 progress=None) -> dict:
    """Vollstaendiger Durchlauf. progress(nachricht, prozent) ist optional."""
    def note(msg, pct):
        if progress:
            progress(msg, pct)

    note("PDF wird gelesen", 5)
    analyse = analyse_pdf(path)
    seiten = analyse["ausgewaehlteSeiten"]
    if not seiten:
        raise GeminiError("Das PDF enthält keine lesbaren Seiten.")

    note(f"{analyse['seitenGesamt']} Seiten erkannt, {len(seiten)} zur Auswertung gewählt", 20)

    text_by_page = {p["seite"]: p["text"] for p in analyse["seiten"]}
    braucht_ocr = [nr for nr in seiten
                   if force_ocr or (text_by_page.get(nr, "").strip().__len__()
                                    < get_settings()["textDensityThreshold"])]

    ocr_usage = None
    ocr_seiten: list[int] = []
    if braucht_ocr:
        note(f"OCR für {len(braucht_ocr)} Seite(n) erforderlich", 30)
        ergebnis = ocr_pages(path, braucht_ocr, progress=progress)
        for nr, text in ergebnis["texte"].items():
            if text.strip():
                text_by_page[nr] = text
                ocr_seiten.append(nr)
        ocr_usage = ergebnis["usage"]

    seitentexte = {nr: text_by_page.get(nr, "") for nr in seiten}
    gesamt_zeichen = sum(len(t) for t in seitentexte.values())
    if gesamt_zeichen < 200:
        raise GeminiError("Aus dem PDF liess sich kein verwertbarer Text gewinnen – "
                          "weder aus der Textebene noch per OCR.")

    note("Kennzahlen werden extrahiert", 70)
    extraktion = extract_metrics(seitentexte, jahre, bankname=bankname, model=model,
                                 progress=progress)
    note("Extraktion abgeschlossen", 95)

    return {
        "analyse": {k: v for k, v in analyse.items() if k != "seiten"},
        "seitenText": seitentexte,
        "ocrSeiten": sorted(ocr_seiten),
        "ocrUsage": ocr_usage,
        "textZeichen": gesamt_zeichen,
        "extraktion": extraktion,
    }
