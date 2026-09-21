"""Migriert den DATA-Block aus dem alten statischen Dashboard in den Store.

Aufruf:  python tools/seed_from_html.py ["benchmarking (1) 1.html"] [--force]
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bench import store, schema  # noqa: E402
from bench.config import BASE_DIR  # noqa: E402

DEFAULT_HTML = BASE_DIR / "benchmarking (1) 1.html"

# Altes Feld -> neuer kanonischer KPI-Key
KEY_MAP = {
    "bilanzsumme": "bilanzsumme",
    "eigenkapitalquote": "eigenkapitalquote",
    "cet1Quote": "cet1Quote",
    "roe": "roe",
    "cir": "cir",
    "nettozinsmarge": "nettozinsmarge",
    "kreditvolumen": "kreditvolumen",
    "kundeneinlagen": "kundeneinlagen",
    "nplQuote": "nplQuote",
    "jahresueberschuss": "jahresueberschuss",
    "mitarbeiterzahl": "mitarbeiterzahl",
    "aum": "aum",
    "leverageRatio": "leverageRatio",
    "lcr": "lcr",
    "personalaufwand": "personalaufwand",
    "sachaufwand": "sachaufwand",
    "zinserfolg": "zinserfolg",
    "kommissionserfolg": "kommissionserfolg",
    "handelserfolg": "handelserfolg",
    "anzahlGeschaeftsleitung": "anzahlGeschaeftsleitung",
    "anzahlVerwaltungsrat": "anzahlVerwaltungsrat",
    "anzahlStandorte": "anzahlStandorte",
}

# Felder aus dem alten "weitere"-Sack, die zu echten KPIs werden
WEITERE_MAP = {
    "aum": "aum",
    "leverageRatio": "leverageRatio",
    "lcr": "lcr",
    "nsfr": "nsfr",
    "nettoNeugeld": "nettoNeugeld",
    "bruttoertrag": "bruttoertrag",
    "eigenkapitalAbsolut": "eigenkapital",
    "mitarbeiterKopfzahl": "mitarbeiterKopfzahl",
    "kapitalrenditeRoA_Konzern": "roa",
    "kapitalrenditeROA": "roa",
    "returnOnAssets": "roa",
    "returnOnInvestmentROA": "roa",
    "gefaehrdeteForderungenNettoKonzern": "gefaehrdeteForderungen",
    "gefaehrdeteForderungenBrutto": "gefaehrdeteForderungen",
    "gefaehrdeteForderungenBruttoKonsolidiert": "gefaehrdeteForderungen",
    "einzelwertberichtigungenAusfallrisiken": "wertberichtigungen",
    "totalClientAssets": "aum",
}

# Felder, die bewusst als Zusatzinfo am Bank-Jahr haengen bleiben
KEEP_AS_EXTRA = {
    "geschaeftsvolumen", "kundengelderBreit", "custodyAssets", "netNewAssets",
    "dueToAffiliatedBanks", "einzelabschluss_bilanzsumme",
    "einzelabschluss_jahresueberschuss", "einzelabschluss_mitarbeiterzahl",
}


def extract_data(html_path: Path) -> dict:
    text = html_path.read_text(encoding="utf-8")
    m = re.search(r"const DATA = (\{.*?\n\});", text, re.DOTALL)
    if not m:
        raise SystemExit("DATA-Block in der HTML-Datei nicht gefunden.")
    return json.loads(m.group(1))


def convert_metric(raw: dict, kpi_key: str, quelle: str) -> dict:
    value = raw.get("value")
    src = (raw.get("source") or "").strip()
    has_value = isinstance(value, (int, float))
    return {
        "value": value if has_value else None,
        "unit": raw.get("unit") or schema.all_kpi_defs().get(kpi_key, {}).get("unit", ""),
        "source": src,
        "herkunft": "bericht" if has_value else "leer",
        "confidence": 0.95 if has_value else None,
        "quelldatei": quelle,
    }


def build_store(old: dict) -> dict:
    data = store.empty_store()
    meta_old = old.get("meta", {})
    data["meta"].update({
        "titel": "Bank-Benchmarking Liechtenstein",
        "waehrung": meta_old.get("waehrung", "CHF"),
        "hinweis": meta_old.get("hinweis", ""),
        "quellordner": meta_old.get("quellordner", ""),
    })

    for b_old in old.get("banken", []):
        bank_id = store.new_id("bank")
        bank = {
            "id": bank_id,
            "name": b_old["name"],
            "kuerzel": kurz(b_old["name"]),
            "quelldatei": b_old.get("quelldatei", ""),
            "basis": b_old.get("basis", ""),
            "gruppe": klassifiziere(b_old["name"], b_old.get("basis", "")),
            "notizen": "",
            "angelegtAm": store.now_iso(),
            "jahre": {},
            "extra": {},
        }
        if b_old.get("istZielbank"):
            data["meta"]["zielbankId"] = bank_id

        for year, ydata in (b_old.get("jahre") or {}).items():
            jahr = {}
            for old_key, raw in ydata.items():
                if old_key == "weitere":
                    continue
                new_key = KEY_MAP.get(old_key)
                if not new_key or not isinstance(raw, dict):
                    continue
                jahr[new_key] = convert_metric(raw, new_key, bank["quelldatei"])

            extra = {}
            for wk, raw in (ydata.get("weitere") or {}).items():
                if not isinstance(raw, dict):
                    continue
                target = WEITERE_MAP.get(wk)
                if target:
                    existing = jahr.get(target)
                    if existing and isinstance(existing.get("value"), (int, float)):
                        continue  # vorhandenen Hauptwert nicht ueberschreiben
                    jahr[target] = convert_metric(raw, target, bank["quelldatei"])
                elif wk in KEEP_AS_EXTRA:
                    extra[wk] = raw
                else:
                    extra[wk] = raw
            if extra:
                bank["extra"].setdefault(year, {}).update(extra)
            bank["jahre"][str(year)] = jahr

        data["banken"].append(bank)

    data["methodik"] = {
        "verwendeteDateien": old.get("methodik", {}).get("verwendeteDateien", []),
        "einschraenkungen": old.get("methodik", {}).get("einschraenkungen", []),
    }
    data["untersuchungsbereiche"] = schema.UNTERSUCHUNGSBEREICHE
    return data


def kurz(name: str) -> str:
    replacements = {
        "SIGMA Bank AG": "SIGMA",
        "Bendura Bank AG": "Bendura",
        "Bank Frick & Co. AG": "Bank Frick",
        "Liechtensteinische Landesbank AG": "LLB",
        "LGT Bank AG": "LGT",
        "EFG Bank von Ernst AG": "EFG von Ernst",
        "Kaiser Partner Privatbank AG": "Kaiser Partner",
        "Neue Bank AG": "Neue Bank",
        "Banking Circle (Liechtenstein) AG": "Banking Circle",
    }
    if name in replacements:
        return replacements[name]
    return re.sub(r"\s+(AG|SA|Ltd\.?)$", "", name).strip()[:24]


def klassifiziere(name: str, basis: str) -> str:
    n = name.lower()
    if "landesbank" in n:
        return "Universalbank"
    if "banking circle" in n:
        return "Nischenbank / Zahlungsverkehr"
    if "frick" in n:
        return "Spezial-/Transaktionsbank"
    if any(k in n for k in ("lgt", "kaiser", "efg", "neue bank", "bendura")):
        return "Privatbank / Vermögensverwaltung"
    return "Universalbank"


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    html_path = Path(args[0]) if args else DEFAULT_HTML
    if not html_path.exists():
        raise SystemExit(f"Datei nicht gefunden: {html_path}")

    from bench.config import STORE_PATH
    if STORE_PATH.exists() and not force:
        existing = store.load()
        if existing.get("banken"):
            print(f"Store enthaelt bereits {len(existing['banken'])} Banken. "
                  f"Mit --force ueberschreiben.")
            return

    old = extract_data(html_path)
    data = build_store(old)
    store.save(data, action="seed", details={"quelle": html_path.name,
                                             "banken": len(data["banken"])}, backup=False)
    kpis = sum(1 for b in data["banken"] for y in b["jahre"].values()
               for m in y.values() if m.get("value") is not None)
    print(f"OK: {len(data['banken'])} Banken, "
          f"{len(store.all_years(data))} Jahre, {kpis} belegte Kennzahlwerte -> {STORE_PATH}")


if __name__ == "__main__":
    main()
