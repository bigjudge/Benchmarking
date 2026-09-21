"""Auswertungslogik: Kennzahlmatrix, Rankings, Peer-Statistik, Insights."""

from __future__ import annotations

import math
from statistics import mean, median, pstdev

from . import schema, store

DEFS = schema.all_kpi_defs()


# --------------------------------------------------------------------------
# Matrix
# --------------------------------------------------------------------------
def reported_values(bank: dict, year: str) -> dict:
    """Nur berichtete Rohwerte als {key: number|None}."""
    ydata = (bank.get("jahre") or {}).get(str(year)) or {}
    out = {}
    for key in schema.REPORTED_KEYS:
        entry = ydata.get(key)
        val = entry.get("value") if isinstance(entry, dict) else None
        out[key] = val if isinstance(val, (int, float)) else None
    return out


def bank_year_cells(bank: dict, year: str) -> dict:
    """Alle Zellen inkl. abgeleiteter Kennzahlen, jeweils mit Metadaten."""
    ydata = (bank.get("jahre") or {}).get(str(year)) or {}
    cells: dict[str, dict] = {}

    for key in schema.REPORTED_KEYS:
        entry = ydata.get(key)
        if isinstance(entry, dict):
            val = entry.get("value")
            cells[key] = {
                "value": val if isinstance(val, (int, float)) else None,
                "unit": entry.get("unit") or DEFS[key]["unit"],
                "source": entry.get("source", ""),
                "herkunft": entry.get("herkunft", "leer"),
                "confidence": entry.get("confidence"),
                "seite": entry.get("seite"),
                "snippet": entry.get("snippet"),
                "geaendertAm": entry.get("geaendertAm"),
                "berechnet": False,
            }
        else:
            cells[key] = {"value": None, "unit": DEFS[key]["unit"], "source": "",
                          "herkunft": "leer", "confidence": None, "berechnet": False}

    raw = {k: c["value"] for k, c in cells.items()}
    for key, val in schema.compute_derived(raw).items():
        cells[key] = {
            "value": val,
            "unit": DEFS[key]["unit"],
            "source": DEFS[key].get("formel", ""),
            "herkunft": "berechnet" if val is not None else "leer",
            "confidence": None,
            "berechnet": True,
        }
    return cells


def matrix(data: dict, years: list[str] | None = None) -> dict:
    """{bankId: {year: {kpiKey: cell}}}"""
    years = years or store.all_years(data)
    out = {}
    for bank in data.get("banken", []):
        out[bank["id"]] = {y: bank_year_cells(bank, y) for y in years}
    return out


# --------------------------------------------------------------------------
# Statistik
# --------------------------------------------------------------------------
def _percentile(sorted_vals: list[float], value: float, higher_better) -> float | None:
    """Perzentilrang 0..100, wobei 100 = bester Wert gemaess Richtung."""
    if not sorted_vals or higher_better is None:
        return None
    n = len(sorted_vals)
    if n == 1:
        return 50.0
    below = sum(1 for v in sorted_vals if v < value)
    equal = sum(1 for v in sorted_vals if v == value)
    pct = (below + 0.5 * equal) / n * 100
    return round(pct if higher_better else 100 - pct, 1)


