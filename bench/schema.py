"""Kanonische KPI-Definitionen, Kategorien und abgeleitete Kennzahlen.

Grundsatz aus der Ursprungsanalyse: berichtete Werte werden NICHT geschaetzt.
Abgeleitete Kennzahlen werden serverseitig berechnet, aber strikt getrennt
gehalten und als `berechnet` markiert, damit der Nutzer jederzeit sieht,
was aus dem Bericht stammt und was daraus errechnet wurde.
"""

from __future__ import annotations

# --------------------------------------------------------------------------
# Kategorien
# --------------------------------------------------------------------------
KATEGORIEN = {
    "kern": "Kernkennzahlen",
    "kapital": "Kapital, Liquiditaet & Risiko",
    "ertrag": "Ertragsstruktur",
    "kosten": "Kostenstruktur",
    "organisation": "Organisation & Governance",
    "abgeleitet": "Abgeleitete Kennzahlen (berechnet)",
}

CHF_MIO = "CHF Mio."
PCT = "%"

# --------------------------------------------------------------------------
# Berichtete Kennzahlen
# key: (label, unit, hoeherIstBesser, kategorie, beschreibung, aliases)
# hoeherIstBesser: True | False | None (neutral -> keine Wertung)
# --------------------------------------------------------------------------
_REPORTED = {
    # --- Kern -------------------------------------------------------------
    "bilanzsumme": (
        "Bilanzsumme", CHF_MIO, True, "kern",
        "Summe aller Aktiven laut Bilanz zum Bilanzstichtag.",
        ["Total assets", "Bilanzsumme", "Total Aktiven", "Total der Aktiven"],
    ),
    "kreditvolumen": (
        "Kreditvolumen (Forderungen ggü. Kunden)", CHF_MIO, True, "kern",
        "Forderungen gegenüber Kunden inkl. Hypothekarforderungen.",
        ["Forderungen gegenüber Kunden", "Due from clients", "Loans to customers",
         "Kundenausleihungen", "Hypothekarforderungen"],
    ),
    "kundeneinlagen": (
        "Kundeneinlagen", CHF_MIO, True, "kern",
        "Verpflichtungen gegenüber Kunden (Kundengelder).",
        ["Verpflichtungen gegenüber Kunden", "Due to clients", "Kundengelder",
         "Customer deposits"],
    ),
    "aum": (
        "Verwaltete Kundenvermögen (AuM)", CHF_MIO, True, "kern",
        "Betreute bzw. verwaltete Kundenvermögen laut Bericht.",
        ["Kundenvermögen", "Assets under Management", "Total client assets",
         "betreute Kundenvermögen", "Verwaltetes Vermögen"],
    ),
    "jahresueberschuss": (
        "Jahresüberschuss", CHF_MIO, True, "kern",
        "Jahresgewinn nach Steuern (Konzern- bzw. Einzelergebnis).",
        ["Jahresgewinn", "Net profit", "Konzernergebnis", "Reingewinn", "Jahresergebnis"],
    ),
    "mitarbeiterzahl": (
        "Mitarbeiterzahl (FTE)", "FTE", None, "kern",
        "Teilzeitbereinigter Personalbestand in Vollzeitäquivalenten.",
        ["FTE", "Vollzeitstellen", "Personalbestand", "Mitarbeitende (FTE)",
         "Full-time equivalents"],
    ),
    "roe": (
        "Return on Equity (RoE)", PCT, True, "kern",
        "Eigenkapitalrendite im engeren Sinn (Gewinn / Eigenkapital). "
        "Achtung: eine als Gewinn/Bilanzsumme definierte 'Kapitalrendite' "
        "gehört unter RoA, nicht hierher.",
        ["Eigenkapitalrendite", "Return on Equity", "RoE"],
    ),
    "cir": (
        "Cost-Income-Ratio (CIR)", PCT, False, "kern",
        "Geschäftsaufwand im Verhältnis zum Bruttoertrag.",
        ["Cost-Income-Ratio", "Aufwand-Ertrags-Verhältnis", "CIR", "Cost/income ratio"],
    ),
    "nettozinsmarge": (
        "Nettozinsmarge", PCT, True, "kern",
        "Zinserfolg im Verhältnis zur zinstragenden Bilanz, nur wenn explizit ausgewiesen.",
        ["Nettozinsmarge", "Net interest margin", "Zinsmarge"],
    ),

    # --- Kapital, Liquiditaet, Risiko ------------------------------------
    "cet1Quote": (
        "CET1- / Kernkapitalquote", PCT, True, "kapital",
        "Hartes Kernkapital im Verhältnis zu den risikogewichteten Aktiven.",
        ["CET1", "Tier 1 ratio", "Kernkapitalquote", "Tier-1-Ratio", "Total capital ratio"],
    ),
    "eigenkapitalquote": (
        "Eigenkapitalquote (ausgewiesen)", PCT, True, "kapital",
        "Vom Bericht ausgewiesene Eigenkapitalquote.",
        ["Eigenkapitalquote", "Equity ratio"],
    ),
    "eigenkapital": (
        "Eigenkapital (absolut)", CHF_MIO, True, "kapital",
        "Bilanzielles Eigenkapital in absoluten Zahlen.",
        ["Eigenkapital", "Total equity", "Eigene Mittel"],
    ),
    "leverageRatio": (
        "Leverage Ratio", PCT, True, "kapital",
        "Kernkapital im Verhältnis zur ungewichteten Gesamtrisikoposition.",
        ["Leverage Ratio", "Verschuldungsquote"],
    ),
    "lcr": (
        "Liquidity Coverage Ratio (LCR)", PCT, True, "kapital",
        "Kurzfristige Liquiditätsdeckungsquote.",
        ["LCR", "Liquidity Coverage Ratio", "Liquiditätsdeckungsquote"],
    ),
    "nsfr": (
        "Net Stable Funding Ratio (NSFR)", PCT, True, "kapital",
        "Strukturelle Liquiditätsquote.",
        ["NSFR", "Net Stable Funding Ratio"],
    ),
    "nplQuote": (
        "NPL-Quote", PCT, False, "kapital",
        "Anteil notleidender Forderungen am Kreditvolumen.",
        ["NPL", "Non-performing loans", "NPL-Quote", "notleidende Kredite"],
    ),
    "gefaehrdeteForderungen": (
        "Gefährdete Forderungen (absolut)", CHF_MIO, False, "kapital",
        "Absolutbetrag gefährdeter Forderungen bzw. erwarteter Kreditverluste.",
        ["Gefährdete Forderungen", "impaired loans", "erwartete Kreditverluste", "ECL"],
    ),
    "wertberichtigungen": (
        "Wertberichtigungen für Ausfallrisiken", CHF_MIO, False, "kapital",
        "Gebildete Einzel-/Pauschalwertberichtigungen für Ausfallrisiken.",
        ["Wertberichtigungen", "Einzelwertberichtigungen", "Rückstellungen für Ausfallrisiken"],
    ),

    # --- Ertragsstruktur --------------------------------------------------
    "bruttoertrag": (
        "Bruttoertrag / Betriebsertrag", CHF_MIO, True, "ertrag",
        "Gesamter Geschäftsertrag vor Geschäftsaufwand.",
        ["Bruttoertrag", "Betriebsertrag", "Total operating income", "Geschäftsertrag"],
    ),
    "zinserfolg": (
        "Zinserfolg", CHF_MIO, None, "ertrag",
        "Erfolg aus dem Zinsengeschäft (Subtotal laut Erfolgsrechnung).",
        ["Erfolg aus dem Zinsengeschäft", "Net interest income", "Nettozinsertrag", "Zinserfolg"],
    ),
    "kommissionserfolg": (
        "Kommissionserfolg", CHF_MIO, None, "ertrag",
        "Erfolg aus dem Kommissions- und Dienstleistungsgeschäft.",
        ["Kommissions- und Dienstleistungsgeschäft", "Net fee and commission income",
         "Kommissionserfolg"],
    ),
    "handelserfolg": (
        "Handelserfolg", CHF_MIO, None, "ertrag",
        "Erfolg aus Finanzgeschäften bzw. dem Handelsgeschäft.",
        ["Erfolg aus Finanzgeschäften", "Trading income", "Handelserfolg",
         "Income from financial transactions"],
    ),
    "uebrigerErfolg": (
        "Übriger ordentlicher Erfolg", CHF_MIO, None, "ertrag",
        "Übriger ordentlicher Erfolg laut Erfolgsrechnung.",
        ["Übriger ordentlicher Erfolg", "Other ordinary income"],
    ),
    "nettoNeugeld": (
        "Netto-Neugeld", CHF_MIO, True, "ertrag",
        "Netto-Neugeldzufluss der Berichtsperiode.",
        ["Netto-Neugeld", "Net new money", "Net new assets", "Neugeld"],
    ),
    "roa": (
        "Kapitalrendite / RoA (ausgewiesen)", PCT, True, "ertrag",
        "Vom Bericht ausgewiesene Kapitalrendite (Gewinn / Bilanzsumme).",
        ["Kapitalrendite", "Return on assets", "Return on Investment", "RoA"],
    ),

    # --- Kostenstruktur ---------------------------------------------------
    "personalaufwand": (
        "Personalaufwand", CHF_MIO, None, "kosten",
        "Gesamter Personalaufwand der Berichtsperiode.",
        ["Personalaufwand", "Personnel expenses", "Staff costs"],
    ),
    "sachaufwand": (
        "Sachaufwand", CHF_MIO, None, "kosten",
        "Sachaufwand bzw. allgemeiner Verwaltungsaufwand.",
        ["Sachaufwand", "General and administrative expenses", "Geschäftsaufwand",
         "Other operating expenses"],
    ),
    "geschaeftsaufwand": (
        "Geschäftsaufwand (Total)", CHF_MIO, None, "kosten",
        "Total Geschäftsaufwand (Personal + Sach), sofern als Summe ausgewiesen.",
        ["Total Geschäftsaufwand", "Total operating expenses", "Geschäftsaufwand total"],
    ),
    "itAufwand": (
        "IT- / EDV-Aufwand", CHF_MIO, None, "kosten",
        "Separat ausgewiesener IT-/EDV-Aufwand, falls im Anhang aufgeschlüsselt.",
        ["EDV", "IT-Aufwand", "Informatikaufwand", "IT expenses"],
    ),
    "revisionBeratung": (
        "Revisions- & Beratungsaufwand", CHF_MIO, None, "kosten",
        "Honorare für Revision, Beratung und externe Dienstleistungen, falls separat.",
        ["Revisionshonorar", "Beratungsaufwand", "Audit fees", "Honorare"],
    ),
    "abschreibungen": (
        "Abschreibungen", CHF_MIO, None, "kosten",
        "Abschreibungen auf Sachanlagen und immateriellen Werten.",
        ["Abschreibungen", "Depreciation", "Amortisation"],
    ),

    # --- Organisation & Governance ---------------------------------------
    "mitarbeiterKopfzahl": (
        "Mitarbeitende (Kopfzahl)", "Anzahl", None, "organisation",
        "Personalbestand nach Köpfen (nicht teilzeitbereinigt).",
        ["Mitarbeitende", "Headcount", "Anzahl Mitarbeitende"],
    ),
    "anzahlGeschaeftsleitung": (
        "Geschäftsleitung (Mitglieder)", "Anzahl", None, "organisation",
        "Anzahl Mitglieder der Geschäftsleitung zum Stichtag.",
        ["Geschäftsleitung", "Executive Board", "Management Board"],
    ),
    "anzahlVerwaltungsrat": (
        "Verwaltungsrat (Mitglieder)", "Anzahl", None, "organisation",
        "Anzahl Mitglieder des Verwaltungsrats zum Stichtag.",
        ["Verwaltungsrat", "Board of Directors", "Aufsichtsrat"],
    ),
    "anzahlStandorte": (
        "Standorte / Niederlassungen", "Anzahl", None, "organisation",
        "Explizit genannte Anzahl Standorte bzw. Niederlassungen.",
        ["Niederlassungen", "Standorte", "Branches", "Geschäftsstellen"],
    ),
    "frauenanteilFuehrung": (
        "Frauenanteil Führungsebene", PCT, None, "organisation",
        "Frauenanteil auf der obersten Führungsebene, falls ausgewiesen.",
        ["Frauenanteil", "Geschlechterverteilung", "Gender diversity"],
    ),
}


