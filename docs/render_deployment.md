# Zero-cost Render deployment

This guide uses only a free Render Static Site and one Free Web Service. It
creates no paid disk, paid database, or other paid resource. **No service has
been created or deployed by this repository change.**

## Frontend: free Static Site

The installed Next.js 16.4.5 app was tested with `output: "export"`. The only
app routes are the root page and layout; the page is a client component that
calls FastAPI from the browser. It uses no Next.js request handlers, server
actions, cookies, rewrites, dynamic server functions, or dynamic route params.
Static export therefore fits the current implementation. Next.js 16's
`cacheComponents` and `partialPrefetching` settings were removed because their
Partial Prerendering mode is incompatible with export mode; this app does not
use those server-side features. The verified build emits the static `out`
directory.

Create **New → Static Site** from the private repository:

| Render setting | Value |
| --- | --- |
| Branch | `main` |
| Root Directory | `frontend` |
| Build Command | `npm ci && npm run build` |
| Publish Directory | `out` |
| Plan | Static Site (free) |
| Start Command | None |

Set these frontend environment variables before building:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | `https://<backend-service>.onrender.com` |
| `NEXT_PUBLIC_XPLORERS_EPHEMERAL_STORAGE` | `true` |
| `NEXT_PUBLIC_XPLORERS_LOW_MEMORY_MODE` | `true` |

`NEXT_PUBLIC_API_URL` and both public mode flags are embedded at build time in
the static bundle. Set the backend URL before the first build, and rebuild the
Static Site after changing any of these values. The API URL is public and must
not contain credentials. The app falls back to `http://127.0.0.1:8000` if the
variable is missing, which does not work for a hosted site.
When the ephemeral-storage flag is enabled, the build also fails fast if the
API URL is missing, not a bare HTTPS origin, or includes a path or trailing
slash.

Static export serves the existing client-driven page, its local JSON target
cases, and browser-side fetches. It does not provide a Next.js runtime server;
new server-only Next features would require rechecking export compatibility.

## Backend: Free Web Service

The catalog CSV is at the repository root, outside `backend`. Render makes files
outside a configured service Root Directory unavailable at build and runtime,
so **leave the backend Root Directory blank** (repository root). Use:

| Render setting | Value |
| --- | --- |
| Branch | `main` |
| Root Directory | blank / repository root |
| Build Command | `pip install -r backend/requirements.txt` |
| Start Command | `python backend/scripts/ingest_csv.py table_Spectral-Images-1.csv && cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1` |
| Plan | Free Web Service |
| Health Check Path | `/health/database` |

Because the backend must use the repository root to read the CSV, optionally set
backend Build Filters to these repository-relative included paths so
frontend-only edits do not redeploy the API and clear its temporary files:
`backend/**` and `table_Spectral-Images-1.csv`. Render evaluates these filters
relative to the repository root.

The startup importer validates the CSV before writing, batches inserts inside a
transaction, and only adds rows whose stable `obs_publisher_did` is not already
present. It never deletes or replaces catalog rows. A failed import causes the
start command to stop before Uvicorn starts; the existing catalog is preserved.
With the Free filesystem, the import repopulates the catalog after each fresh
backend filesystem, so catalog contents are reconstructed from the committed
public CSV rather than durably stored.

Set these backend environment variables:

| Variable | Value / behavior |
| --- | --- |
| `DATABASE_URL` | `sqlite:////tmp/xplorers/spectra.db` |
| `SPHEREX_ARCHIVE_CACHE_DIR` | `/tmp/xplorers/archive_products` |
| `XPLORERS_LOW_MEMORY_MODE` | `true` |
| `CORS_ALLOWED_ORIGINS` | Exact HTTPS Static Site origin, e.g. `https://<frontend-site>.onrender.com` |
| `PORT` | Supplied by Render; do not set manually |
| `PYTHON_VERSION` | Optional pin: `3.12.10` |

`XPLORERS_LOW_MEMORY_MODE` accepts explicit true/false spellings; a misspelled
value stops backend startup instead of silently changing safeguards.

The backend keeps local development CORS origins available and adds only the
explicit origins in `CORS_ALLOWED_ORIGINS`; wildcard origins are rejected. Since
the frontend hostname is assigned by Render, create the backend first, then the
Static Site, then set the backend's CORS variable to the Static Site's exact
origin and redeploy the backend. Include scheme and host only, without a path or
trailing slash.

## Free storage and availability limits

Render Free Web Services have an ephemeral filesystem and no persistent disks.
The SQLite database and retrieved FITS cache under `/tmp` may be lost whenever
Render restarts, redeploys, or spins the service down. Free services spin down
after 15 minutes without inbound traffic and take about a minute to start again.
Render may also restart a Free service. No Free-tier configuration in this
project guarantees retention of catalog writes, FITS bytes, or archive-product
provenance. The startup import reconstructs only the catalog represented by the
CSV; it cannot restore downloaded FITS products or in-memory session results.
The UI explicitly labels storage and cache state as temporary. Never treat a
product currently listed as cached as permanently available.

The database and FITS cache paths are independently configurable. The values
above deliberately point into temporary `/tmp` storage and do not imply a disk
mount. The existing local SQLite database and five verified FITS files are not
uploaded by this setup.

## 512 MB safeguards and limits

Configure `XPLORERS_LOW_MEMORY_MODE=true`. In this mode the API returns HTTP 503
with quality state `NOT EVALUATED` for these resource-heavy routes, and the
frontend disables their controls:

- `GET /api/v1/analysis/fits/{image_name}`: whole-image statistics and a full
  FLAGS value count.
- `GET /api/v1/ai/anomaly/{image_name}`: loads image and variance planes into
  float64 arrays and runs Isolation Forest.
- `GET /api/v1/ai/observation-clusters`: loads many database rows and scikit-learn.

The gate changes availability only; it does not weaken or alter scientific
validation. Existing pixel, ROI, region-comparison, and WCS geometry routes are
not disabled. They still need a product in the current temporary cache, and
they may fail if memory is exhausted or requests overlap. Archive retrieval is
user-triggered and bounded at the product level, but its transfers also use
memory and temporary storage. The Free plan is not a reliable environment for
heavy FITS analysis or continuous availability.

Render documents 512 MB RAM and 0.1 CPU for its Free web service, idle spin-down,
and ephemeral storage. Free instance hours and bandwidth/build usage are shared
with other Free services in the workspace and subject to Render's current
allowances. Render documents that excess bandwidth/build usage can incur charges
when billing is available; to preserve a $0 ceiling, keep usage below allowances
and use the workspace spend limit if available. A limit or exhausted allowance
can suspend builds or services. This is a hobby/demo deployment configuration,
not a durable production data service.

## Deployment order and validation

1. Create the backend Free Web Service with the repository-root settings above.
2. Set its temporary storage paths and `XPLORERS_LOW_MEMORY_MODE=true`; wait for
   a successful start and `/health/database` response.
3. Create the free Static Site with `NEXT_PUBLIC_API_URL` set to the backend URL
   and both frontend mode flags set to `true`.
4. Copy the Static Site's exact `https://...onrender.com` origin to backend
   `CORS_ALLOWED_ORIGINS`, then redeploy the backend.
5. Verify the frontend can reach `/health`, query `/api/v1/metadata/summary`,
   and sees the temporary-storage / low-memory notices.
6. Verify the three gated routes report `NOT EVALUATED` on HTTP 503. Do not
   interpret missing cached FITS products after a restart as archive zero
   coverage or as failed science validation.

The backend health endpoints report service/database connectivity only. They do
not certify that archive products are cached, that scientific analyses ran, or
that any scientific requirement passed.