def kpi_stats(data: dict, kpi_key: str, year: str, bank_ids: list[str],
              mat: dict | None = None) -> dict:
    mat = mat if mat is not None else matrix(data, [year])
    definition = DEFS.get(kpi_key)
    if not definition:
        return {"kpi": kpi_key, "rows": [], "available": False}

    target = store.target_bank(data)
    target_id = target["id"] if target else None
    name_by_id = {b["id"]: b["name"] for b in data.get("banken", [])}
    kurz_by_id = {b["id"]: b.get("kuerzel") or b["name"] for b in data.get("banken", [])}

    rows = []
    for bid in bank_ids:
        cell = (mat.get(bid) or {}).get(year, {}).get(kpi_key)
        if not cell:
            continue
        rows.append({
            "bankId": bid,
            "name": name_by_id.get(bid, bid),
            "kuerzel": kurz_by_id.get(bid, bid),
            "istZielbank": bid == target_id,
            "value": cell.get("value"),
            "unit": cell.get("unit"),
            "source": cell.get("source"),
            "herkunft": cell.get("herkunft"),
            "confidence": cell.get("confidence"),
            "berechnet": cell.get("berechnet", False),
        })

    valued = [r for r in rows if isinstance(r["value"], (int, float))]
    higher_better = definition["hoeherIstBesser"]
    ranked = sorted(valued, key=lambda r: r["value"],
                    reverse=(higher_better is not False))
    for i, r in enumerate(ranked, start=1):
        r["rang"] = i if higher_better is not None else None

    peer_vals = [r["value"] for r in valued if not r["istZielbank"]]
    all_vals = sorted(r["value"] for r in valued)
    target_row = next((r for r in valued if r["istZielbank"]), None)

    stats = {
        "kpi": kpi_key,
        "definition": definition,
        "year": year,
        "available": bool(valued),
        "rows": ranked,
        "missing": [r for r in rows if not isinstance(r["value"], (int, float))],
        "n": len(valued),
        "peerN": len(peer_vals),
        "peerAvg": round(mean(peer_vals), 4) if peer_vals else None,
        "peerMedian": round(median(peer_vals), 4) if peer_vals else None,
        "peerMin": round(min(peer_vals), 4) if peer_vals else None,
        "peerMax": round(max(peer_vals), 4) if peer_vals else None,
        "peerStd": round(pstdev(peer_vals), 4) if len(peer_vals) > 1 else None,
        "target": target_row,
    }

    if target_row and peer_vals:
        avg = stats["peerAvg"]
        med = stats["peerMedian"]
        std = stats["peerStd"]
        tv = target_row["value"]
        stats["abweichungAvgPct"] = (round((tv - avg) / abs(avg) * 100, 2)
                                     if avg not in (None, 0) else None)
        # Bei sehr grossen Abweichungen ist ein Vielfaches lesbarer als Prozent
        if avg not in (None, 0) and tv * avg > 0 and abs(tv / avg) >= 10:
            stats["faktorAvg"] = round(tv / avg, 1)
        else:
            stats["faktorAvg"] = None
        stats["abweichungMedianPct"] = (round((tv - med) / abs(med) * 100, 2)
                                        if med not in (None, 0) else None)
        stats["zScore"] = round((tv - avg) / std, 2) if std else None
        stats["perzentil"] = _percentile(all_vals, tv, higher_better)
        stats["rang"] = target_row.get("rang")
        if higher_better is None:
            stats["bewertung"] = "neutral"
        else:
            besser = tv > avg if higher_better else tv < avg
            stats["bewertung"] = "staerke" if besser else "schwaeche"
    return stats


def timeseries(data: dict, kpi_key: str, bank_ids: list[str],
               years: list[str] | None = None) -> dict:
    years = sorted(years or store.all_years(data))
    mat = matrix(data, years)
    target = store.target_bank(data)
    target_id = target["id"] if target else None
    series = []
    for bid in bank_ids:
        bank = store.find_bank(data, bid)
        if not bank:
            continue
        points = []
        for y in years:
            cell = (mat.get(bid) or {}).get(y, {}).get(kpi_key) or {}
            points.append({"year": y, "value": cell.get("value"),
                           "source": cell.get("source", "")})
        if any(p["value"] is not None for p in points):
            series.append({
                "bankId": bid, "name": bank["name"],
                "kuerzel": bank.get("kuerzel") or bank["name"],
                "istZielbank": bid == target_id, "points": points,
            })
    return {"kpi": kpi_key, "definition": DEFS.get(kpi_key), "years": years,
            "series": series}


def growth(data: dict, kpi_key: str, bank_ids: list[str],
           year_from: str, year_to: str) -> list[dict]:
    mat = matrix(data, [year_from, year_to])
    target = store.target_bank(data)
    target_id = target["id"] if target else None
    out = []
    for bid in bank_ids:
        bank = store.find_bank(data, bid)
        if not bank:
            continue
        a = (mat.get(bid) or {}).get(year_from, {}).get(kpi_key, {}).get("value")
        b = (mat.get(bid) or {}).get(year_to, {}).get(kpi_key, {}).get("value")
        delta = pct = None
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            delta = round(b - a, 4)
            pct = round((b - a) / abs(a) * 100, 2) if a != 0 else None
        out.append({"bankId": bid, "name": bank["name"],
                    "kuerzel": bank.get("kuerzel") or bank["name"],
                    "istZielbank": bid == target_id,
                    "von": a, "bis": b, "delta": delta, "deltaPct": pct})
    return out


