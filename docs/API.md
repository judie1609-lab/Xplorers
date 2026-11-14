# XPLORERS API reference

The API is a local FastAPI service. Interactive OpenAPI documentation is available at `http://127.0.0.1:8000/docs` after startup. The JSON examples and parameter limits shown there are generated from the running application.

## Service health and catalog

| Endpoint | Purpose |
|---|---|
| `GET /health` | Process-level health response. It does not prove that a scientific workflow passed. |
| `GET /health/database` | Tests a database connection with a read-only `SELECT 1`. |
| `GET /api/v1/metadata/summary` | Catalog row counts and collection/band summary. |
| `GET /api/v1/observations` | Offset/limit observation listing with collection, band, ID, and MJD filters. |
| `GET /api/v1/catalog/search` | Server-side catalog filters, pagination, RA/Dec bounds, spherical cone search, and FOV. `fov_deg` is the full diameter; cone radius is `fov_deg / 2`. |
| `GET /api/v1/observations/{observation_id}` | Observation lookup. |
| `GET /api/v1/images` | Local image asset listing. |

## IRSA and cached products

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/archive/search` | One live, bounded IRSA SIA2 query. Supports `spherex_dr1`, `spherex_dr1_deep`, `spherex_qr3`, and `spherex_qr3_deep`; FOV is a diameter and is translated to the SIA cone radius. Response includes `query_url`, VOTable `QUERY_STATUS`, availability, completeness, and returned rows. |
| `GET /api/v1/archive/products` | Products successfully retrieved and recorded in the archive-product registry. |
| `GET /api/v1/archive/cached-products` | Read-only listing of hash-named cached FITS files and available provenance from the product registry or `docs/verified_archive_products.json`. Listing does not itself recompute SHA-256. |
| `POST /api/v1/archive/products/retrieve` | Explicitly retrieve a selected SIA item. DataLink is resolved and parsed; the DataLink URL is never treated as the FITS byte stream. Product size is capped at 80 MiB. |

SIA returns metadata only. A successful search is not a source detection. `QUERY_STATUS=OVERFLOW` is reported as `CAPPED`; an explicit `OK` with zero rows is a complete zero for that exact query; timeout and other errors remain failures and are not converted to zero coverage. SIA paging or asynchronous jobs are not implemented because the documented IRSA SIA2 endpoint does not expose a page cursor or async result interface.

## FITS inspection and analysis

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/analysis/fits/{image_name}` | Inspect a FITS file under the static images directory; report data and metadata, not a target detection. |
| `GET /api/v1/analysis/pixel/{image_name}?x=…&y=…` | Read original IMAGE, VARIANCE, FLAGS values and WCS coordinate when available. Flag integers are not decoded. |
| `GET /api/v1/analysis/roi/{image_name}` | Descriptive statistics for a rectangular region in the original array. Not source photometry. |
| `GET /api/v1/analysis/compare-regions/{image_name}` | Descriptive comparison of two regions within one image. Not cross-epoch differencing. |
| `POST /api/v1/analysis/epochs/wcs-comparison` | Compare two hash-named cached FITS products for WCS footprint geometry and fail-closed scientific eligibility. It does not register sources or subtract pixels. |
| `GET /api/v1/ai/anomaly/{image_name}` | Unsupervised unusual-tile triage. Not source classification or astrophysical interpretation. |
| `GET /api/v1/ai/observation-clusters` | Unsupervised grouping of catalog metadata. Not astrophysical source classification. |

Scientific quality states are `PASS`, `WARNING`, `REJECT`, and `NOT EVALUATED`. They describe the specific check named by an endpoint. A FITS-structure PASS does not imply scientific eligibility. Missing calibration, mask, uncertainty, or source-registration evidence blocks differencing.

## CORS and local configuration

The default browser URL is `http://127.0.0.1:8000`, configured by `NEXT_PUBLIC_API_URL` at frontend build time. The API CORS list permits localhost/127.0.0.1 on ports 3000 and 3001. This is a local-development configuration, not a production deployment policy. Do not place private credentials in `NEXT_PUBLIC_` variables.
