## Port ICCC — Developer Guide

This guide explains how to set up and run the Port ICCC project locally after cloning the repository. It covers the Next.js frontend (app/), the AIS relay microservice (ais-relay-server/), and the OpenCV/YOLOv8 microservice (opencv-service/).

## Table of contents
- Prerequisites
- Quick start (Windows PowerShell)
- Running the Next.js app
- Running the AIS relay microservice
- Running the OpenCV microservice (Python)
- Environment variables
- Testing and linting
- Troubleshooting & tips
- Next steps / optional improvements

---

## Prerequisites

- Node.js (v18+ recommended) and npm installed. Verify with:

  node --version
  npm --version

- Python 3.10+ (for the OpenCV service). Verify with:

  python --version

- Recommended (optional): a virtual environment tool for Python (venv, virtualenv, conda).

Notes:
- This repository contains three runnable parts:
  - Next.js frontend (root) — development server, build, tests.
  - AIS relay (Node.js) — a small WebSocket/HTTP relay in `ais-relay-server/`.
  - OpenCV microservice (FastAPI/Python) — in `opencv-service/`.

---

## Quick start (Windows PowerShell)

Clone the repo and install dependencies for the frontend:

  git clone <repo-url>
  cd "Port CCC_updated"
  npm install

Start the Next.js dev server (root):

  npm run dev

Open your browser at http://localhost:3000.

To run AIS relay and OpenCV services (recommended in separate terminals):

  # Terminal 1 (AIS relay)
  cd ais-relay-server
  npm install
  $env:PORT=3001; $env:AIS_STREAM_KEY='your_key_here'
  node index.js

  # Terminal 2 (OpenCV service)
  cd opencv-service
  python -m venv .venv
  .\.venv\Scripts\Activate.ps1
  pip install -r requirements.txt
  # Run in demo mode (no camera feeds):
  uvicorn main:app --host 0.0.0.0 --port 8000

By default the frontend uses simulation data. To point it at the OpenCV service, set `OPENCV_SERVICE_URL` in your environment (or in Netlify when deployed):

  $env:OPENCV_SERVICE_URL='http://localhost:8000'

---

## Running the Next.js app (frontend)

From the repository root:

  npm install
  npm run dev

Available scripts (from `package.json`):
- `dev` — start Next.js dev server (next dev)
- `build` — build for production (next build)
- `start` — start built app (next start)
- `lint` — run ESLint
- `typecheck` — run TypeScript type-checker
- `test` — run Vitest tests

When building for production, run:

  npm run build
  npm start

If you need to set environment variables for Next.js in development, prefix them or use PowerShell's `$env:` as shown above.

---

## AIS relay microservice

Purpose: connects to aisstream.io via WebSocket and exposes `/api/vessels` and `/health` endpoints for the frontend to consume.

Location: `ais-relay-server/index.js`

Prereqs: Node.js and an AIS_STREAM_KEY (from aisstream.io)

Install and run (PowerShell):

  cd ais-relay-server
  npm install
  $env:PORT=3001; $env:AIS_STREAM_KEY='your_key_here'
  node index.js

Health: http://localhost:3001/health
Vessels API: http://localhost:3001/api/vessels

Note: If `AIS_STREAM_KEY` is not set the relay prints an error and will not connect; the frontend will continue using simulated vessel data.

---

## OpenCV microservice (FastAPI + YOLOv8)

Purpose: runs OpenCV + YOLOv8 analysis and exposes `/api/analytics/latest`.

Location: `opencv-service/main.py`

Requirements: Python 3.10+, see `opencv-service/requirements.txt`.
This service relies on CPU-bound ML libraries (ultralytics, opencv) and can be heavy to install on Windows. For local development you can run it in demo mode (no CAMERA_FEEDS) which only needs the requirements installed but won't open camera streams.

Setup (PowerShell):

  cd opencv-service
  python -m venv .venv
  .\.venv\Scripts\Activate.ps1
  pip install -r requirements.txt

Run (demo mode):

  uvicorn main:app --host 0.0.0.0 --port 8000

Run (with camera feeds):

  $env:CAMERA_FEEDS='gate_1:rtsp://user:pw@192.168.x.x:554/stream1,perimeter:rtsp://192.168.x.x:554/stream2'
  uvicorn main:app --host 0.0.0.0 --port 8000

Notes and tips:
- The `ultralytics` model downloads YOLO weights (`yolov8n.pt`) on first run.
- On Windows, OpenCV/video capture from RTSP can be tricky. Running the service in WSL2 or a Linux container often works better for camera access.
- If you only want UI integration, you can set `OPENCV_SERVICE_URL` to the deployed service URL or leave it unset to use simulation fallback in the frontend.

---

## Environment variables (summary)

- Frontend / runtime (Next.js):
  - `NEXT_PUBLIC_POC_MODE` — optional, show POC UI flows.
  - `OPENCV_SERVICE_URL` — URL to the opencv-service (e.g., https://your-service.onrender.com). If unset the UI uses a simulated analytics fallback.

- AIS Relay:
  - `AIS_STREAM_KEY` — API key for aisstream.io (required to actually stream AIS messages).
  - `PORT` — optional (defaults to 3001 in the relay script).

- OpenCV service (Render / local):
  - `CAMERA_FEEDS` — comma-separated zone:rtsp_url pairs. If missing the service runs in demo mode.
  - `PORT` — port for uvicorn; default examples use 8000 locally.

---

## Testing and linting

From repo root:

  npm install
  npm run test
  npm run lint
  npm run typecheck

Tests use Vitest (see `vitest.config.ts`). There are unit tests under `lib/__tests__/`.

---

## Troubleshooting & tips

- Frontend port: Next.js dev server runs on port 3000 by default. If port conflicts occur, stop the process using that port or change the env setup.
- OpenCV on Windows: if RTSP capture fails, consider WSL2 or running the Python service in a Docker container or a Linux VM.
- AIS relay: if you don't have an `AIS_STREAM_KEY`, the relay will not stream; the frontend will show simulated vessel data instead.
- Dependency problems: remove `node_modules` and reinstall `npm ci` for consistent installs.

---

## Next steps / optional improvements

- Add a `docker-compose.yml` that wires the Next.js app, ais-relay-server, and opencv-service for easy local composition.
- Add `.env.example` files for both Node and Python services with sample values.
- Add a small script to the root `package.json` to launch all local services in parallel (concurrently or using `npm-run-all`).

---

If you'd like, I can:
- add a `docker-compose.yml` for local development,
- create `.env.example` files for `ais-relay-server` and `opencv-service`, or
- add a `dev` helper script that starts all required services in separate terminals.