# --------------------------------------------------------------------------
# Insights
# --------------------------------------------------------------------------
def insights(data: dict, year: str, bank_ids: list[str],
             include_derived: bool = True, min_peers: int = 2,
             include_scale: bool = False) -> dict:
    """Staerken und Schwaechen der Zielbank.

    Absolute Groessenkennzahlen bleiben standardmaessig aussen vor: eine kleine
    Bank hat zwangslaeufig eine kleinere Bilanzsumme als der Peer-Durchschnitt,
    was nichts ueber ihre Leistung aussagt. Mit include_scale kommen sie zurueck.
    """
    mat = matrix(data, [year])
    staerken, schwaechen, neutral, skala = [], [], [], []
    keys = schema.REPORTED_KEYS + (schema.DERIVED_KEYS if include_derived else [])

    for key in keys:
        definition = DEFS[key]
        ist_skala = definition.get("skala", False)
        if ist_skala and not include_scale:
            st = kpi_stats(data, key, year, bank_ids, mat=mat)
            if st.get("target") and st.get("peerN", 0) >= min_peers:
                skala.append(_insight_item(key, definition, st))
            continue
        st = kpi_stats(data, key, year, bank_ids, mat=mat)
        if not st.get("target") or st.get("peerN", 0) < min_peers:
            continue
        item = _insight_item(key, definition, st)
        if item["bewertung"] == "staerke":
            staerken.append(item)
        elif item["bewertung"] == "schwaeche":
            schwaechen.append(item)
        else:
            neutral.append(item)

    staerken.sort(key=lambda x: x["score"], reverse=True)
    schwaechen.sort(key=lambda x: x["score"], reverse=True)
    neutral.sort(key=lambda x: x["label"])
    skala.sort(key=lambda x: x["label"])
    return {"year": year, "staerken": staerken, "schwaechen": schwaechen,
            "neutral": neutral, "skala": skala, "skalaAusgeblendet": not include_scale}


def _insight_item(key: str, definition: dict, st: dict) -> dict:
    item = {
        "kpi": key,
        "label": definition["label"],
        "unit": definition["unit"],
        "berechnet": definition.get("berechnet", False),
        "skala": definition.get("skala", False),
        "kategorie": definition["kategorie"],
        "wert": st["target"]["value"],
        "peerAvg": st["peerAvg"],
        "peerMedian": st["peerMedian"],
        "abweichungPct": st.get("abweichungAvgPct"),
        "faktor": st.get("faktorAvg"),
        "zScore": st.get("zScore"),
        "perzentil": st.get("perzentil"),
        "rang": st.get("rang"),
        "n": st["n"],
        "bewertung": st.get("bewertung"),
    }
    score = abs(item["zScore"]) if item["zScore"] is not None else (
        abs(item["abweichungPct"] or 0) / 100)
    item["score"] = round(score, 3)
    return item


def scorecard(data: dict, year: str, bank_ids: list[str]) -> dict:
    """Perzentil-Scorecard je Bank und Kategorie über alle wertbaren KPIs."""
    mat = matrix(data, [year])
    keys = [k for k in schema.REPORTED_KEYS + schema.DERIVED_KEYS
            if DEFS[k]["hoeherIstBesser"] is not None]
    per_bank: dict[str, dict] = {bid: {"kpis": {}, "kategorien": {}} for bid in bank_ids}

    for key in keys:
        definition = DEFS[key]
        rows = []
        for bid in bank_ids:
            v = (mat.get(bid) or {}).get(year, {}).get(key, {}).get("value")
            if isinstance(v, (int, float)):
                rows.append((bid, v))
        if len(rows) < 3:
            continue
        vals = sorted(v for _, v in rows)
        for bid, v in rows:
            p = _percentile(vals, v, definition["hoeherIstBesser"])
            if p is None:
                continue
            per_bank[bid]["kpis"][key] = p
            per_bank[bid]["kategorien"].setdefault(definition["kategorie"], []).append(p)

    target = store.target_bank(data)
    target_id = target["id"] if target else None
    result = []
    for bid, payload in per_bank.items():
        bank = store.find_bank(data, bid)
        if not bank:
            continue
        kats = {k: round(mean(v), 1) for k, v in payload["kategorien"].items() if v}
        alle = list(payload["kpis"].values())
        result.append({
            "bankId": bid, "name": bank["name"],
            "kuerzel": bank.get("kuerzel") or bank["name"],
            "istZielbank": bid == target_id,
            "gesamt": round(mean(alle), 1) if alle else None,
            "abgedeckteKpis": len(alle),
            "kategorien": kats,
            "kpis": payload["kpis"],
        })
    result.sort(key=lambda r: (r["gesamt"] is None, -(r["gesamt"] or 0)))
    return {"year": year, "kategorien": schema.KATEGORIEN, "banken": result}