# Absolute Groessenkennzahlen. Sie messen, wie gross ein Institut ist, nicht wie
# gut es wirtschaftet. In der Staerken-/Schwaechen-Auswertung wuerden sie jede
# kleinere Bank pauschal als schwach erscheinen lassen, deshalb sind sie dort
# standardmaessig ausgeblendet.
SKALEN_KPIS = {
    "bilanzsumme", "kreditvolumen", "kundeneinlagen", "aum", "jahresueberschuss",
    "eigenkapital", "bruttoertrag", "nettoNeugeld", "gefaehrdeteForderungen",
    "wertberichtigungen", "zinserfolg", "kommissionserfolg", "handelserfolg",
    "uebrigerErfolg", "personalaufwand", "sachaufwand", "geschaeftsaufwand",
    "itAufwand", "revisionBeratung", "abschreibungen", "mitarbeiterzahl",
    "mitarbeiterKopfzahl",
}


def _reported_defs() -> dict:
    out = {}
    for key, (label, unit, better, kat, desc, aliases) in _REPORTED.items():
        out[key] = {
            "key": key,
            "label": label,
            "unit": unit,
            "hoeherIstBesser": better,
            "kategorie": kat,
            "beschreibung": desc,
            "aliases": aliases,
            "berechnet": False,
            "skala": key in SKALEN_KPIS,
        }
    return out


