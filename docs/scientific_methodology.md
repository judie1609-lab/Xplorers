# Scientific methodology and limitations

**Current assessment: NOT READY FOR JUDGING.** XPLORERS keeps four separate questions distinct: (1) are the cached bytes intact, (2) are the FITS structure and WCS readable, (3) are measurements valid, and (4) is a proposed scientific comparison eligible. Passing an earlier layer does not pass a later one.

## Catalog positions and archive queries

The five target coordinates are linked to SIMBAD records in [the real archive validation log](real_archive_validation.md). SIMBAD coordinates are catalog positions at J2000.0. Search centers in that log and in the Target Coverage workspace are a documented linear proper-motion propagation to epoch 2025.0. They omit parallax, radial velocity, and an observation-specific epoch; they are only query centers. A target-specific query defaults to a 0.2-degree FOV diameter (0.1-degree SIA cone radius), QR3 wide, calibration level 2, and image products. The user must submit the request.

An SIA row means the service returned archive metadata matching its query; a footprint overlap is not a source detection. Returned rows may be capped. `QUERY_STATUS=OVERFLOW` remains `CAPPED`, explicit `QUERY_STATUS=OK` with no rows is a zero only for that exact query, and a timeout remains a timeout. The UI does not automatically retry.

## FITS products and provenance

The archive retrieval path records source and resolved product URLs, observation/product identifiers when provided, collection/release, band, retrieval time, byte count, SHA-256, and structural validation. For verified products without archive FITS `CHECKSUM`/`DATASUM`, the local SHA-256 confirms the received file matches its cache name; it is not an archive-issued checksum. Such a product keeps its structural `WARNING` where that warning applies.

The project preserves original FITS values and declared units. Product checks inspect HDU structure, dimensions, types, available checksums, metadata, and celestial WCS. A coordinate transform sanity check does not establish astrometric accuracy. The per-session evidence export includes the live query parameters and response/error, query URLs where returned, user-browser submission/receipt times, successful retrieved products, and current comparison report. Those browser timestamps are evidence-capture times, not IRSA server timestamps. SIA query history is not persisted to the SQLite catalog.

## Field handling boundaries

The current official [SPHEREx Data Products guide](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products/) and [IRSA data-access guide](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access/) are the references for product structure and access behavior.

- `IMAGE`: calibrated surface brightness. Raw values are not rescaled by the comparison API.
- `VARIANCE`: per-pixel variance as documented by the archive. Its presence alone does not establish cross-epoch uncertainty propagation or a validated source-flux uncertainty.
- `FLAGS`: retained as raw per-pixel integer values. Their release-appropriate bit definitions are in Table 16 of the SPHEREx Explanatory Supplement; XPLORERS does not infer flag meanings or masks without that mapping and a release-bound policy.
- `EPSF` / `PSF`: structurally inventoried only. No ePSF fit or point-source photometry is performed.
- `ZODI`: modeled zodiacal background; the archive documents it as not subtracted from IMAGE. XPLORERS does not subtract it or treat it as a source/background estimate.
- `WCS-WAVE`: visualization-oriented lookup table in the spectral image MEF. It is not used here to report scientifically calibrated spectra.
- `CWAVE` / `CBAND`: the official guide specifies these extensions from the separate Spectral WCS calibration product for science wavelength/bandwidth analysis. That product and matching calibration validation are not present in the retained evidence, so the Spectral Explorer remains NOT EVALUATED.

The [official ePSF tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-psf/) documents the ePSF data layout and use. The [SPHEREx Explanatory Supplement](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/SPHEREx_Expsupp.pdf) is the authoritative flag reference. No unverified flag semantics, PSF quality cuts, or arbitrary thresholds are encoded.

## Cross-product comparison

The WCS comparison reports bidirectional sampled footprint overlap and a fitted map from one WCS pixel grid to another. Its RMS and p95 are **WCS mapping diagnostics**. They are not empirical source-registration residuals. Source registration is NOT EVALUATED because no cross-epoch source associations or reference-star measurements have been validated.

The eligibility report separately checks detector, band, release, calibration compatibility, elapsed time, geometry, units, masks, uncertainty, and source registration. Unknown checks remain NOT EVALUATED and block the differencing gate. No arbitrary temporal or overlap cutoff is applied. CSS blending, wipe, or a spatial overlap result cannot enable scientific differencing. The existing preview comparison modes are visual-only.

The two Barnard QR3 D6 products are 128.9299679 seconds apart. They are a geometry test pair, not an appropriate long-baseline motion/variability pair. Epsilon Indi B, RW Aur, and R Draconis each have one verified local product but no confirmed compatible separated pair. WISE 0855 has no locally verified product; the retained zero-row result is query-limited and other searches timed out.

## Measurements not currently evaluated

No target detections, source associations, motion, photometry, light curves, variability, spectral fluxes, or scientific image-change products are asserted. Their prerequisites include appropriate separated observations, observation-epoch target positions and uncertainty models, same-detector/band/release calibration evidence, empirical registration, source matching, verified flag/mask policy, PSF/ePSF modeling, and uncertainty propagation. Missing prerequisites remain NOT EVALUATED; they are not replaced by visual previews, catalog metadata, or synthetic test fixtures.

## Test data versus observations

Sanitized FITS/WCS fixtures test parsing and fail-closed branches only; their values do not represent SPHEREx observations. The separately recorded live integration result used an actual archive product. Test status and live archive status are reported separately in `docs/real_archive_validation.md`.
