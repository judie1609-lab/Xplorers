# SPECTRA Phase 1 — Windows Native Setup (No Docker)

This version runs directly on Windows. It uses SQLite for the first local milestone, so Docker, WSL, Ubuntu, and BIOS virtualization are not required.

## Requirements
- Windows 10/11
- Python 3.12 (install from https://www.python.org/downloads/windows/ and enable **Add python.exe to PATH**)
- Node.js 20.9 or newer and npm (required for the Next.js 16 frontend)
- VS Code (recommended, optional)

## Included data
This working copy has a prebuilt SQLite catalog at `data\spectra.db` with **28,953 rows**. Git intentionally excludes the local `data\` directory and all FITS files. The root `table_Spectral-Images-1.csv` is included in the repository so a fresh clone can recreate the catalog. On a fresh clone, run the CSV import below before using catalog-backed workspaces.

The five verified QR3 FITS products and `backend\static\images\SPHEREX_D3.fits` remain in this local working copy but are not part of the Git push. A fresh clone will not have FITS inspection or cached-product WCS comparison data until those files are restored or retrieved. This is an intentional data exclusion; their provenance is retained in `docs\verified_archive_products.json` and `docs\real_archive_validation.md`.

## 1. Install Python packages
Open PowerShell in this folder and run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\setup_windows.ps1
```

## 2. Start the API

```powershell
.\run_api_windows.ps1
```

Open:
- http://127.0.0.1:8000/docs
- http://127.0.0.1:8000/health
- http://127.0.0.1:8000/api/v1/metadata/summary

## 3. Start the frontend

In a second PowerShell window:

```powershell
Set-Location .\frontend
npm ci
npm run dev
```

Open http://localhost:3000. The default frontend API address is `http://127.0.0.1:8000`. For another local API address, set `NEXT_PUBLIC_API_URL` in `frontend\.env.local` before starting the frontend. Do not put private credentials in any `NEXT_PUBLIC_` variable.

## Initialize or rebuild the catalog from the CSV
The root CSV is already beside this README. Run this before the API on a fresh clone, or whenever you intentionally need to rebuild the catalog:

```powershell
.\import_data_windows.ps1
```

The database is stored at `data\spectra.db`.

CSV replacement is transactional: the existing catalog remains committed until
the full replacement import succeeds. If parsing or inserting any row fails,
the transaction rolls back and the previous catalog remains available.

## Catalog search and IRSA archive products

The local catalog search is available at `/api/v1/catalog/search`. It filters
and paginates on the server. `ra_min`/`ra_max` may cross 0°; the optional
`ra_deg`, `dec_deg`, and `fov_deg` parameters define a spherical cone, with
`fov_deg` interpreted as the full diameter and the searched radius set to
`fov_deg / 2`.

The **IRSA Archive** workspace queries the official IRSA SIA v2 endpoint for
`spherex_dr1`, `spherex_dr1_deep`, `spherex_qr3`, or `spherex_qr3_deep` image
collections. QR2 is not available through the current SIA2 search path. Search
is user-triggered and returns actual IRSA metadata without claiming target
detections. Product retrieval is a separate, explicit action, limited to 80
MiB per product.
Products are stored under `backend/static/archive_products/` by SHA-256, and
their source and resolved URLs, release metadata, retrieval time, checksum,
FITS validation report, and quality state are recorded in the additive
`archive_products` table. The original SQLite catalog and source data are not
replaced by this feature. The five already verified cache files also have a
read-only record in `docs/verified_archive_products.json`; the cached-product
API uses it when a matching registry row is not present. File size matching
does not substitute for recomputing the SHA-256, which is done for a selected
pair before reporting comparison integrity.

IRSA SIA rows may return either a direct `image/fits` access URL or a DataLink
VOTable URL. DataLink is resolved and parsed as VOTable; only a link with
`semantics=#this` and FITS content is eligible for download. Service descriptor,
cutout, and calibration links are not treated as the selected science image.
All requests and redirects are restricted to HTTPS IRSA SIA, SPHEREx DataLink,
and SPHEREx IBE product paths.

FITS validation reports exact HDU names, dimensions, dtypes, units, table
columns, WCS header keywords, and available CHECKSUM/DATASUM results. The
`PASS`/`WARNING`/`REJECT` structural state describes FITS integrity only;
scientific quality remains `NOT EVALUATED` until independent calibration,
WCS registration, uncertainty, PSF/ePSF, flags, and provenance checks exist.
No flag meanings or scientific results are inferred from the FITS values.

## Current science and judge-readiness state

Use **Target Coverage** to inspect the five required cases and prepare a bounded
query. Catalog coordinates are from linked SIMBAD records; the displayed query
centers are the documented linear proper-motion propagation to epoch 2025.0 and
omit parallax, radial velocity, and observation-specific propagation. The query
is sent only after the Search button is pressed. Request parameters and the live
response or error are captured in the current browser-session evidence export;
IRSA query history is not written to the project database.

Use **Scientific Analysis** for cached-product WCS geometry and the transparent
comparison eligibility report. Current data do not validate empirical
source-registration residuals, source detections, motion, photometry, variability,
light curves, spectra, or pixel differencing. The Barnard D6 pair is only 128.929
seconds apart and its differencing gate is REJECT. WISE 0855 coverage remains
unresolved; timeouts are not zero-row results.

The app remains a local prototype and is **not ready for judging**. The judging
guide lists a safe real-data demo sequence, expected outputs, scientific limits,
and remaining acceptance gates. No cloud deployment, public URL, or contest
portal configuration is included.

## Notes
- This phase stores all 62 source CSV fields in `raw_metadata` and indexes commonly searched fields.
- `obs_id` is not a unique key; the database uses its own integer primary key.
- `access_url` values in the local catalog can be DataLink endpoints. Retrieval resolves these through DataLink and never downloads the VOTable URL as if it were a FITS file.
- SQLite is suitable for this single-user local MVP and 28,953-row catalog. The current cone search is correct on the sphere but uses SQL trigonometric expressions; a spatial database/index would be appropriate for much larger catalogs or concurrent workloads.
- Motion, light curves, empirical image registration, spectra, reference-star controls, change atlas, and scientific change detection require compatible verified products, authoritative calibration metadata, and independent validation. Their absence is displayed as unavailable or `NOT EVALUATED`, never as a pass or discovery.
- No astronomical change is inferred from catalog metadata alone.

## Project references

- [API reference](docs/API.md)
- [Scientific methodology](docs/scientific_methodology.md)
- [Judging demonstration guide](docs/judging_demo_guide.md)
- [Requirement traceability](docs/requirement_traceability.md)
- [Real archive validation and provenance](docs/real_archive_validation.md)