# --------------------------------------------------------------------------
# Abgeleitete Kennzahlen
# Jede Formel bekommt ein dict {kpiKey: value|None} und gibt float|None zurueck.
# --------------------------------------------------------------------------

def _div(a, b, factor=1.0):
    if a is None or b is None:
        return None
    try:
        if b == 0:
            return None
        return (a / b) * factor
    except (TypeError, ZeroDivisionError):
        return None


def _sum_or_none(*vals):
    """Summe; None wenn ALLE Summanden fehlen, sonst Summe der vorhandenen."""
    present = [v for v in vals if isinstance(v, (int, float))]
    if not present:
        return None
    return sum(present)


def ertrag_basis(v: dict):
    """Bruttoertrag: berichtet bevorzugt, sonst Summe der Ertragssaeulen."""
    if isinstance(v.get("bruttoertrag"), (int, float)):
        return v["bruttoertrag"]
    return _sum_or_none(v.get("zinserfolg"), v.get("kommissionserfolg"),
                        v.get("handelserfolg"), v.get("uebrigerErfolg"))


def aufwand_basis(v: dict):
    if isinstance(v.get("geschaeftsaufwand"), (int, float)):
        return v["geschaeftsaufwand"]
    return _sum_or_none(v.get("personalaufwand"), v.get("sachaufwand"))


