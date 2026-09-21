"""Einfache Hintergrund-Jobverwaltung fuer die laufzeitintensive Extraktion."""

from __future__ import annotations

import threading
import traceback
from datetime import datetime, timezone

_jobs: dict[str, dict] = {}
_lock = threading.RLock()
MAX_JOBS = 60


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def create(job_id: str, label: str, meta: dict | None = None) -> dict:
    with _lock:
        job = {
            "id": job_id,
            "label": label,
            "status": "wartet",
            "fortschritt": 0,
            "nachricht": "In der Warteschlange",
            "meta": meta or {},
            "ergebnis": None,
            "fehler": None,
            "verlauf": [],
            "startedAt": _now(),
            "endedAt": None,
        }
        _jobs[job_id] = job
        if len(_jobs) > MAX_JOBS:
            fertig = [j for j in _jobs.values() if j["status"] in ("fertig", "fehler")]
            fertig.sort(key=lambda j: j.get("endedAt") or "")
            for j in fertig[:len(_jobs) - MAX_JOBS]:
                _jobs.pop(j["id"], None)
        return job


def update(job_id: str, nachricht: str | None = None, fortschritt: int | None = None,
           status: str | None = None) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return
        if nachricht:
            job["nachricht"] = nachricht
            job["verlauf"].append({"ts": _now(), "text": nachricht,
                                   "fortschritt": fortschritt})
            job["verlauf"] = job["verlauf"][-40:]
        if fortschritt is not None:
            job["fortschritt"] = max(0, min(100, int(fortschritt)))
        if status:
            job["status"] = status


def finish(job_id: str, ergebnis) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job.update(status="fertig", fortschritt=100, ergebnis=ergebnis,
                   nachricht="Abgeschlossen", endedAt=_now())


def fail(job_id: str, fehler: str, detail: str | None = None) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job.update(status="fehler", fehler=fehler, nachricht=fehler,
                   endedAt=_now())
        if detail:
            job["detail"] = detail[:4000]


def get(job_id: str) -> dict | None:
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None


def listing(limit: int = 25) -> list[dict]:
    with _lock:
        jobs = sorted(_jobs.values(), key=lambda j: j["startedAt"], reverse=True)
        return [{k: v for k, v in j.items() if k != "ergebnis"} for j in jobs[:limit]]


def run_async(job_id: str, fn, *args, **kwargs) -> None:
    """Startet fn im Thread. fn erhaelt `progress` als Keyword."""
    def progress(nachricht: str, prozent: int | None = None) -> None:
        update(job_id, nachricht=nachricht, fortschritt=prozent, status="laeuft")

    def runner():
        update(job_id, nachricht="Verarbeitung gestartet", fortschritt=2, status="laeuft")
        try:
            ergebnis = fn(*args, progress=progress, **kwargs)
            finish(job_id, ergebnis)
        except Exception as exc:  # noqa: BLE001 - Fehler gehoert in den Job
            fail(job_id, str(exc) or exc.__class__.__name__, traceback.format_exc())

    threading.Thread(target=runner, name=f"job-{job_id}", daemon=True).start()
