"""REST-Schnittstelle des Benchmarking-Servers."""

from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path

from flask import Blueprint, Response, jsonify, request, send_file
from werkzeug.utils import secure_filename

from . import analytics, config, exporters, extraction, gemini, jobs, schema, store
from .config import UPLOAD_DIR

api = Blueprint("api", __name__, url_prefix="/api")

DEFS = schema.all_kpi_defs()


# --------------------------------------------------------------------------
# Helfer
# --------------------------------------------------------------------------
class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


@api.errorhandler(ApiError)
def _handle_api_error(exc: ApiError):
    return jsonify({"fehler": exc.message}), exc.status


@api.errorhandler(gemini.GeminiError)
def _handle_gemini_error(exc):
    return jsonify({"fehler": str(exc)}), 502


@api.errorhandler(Exception)
def _handle_unexpected(exc):
    return jsonify({"fehler": f"Unerwarteter Serverfehler: {exc}"}), 500


def body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def selected_banks(data: dict) -> list[str]:
    """Bank-IDs aus ?banks=a,b oder Body; Standard: alle. Zielbank immer dabei."""
    raw = request.args.get("banks") or ",".join(body().get("banks") or [])
    alle = [b["id"] for b in data.get("banken", [])]
    if not raw:
        ids = alle
    else:
        wanted = {x.strip() for x in raw.split(",") if x.strip()}
        ids = [b for b in alle if b in wanted]
    target = store.target_bank(data)
    if target and target["id"] not in ids:
        ids = [target["id"]] + ids
    return ids or alle


def selected_year(data: dict) -> str:
    years = store.all_years(data)
    year = request.args.get("year") or body().get("year")
    if year and str(year) in years:
        return str(year)
    return years[0] if years else datetime.now().strftime("%Y")


def selected_years(data: dict) -> list[str]:
    years = store.all_years(data)
    raw = request.args.get("years")
    if raw:
        wanted = [y.strip() for y in raw.split(",") if y.strip() in years]
        if wanted:
            return sorted(wanted)
    return sorted(years)


def bool_arg(name: str, default: bool = True) -> bool:
    raw = request.args.get(name)
    if raw is None:
        raw = body().get(name)
    if raw is None:
        return default
    if isinstance(raw, bool):
        return raw
    return str(raw).strip().lower() in ("1", "true", "yes", "ja", "on")


# --------------------------------------------------------------------------
# Stammdaten
# --------------------------------------------------------------------------
@api.get("/bootstrap")
def bootstrap():
    """Alles, was die Oberflaeche beim Start braucht."""
    data = store.load()
    target = store.target_bank(data)
    return jsonify({
        "meta": data.get("meta", {}),
        "zielbankId": target["id"] if target else None,
        "jahre": store.all_years(data),
        "kategorien": schema.KATEGORIEN,
        "kpiDefinitionen": DEFS,
        "berichteteKpis": schema.REPORTED_KEYS,
        "abgeleiteteKpis": schema.DERIVED_KEYS,
        "banken": [{
            "id": b["id"], "name": b["name"],
            "kuerzel": b.get("kuerzel") or b["name"],
            "gruppe": b.get("gruppe", ""), "basis": b.get("basis", ""),
            "quelldatei": b.get("quelldatei", ""),
            "notizen": b.get("notizen", ""),
            "istZielbank": bool(target and b["id"] == target["id"]),
            "jahre": sorted(b.get("jahre", {}).keys()),
        } for b in data.get("banken", [])],
        "uploads": [_upload_summary(u) for u in data.get("uploads", [])],
        "methodik": data.get("methodik", {}),
        "einstellungen": config.get_settings(),
        "auditAnzahl": len(data.get("audit", [])),
    })


@api.get("/banks")
def list_banks():
    data = store.load()
    target = store.target_bank(data)
    return jsonify([{**b, "istZielbank": bool(target and b["id"] == target["id"])}
                    for b in data.get("banken", [])])