def _diversifikation(v: dict):
    """1 - HHI der drei Ertragssaeulen. 0 = eine Saeule, ~0.67 = perfekt gestreut."""
    parts = [v.get("zinserfolg"), v.get("kommissionserfolg"), v.get("handelserfolg")]
    parts = [p for p in parts if isinstance(p, (int, float)) and p > 0]
    if len(parts) < 2:
        return None
    total = sum(parts)
    if total <= 0:
        return None
    hhi = sum((p / total) ** 2 for p in parts)
    return (1 - hhi) * 100


_DERIVED = {
    "cirBerechnet": {
        "label": "CIR (berechnet)", "unit": PCT, "hoeherIstBesser": False,
        "beschreibung": "Geschäftsaufwand / Bruttoertrag × 100. Ersatzgrösse, wenn der "
                        "Bericht keine CIR ausweist.",
        "formel": "(Personalaufwand + Sachaufwand) / Bruttoertrag × 100",
        "fn": lambda v: _div(aufwand_basis(v), ertrag_basis(v), 100),
    },
    "roaBerechnet": {
        "label": "RoA (berechnet)", "unit": PCT, "hoeherIstBesser": True,
        "beschreibung": "Jahresüberschuss / Bilanzsumme × 100.",
        "formel": "Jahresüberschuss / Bilanzsumme × 100",
        "fn": lambda v: _div(v.get("jahresueberschuss"), v.get("bilanzsumme"), 100),
    },
    "roeBerechnet": {
        "label": "RoE (berechnet)", "unit": PCT, "hoeherIstBesser": True,
        "beschreibung": "Jahresüberschuss / bilanzielles Eigenkapital × 100.",
        "formel": "Jahresüberschuss / Eigenkapital × 100",
        "fn": lambda v: _div(v.get("jahresueberschuss"), v.get("eigenkapital"), 100),
    },
    "eigenkapitalquoteBerechnet": {
        "label": "Eigenkapitalquote (berechnet)", "unit": PCT, "hoeherIstBesser": True,
        "beschreibung": "Bilanzielles Eigenkapital / Bilanzsumme × 100.",
        "formel": "Eigenkapital / Bilanzsumme × 100",
        "fn": lambda v: _div(v.get("eigenkapital"), v.get("bilanzsumme"), 100),
    },
    "bilanzsummeProFte": {
        "label": "Bilanzsumme je FTE", "unit": "CHF Mio./FTE",
        "hoeherIstBesser": True,
        "beschreibung": "Produktivitäts-Proxy: Bilanzsumme pro Vollzeitäquivalent.",
        "formel": "Bilanzsumme / FTE",
        "fn": lambda v: _div(v.get("bilanzsumme"), v.get("mitarbeiterzahl")),
    },
    "aumProFte": {
        "label": "AuM je FTE", "unit": "CHF Mio./FTE", "hoeherIstBesser": True,
        "beschreibung": "Betreutes Kundenvermögen pro Vollzeitäquivalent.",
        "formel": "AuM / FTE",
        "fn": lambda v: _div(v.get("aum"), v.get("mitarbeiterzahl")),
    },
    "ertragProFte": {
        "label": "Bruttoertrag je FTE", "unit": "CHF Mio./FTE", "hoeherIstBesser": True,
        "beschreibung": "Ertragsproduktivität pro Vollzeitäquivalent.",
        "formel": "Bruttoertrag / FTE",
        "fn": lambda v: _div(ertrag_basis(v), v.get("mitarbeiterzahl")),
    },
    "gewinnProFte": {
        "label": "Gewinn je FTE", "unit": "CHF Mio./FTE", "hoeherIstBesser": True,
        "beschreibung": "Jahresüberschuss pro Vollzeitäquivalent.",
        "formel": "Jahresüberschuss / FTE",
        "fn": lambda v: _div(v.get("jahresueberschuss"), v.get("mitarbeiterzahl")),
    },
    "personalaufwandProFte": {
        "label": "Personalaufwand je FTE", "unit": "CHF Mio./FTE", "hoeherIstBesser": None,
        "beschreibung": "Durchschnittlicher Personalaufwand pro Vollzeitäquivalent.",
        "formel": "Personalaufwand / FTE",
        "fn": lambda v: _div(v.get("personalaufwand"), v.get("mitarbeiterzahl")),
    },
    "personalaufwandQuote": {
        "label": "Personalaufwandquote", "unit": PCT, "hoeherIstBesser": False,
        "beschreibung": "Anteil Personalaufwand am Bruttoertrag.",
        "formel": "Personalaufwand / Bruttoertrag × 100",
        "fn": lambda v: _div(v.get("personalaufwand"), ertrag_basis(v), 100),
    },
    "sachaufwandQuote": {
        "label": "Sachaufwandquote", "unit": PCT, "hoeherIstBesser": False,
        "beschreibung": "Anteil Sachaufwand am Bruttoertrag – Proxy für den extern "
                        "bezogenen Kostenblock (Fremdleistungen/Outsourcing).",
        "formel": "Sachaufwand / Bruttoertrag × 100",
        "fn": lambda v: _div(v.get("sachaufwand"), ertrag_basis(v), 100),
    },
    "personalSachVerhaeltnis": {
        "label": "Personal- zu Sachaufwand", "unit": "Faktor", "hoeherIstBesser": None,
        "beschreibung": "Verhältnis interner zu externer Kostenbasis. Niedrig = hoher "
                        "Fremdleistungsanteil.",
        "formel": "Personalaufwand / Sachaufwand",
        "fn": lambda v: _div(v.get("personalaufwand"), v.get("sachaufwand")),
    },
    "zinsanteil": {
        "label": "Ertragsanteil Zinsgeschäft", "unit": PCT, "hoeherIstBesser": None,
        "beschreibung": "Anteil des Zinserfolgs am Bruttoertrag.",
        "formel": "Zinserfolg / Bruttoertrag × 100",
        "fn": lambda v: _div(v.get("zinserfolg"), ertrag_basis(v), 100),
    },
    "kommissionsanteil": {
        "label": "Ertragsanteil Kommissionsgeschäft", "unit": PCT, "hoeherIstBesser": None,
        "beschreibung": "Anteil des Kommissionserfolgs am Bruttoertrag.",
        "formel": "Kommissionserfolg / Bruttoertrag × 100",
        "fn": lambda v: _div(v.get("kommissionserfolg"), ertrag_basis(v), 100),
    },
    "handelsanteil": {
        "label": "Ertragsanteil Handelsgeschäft", "unit": PCT, "hoeherIstBesser": None,
        "beschreibung": "Anteil des Handelserfolgs am Bruttoertrag.",
        "formel": "Handelserfolg / Bruttoertrag × 100",
        "fn": lambda v: _div(v.get("handelserfolg"), ertrag_basis(v), 100),
    },
    "ertragsdiversifikation": {
        "label": "Ertragsdiversifikation", "unit": "Index", "hoeherIstBesser": True,
        "beschreibung": "1 − Herfindahl-Index der drei Ertragssäulen, skaliert. "
                        "Hoch = breit abgestützte Ertragsbasis.",
        "formel": "(1 − HHI(Zins, Kommission, Handel)) × 100",
        "fn": _diversifikation,
    },
    "kreditquote": {
        "label": "Kreditquote (Kredite / Bilanzsumme)", "unit": PCT, "hoeherIstBesser": None,
        "beschreibung": "Anteil des Kundenkreditgeschäfts an der Bilanz.",
        "formel": "Kreditvolumen / Bilanzsumme × 100",
        "fn": lambda v: _div(v.get("kreditvolumen"), v.get("bilanzsumme"), 100),
    },
    "loanDepositRatio": {
        "label": "Loan-to-Deposit-Ratio", "unit": PCT, "hoeherIstBesser": None,
        "beschreibung": "Kredite im Verhältnis zu Kundeneinlagen. Unter 100 % = "
                        "einlagenfinanziert.",
        "formel": "Kreditvolumen / Kundeneinlagen × 100",
        "fn": lambda v: _div(v.get("kreditvolumen"), v.get("kundeneinlagen"), 100),
    },
    "aumZuBilanzsumme": {
        "label": "AuM / Bilanzsumme", "unit": "Faktor", "hoeherIstBesser": None,
        "beschreibung": "Hebel des Off-Balance-Geschäfts. Hoch = Vermögensverwaltung "
                        "dominiert gegenüber Bilanzgeschäft.",
        "formel": "AuM / Bilanzsumme",
        "fn": lambda v: _div(v.get("aum"), v.get("bilanzsumme")),
    },
    "aumMarge": {
        "label": "Bruttomarge auf AuM", "unit": "Basispunkte", "hoeherIstBesser": True,
        "beschreibung": "Bruttoertrag im Verhältnis zu den betreuten Kundenvermögen.",
        "formel": "Bruttoertrag / AuM × 10'000",
        "fn": lambda v: _div(ertrag_basis(v), v.get("aum"), 10000),
    },
    "fuehrungsspanne": {
        "label": "FTE je GL-Mitglied", "unit": "FTE", "hoeherIstBesser": None,
        "beschreibung": "Grober Führungsspannen-Proxy: Belegschaft pro Mitglied der "
                        "Geschäftsleitung.",
        "formel": "FTE / Anzahl Geschäftsleitung",
        "fn": lambda v: _div(v.get("mitarbeiterzahl"), v.get("anzahlGeschaeftsleitung")),
    },
    "teilzeitgrad": {
        "label": "Teilzeitgrad", "unit": PCT, "hoeherIstBesser": None,
        "beschreibung": "Abweichung FTE von Kopfzahl – Indikator für Teilzeitanteil.",
        "formel": "(1 − FTE / Kopfzahl) × 100",
        "fn": lambda v: (None if not isinstance(v.get("mitarbeiterzahl"), (int, float))
                         or not isinstance(v.get("mitarbeiterKopfzahl"), (int, float))
                         or not v.get("mitarbeiterKopfzahl")
                         else (1 - v["mitarbeiterzahl"] / v["mitarbeiterKopfzahl"]) * 100),
    },
    "gremiengroesse": {
        "label": "Gremiengrösse gesamt", "unit": "Anzahl", "hoeherIstBesser": None,
        "beschreibung": "Geschäftsleitung plus Verwaltungsrat. Nur belegt, wenn beide "
                        "Zahlen vorliegen – sonst wäre die Summe irreführend.",
        "formel": "Geschäftsleitung + Verwaltungsrat",
        "fn": lambda v: (v["anzahlGeschaeftsleitung"] + v["anzahlVerwaltungsrat"]
                         if isinstance(v.get("anzahlGeschaeftsleitung"), (int, float))
                         and isinstance(v.get("anzahlVerwaltungsrat"), (int, float))
                         else None),
    },
    "risikodeckung": {
        "label": "Gefährdete Forderungen / Kreditvolumen", "unit": PCT,
        "hoeherIstBesser": False,
        "beschreibung": "NPL-Proxy aus absoluten gefährdeten Forderungen.",
        "formel": "Gefährdete Forderungen / Kreditvolumen × 100",
        "fn": lambda v: _div(v.get("gefaehrdeteForderungen"), v.get("kreditvolumen"), 100),
    },
}


