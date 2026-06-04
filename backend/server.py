from __future__ import annotations

import json
import mimetypes
import os
import sys
from dataclasses import asdict
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIST = ROOT / "frontend" / "dist"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from script import ParseResult, ShippingEmailParser, generate_matches

OUTPUT_JSON = ROOT / "shipping_output.json"
EXPORTS = {
    "json": ROOT / "shipping_output.json",
    "csv": ROOT / "shipping_output.csv",
    "xlsx": ROOT / "shipping_output.xlsx",
    "sqlite": ROOT / "shipping_output.db",
}
_DATASET_CACHE: dict[str, object] = {"mtime": None, "results": None, "matches": None}


def _result_from_payload(item: dict) -> ParseResult:
    return ParseResult(
        file_name=item.get("file_name", ""),
        email_hash=item.get("email_hash", ""),
        category=item.get("category", "Unknown"),
        confidence=item.get("confidence", "low"),
        confidence_score=float(item.get("confidence_score") or 0),
        records=item.get("extracted_data") or item.get("records") or [],
        parse_warnings=item.get("warnings") or item.get("parse_warnings") or [],
        parsed_at=item.get("parsed_at", ""),
        source_metadata=item.get("source_metadata") or {},
    )


def load_results() -> list[ParseResult]:
    if OUTPUT_JSON.exists():
        with OUTPUT_JSON.open(encoding="utf-8") as fh:
            return [_result_from_payload(item) for item in json.load(fh)]

    parser = ShippingEmailParser()
    return [
        parser.parse_file(str(path))
        for path in sorted(ROOT.glob("*.txt"), key=lambda p: p.name)
        if path.name[0].isdigit()
    ]


def serialize_result(result: ParseResult) -> dict:
    payload = asdict(result)
    payload["warnings"] = payload.pop("parse_warnings", [])
    payload["extracted_data"] = payload.pop("records", [])
    return payload


def records_from_results(results: list[ParseResult]) -> list[dict]:
    rows: list[dict] = []
    for result in results:
        source = {
            "file_name": result.file_name,
            "email_hash": result.email_hash,
            "category": result.category,
            "confidence": result.confidence,
            "confidence_score": result.confidence_score,
        }
        if not result.records:
            rows.append({**source, "record_type": "Unstructured", "status": "review"})
            continue
        for index, record in enumerate(result.records, start=1):
            rows.append({**source, "record_id": f"{result.file_name or 'email'}-{index}", **record})
    return rows


def summary_from_results(results: list[ParseResult], matches: list[dict]) -> dict:
    records = records_from_results(results)
    categories: dict[str, int] = {}
    confidence: dict[str, int] = {"high": 0, "medium": 0, "low": 0}
    warnings = 0
    for result in results:
        categories[result.category] = categories.get(result.category, 0) + 1
        confidence[result.confidence] = confidence.get(result.confidence, 0) + 1
        warnings += len(result.parse_warnings)

    vessels = [row for row in records if row.get("record_type") == "Tonnage"]
    cargoes = [row for row in records if row.get("record_type") in {"Cargo VC", "Cargo TC"}]
    return {
        "emails": len(results),
        "records": len(records),
        "vessels": len(vessels),
        "cargoes": len(cargoes),
        "matches": len(matches),
        "warnings": warnings,
        "categories": categories,
        "confidence": confidence,
        "exports": {name: path.name for name, path in EXPORTS.items() if path.exists()},
    }


def current_dataset() -> tuple[list[ParseResult], list[dict]]:
    mtime = OUTPUT_JSON.stat().st_mtime if OUTPUT_JSON.exists() else None
    if (
        _DATASET_CACHE["mtime"] == mtime
        and _DATASET_CACHE["results"] is not None
        and _DATASET_CACHE["matches"] is not None
    ):
        return _DATASET_CACHE["results"], _DATASET_CACHE["matches"]

    results = load_results()
    tonnage = [result for result in results if result.category == "Tonnage"]
    cargo = [result for result in results if result.category in {"Cargo VC", "Cargo TC"}]
    matches = [asdict(match) for match in generate_matches(tonnage, cargo)]
    _DATASET_CACHE.update({"mtime": mtime, "results": results, "matches": matches})
    return results, matches