@api.post("/banks")
def create_bank():
    payload = body()
    name = (payload.get("name") or "").strip()
    if not name:
        raise ApiError("Der Name der Bank darf nicht leer sein.")
    data = store.load()
    if store.find_bank_by_name(data, name):
        raise ApiError(f"Eine Bank mit dem Namen „{name}“ existiert bereits.", 409)

    bank = {
        "id": store.new_id("bank"),
        "name": name,
        "kuerzel": (payload.get("kuerzel") or name)[:24],
        "gruppe": payload.get("gruppe", ""),
        "basis": payload.get("basis", ""),
        "quelldatei": payload.get("quelldatei", ""),
        "notizen": payload.get("notizen", ""),
        "angelegtAm": store.now_iso(),
        "jahre": {},
        "extra": {},
    }
    data["banken"].append(bank)
    if payload.get("istZielbank") or not data["meta"].get("zielbankId"):
        data["meta"]["zielbankId"] = bank["id"]
    store.save(data, action="bank.erstellt", details={"name": name})
    return jsonify(bank), 201


@api.patch("/banks/<bank_id>")
def update_bank(bank_id: str):
    payload = body()
    data = store.load()
    bank = store.find_bank(data, bank_id)
    if not bank:
        raise ApiError("Bank nicht gefunden.", 404)
    for field in ("name", "kuerzel", "gruppe", "basis", "quelldatei", "notizen"):
        if field in payload:
            bank[field] = str(payload[field])[:300]
    if payload.get("istZielbank"):
        data["meta"]["zielbankId"] = bank_id
    store.save(data, action="bank.geaendert", details={"name": bank["name"]})
    return jsonify(bank)


@api.delete("/banks/<bank_id>")
def delete_bank(bank_id: str):
    data = store.load()
    bank = store.find_bank(data, bank_id)
    if not bank:
        raise ApiError("Bank nicht gefunden.", 404)
    data["banken"] = [b for b in data["banken"] if b["id"] != bank_id]
    if data["meta"].get("zielbankId") == bank_id:
        data["meta"]["zielbankId"] = data["banken"][0]["id"] if data["banken"] else None
    for u in data.get("uploads", []):
        if u.get("bankId") == bank_id:
            u["bankId"] = None
    store.save(data, action="bank.geloescht", details={"name": bank["name"]})
    return jsonify({"ok": True, "geloescht": bank["name"]})


@api.post("/target/<bank_id>")
def set_target(bank_id: str):
    data = store.load()
    bank = store.find_bank(data, bank_id)
    if not bank:
        raise ApiError("Bank nicht gefunden.", 404)
    data["meta"]["zielbankId"] = bank_id
    store.save(data, action="zielbank.gesetzt", details={"name": bank["name"]})
    return jsonify({"ok": True, "zielbankId": bank_id, "name": bank["name"]})


# --------------------------------------------------------------------------
# Kennzahlen
# --------------------------------------------------------------------------
@api.get("/banks/<bank_id>/metrics")
def bank_metrics(bank_id: str):
    data = store.load()
    bank = store.find_bank(data, bank_id)
    if not bank:
        raise ApiError("Bank nicht gefunden.", 404)
    years = selected_years(data) or store.all_years(data)
    if not years:
        years = [datetime.now().strftime("%Y")]
    return jsonify({
        "bank": {k: v for k, v in bank.items() if k not in ("jahre", "extra")},
        "jahre": {y: analytics.bank_year_cells(bank, y) for y in years},
        "extra": bank.get("extra", {}),
    })


@api.put("/banks/<bank_id>/metrics/<year>")
def save_metrics(bank_id: str, year: str):
    """Manuelle Korrektur. Body: {werte: {kpiKey: {value, source, unit}}}"""
    payload = body()
    werte = payload.get("werte")
    if not isinstance(werte, dict):
        raise ApiError("Es wurden keine Werte übergeben.")

    data = store.load()
    bank = store.find_bank(data, bank_id)
    if not bank:
        raise ApiError("Bank nicht gefunden.", 404)

    geaendert = []
    for key, entry in werte.items():
        if key not in schema.REPORTED_KEYS:
            continue
        if isinstance(entry, dict):
            roh = entry.get("value")
            quelle = entry.get("source")
            einheit = entry.get("unit")
            herkunft = entry.get("herkunft") or "manuell"
        else:
            roh, quelle, einheit, herkunft = entry, None, None, "manuell"
        wert = extraction.parse_number(roh)
        alt = ((bank.get("jahre") or {}).get(str(year)) or {}).get(key, {})
        store.set_metric(bank, year, key, wert,
                         source=quelle if quelle is not None else alt.get("source", ""),
                         herkunft=herkunft,
                         confidence=1.0 if wert is not None and herkunft == "manuell"
                         else alt.get("confidence"),
                         unit=einheit)
        if alt.get("value") != wert:
            geaendert.append({"kpi": key, "vorher": alt.get("value"), "nachher": wert})

    store.save(data, action="kennzahlen.gespeichert",
               details={"bank": bank["name"], "jahr": year,
                        "anzahl": len(geaendert), "felder": geaendert[:40]})
    return jsonify({"ok": True, "geaendert": len(geaendert),
                    "jahr": analytics.bank_year_cells(bank, year)})


