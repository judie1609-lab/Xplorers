# XPLORERS

XPLORERS is a Windows-first SPHEREx archive and analysis prototype. It combines a local observation catalog, an IRSA SIA search and bounded FITS retrieval workflow, FITS inspection, WCS geometry diagnostics, and a session evidence export.

## Start here

- [Windows installation and startup](README_WINDOWS.md)
- [Backend API reference](docs/API.md)
- [Scientific methodology and limitations](docs/scientific_methodology.md)
- [Judging demonstration guide](docs/judging_demo_guide.md)
- [Requirement traceability and readiness checklist](docs/requirement_traceability.md)
- [Real archive validation record](docs/real_archive_validation.md)
- [SPHEREx Strategy Blueprint v1.1](SPECTRA_Strategy_Blueprint_v1.1_EN.pdf)

The application runs locally by default. No public deployment is configured. The project is **not ready for judging**: the retained archive products support integrity and WCS geometry checks, while source registration, validated multi-epoch measurements, calibrated spectra, and several required science workflows remain unavailable or NOT EVALUATED.

The local SQLite database and all FITS files are intentionally excluded from Git; they remain intact in this working copy. The source CSV is included so a fresh clone can rebuild the catalog with the transactional importer. The five verified QR3 product records and provenance are documented in the JSON manifest, but their FITS bytes and the sample `SPHEREX_D3.fits` are not pushed. FITS analysis and cached-product WCS comparison require those local files to be restored or retrieved after cloning.

All archive coverage, product integrity, measurement validity, and scientific eligibility statements must be read with their quality states. A footprint match is not a target detection, a WCS mapping residual is not an empirical source-registration residual, and a visual comparison is not scientific differencing.
