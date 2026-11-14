# XPLORERS frontend

The frontend is a Next.js 16.4.5 App Router application using React 19.3 and TypeScript. It connects to the local FastAPI service in development and to Enzonic through Vercel same-origin rewrites in production.

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
```

## Vercel with Enzonic FastAPI

Vercel production builds use the Next.js server runtime. Browser requests to
`/api/*`, `/health`, and `/static/*` remain same-origin and are proxied by
`next.config.ts` to the Enzonic backend. This prevents browser mixed-content
requests even though the current Enzonic backend origin is HTTP.

Set this server-only Vercel environment variable for Production and Preview:

```text
ENZONIC_BACKEND_ORIGIN=http://fr-one.enzonic.com:26111
```

Do not set `NEXT_PUBLIC_API_URL` for this Vercel deployment. The production
browser bundle then uses the same-origin proxy. Set
`NEXT_PUBLIC_XPLORERS_LOW_MEMORY_MODE=true` to mirror Enzonic's 512 MB
safeguards in the UI. `CORS_ALLOWED_ORIGINS` is not required for proxy traffic,
but the Enzonic backend may keep the Vercel production origin in its allowlist
for any direct browser use.

For a static host, set `NEXT_STATIC_EXPORT=true`; this produces `out/`, but
static export cannot serve Next.js rewrites. In that mode set
`NEXT_PUBLIC_API_URL` to an HTTPS backend origin or supply an equivalent proxy
at the hosting layer.

For local or static-host API overrides, set `NEXT_PUBLIC_API_URL` to the API
origin only, without a trailing slash. Never put credentials in a public
environment variable.

## Main workspaces

- **Target Coverage**: catalog-linked target coordinates, retained coverage evidence, and user-triggered IRSA query presets.
- **IRSA Archive**: live metadata searches, bounded explicit FITS retrieval, structural validation, and provenance.
- **Scientific Analysis**: FITS inspection and cross-product WCS geometry/eligibility reports.
- **Scientific Evidence**: JSON evidence dossier export from the current browser session.
- **Mission Readiness**: operational checks; its status does not certify scientific validity or judging readiness.

See the project-root [Windows guide](../README_WINDOWS.md), [scientific methodology](../docs/scientific_methodology.md), and [judging demo guide](../docs/judging_demo_guide.md) for limitations and expected outputs.