@api.delete("/banks/<bank_id>/metrics/<year>")
def delete_year(bank_id: str, year: str):
    data = store.load()
    bank = store.find_bank(data, bank_id)
    if not bank:
        raise ApiError("Bank nicht gefunden.", 404)
    if str(year) in (bank.get("jahre") or {}):
        bank["jahre"].pop(str(year))
        store.save(data, action="jahr.geloescht",
                   details={"bank": bank["name"], "jahr": year})
    return jsonify({"ok": True})


# --------------------------------------------------------------------------
# Auswertungen
# --------------------------------------------------------------------------
@api.get("/analysis/matrix")
def analysis_matrix():
    data = store.load()
    years = selected_years(data)
    ids = selected_banks(data)
    mat = analytics.matrix(data, years)
    return jsonify({
        "jahre": years,
        "banken": [{"id": b["id"], "name": b["name"],
                    "kuerzel": b.get("kuerzel") or b["name"],
                    "gruppe": b.get("gruppe", ""), "basis": b.get("basis", "")}
                   for b in data["banken"] if b["id"] in ids],
        "zellen": {bid: mat[bid] for bid in ids if bid in mat},
    })


@api.get("/analysis/kpi/<kpi_key>")
def analysis_kpi(kpi_key: str):
    if kpi_key not in DEFS:
        raise ApiError(f"Unbekannte Kennzahl: {kpi_key}", 404)
    data = store.load()
    year = selected_year(data)
    ids = selected_banks(data)
    return jsonify({
        "stats": analytics.kpi_stats(data, kpi_key, year, ids),
        "verlauf": analytics.timeseries(data, kpi_key, ids, store.all_years(data)),
    })


@api.get("/analysis/growth/<kpi_key>")
def analysis_growth(kpi_key: str):
    data = store.load()
    years = store.all_years(data)
    if len(years) < 2:
        return jsonify({"zeilen": [], "hinweis": "Es liegt nur ein Berichtsjahr vor."})
    von = request.args.get("from") or sorted(years)[-2]
    bis = request.args.get("to") or sorted(years)[-1]
    return jsonify({"von": von, "bis": bis,
                    "zeilen": analytics.growth(data, kpi_key, selected_banks(data), von, bis)})


@api.get("/analysis/insights")
def analysis_insights():
    data = store.load()
    return jsonify(analytics.insights(data, selected_year(data), selected_banks(data),
                                      include_derived=bool_arg("derived", True),
                                      include_scale=bool_arg("skala", False)))


@api.get("/analysis/scorecard")
def analysis_scorecard():
    data = store.load()
    return jsonify(analytics.scorecard(data, selected_year(data), selected_banks(data)))


@api.get("/analysis/coverage")
def analysis_coverage():
    data = store.load()
    return jsonify(analytics.coverage(data, selected_years(data)))


@api.get("/analysis/bereiche")
def analysis_bereiche():
    data = store.load()
    return jsonify(analytics.bereiche_status(data, selected_year(data),
                                             selected_banks(data)))


@api.get("/analysis/scatter")
def analysis_scatter():
    data = store.load()
    x = request.args.get("x", "bilanzsumme")
    y = request.args.get("y", "cirBerechnet")
    if x not in DEFS or y not in DEFS:
        raise ApiError("Unbekannte Kennzahl für die Achsen.", 404)
    return jsonify(analytics.correlation(data, x, y, selected_year(data),
                                         selected_banks(data)))


# --------------------------------------------------------------------------
# Upload & Extraktion
# --------------------------------------------------------------------------
def _upload_summary(u: dict) -> dict:
    return {k: v for k, v in u.items() if k not in ("seitenText", "extraktion")} | {
        "hatExtraktion": bool(u.get("extraktion")),
        "seitenMitText": len(u.get("seitenText") or {}),
    }