def json_response(handler: SimpleHTTPRequestHandler, payload: object, status: int = 200) -> None:
    body = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class ShippingAPIHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[backend] {self.address_string()} {fmt % args}")

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/"):
            self.handle_api_get(path, parse_qs(parsed.query))
            return
        self.serve_frontend(path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path not in {"/api/parse", "/api/ingest/email", "/api/plugins/email-listener/test"}:
            json_response(self, {"error": "Unknown endpoint"}, HTTPStatus.NOT_FOUND)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8") if length else "{}"
            payload = json.loads(raw or "{}")
        except Exception as exc:
            json_response(self, {"error": f"Invalid JSON: {exc}"}, HTTPStatus.BAD_REQUEST)
            return

        text = payload.get("email") or payload.get("text") or payload.get("body") or ""
        subject = payload.get("subject") or "live-email.txt"
        if not text.strip():
            json_response(self, {"error": "Provide email text in `email`, `text`, or `body`."}, HTTPStatus.BAD_REQUEST)
            return

        parser = ShippingEmailParser()
        result = parser.parse(text, file_name=subject)
        related_results = load_results() + [result]
        tonnage = [item for item in related_results if item.category == "Tonnage"]
        cargo = [item for item in related_results if item.category in {"Cargo VC", "Cargo TC"}]
        matches = [asdict(match) for match in generate_matches(tonnage, cargo)]
        json_response(self, {
            "status": "accepted",
            "mode": "plugin-ready-ingest",
            "result": serialize_result(result),
            "best_matches": matches[:8],
        })

    def handle_api_get(self, path: str, query: dict[str, list[str]]) -> None:
        try:
            results, matches = current_dataset()
        except Exception as exc:
            json_response(self, {"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if path == "/api/health":
            json_response(self, {"status": "ok", "service": "shipping-email-segregation"})
        elif path == "/api/summary":
            json_response(self, summary_from_results(results, matches))
        elif path == "/api/results":
            json_response(self, [serialize_result(item) for item in results])
        elif path == "/api/records":
            rows = records_from_results(results)
            record_type = (query.get("type") or [""])[0]
            if record_type:
                rows = [row for row in rows if row.get("record_type") == record_type]
            json_response(self, rows)
        elif path == "/api/matches":
            json_response(self, matches)
        elif path == "/api/plugins":
            json_response(self, {
                "plugins": [
                    {
                        "id": "gmail-watch",
                        "name": "Gmail/IMAP listener",
                        "status": "ready-to-configure",
                        "events": ["message.received", "message.updated"],
                        "target": "/api/ingest/email",
                    },
                    {
                        "id": "outlook-graph-watch",
                        "name": "Outlook Graph webhook",
                        "status": "ready-to-configure",
                        "events": ["mail.created"],
                        "target": "/api/ingest/email",
                    },
                ],
                "contract": {
                    "method": "POST",
                    "endpoint": "/api/ingest/email",
                    "body": {"subject": "string", "from": "string", "body": "raw email text"},
                },
            })
        elif path.startswith("/api/export/"):
            name = path.rsplit("/", 1)[-1]
            self.serve_export(name)
        else:
            json_response(self, {"error": "Unknown endpoint"}, HTTPStatus.NOT_FOUND)

    def serve_export(self, name: str) -> None:
        path = EXPORTS.get(name)
        if not path or not path.exists():
            json_response(self, {"error": "Export not found"}, HTTPStatus.NOT_FOUND)
            return
        body = path.read_bytes()
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Disposition", f'attachment; filename="{path.name}"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_frontend(self, path: str) -> None:
        if FRONTEND_DIST.exists():
            target = FRONTEND_DIST / path.lstrip("/")
            if path == "/" or not target.exists():
                target = FRONTEND_DIST / "index.html"
            if target.exists() and target.is_file():
                body = target.read_bytes()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "text/html")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
        json_response(self, {
            "message": "API is running. Build the frontend with `npm run build` to serve the live app from this backend.",
            "docs": ["/api/summary", "/api/records", "/api/matches", "/api/plugins"],
        })


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), ShippingAPIHandler)
    print(f"Shipping Email Segregation API running on http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
