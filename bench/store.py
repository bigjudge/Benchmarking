"""JSON-basierter Datenspeicher mit Sperre, Backups und Audit-Log."""

from __future__ import annotations

import json
import shutil
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from .config import BACKUP_DIR, STORE_PATH
from . import schema

_lock = threading.RLock()
MAX_BACKUPS = 30
MAX_AUDIT = 800


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def empty_store() -> dict:
    return {
        "version": 2,
        "meta": {
            "titel": "Bank-Benchmarking Liechtenstein",
            "zielbankId": None,
            "waehrung": "CHF",
            "erstelltAm": now_iso(),
            "aktualisiertAm": now_iso(),
            "hinweis": "",
        },
        "banken": [],
        "untersuchungsbereiche": schema.UNTERSUCHUNGSBEREICHE,
        "methodik": {"verwendeteDateien": [], "einschraenkungen": []},
        "uploads": [],
        "audit": [],
    }


def _load_raw() -> dict:
    if not STORE_PATH.exists():
        data = empty_store()
        _write_raw(data, backup=False)
        return data
    try:
        return json.loads(STORE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise RuntimeError(f"Datenspeicher {STORE_PATH} ist beschaedigt: {exc}") from exc


def _write_raw(data: dict, backup: bool = True) -> None:
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    if backup and STORE_PATH.exists():
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        shutil.copy2(STORE_PATH, BACKUP_DIR / f"store-{stamp}.json")
        backups = sorted(BACKUP_DIR.glob("store-*.json"))
        for old in backups[:-MAX_BACKUPS]:
            try:
                old.unlink()
            except OSError:
                pass
    tmp = STORE_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(STORE_PATH)


def load() -> dict:
    with _lock:
        return _load_raw()


def save(data: dict, action: str = "", details: Any = None, backup: bool = True) -> dict:
    with _lock:
        data.setdefault("meta", {})["aktualisiertAm"] = now_iso()
        if action:
            entry = {"id": new_id("aud"), "ts": now_iso(), "action": action}
            if details is not None:
                entry["details"] = details
            data.setdefault("audit", []).insert(0, entry)
            data["audit"] = data["audit"][:MAX_AUDIT]
        _write_raw(data, backup=backup)
        return data


def mutate(action: str, fn, details: Any = None) -> dict:
    """Laedt, veraendert und speichert atomar. fn(data) -> details|None"""
    with _lock:
        data = _load_raw()
        result = fn(data)
        if result is not None:
            details = result
        save(data, action=action, details=details)
        return data


# --------------------------------------------------------------------------
# Zugriffshelfer
# --------------------------------------------------------------------------
def find_bank(data: dict, bank_id: str) -> dict | None:
    for b in data.get("banken", []):
        if b.get("id") == bank_id:
            return b
    return None


def find_bank_by_name(data: dict, name: str) -> dict | None:
    norm = (name or "").strip().casefold()
    if not norm:
        return None
    for b in data.get("banken", []):
        if b.get("name", "").strip().casefold() == norm:
            return b
    return None


def target_bank(data: dict) -> dict | None:
    tid = data.get("meta", {}).get("zielbankId")
    if tid:
        b = find_bank(data, tid)
        if b:
            return b
    banks = data.get("banken", [])
    return banks[0] if banks else None


def all_years(data: dict) -> list[str]:
    years: set[str] = set()
    for b in data.get("banken", []):
        years.update(b.get("jahre", {}).keys())
    return sorted(years, reverse=True)


def blank_metric(unit: str = "") -> dict:
    return {"value": None, "unit": unit, "source": "", "herkunft": "leer", "confidence": None}


def set_metric(bank: dict, year: str, key: str, value, source: str = "",
               herkunft: str = "manuell", confidence=None, unit: str | None = None,
               seite=None, snippet: str | None = None) -> dict:
    jahre = bank.setdefault("jahre", {})
    ydata = jahre.setdefault(str(year), {})
    defs = schema.all_kpi_defs()
    entry = dict(ydata.get(key) or {})
    entry["value"] = value
    entry["unit"] = unit if unit is not None else entry.get("unit") or (
        defs.get(key, {}).get("unit", ""))
    entry["source"] = source if source is not None else entry.get("source", "")
    entry["herkunft"] = herkunft
    entry["confidence"] = confidence
    if seite is not None:
        entry["seite"] = seite
    if snippet is not None:
        entry["snippet"] = snippet
    entry["geaendertAm"] = now_iso()
    ydata[key] = entry
    return entry


def find_upload(data: dict, upload_id: str) -> dict | None:
    for u in data.get("uploads", []):
        if u.get("id") == upload_id:
            return u
    return None


def mark_orphaned_uploads() -> int:
    """Uploads, deren Job einen Serverneustart nicht ueberlebt hat, aufraeumen.

    Jobs laufen nur im Arbeitsspeicher. Ohne diesen Schritt haengen Uploads
    nach einem Neustart fuer immer auf 'in Verarbeitung'.
    """
    with _lock:
        data = _load_raw()
        betroffen = [u for u in data.get("uploads", [])
                     if u.get("status") in ("wartet", "laeuft")
                     and not u.get("extraktion")]
        if not betroffen:
            return 0
        for u in betroffen:
            u["status"] = "abgebrochen"
            u["jobId"] = None
            u["fehler"] = ("Die Verarbeitung wurde durch einen Neustart des Servers "
                           "unterbrochen. Bitte erneut auswerten.")
        save(data, action="uploads.abgebrochen",
             details={"anzahl": len(betroffen)}, backup=False)
        return len(betroffen)