@api.get("/uploads")
def list_uploads():
    data = store.load()
    return jsonify([_upload_summary(u) for u in data.get("uploads", [])])


@api.get("/uploads/<upload_id>")
def get_upload(upload_id: str):
    data = store.load()
    upload = store.find_upload(data, upload_id)
    if not upload:
        raise ApiError("Upload nicht gefunden.", 404)
    return jsonify(upload)


@api.get("/uploads/<upload_id>/file")
def download_upload(upload_id: str):
    data = store.load()
    upload = store.find_upload(data, upload_id)
    if not upload:
        raise ApiError("Upload nicht gefunden.", 404)
    path = UPLOAD_DIR / upload["gespeichertAls"]
    if not path.exists():
        raise ApiError("Die Datei ist nicht mehr vorhanden.", 404)
    return send_file(path, mimetype="application/pdf",
                     download_name=upload["dateiname"])


@api.delete("/uploads/<upload_id>")
def delete_upload(upload_id: str):
    data = store.load()
    upload = store.find_upload(data, upload_id)
    if not upload:
        raise ApiError("Upload nicht gefunden.", 404)
    path = UPLOAD_DIR / upload.get("gespeichertAls", "")
    if path.exists():
        try:
            path.unlink()
        except OSError:
            pass
    data["uploads"] = [u for u in data["uploads"] if u["id"] != upload_id]
    store.save(data, action="upload.geloescht", details={"datei": upload["dateiname"]})
    return jsonify({"ok": True})


@api.post("/uploads")
def create_upload():
    """PDF entgegennehmen und die Extraktion als Hintergrundjob starten."""
    if "datei" not in request.files and "file" not in request.files:
        raise ApiError("Es wurde keine Datei übermittelt.")
    file = request.files.get("datei") or request.files["file"]
    if not file.filename:
        raise ApiError("Die Datei hat keinen Namen.")
    if not file.filename.lower().endswith(".pdf"):
        raise ApiError("Es werden nur PDF-Dateien unterstützt.")
    if not config.get_api_key():
        raise ApiError("Kein Gemini-API-Key hinterlegt. Bitte zuerst unter "
                       "Einstellungen eintragen.", 428)

    original = secure_filename(file.filename) or "bericht.pdf"
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    stored = f"{stamp}_{original}"
    path = UPLOAD_DIR / stored
    file.save(path)

    groesse = path.stat().st_size
    max_bytes = config.get_settings()["maxUploadMb"] * 1024 * 1024
    if groesse > max_bytes:
        path.unlink(missing_ok=True)
        raise ApiError(f"Die Datei ist grösser als das Limit von "
                       f"{config.get_settings()['maxUploadMb']} MB.", 413)

    data = store.load()
    jahre_raw = request.form.get("jahre") or ""
    jahre = [j.strip() for j in jahre_raw.split(",") if j.strip()]
    if not jahre:
        jahre = store.all_years(data)[:2] or [datetime.now().strftime("%Y")]
    bank_id = request.form.get("bankId") or None
    bank = store.find_bank(data, bank_id) if bank_id else None
    force_ocr = request.form.get("forceOcr", "").lower() in ("1", "true", "ja", "on")
    model = request.form.get("model") or None

    upload = {
        "id": store.new_id("upl"),
        "dateiname": file.filename,
        "gespeichertAls": stored,
        "groesseBytes": groesse,
        "hochgeladenAm": store.now_iso(),
        "bankId": bank_id,
        "bankName": bank["name"] if bank else (request.form.get("bankName") or ""),
        "jahre": jahre,
        "forceOcr": force_ocr,
        "status": "wartet",
        "jobId": None,
        "uebernommen": False,
    }
    data.setdefault("uploads", []).insert(0, upload)

    job = jobs.create(store.new_id("job"), f"Extraktion: {file.filename}",
                      meta={"uploadId": upload["id"], "datei": file.filename})
    upload["jobId"] = job["id"]
    store.save(data, action="upload.erstellt",
               details={"datei": file.filename, "jahre": jahre})

    jobs.run_async(job["id"], _run_extraction, upload["id"], str(path), jahre,
                   upload["bankName"] or (bank["name"] if bank else None),
                   force_ocr, model)
    return jsonify({"upload": _upload_summary(upload), "jobId": job["id"]}), 202