def derived_defs() -> dict:
    out = {}
    for key, d in _DERIVED.items():
        out[key] = {
            "key": key,
            "label": d["label"],
            "unit": d["unit"],
            "hoeherIstBesser": d["hoeherIstBesser"],
            "kategorie": "abgeleitet",
            "beschreibung": d["beschreibung"],
            "formel": d["formel"],
            "aliases": [],
            "berechnet": True,
            "skala": False,
        }
    return out


def all_kpi_defs() -> dict:
    defs = _reported_defs()
    defs.update(derived_defs())
    return defs


REPORTED_KEYS = list(_REPORTED.keys())
DERIVED_KEYS = list(_DERIVED.keys())


def compute_derived(values: dict) -> dict:
    """values: {reportedKpiKey: number|None} -> {derivedKey: number|None}"""
    out = {}
    for key, d in _DERIVED.items():
        try:
            res = d["fn"](values)
        except Exception:
            res = None
        if isinstance(res, (int, float)):
            if res != res or res in (float("inf"), float("-inf")):  # NaN / inf
                res = None
            else:
                res = round(float(res), 4)
        else:
            res = None
        out[key] = res
    return out


# --------------------------------------------------------------------------
# Untersuchungsbereiche (Vorgehensmodell)
# --------------------------------------------------------------------------
UNTERSUCHUNGSBEREICHE = [
    {
        "id": "ub1",
        "titel": "Organisationsstruktur, Teamdimensionierung und Führungsspannen",
        "beschreibung": "Analyse, ob Teamzuschnitte, Führungsebenen und Leitungsrelationen "
                        "zur heutigen Geschäftsgrösse passen.",
        "abgedeckteKpis": ["mitarbeiterzahl", "mitarbeiterKopfzahl", "anzahlGeschaeftsleitung",
                           "anzahlVerwaltungsrat", "fuehrungsspanne", "teilzeitgrad",
                           "gremiengroesse"],
        "luecke": "Geschäftsberichte liefern nur Gesamt-FTE und Namenslisten der Organe – keine "
                  "Teamzuschnitte, echten Führungsspannen (Anzahl direkter Reports) oder "
                  "Organigramm-Tiefe. Der Wert 'FTE je GL-Mitglied' ist ein grober Proxy, kein "
                  "Ersatz für interne Org-Daten.",
    },
    {
        "id": "ub2",
        "titel": "Fremdleistungen, Outsourcing und Drittanbieteraufwand",
        "beschreibung": "Untersuchung externer Kostenblöcke wie IT, Revision, Beratung und "
                        "weiterer Dienstleistungen.",
        "abgedeckteKpis": ["sachaufwand", "sachaufwandQuote", "itAufwand", "revisionBeratung",
                           "personalSachVerhaeltnis"],
        "luecke": "Keine der untersuchten Banken weist eine explizite Position 'Outsourcing' oder "
                  "'Dienstleistungen Dritter' aus. IT-/EDV-Aufwand ist meist mit "
                  "Mobiliar/Maschinen zusammengelegt. Die Sachaufwandquote ist die beste "
                  "verfügbare Annäherung.",
    },
    {
        "id": "ub3",
        "titel": "Profitabilität von Produkten, Services und Kundenbeziehungen",
        "beschreibung": "Analyse der Wirtschaftlichkeit von Angeboten, Servicelevels und "
                        "Kundenbeziehungen im Hinblick auf Erträge und gebundene Kapazitäten.",
        "abgedeckteKpis": ["zinserfolg", "kommissionserfolg", "handelserfolg", "zinsanteil",
                           "kommissionsanteil", "handelsanteil", "ertragsdiversifikation",
                           "aumMarge", "cir", "cirBerechnet", "jahresueberschuss"],
        "luecke": "Ertragsstruktur ist nur auf Gesamtbank-Ebene sichtbar, nicht nach Produkt, "
                  "Servicelevel oder Kundenbeziehung. Die Bruttomarge auf AuM ist ein "
                  "Gesamtbank-Durchschnitt und ersetzt keine Managementrechnung.",
    },
    {
        "id": "ub4",
        "titel": "Gruppenweite Synergien und Vereinfachung beider Häuser",
        "beschreibung": "Untersuchung von Doppelstrukturen, Schnittstellen und parallelen "
                        "Aktivitäten zur Realisierung von Synergien.",
        "abgedeckteKpis": [],
        "luecke": "Diese Fragestellung betrifft die interne Struktur der Zielgruppe selbst und ist "
                  "grundsätzlich nicht aus Peer-Vergleichsdaten ableitbar. Erfordert eine interne "
                  "Prozess- und Schnittstellenanalyse.",
    },
    {
        "id": "ub5",
        "titel": "Strukturelle Kostenbasis und Kostenflexibilität",
        "beschreibung": "Analyse der wesentlichen Kostenblöcke, um materielle Einsparpotenziale "
                        "sowie kurz-, mittel- und langfristig beeinflussbare Kosten transparent "
                        "zu machen.",
        "abgedeckteKpis": ["personalaufwand", "sachaufwand", "geschaeftsaufwand",
                           "personalaufwandQuote", "sachaufwandQuote", "personalaufwandProFte",
                           "abschreibungen", "cir", "cirBerechnet"],
        "luecke": "Der Personal-/Sachaufwand-Split ist durchgängig vorhanden, eine Fixkosten-/"
                  "variable-Kosten-Aufschlüsselung oder Aussagen zur kurzfristigen "
                  "Kostenflexibilität sind in keinem Bericht enthalten.",
    },
    {
        "id": "ub6",
        "titel": "Governance-, Steuerungs- und Kontrollmodell",
        "beschreibung": "Analyse von Gremien, Entscheidungswegen, Reporting, Kontrollintensität "
                        "und laufenden Initiativen.",
        "abgedeckteKpis": ["anzahlGeschaeftsleitung", "anzahlVerwaltungsrat", "gremiengroesse",
                           "frauenanteilFuehrung", "anzahlStandorte"],
        "luecke": "Nur Kopfzahlen der Führungsgremien sind verfügbar, teils nur zum aktuellsten "
                  "Berichtsstichtag. Ausschüsse, Sitzungsfrequenz, Reporting-Linien und "
                  "Kontrollintensität sind nicht strukturiert extrahierbar.",
    },
    {
        "id": "ub7",
        "titel": "Produktivität, Prozesseffizienz und Automatisierung",
        "beschreibung": "Untersuchung von Kapazitätsnutzung, manuellen Tätigkeiten, "
                        "Medienbrüchen und Prozessineffizienzen.",
        "abgedeckteKpis": ["bilanzsummeProFte", "aumProFte", "ertragProFte", "gewinnProFte",
                           "cir", "cirBerechnet", "mitarbeiterzahl"],
        "luecke": "Die Pro-FTE-Kennzahlen sind Produktivitäts-Proxys auf Gesamtbank-Ebene. "
                  "Automatisierungsgrad, Durchlaufzeiten und Prozesskennzahlen sind in keinem "
                  "Geschäftsbericht enthalten – dafür sind Prozessaufnahmen vor Ort nötig.",
    },
]