def coverage(data: dict, years: list[str] | None = None) -> dict:
    """Datenabdeckung: wie viele berichtete KPIs sind je Bank/Jahr belegt."""
    years = years or store.all_years(data)
    total = len(schema.REPORTED_KEYS)
    rows = []
    for bank in data.get("banken", []):
        per_year = {}
        for y in years:
            vals = reported_values(bank, y)
            filled = sum(1 for v in vals.values() if v is not None)
            per_year[y] = {"belegt": filled, "total": total,
                           "quote": round(filled / total * 100, 1) if total else 0}
        rows.append({"bankId": bank["id"], "name": bank["name"],
                     "kuerzel": bank.get("kuerzel") or bank["name"],
                     "jahre": per_year})
    kpi_rows = []
    for key in schema.REPORTED_KEYS:
        filled = 0
        tot = 0
        for bank in data.get("banken", []):
            for y in years:
                tot += 1
                v = reported_values(bank, y).get(key)
                if v is not None:
                    filled += 1
        kpi_rows.append({"kpi": key, "label": DEFS[key]["label"],
                         "kategorie": DEFS[key]["kategorie"],
                         "belegt": filled, "total": tot,
                         "quote": round(filled / tot * 100, 1) if tot else 0})
    kpi_rows.sort(key=lambda r: r["quote"])
    return {"years": years, "banken": rows, "kpis": kpi_rows}


def bereiche_status(data: dict, year: str, bank_ids: list[str]) -> list[dict]:
    """Untersuchungsbereiche inkl. Abdeckungsgrad im aktuellen Datenbestand."""
    mat = matrix(data, [year])
    out = []
    for ub in data.get("untersuchungsbereiche", schema.UNTERSUCHUNGSBEREICHE):
        kpis = []
        for key in ub.get("abgedeckteKpis", []):
            definition = DEFS.get(key)
            if not definition:
                continue
            belegt = sum(1 for bid in bank_ids
                         if isinstance((mat.get(bid) or {}).get(year, {})
                                       .get(key, {}).get("value"), (int, float)))
            kpis.append({"kpi": key, "label": definition["label"],
                         "berechnet": definition.get("berechnet", False),
                         "belegt": belegt, "vonBanken": len(bank_ids)})
        gesamt = sum(k["belegt"] for k in kpis)
        moeglich = sum(k["vonBanken"] for k in kpis)
        out.append({**ub, "kpiStatus": kpis,
                    "abdeckung": round(gesamt / moeglich * 100, 1) if moeglich else 0})
    return out


def correlation(data: dict, kpi_x: str, kpi_y: str, year: str,
                bank_ids: list[str]) -> dict:
    mat = matrix(data, [year])
    target = store.target_bank(data)
    target_id = target["id"] if target else None
    pts = []
    for bid in bank_ids:
        bank = store.find_bank(data, bid)
        if not bank:
            continue
        x = (mat.get(bid) or {}).get(year, {}).get(kpi_x, {}).get("value")
        y = (mat.get(bid) or {}).get(year, {}).get(kpi_y, {}).get("value")
        if isinstance(x, (int, float)) and isinstance(y, (int, float)):
            pts.append({"bankId": bid, "name": bank["name"],
                        "kuerzel": bank.get("kuerzel") or bank["name"],
                        "istZielbank": bid == target_id, "x": x, "y": y})
    r = None
    if len(pts) > 2:
        xs = [p["x"] for p in pts]
        ys = [p["y"] for p in pts]
        mx, my = mean(xs), mean(ys)
        num = sum((a - mx) * (b - my) for a, b in zip(xs, ys))
        den = math.sqrt(sum((a - mx) ** 2 for a in xs) * sum((b - my) ** 2 for b in ys))
        if den:
            r = round(num / den, 3)
    return {"x": {"kpi": kpi_x, "definition": DEFS.get(kpi_x)},
            "y": {"kpi": kpi_y, "definition": DEFS.get(kpi_y)},
            "year": year, "punkte": pts, "r": r}
