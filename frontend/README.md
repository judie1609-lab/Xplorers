# XPLORERS frontend

The frontend is a Next.js 16.4.5 App Router application using React 19.3 and TypeScript. It connects to the local FastAPI service.

## Run locally

Start the backend first from the project root with `run_api_windows.ps1`. In a second PowerShell window:

```powershell
Set-Location .\frontend
npm ci
npm run dev
```

Open http://localhost:3000. The app defaults to `http://127.0.0.1:8000` for the API. To use another local API address, create `frontend/.env.local` with:

```text
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

Only put public URLs in `NEXT_PUBLIC_` variables. Never put API keys, passwords, or private credentials there.

## Production checks

```powershell
npm run lint
npm run build
npm start
```

The production build is a local validation step. No deployment configuration or public URL is part of this project.

## Main workspaces

- **Target Coverage**: catalog-linked target coordinates, retained coverage evidence, and user-triggered IRSA query presets.
- **IRSA Archive**: live metadata searches, bounded explicit FITS retrieval, structural validation, and provenance.
- **Scientific Analysis**: FITS inspection and cross-product WCS geometry/eligibility reports.
- **Scientific Evidence**: JSON evidence dossier export from the current browser session.
- **Mission Readiness**: operational checks; its status does not certify scientific validity or judging readiness.

See the project-root [Windows guide](../README_WINDOWS.md), [scientific methodology](../docs/scientific_methodology.md), and [judging demo guide](../docs/judging_demo_guide.md) for limitations and expected outputs.
