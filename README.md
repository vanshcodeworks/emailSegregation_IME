# Shipping Email Segregation & Data Extraction

End-to-end demo that classifies shipping emails, extracts commercial fields, and highlights vessel-to-cargo opportunities without external LLM APIs.

Live Link ->  

## Problem

Shipping brokers receive unstructured emails (tonnage lists, cargo offers, time charter requests). This project turns those emails into structured records and searchable outputs.

## What This Demo Does

- Classifies into Tonnage, Cargo VC, or Cargo TC.
- Extracts vessel, ports, laycan/open dates, cargo, duration, and confidence.
- Generates exports: JSON, CSV, Excel, SQLite.
- Provides a plugin-ready ingest endpoint for email listeners.

## Repository Structure

```
backend/              # HTTP API that serves data + optional built frontend
frontend/             # React UI (Vite)
script.py             # Parser + dataset generation
shipping_output.json  # Primary dataset (generated)
shipping_output.csv   # Export (generated)
shipping_output.xlsx  # Export (generated)
shipping_output.db    # Export (generated)
1.txt..10.txt         # Sample emails
```

## Quickstart (Windows)

1) Install dependencies

```powershell
cd frontend
npm install
```

2) Start backend

```powershell
py.exe backend\server.py
```

3) Start frontend (dev mode)

```powershell
cd frontend
npm run dev
```

Open the app:

```text
http://localhost:5173
```

## Single-URL Build (Serve UI from Backend)

```powershell
cd frontend
npm run build
```

Then run the backend and open:

```text
http://localhost:8000
```

## How Data Flows

1) `script.py` parses sample emails and writes `shipping_output.*` exports.
2) `backend/server.py` reads `shipping_output.json` (or falls back to sample .txt files).
3) `frontend/src/App.jsx` calls `/api/*` endpoints and renders tables + JSON preview.

## API Routes

- `GET /api/summary` - KPIs, categories, confidence
- `GET /api/results` - parsed JSON per email
- `GET /api/records` - flattened searchable records
- `GET /api/matches` - best vessel-to-cargo matches
- `GET /api/plugins` - ingest contract for email listeners
- `POST /api/ingest/email` - live email parsing
- `GET /api/export/json|csv|xlsx|sqlite` - download exports

Example live ingestion body:

```json
{
  "subject": "new-market-email.txt",
  "from": "broker@example.com",
  "body": "Raw shipping email text..."
}
```

## Generate Dataset Manually

```powershell
py.exe script.py
```

This regenerates `shipping_output.json` and export files.

## Notes For Submission

- No external LLM APIs are used.
- API + UI run locally, with optional single-URL build.
- The parser is rule-based + ML-style scoring inside [script.py](script.py).