def _run_extraction(upload_id: str, path: str, jahre: list[str], bankname: str | None,
                    force_ocr: bool, model: str | None, progress=None):
    ergebnis = extraction.run_pipeline(path, jahre, bankname=bankname,
                                       force_ocr=force_ocr, model=model,
                                       progress=progress)
    data = store.load()
    upload = store.find_upload(data, upload_id)
    if upload:
        extrakt = ergebnis["extraktion"]
        upload.update({
            "status": "extrahiert",
            "analyse": ergebnis["analyse"],
            "seitenText": ergebnis["seitenText"],
            "ocrSeiten": ergebnis["ocrSeiten"],
            "ocrUsage": ergebnis["ocrUsage"],
            "textZeichen": ergebnis["textZeichen"],
            "extraktion": extrakt,
            "erkannteBank": extrakt.get("bankname", ""),
            "erkannteBasis": extrakt.get("basis", ""),
            "modell": extrakt.get("_meta", {}).get("model"),
            "verarbeitetAm": store.now_iso(),
        })
        gefunden = sum(1 for felder in extrakt.get("jahre", {}).values()
                       for f in felder.values() if f.get("value") is not None)
        upload["gefundeneWerte"] = gefunden
        store.save(data, action="upload.extrahiert",
                   details={"datei": upload["dateiname"], "werte": gefunden})
    return {"uploadId": upload_id,
            "gefundeneWerte": upload.get("gefundeneWerte") if upload else 0,
            "ocrSeiten": ergebnis["ocrSeiten"],
            "seiten": ergebnis["analyse"].get("seitenGesamt")}


@api.post("/uploads/<upload_id>/rerun")
def rerun_extraction(upload_id: str):
    data = store.load()
    upload = store.find_upload(data, upload_id)
    if not upload:
        raise ApiError("Upload nicht gefunden.", 404)
    path = UPLOAD_DIR / upload["gespeichertAls"]
    if not path.exists():
        raise ApiError("Die Quelldatei ist nicht mehr vorhanden.", 404)

    payload = body()
    jahre = payload.get("jahre") or upload.get("jahre") or store.all_years(data)[:2]
    force_ocr = bool(payload.get("forceOcr", upload.get("forceOcr")))
    model = payload.get("model")

    job = jobs.create(store.new_id("job"), f"Neuauswertung: {upload['dateiname']}",
                      meta={"uploadId": upload_id, "datei": upload["dateiname"]})
    upload.update({"status": "wartet", "jobId": job["id"], "jahre": jahre,
                   "forceOcr": force_ocr, "uebernommen": False})
    store.save(data, action="upload.neuausgewertet", details={"datei": upload["dateiname"]})

    jobs.run_async(job["id"], _run_extraction, upload_id, str(path), jahre,
                   upload.get("bankName") or upload.get("erkannteBank"), force_ocr, model)
    return jsonify({"jobId": job["id"]}), 202


