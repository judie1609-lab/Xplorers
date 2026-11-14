# XPLORERS demonstration and readiness guide

**Readiness assessment: NOT READY FOR JUDGING.** This guide presents a reproducible local demonstration of real archive handling and fail-closed analysis. It does not assert scientific discoveries or replace current contest instructions.

## Before the demonstration

1. Read [Windows installation](../README_WINDOWS.md), then start the API and frontend in separate PowerShell windows.
2. Open `http://127.0.0.1:8000/health`, `/health/database`, `/docs`, and `http://localhost:3000`. Health endpoints establish service availability only.
3. This working copy contains the five retained cached products. Confirm they are listed in **Scientific Analysis** and that displayed hashes/sizes agree with [the archive validation record](real_archive_validation.md). A clean Git clone intentionally excludes all FITS bytes and must restore them before the FITS/WCS part of this walkthrough is available.
4. If the archive will be queried live, choose one target, one collection, and a bounded FOV. Submit once. A timeout is a timeout, not zero coverage. Avoid repeated retries.
5. Keep the project SQLite database and the five FITS files unchanged in this working copy. Do not import the CSV during the demo. On a fresh clone, initialize the catalog from the included CSV and restore the required FITS files before presenting scientific image workspaces.

## Safe five-step walkthrough

| Step | Workspace and action | Expected, defensible result |
|---|---|---|
| 1. Identify a required case | Open **Target Coverage** and choose one named target. Point out the linked SIMBAD coordinate, J2000 catalog epoch, approximate 2025.0 query center, and the missing parallax/radial-velocity correction. | Catalog coordinates and query-center approximation are labeled as such. They are not described as SPHEREx detections. |
| 2. Search IRSA explicitly | Select **Prepare user-triggered IRSA search**, inspect RA/Dec, FOV, and collection, then press **Search IRSA metadata**. | A live IRSA SIA response is shown with actual rows, `COMPLETE`/`CAPPED` status, query URL, and product availability. A timeout or service error stays an error. |
| 3. Inspect a verified FITS product | Open **Scientific Analysis** and select one cached product. Show IMAGE statistics, units, HDUs, raw FLAGS values, variance, WCS, byte size, and SHA-256 where available. | Data are read from the existing archive file. Product-level `WARNING` and scientific `NOT EVALUATED` are visible; no flag semantics are invented. |
| 4. Compare WCS geometry | Choose the two Barnard D6 products and run the existing WCS comparison. | Demonstrate sampled footprint overlap, WCS mapping RMS/p95, separate source-registration state, and each eligibility check. Explain that the time separation is 128.9299679 s; the science gate is REJECT and no pixels are subtracted. |
| 5. Export the evidence record | Open **Scientific Evidence** and export JSON after a search and comparison. | The dossier contains current query parameters/results or failure, returned rows, timestamps captured by the browser, successfully retrieved product provenance, selected target case, WCS report, quality reasons, and explicit limitations. It records the current session only. |

## Do not present as scientific results

- The existing Overview timeline is catalog metadata, not a validated target-image time series or playback.
- The preview-based Comparison Lab is visual-only. Its blend/wipe/difference display must not be called scientific image differencing.
- The AI clustering and anomaly workspaces are metadata/tile triage only, not source classification or astrophysical evidence.
- A returned SIA footprint row or a target coordinate falling inside a FITS image does not establish target detection.
- The Barnard WCS RMS/p95 values are WCS transformation diagnostics, not source registration residuals.
- Do not claim proper motion, flux, variability, spectrum, light curve, change detection, or discovery.
- WISE 0855 coverage is unresolved. Its previous QR3 zero-row result was limited to one exact query; alternate searches timed out.

## Current acceptance checklist

| Gate | State | Evidence or blocker |
|---|---|---|
| Local API and browser application | PARTIALLY IMPLEMENTED | Local health and production build are tested; public URL and external production deployment are not configured. |
| RA/Dec/FOV and real IRSA query | IMPLEMENTED | User-triggered SIA2 path and explicit FOV semantics exist; live archive availability can vary. |
| Real products and provenance | IMPLEMENTED | Five verified QR3 products and prior live integration evidence are preserved; product-level missing FITS checksum cards leave warnings. |
| Same-sky, scientifically eligible separated epochs | NOT EVALUATED | No suitable validated pair; the Barnard pair is only 128.93 s apart and other targets lack a confirmed pair. |
| Timeline/playback at true observation times | PARTIALLY IMPLEMENTED | Generic metadata timeline exists; validated target-product playback does not. |
| Five target cases | PARTIALLY IMPLEMENTED | Four have one or more local footprint-validated products; WISE coverage unresolved; no target detections claimed. |
| What Changed, motion, light curves, spectra | NOT EVALUATED | Registration, compatible calibrations, source associations, and measurement uncertainties are unavailable. |
| Quality gate and evidence export | PARTIALLY IMPLEMENTED | Integrity and comparison gates are fail-closed; the evidence export is session-scoped and no validated measurements exist. |
| Current judging format, public deployment, AI disclosure | NOT EVALUATED | Verify current 2026 submission rules with organizers; external deployment and portal submission are outside this local project. |

Before any external presentation, independently verify the active challenge rules, required submission format, public-link expectations, accessibility requirements, team naming, and AI-use disclosure with the current organizers. No public deployment or submission has been made by this project work.

For disclosure preparation, note that AI-assisted implementation and documentation changes were made during this maintenance phase. Review the full project history with the team, identify the tools and scope required by the current rules, and state clearly that no AI-generated scientific observations or measurements were used.
