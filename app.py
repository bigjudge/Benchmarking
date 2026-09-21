"""Bank-Benchmarking – Flask-Anwendung.

Start:  python app.py
        http://127.0.0.1:5000
"""

from __future__ import annotations

import argparse
import sys
import webbrowser
from threading import Timer

from flask import Flask, jsonify, render_template

from bench import store
from bench.api import api
from bench.config import BASE_DIR, get_settings


def create_app() -> Flask:
    app = Flask(__name__,
                template_folder=str(BASE_DIR / "templates"),
                static_folder=str(BASE_DIR / "static"))
    app.config["MAX_CONTENT_LENGTH"] = get_settings()["maxUploadMb"] * 1024 * 1024
    app.config["JSON_SORT_KEYS"] = False
    app.register_blueprint(api)

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/healthz")
    def health():
        data = store.load()
        return jsonify({"ok": True, "banken": len(data.get("banken", [])),
                        "jahre": store.all_years(data)})

    @app.errorhandler(413)
    def too_large(_):
        limit = get_settings()["maxUploadMb"]
        return jsonify({"fehler": f"Die Datei überschreitet das Limit von {limit} MB."}), 413

    @app.errorhandler(404)
    def not_found(_):
        return jsonify({"fehler": "Diese Adresse gibt es nicht."}), 404

    @app.after_request
    def no_store(resp):
        if resp.mimetype == "application/json":
            resp.headers["Cache-Control"] = "no-store"
        return resp

    return app


def main() -> None:
    # Windows-Konsolen laufen oft noch auf einer Codepage ohne Umlaute.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass

    parser = argparse.ArgumentParser(description="Bank-Benchmarking-Server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--no-browser", action="store_true",
                        help="Browser nicht automatisch öffnen")
    args = parser.parse_args()

    app = create_app()
    verwaist = store.mark_orphaned_uploads()
    data = store.load()
    url = f"http://{'127.0.0.1' if args.host in ('0.0.0.0', '127.0.0.1') else args.host}:{args.port}"
    print("=" * 68)
    print("  Bank-Benchmarking")
    print(f"  {len(data.get('banken', []))} Banken · Jahre: "
          f"{', '.join(store.all_years(data)) or 'keine'}")
    print(f"  {url}")
    if verwaist:
        print(f"  {verwaist} unterbrochene Auswertung(en) aus dem letzten Lauf markiert.")
    if not get_settings()["geminiKeyConfigured"]:
        print("  Hinweis: Kein Gemini-API-Key hinterlegt – OCR und Extraktion sind")
        print("           erst nach Eintrag unter Einstellungen verfügbar.")
    print("=" * 68)

    if not args.no_browser and not args.debug:
        Timer(1.2, lambda: webbrowser.open(url)).start()

    app.run(host=args.host, port=args.port, debug=args.debug,
            threaded=True, use_reloader=args.debug)


if __name__ == "__main__":
    main()