@api.post("/uploads/<upload_id>/apply")
def apply_upload(upload_id: str):
    """Uebernimmt geprüfte Extraktionswerte in den Datenbestand."""
    payload = body()
    data = store.load()
    upload = store.find_upload(data, upload_id)
    if not upload:
        raise ApiError("Upload nicht gefunden.", 404)
    extrakt = upload.get("extraktion")
    if not extrakt:
        raise ApiError("Für diesen Upload liegt noch keine Extraktion vor.")

    bank_id = payload.get("bankId") or upload.get("bankId")
    neuer_name = (payload.get("neueBank") or "").strip()
    if neuer_name:
        bestehend = store.find_bank_by_name(data, neuer_name)
        if bestehend:
            bank = bestehend
        else:
            bank = {
                "id": store.new_id("bank"), "name": neuer_name,
                "kuerzel": (payload.get("kuerzel") or neuer_name)[:24],
                "gruppe": payload.get("gruppe", ""),
                "basis": extrakt.get("basis", ""),
                "quelldatei": upload["dateiname"], "notizen": "",
                "angelegtAm": store.now_iso(), "jahre": {}, "extra": {},
            }
            data["banken"].append(bank)
    else:
        bank = store.find_bank(data, bank_id)
    if not bank:
        raise ApiError("Bitte eine Zielbank auswählen oder eine neue anlegen.")

    # {jahr: {kpiKey: value}} - vom Nutzer im Prüfdialog freigegeben
    auswahl = payload.get("werte")
    uebernommen = 0
    betroffene_jahre = set()

    for jahr, felder in (auswahl or extrakt.get("jahre", {})).items():
        if not isinstance(felder, dict):
            continue
        for key, entry in felder.items():
            if key not in schema.REPORTED_KEYS:
                continue
            if isinstance(entry, dict):
                wert = extraction.parse_number(entry.get("value"))
                seite = entry.get("seite")
                beleg = entry.get("beleg") or entry.get("snippet") or ""
                conf = entry.get("confidence")
            else:
                wert = extraction.parse_number(entry)
                seite, beleg, conf = None, "", None
            if wert is None and not payload.get("leereUebernehmen"):
                continue
            quelle = upload["dateiname"]
            if seite:
                quelle += f", S. {seite}"
            if beleg:
                quelle += f" – „{str(beleg)[:160]}“"
            store.set_metric(bank, jahr, key, wert, source=quelle,
                             herkunft="extrahiert", confidence=conf,
                             seite=seite, snippet=str(beleg)[:400])
            uebernommen += 1
            betroffene_jahre.add(str(jahr))

    if not bank.get("basis") and extrakt.get("basis"):
        bank["basis"] = extrakt["basis"]
    if not bank.get("quelldatei"):
        bank["quelldatei"] = upload["dateiname"]

    upload.update({"bankId": bank["id"], "bankName": bank["name"],
                   "uebernommen": True, "uebernommenAm": store.now_iso(),
                   "uebernommeneWerte": uebernommen, "status": "übernommen"})

    dateien = data.setdefault("methodik", {}).setdefault("verwendeteDateien", [])
    if upload["dateiname"] not in dateien:
        dateien.append(upload["dateiname"])

    store.save(data, action="upload.uebernommen",
               details={"datei": upload["dateiname"], "bank": bank["name"],
                        "werte": uebernommen, "jahre": sorted(betroffene_jahre)})
    return jsonify({"ok": True, "bankId": bank["id"], "bankName": bank["name"],
                    "uebernommen": uebernommen, "jahre": sorted(betroffene_jahre)})


# --------------------------------------------------------------------------
# Jobs
# --------------------------------------------------------------------------
@api.get("/jobs")
def list_jobs():
    return jsonify(jobs.listing())


@api.get("/jobs/<job_id>")
def get_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise ApiError("Job nicht gefunden.", 404)
    return jsonify(job)


# --------------------------------------------------------------------------
# Einstellungen
# --------------------------------------------------------------------------
@api.get("/settings")
def get_settings_route():
    return jsonify(config.get_settings())


@api.patch("/settings")
def patch_settings():
    payload = body()
    if "geminiApiKey" in payload:
        config.set_api_key(payload.pop("geminiApiKey") or "")
    return jsonify(config.update_settings(payload))


@api.post("/settings/test")
def test_key():
    payload = body()
    if payload.get("geminiApiKey"):
        config.set_api_key(payload["geminiApiKey"])
    return jsonify(gemini.check_key())


@api.get("/settings/models")
def list_models():
    return jsonify({"modelle": gemini.list_models()})


# --------------------------------------------------------------------------
# Methodik, Audit, Backups
# --------------------------------------------------------------------------
@api.get("/methodik")
def get_methodik():
    data = store.load()
    return jsonify(data.get("methodik", {}))


@api.put("/methodik")
def put_methodik():
    payload = body()
    data = store.load()
    meth = data.setdefault("methodik", {})
    if isinstance(payload.get("einschraenkungen"), list):
        meth["einschraenkungen"] = [str(x)[:2000] for x in payload["einschraenkungen"]]
    if isinstance(payload.get("verwendeteDateien"), list):
        meth["verwendeteDateien"] = [str(x)[:400] for x in payload["verwendeteDateien"]]
    store.save(data, action="methodik.geaendert")
    return jsonify(meth)


@api.get("/audit")
def get_audit():
    data = store.load()
    limit = min(int(request.args.get("limit", 100)), 500)
    return jsonify(data.get("audit", [])[:limit])


