"""Schlanker Client fuer die Google Gemini API (REST, ohne SDK-Abhaengigkeit)."""

from __future__ import annotations

import json
import re
import time

import requests

from .config import get_api_key, get_settings

API_ROOT = "https://generativelanguage.googleapis.com/v1beta"


class GeminiError(RuntimeError):
    """Fehler bei der Kommunikation mit der Gemini-API."""

    def __init__(self, message: str, status: int | None = None, retryable: bool = False):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


def _key() -> str:
    key = get_api_key()
    if not key:
        raise GeminiError(
            "Kein Gemini-API-Key hinterlegt. Unter Einstellungen eintragen oder "
            "GEMINI_API_KEY in der .env-Datei setzen."
        )
    return key


def list_models() -> list[dict]:
    resp = requests.get(f"{API_ROOT}/models", params={"key": _key()}, timeout=30)
    if resp.status_code != 200:
        raise GeminiError(_err_text(resp), status=resp.status_code)
    models = []
    for m in resp.json().get("models", []):
        methods = m.get("supportedGenerationMethods", [])
        if "generateContent" not in methods:
            continue
        models.append({
            "name": m.get("name", "").replace("models/", ""),
            "displayName": m.get("displayName", ""),
            "inputTokenLimit": m.get("inputTokenLimit"),
            "outputTokenLimit": m.get("outputTokenLimit"),
        })
    models.sort(key=lambda x: x["name"])
    return models


def check_key() -> dict:
    """Schneller Verbindungstest."""
    try:
        models = list_models()
    except GeminiError as exc:
        return {"ok": False, "fehler": str(exc), "status": exc.status}
    return {"ok": True, "modelle": len(models),
            "beispiele": [m["name"] for m in models[:8]]}


def _err_text(resp) -> str:
    try:
        payload = resp.json()
        err = payload.get("error", {})
        msg = err.get("message") or json.dumps(payload)[:400]
        return f"Gemini-API {resp.status_code}: {msg}"
    except ValueError:
        return f"Gemini-API {resp.status_code}: {resp.text[:400]}"


def generate(parts: list[dict], model: str | None = None, *,
             system_instruction: str | None = None,
             json_mode: bool = False,
             temperature: float | None = None,
             max_output_tokens: int = 32768,
             retries: int = 3) -> dict:
    """Ein generateContent-Aufruf. `parts` sind bereits fertige Gemini-Parts.

    Rueckgabe: {"text": str, "usage": {...}, "model": str, "finishReason": str}
    """
    settings = get_settings()
    model = model or settings["geminiModel"]
    temperature = settings["temperature"] if temperature is None else temperature

    body: dict = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_output_tokens,
        },
    }
    if json_mode:
        body["generationConfig"]["responseMimeType"] = "application/json"
    if system_instruction:
        body["systemInstruction"] = {"parts": [{"text": system_instruction}]}

    url = f"{API_ROOT}/models/{model}:generateContent"
    last_err: GeminiError | None = None

    for attempt in range(retries):
        try:
            resp = requests.post(url, params={"key": _key()}, json=body,
                                 timeout=settings["requestTimeout"])
        except requests.Timeout as exc:
            last_err = GeminiError(f"Zeitüberschreitung bei der Gemini-Anfrage: {exc}",
                                   retryable=True)
        except requests.RequestException as exc:
            last_err = GeminiError(f"Netzwerkfehler bei der Gemini-Anfrage: {exc}",
                                   retryable=True)
        else:
            if resp.status_code == 200:
                return _parse_response(resp.json(), model)
            retryable = resp.status_code in (429, 500, 502, 503, 504)
            last_err = GeminiError(_err_text(resp), status=resp.status_code,
                                   retryable=retryable)
            if not retryable:
                raise last_err
        if attempt < retries - 1:
            time.sleep(2 ** attempt * 1.5)

    raise last_err or GeminiError("Unbekannter Fehler bei der Gemini-Anfrage.")


def _parse_response(payload: dict, model: str) -> dict:
    candidates = payload.get("candidates") or []
    if not candidates:
        feedback = payload.get("promptFeedback", {})
        blocked = feedback.get("blockReason")
        raise GeminiError(
            f"Gemini lieferte keine Antwort{f' (blockiert: {blocked})' if blocked else ''}."
        )
    cand = candidates[0]
    finish = cand.get("finishReason", "")
    text = "".join(p.get("text", "") for p in (cand.get("content", {}).get("parts") or []))
    if not text.strip() and finish == "MAX_TOKENS":
        raise GeminiError("Antwort wurde durch das Token-Limit abgeschnitten. "
                          "Bitte weniger Seiten pro Durchgang verarbeiten.")
    usage = payload.get("usageMetadata", {})
    return {
        "text": text,
        "finishReason": finish,
        "model": model,
        "usage": {
            "prompt": usage.get("promptTokenCount"),
            "output": usage.get("candidatesTokenCount"),
            "total": usage.get("totalTokenCount"),
        },
    }


def generate_json(parts: list[dict], model: str | None = None, **kwargs) -> tuple[dict, dict]:
    """Wie generate(), erzwingt aber JSON und parst es. -> (daten, meta)"""
    res = generate(parts, model=model, json_mode=True, **kwargs)
    return parse_json_text(res["text"]), res


def parse_json_text(text: str) -> dict:
    text = (text or "").strip()
    if not text:
        raise GeminiError("Gemini lieferte eine leere Antwort.")
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError as exc:
            raise GeminiError(f"Antwort war kein gültiges JSON: {exc}") from exc
    raise GeminiError("Antwort enthielt kein JSON-Objekt.")