@api.get("/backups")
def list_backups():
    from .config import BACKUP_DIR
    items = []
    for p in sorted(BACKUP_DIR.glob("store-*.json"), reverse=True):
        st = p.stat()
        items.append({"datei": p.name, "groesse": st.st_size,
                      "erstellt": datetime.fromtimestamp(st.st_mtime)
                      .isoformat(timespec="seconds")})
    return jsonify(items)


@api.post("/backups/<name>/restore")
def restore_backup(name: str):
    from .config import BACKUP_DIR, STORE_PATH
    safe = secure_filename(name)
    src = BACKUP_DIR / safe
    if not src.exists() or not safe.startswith("store-"):
        raise ApiError("Sicherungspunkt nicht gefunden.", 404)
    try:
        json.loads(src.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise ApiError(f"Sicherungspunkt ist unlesbar: {exc}")
    shutil.copy2(STORE_PATH, BACKUP_DIR /
                 f"store-{datetime.now().strftime('%Y%m%d-%H%M%S')}-vor-restore.json")
    shutil.copy2(src, STORE_PATH)
    data = store.load()
    store.save(data, action="backup.zurueckgespielt", details={"datei": safe},
               backup=False)
    return jsonify({"ok": True, "wiederhergestellt": safe})


# --------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------
@api.get("/export/json")
def export_json():
    data = store.load()
    ids = set(selected_banks(data))
    payload = {**data, "banken": [b for b in data["banken"] if b["id"] in ids]}
    payload.pop("audit", None)
    return Response(json.dumps(payload, indent=2, ensure_ascii=False),
                    mimetype="application/json",
                    headers={"Content-Disposition":
                             f'attachment; filename="benchmarking-{_stamp()}.json"'})


@api.get("/export/csv")
def export_csv():
    data = store.load()
    csv_text = exporters.to_csv(data, selected_years(data), selected_banks(data),
                                bool_arg("derived", True))
    return Response("﻿" + csv_text, mimetype="text/csv; charset=utf-8",
                    headers={"Content-Disposition":
                             f'attachment; filename="benchmarking-{_stamp()}.csv"'})


@api.get("/export/csv-wide")
def export_csv_wide():
    data = store.load()
    csv_text = exporters.to_wide_csv(data, selected_year(data), selected_banks(data),
                                     bool_arg("derived", True))
    return Response("﻿" + csv_text, mimetype="text/csv; charset=utf-8",
                    headers={"Content-Disposition":
                             f'attachment; filename="matrix-{selected_year(data)}.csv"'})


@api.get("/export/xlsx")
def export_xlsx():
    data = store.load()
    blob = exporters.to_xlsx(data, selected_years(data), selected_banks(data),
                             bool_arg("derived", True))
    return Response(blob, mimetype="application/vnd.openxmlformats-officedocument."
                                   "spreadsheetml.sheet",
                    headers={"Content-Disposition":
                             f'attachment; filename="benchmarking-{_stamp()}.xlsx"'})


@api.get("/export/markdown")
def export_markdown():
    data = store.load()
    text = exporters.to_markdown(data, selected_year(data), selected_banks(data),
                                 bool_arg("derived", True))
    return Response(text, mimetype="text/markdown; charset=utf-8",
                    headers={"Content-Disposition":
                             f'attachment; filename="report-{selected_year(data)}.md"'})


@api.post("/import/json")
def import_json():
    """Vollstaendiger Datenimport. Ersetzt den bestehenden Bestand."""
    if "datei" not in request.files:
        raise ApiError("Es wurde keine Datei übermittelt.")
    try:
        payload = json.loads(request.files["datei"].read().decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ApiError(f"Die Datei ist kein gültiges JSON: {exc}")
    if not isinstance(payload.get("banken"), list):
        raise ApiError("Die Datei enthält keinen gültigen Bankenbestand.")

    aktuell = store.load()
    payload.setdefault("meta", {})
    payload.setdefault("uploads", aktuell.get("uploads", []))
    payload.setdefault("untersuchungsbereiche", schema.UNTERSUCHUNGSBEREICHE)
    payload["audit"] = aktuell.get("audit", [])
    store.save(payload, action="daten.importiert",
               details={"banken": len(payload["banken"])})
    return jsonify({"ok": True, "banken": len(payload["banken"])})


def _stamp() -> str:
    return datetime.now().strftime("%Y-%m-%d")
