# XPLORERS real SPHEREx archive validation

**Run date:** 2026-11-13 UTC  
**Data source:** IRSA SIA and the official IRSA QR S3 mirror  
**Scientific state:** archive retrieval is demonstrated for five real products: two Barnard's Star samples, and one each for Epsilon Indi B, RW Aur, and R Draconis. Target source detections, calibrated spectra, photometry, motion, light curves, cross-epoch registration, and change detection remain **NOT EVALUATED**.

## Scope and query method

The target centers below come from SIMBAD entries and their linked catalog references. SIMBAD reports the coordinates as ICRS at J2000.0. Proper motion is in mas/year, with `pmRA = μRA cos(dec)` and `pmDec = μDec`. For the archive search, those catalog coordinates were propagated linearly to epoch 2025.0 using the listed proper motions. This is a query-center approximation: it does not apply parallax, radial velocity, or an observation-specific epoch correction.

All SIA searches used a **0.2 degree full FOV diameter** (12 arcminutes), represented by `POS=CIRCLE <RA> <Dec> 0.1` (a 6 arcminute radius), `CALIB=2`, `DPTYPE=image`, `MAXREC=20`, and CSV output. An SIA match means an archive product footprint intersects the search cone. It is not evidence of a detected target.

The checked QR3 responses returned at most 20 product rows per target. Where all 20 were returned, row and observation counts below are capped lower bounds, not total archive counts. Products were reported as direct FITS access where available. QR2 is not used to infer absence: IRSA says that after DR1 release QR2 is no longer returned in IRSA/VO searches, while direct QR2 download remains available through February 2027. DR1 and QR3 are the current uniformly processed image set. See [IRSA Quick Release overview](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html) and [IRSA SIA documentation](https://irsa.ipac.caltech.edu/ibe/sia.html).

## Catalog coordinates and query centers

| Target | SIMBAD ICRS coordinate (J2000.0) | Proper motion (mas/yr) | Coordinate/proper-motion reference | Search center at epoch 2025.0 (deg) |
|---|---|---:|---|---:|
| Barnard's Star | 17:57:48.4984700685, +04:41:36.113879676 | −801.551, +10362.394 | [SIMBAD](https://simbad.cds.unistra.fr/simbad/sim-id?Ident=Barnard%27s+Star), Gaia DR3 catalog reference `2020yCat.1350....0G` | 269.446491905, +4.765326036 |
| WISE 0855 | 08:55:16.53798, −07:14:49.3728 | −8123.7, +673.2 | [SIMBAD](https://simbad.cds.unistra.fr/simbad/sim-id?Ident=WISEA+J085510.74-071442.5), CatWISE reference `2021ApJS..253....7K` | 133.762039367, −7.242373000 |
| Epsilon Indi B | 22:04:10.5951812451, −56:46:58.239102418 | +3981.977, −2466.832 | [SIMBAD](https://simbad.u-strasbg.fr/simbad/sim-id?Ident=%2A+eps+Ind+B), Gaia DR3 catalog reference `2020yCat.1350....0G` | 331.094624727, −56.799974973 |
| RW Aur | 05:07:49.5662483, +30:24:05.177426 | +7.23, −20.33 | [SIMBAD](https://simbad.cds.unistra.fr/simbad/sim-id?Ident=RW+Aur), astrometry reference `2007A&A...474..653V` | 76.956584247, +30.401296993 |
| R Draconis | 16:32:40.2265999080, +66:45:17.925901992 | −20.643, +6.149 | [SIMBAD](https://simbad.cds.unistra.fr/simbad/sim-id?Ident=%40376084&Name=V%2A+R+Dra&submit=submit), Gaia DR3 catalog reference `2020yCat.1350....0G` | 248.167247602, +66.755022119 |

These are catalog coordinates and proper motions, not target detections or measured XPLORERS results. Barnard's Star, WISE 0855, and Epsilon Indi B move substantially; any narrow-FOV science analysis should propagate to each observation's epoch and include the appropriate astrometric model.

## SIA archive coverage

The exact QR3 query format is `https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_qr3&POS=CIRCLE+<RA>+<Dec>+0.1000000000&CALIB=2&DPTYPE=image&MAXREC=20&RESPONSEFORMAT=CSV`. The same query was attempted with `COLLECTION=spherex_dr1` for each target. Barnard's Star DR1 returned successfully in the earlier live query; four DR1 retries timed out in this run and are left unresolved rather than treated as empty results.

| Target | DR1 SIA result | QR3 SIA result | Returned bands | Returned date range (UTC) | Example observation IDs | Product availability | Compatible multi-epoch |
|---|---|---|---|---|---|---|---|
| Barnard's Star | 20 rows (cap), 11 observation IDs; 2025-08-15 to 2025-08-21 | 20 rows (cap), 10 observation IDs; 2026-08-16 to 2026-09-22 | DR1 D3,D6; QR3 D2,D3,D5,D6 | DR1 2025-08-15 20:45 to 2025-08-21 15:22; QR3 2026-08-16 15:06 to 2026-09-22 15:04 | DR1 `2025W33_2C_0321_1`; QR3 `2026W33_2A_0594_3`, `2026W33_2A_0594_4`, `2026W39_1A_0371_1` | Direct FITS rows returned in both releases | NOT EVALUATED; only one downloaded product contains the target coordinate |
| WISE 0855 | Query timed out; coverage unresolved | 0 rows returned | None in the QR3 response | None | None | No QR3 products returned; DR1 unresolved | NOT EVALUATED |
| Epsilon Indi B | Query timed out; coverage unresolved | 20 rows (cap), 10 observation IDs; 2026-09-22 to 2026-09-23 | D3,D6 | 2026-09-22 05:26 to 2026-09-23 17:22 | `2026W39_1A_0276_2`, `2026W39_1A_0276_3` | Direct FITS rows returned | NOT EVALUATED; no epoch pair validated |
| RW Aur | Query timed out; coverage unresolved | 20 rows (cap), 10 observation IDs; 2026-09-02 to 2026-09-11 | D1,D2,D4,D5 | 2026-09-02 02:19 to 2026-09-11 20:59 | `2026W36_1A_0476_1` | Direct FITS rows returned | NOT EVALUATED; no epoch pair validated |
| R Draconis | Query timed out; coverage unresolved | 20 rows (cap), 11 observation IDs; 2026-05-16 to 2026-05-23 | D3,D6 | 2026-05-16 08:41 to 2026-05-23 11:50 | `2026W20_2A_0294_4` | Direct FITS rows returned | NOT EVALUATED; no epoch pair validated |

For rows capped at 20, the listed bands, IDs, and dates describe the returned sample only. SIA footprint overlap is not a source detection. The absence of a QR3 row for WISE 0855 is limited to this target center, 0.2 degree FOV, release, calibration level, and response; DR1 coverage remains unresolved.

The QR3 table comes from the successfully returned live SIA searches earlier in this audit. Later QR3 retries for Epsilon Indi B, RW Aur, and R Draconis timed out at 180 seconds; their sampled product keys were checked separately in the official S3 listing before download.

### Target-position check in downloaded images

For each file, the catalog coordinate and proper motion were propagated from J2000 to that product's `MJD-OBS`, then projected with the IMAGE celestial WCS to zero-based pixels. This is a first-order proper-motion-only check (no parallax or radial velocity); an in-image coordinate is not a detection.

| Target and product | Target pixel (x,y) | Within the 2040 x 2040 image? |
|---|---:|---|
| Barnard's Star, `2026W33_2A_0594_3` D6 | (652.54, 2047.49) | No; SIA cone-overlap product only |
| Barnard's Star, `2026W33_2A_0594_4` D6 | (651.70, 1933.18) | Yes |
| Epsilon Indi B, `2026W39_1A_0276_2` D3 | (2002.78, 1671.10) | Yes |
| RW Aur, `2026W36_1A_0476_1` D1 | (262.65, 651.28) | Yes |
| R Draconis, `2026W20_2A_0294_4` D3 | (1715.42, 1755.58) | Yes |

The live DR1 retry URLs used `COLLECTION=spherex_dr1`, the same target-specific centers above, the same 0.1 degree radius, and `MAXREC=20`. Each of the four unresolved requests (WISE 0855, Epsilon Indi B, RW Aur, R Draconis) timed out at 20 seconds and again with a 120 second timeout. The successful Barnard DR1 query used:

`https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_dr1&POS=CIRCLE+269.4464919048+4.7653260360+0.1000000000&CALIB=2&DPTYPE=image&MAXREC=20&RESPONSEFORMAT=CSV`

## Real FITS products retrieved

Two Barnard D6 products were downloaded. The first was returned by SIA because its footprint intersects the 0.2-degree search cone, but a separate proper-motion-at-observation-epoch WCS check places the star just outside this image. The second product contains the propagated coordinate within its pixel bounds. Neither result asserts a source detection.

| Provenance field | Value |
|---|---|
| Target search | Barnard's Star, epoch-2025.0 center 269.4464919048°, +4.7653260360°, 0.2° FOV diameter |
| SIA query | `https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_qr3&POS=CIRCLE+269.4464919048+4.7653260360+0.1000000000&CALIB=2&DPTYPE=image&MAXREC=20&RESPONSEFORMAT=CSV` |
| SIA source product URL | `https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/2026W33_2A/l2b-v27-2026-241/6/level2_2026W33_2A_0594_3D6_spx_l2b-v27-2026-241.fits` |
| Resolved product URL | `https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/qr3/level2/2026W33_2A/l2b-v27-2026-241/6/level2_2026W33_2A_0594_3D6_spx_l2b-v27-2026-241.fits` |
| SIA observation ID / release / band | `2026W33_2A_0594_3` / QR3 (`spherex_qr3`) / SPHEREx-D6 |
| Observation time | `2026-08-16T15:06:13.192` UTC; MJD `61268.629319352` |
| Retrieval time | `2026-11-13T21:27:44.121828+00:00` |
| Received and archive-declared size | `64,981,440` bytes (equal) |
| HTTP ETag | `"715183758da76887c58b49534ce554e8"` (not a SHA-256 checksum) |
| Local SHA-256 | `815e02a989418172e7e408ee925b518f2e9a51bd244aef82b6ca2e5d10974da6` |
| Local cached file | `backend/static/archive_products/815e02a989418172e7e408ee925b518f2e9a51bd244aef82b6ca2e5d10974da6.fits` |

The SIA row declared `image/fits` / direct FITS access, not a DataLink response. The IRSA product was mapped to its documented QR S3 mirror, downloaded in byte ranges, and checked against the advertised total size. This product download did not use a DataLink URL as a FITS file URL. This first Barnard file is a cone-overlap example: the Barnard coordinate propagated to `DATE-OBS` falls just outside this image's pixel bounds, so this file is not treated as containing the star.

### Additional QR3 target products

The follow-up live SIA requests timed out, so the exact additional object keys below were first verified in the official public S3 listing under the planning-period and processing directories associated with the SIA-returned observation IDs and bands. Their IRSA IBE input URLs use the confirmed keys and were passed to the same bounded project retriever. These are archive products, not detections.

**Barnard's Star (target-position sample)** - observation `2026W33_2A_0594_4`, QR3, SPHEREx-D6; `DATE-OBS=2026-08-16T15:08:22.122`, MJD `61268.630811597`. The propagated target position maps to pixel `(651.70, 1933.18)`, inside the image. Retrieved `2026-11-13T22:35:21.489232+00:00`; `64,941,120` bytes (declared size matched); ETag `"bcbc62495c94cab1efa774e730c4e415"`; SHA-256 `40ce174e9ba2ffac86e7df4b20d3eb949a12090ed586deef982ae6275320ba02`; local file `backend/static/archive_products/40ce174e9ba2ffac86e7df4b20d3eb949a12090ed586deef982ae6275320ba02.fits`.

- IBE input: `https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/2026W33_2A/l2b-v27-2026-241/6/level2_2026W33_2A_0594_4D6_spx_l2b-v27-2026-241.fits`
- Resolved S3 product: `https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/qr3/level2/2026W33_2A/l2b-v27-2026-241/6/level2_2026W33_2A_0594_4D6_spx_l2b-v27-2026-241.fits`

**Epsilon Indi B** - observation `2026W39_1A_0276_2`, QR3, SPHEREx-D3; `DATE-OBS=2026-09-22T05:28:53.617`, MJD `61305.228398345`. Retrieved `2026-11-13T22:17:08.124815+00:00`; `65,995,200` bytes (declared size matched); ETag `"bd739fe9b47ea30c7f1c09ab644d9b9a"`; SHA-256 `ffdba4f71be3f3985f1afd1f6ea662599b456db18d6c0932d026fbb7b7cb1528`; local file `backend/static/archive_products/ffdba4f71be3f3985f1afd1f6ea662599b456db18d6c0932d026fbb7b7cb1528.fits`.

- IBE input: `https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/2026W39_1A/l2b-v27-2026-268/3/level2_2026W39_1A_0276_2D3_spx_l2b-v27-2026-268.fits`
- Resolved S3 product: `https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/qr3/level2/2026W39_1A/l2b-v27-2026-268/3/level2_2026W39_1A_0276_2D3_spx_l2b-v27-2026-268.fits`

**RW Aur** - observation `2026W36_1A_0476_1`, QR3, SPHEREx-D1; `DATE-OBS=2026-09-02T02:19:55.430`, MJD `61285.097169329`. Retrieved `2026-11-13T22:20:39.656805+00:00`; `65,638,080` bytes (declared size matched); ETag `"7b619eda0d8e08b8c500c224e784246c"`; SHA-256 `a0de1723f4c47c53e3c5ddd8e152046511e0311c999ff5603adce3c44b9b8ea2`; local file `backend/static/archive_products/a0de1723f4c47c53e3c5ddd8e152046511e0311c999ff5603adce3c44b9b8ea2.fits`.

- IBE input: `https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/2026W36_1A/l2b-v27-2026-252/1/level2_2026W36_1A_0476_1D1_spx_l2b-v27-2026-252.fits`
- Resolved S3 product: `https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/qr3/level2/2026W36_1A/l2b-v27-2026-252/1/level2_2026W36_1A_0476_1D1_spx_l2b-v27-2026-252.fits`

**R Draconis** - observation `2026W20_2A_0294_4`, QR3, SPHEREx-D3; `DATE-OBS=2026-05-16T08:48:05.330`, MJD `61176.366728356`. Retrieved `2026-11-13T22:21:00.923530+00:00`; `65,928,960` bytes (declared size matched); ETag `"063432f1fcf5bd88946e8488bb9cbf88"`; SHA-256 `51f8bd415da3308555bf6b254e36e7e42f5dd054218054a693d39352fe9475ac`; local file `backend/static/archive_products/51f8bd415da3308555bf6b254e36e7e42f5dd054218054a693d39352fe9475ac.fits`.

- IBE input: `https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/2026W20_2A/l2b-v27-2026-267/3/level2_2026W20_2A_0294_4D3_spx_l2b-v27-2026-267.fits`
- Resolved S3 product: `https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/qr3/level2/2026W20_2A/l2b-v27-2026-267/3/level2_2026W20_2A_0294_4D3_spx_l2b-v27-2026-267.fits`

All five products are below the 80 MiB per-product limit. Their combined size is `327,484,800` bytes, with no partial files left in the cache. All four additional files were SHA-256 checked after caching. Each has the documented QR3 HDU layout, units, and a spatial WCS sanity check of PASS; each overall file-quality state is WARNING because archive FITS CHECKSUM/DATASUM cards are absent.

### FITS structure and validation

| HDU | Observed structure | Unit / metadata |
|---|---|---|
| PRIMARY | PrimaryHDU; no image array | pipeline version `7.0.5` |
| IMAGE | 2040 × 2040 float32; RA---TAN-SIP / DEC--TAN-SIP; ICRS | `MJy / sr`; `DATE-OBS=2026-08-16T15:06:13.192`; `MJD-OBS=61268.629319352`; detector 6 |
| FLAGS | 2040 × 2040 compressed int32 image | Per-pixel bitmap; values preserved, not decoded |
| VARIANCE | 2040 × 2040 float32 | `MJy2 / sr2` |
| ZODI | 2040 × 2040 float32 | `MJy / sr`; modeled zodiacal background, not subtracted from IMAGE |
| EPSF | Binary table, 441 detector zones; columns BINX, BINY, XCENTER, YCENTER, XWIDTH, YWIDTH, NSTAR, NEFF_MEAN, CWAVE, CBAND, EPSF; EPSF grid is 33 × 33 | Coordinates/widths in pixels; CWAVE/CBAND in μm; EPSF values not used for photometry |
| WCS-WAVE | One-row binary table with X, Y, VALUES; 9 × 9 control-point grid | Visualization lookup only; not used as scientific wavelength calibration |

**PASS:** FITS syntax/HDUs open and verify; HTTP byte count equals the archive-advertised size; local SHA-256 is repeatable; required QR3 HDUs including EPSF are present; documented IMAGE, VARIANCE, and ZODI units parse correctly; IMAGE celestial WCS transforms its center and four corners to finite sky coordinates.

**WARNING:** No HDU in the downloaded archive product has both `CHECKSUM` and `DATASUM`, so archive-provided FITS checksum validation is unavailable. The SHA-256 above is a local content hash, not an archive-supplied checksum. WCS validation is a spatial sanity check, not an alignment or astrometric-accuracy test.

**NOT EVALUATED:** FLAGS bit meanings; source detection; target association; image registration across epochs; PSF/ePSF photometry; variance propagation into source uncertainty; spectra; motion; light curves; and change detection.

## Official field interpretation boundaries

The [official SPHEREx Data Products guide](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products/) identifies IMAGE as calibrated surface brightness without zodiacal subtraction, VARIANCE as its variance, ZODI as modeled zodiacal light that is not subtracted from IMAGE, FLAGS as a bitmap whose definitions are in Table 16 of the Explanatory Supplement, and HDU 5 as EPSF for DR1/QR3 or PSF for QR2. It also says WCS-WAVE in the image MEF is intended for visualization; science wavelength values require the separate Spectral WCS calibration product's CWAVE and CBAND images. The [ePSF tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-psf/) describes the EPSF table schema and model use.

The [IRSA cloud data access guide](https://irsa.ipac.caltech.edu/cloud_access/index.html) documents the public QR product mirror. Its current page did not confirm DR1 publication to S3, so the downloader does not map DR1 IBE links to S3.

The official [Explanatory Supplement](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/SPHEREx_Expsupp.pdf) is the cited source for FLAGS Table 16. The bit table was not available to this validation run, so no flag bit names, masks, or scientific interpretations are encoded. No separate Spectral WCS product containing CWAVE/CBAND was retrieved; the WCS-WAVE table is not substituted for it.

## Test fixture and live integration results

Automated tests build a small, zero-valued sanitized FITS fixture matching the verified QR3 HDU names, compressed FLAGS type, EPSF and WCS-WAVE table columns, and documented units. It carries a `SANITIZ` marker. Its pixel and table values are synthetic test zeros; it is not an observation or analysis result. FITS checksum evidence is deliberately absent on the compressed FLAGS test HDU, so the fixture must remain WARNING rather than PASS.

An opt-in live integration test was run against the actual SIA source URL above with an 80 MiB cap. It passed after a 311 second transfer: received size and expected SHA-256 matched, the spatial WCS passed, the EPSF QR3 layout and required extensions were present, and spectral calibration and flag interpretation remained NOT EVALUATED. The product did not exceed the cap.

The full backend suite ran 20 tests: 19 passed and the separate live test was skipped when run without its opt-in URL. The opt-in live test was also run separately and passed as described above.

## Outstanding validation

1. Retry the four DR1 SIA queries when the archive responds; query the all-sky release/product APIs as appropriate, and retain exact responses and timestamps.
2. Retrieve at least one additional product at a distinct epoch for each target with reported coverage, then verify same-band compatibility, target position coverage, WCS registration, PSF/ePSF, and uncertainty metadata before evaluating multi-epoch behavior.
3. Retrieve compatible spectral WCS calibration products (CWAVE/CBAND) for any spectral analysis.
4. Obtain and implement the official FLAGS Table 16 mapping with version/release checks before decoding flags.
5. Validate observation-time target coordinates, cross-epoch WCS registration, PSF/ePSF compatibility, source association, and uncertainty propagation before motion, photometry, light curves, or change analysis.
6. Obtain archive-provided checksums or another official integrity reference if available; the current local SHA-256 verifies received bytes only.

No target detections, scientific measurements, spectra, proper motions measured from SPHEREx, variability, or discoveries are reported here.

## Multi-epoch validation update

**Update completed:** 2026-11-13 23:15 UTC  
**Scientific state:** No target motion, variability, photometry, spectral measurement, or change image has been evaluated. The only downloaded same-target pair is two Barnard's Star QR3 D6 files 128.929 seconds apart. It is useful for testing WCS geometry, but not a long-baseline motion comparison.

### Searchable image collections and live-query status

The current [IRSA data-access guide](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access/) lists four searchable spectral-image collections: `spherex_dr1`, `spherex_dr1_deep`, `spherex_qr3`, and `spherex_qr3_deep`. QR2 remains downloadable through February 2027 but is no longer searchable through SIA2. DR1 also has `spherex_dr1_cube`; it is a coadded all-sky product, not a sequence of independent spectral-image epochs, so it is not used as an epoch pair.

The expanded metadata-only query batch used `CALIB=2`, `DPTYPE=image`, CSV, and `MAXREC=100`. For each target it queried the catalog-propagated epoch-2025.0 center from the preceding coordinate table with a **0.2-degree FOV diameter** (`POS=CIRCLE RA Dec 0.1`). The batch queried all four image collections. All 20 requests timed out while reading the SIA response (about 15.4–17.2 seconds each); none returned a table. The errors are timeouts, not zero-row results. A separate initial `spherex_dr1_deep` Barnard request returned HTTP 502 Proxy Error. The local `data/spectra.db` catalog was read-only checked; it has 28,953 rows but no observation pointings within 2 degrees of any of these five centers, so it does not add target coverage evidence.

| Target | Last successful metadata result retained from the 2026-11-13 audit | Expanded DR1/QR3 wide/deep batch | Current interpretation |
|---|---|---|---|
| Barnard's Star | QR3 wide: 20 rows returned (capped), 10 observation IDs, 2026-08-16 to 2026-09-22. DR1 wide: 20 rows (capped), 11 observation IDs, 2025-08-15 to 2025-08-21. | All four collections timed out. | Archive-footprint metadata exists in the prior bounded sample; exact multi-epoch product pairing remains unverified. |
| WISE 0855 | QR3 wide: 0 rows for the epoch-2025.0 center and 0.2-degree FOV. DR1 query timed out. | All four collections timed out. | The prior QR3 zero applies only to that one collection, center, FOV, calibration level, and query. Coverage remains unresolved. |
| Epsilon Indi B | QR3 wide: 20 rows returned (capped), 10 observation IDs, 2026-09-22 to 2026-09-23. DR1 query timed out. | All four collections timed out. | Archive-footprint metadata exists in the prior bounded sample; detector/band-compatible pairs were not confirmed. |
| RW Aurigae | QR3 wide: 20 rows returned (capped), 10 observation IDs, 2026-09-02 to 2026-09-11. DR1 query timed out. | All four collections timed out. | Archive-footprint metadata exists in the prior bounded sample; detector/band-compatible pairs were not confirmed. |
| R Draconis | QR3 wide: 20 rows returned (capped), 11 observation IDs, 2026-05-16 to 2026-05-23. DR1 query timed out. | All four collections timed out. | Archive-footprint metadata exists in the prior bounded sample; detector/band-compatible pairs were not confirmed. |

For WISE 0855, two additional metadata-only strategies were tried against `spherex_qr3`: a 1.0-degree FOV centered on the epoch-2025.0 propagated position, and a 0.2-degree FOV centered on the decimal conversion of the catalog/J2000 coordinate in the preceding table (`133.8189082500`, `-7.2470480000`). Both timed out while reading the response. The prior 0-row QR3 result therefore remains limited; neither wider-cone nor catalog-epoch coverage was established. No additional FITS products were downloaded because no refreshed SIA rows or safely confirmed object keys were available.

The expanded request form is:

```text
https://irsa.ipac.caltech.edu/SIA?COLLECTION=<one-of-the-four-image-collections>&POS=CIRCLE+<RA>+<Dec>+<radius-degrees>&CALIB=2&DPTYPE=image&MAXREC=100&RESPONSEFORMAT=CSV
```

The WISE wide-cone attempt was:

```text
https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_qr3&POS=CIRCLE+133.7620393670+-7.2423730000+0.5000000000&CALIB=2&DPTYPE=image&MAXREC=100&RESPONSEFORMAT=CSV
```

### Candidate epoch pairs

| Target | Product pair available locally | Detector / band / release and calibration metadata | Time separation | Pair decision |
|---|---|---|---:|---|
| Barnard's Star | `2026W33_2A_0594_3 D6` and `2026W33_2A_0594_4 D6` | Matching detector 6 / D6 and QR3 release. Both resolved filenames are from `l2b-v27-2026-241`; both declare pipeline `7.0.5` and `MJy / sr`. These match at the product metadata level, but calibration-reference equivalence is **NOT EVALUATED**. | 128.929 s | WCS geometry test pair only. Excluded as a long-baseline motion/variability pair. No source match or image difference. |
| WISE 0855 | No downloaded pair | No current successful refreshed SIA rows. | — | NOT EVALUATED; archive coverage unresolved. |
| Epsilon Indi B | One cached QR3 D3 product: `2026W39_1A_0276_2` | Only one local product; prior SIA sample spans multiple observation IDs, but exact compatible D3/band product rows were not retained in the summary. | — | No pair confirmed; NOT EVALUATED. |
| RW Aurigae | One cached QR3 D1 product: `2026W36_1A_0476_1` | Only one local product; prior SIA sample spans multiple bands and observation IDs, but no matching D1/band pair was confirmed. | — | No pair confirmed; NOT EVALUATED. |
| R Draconis | One cached QR3 D3 product: `2026W20_2A_0294_4` | Only one local product; prior SIA sample includes D3 and D6 rows, but no matching D3/band pair was confirmed. | — | No pair confirmed; NOT EVALUATED. |

The earlier SIA samples were capped at 20 rows. Their observation-ID counts and date spans are lower bounds over returned metadata rows, not complete target-product histories. A footprint intersection is not a target detection. Without retained row-level observation IDs, detector, band, calibration version, access URL, and product validation, the other metadata samples cannot be promoted to candidate epoch pairs.

### Cross-image WCS geometry implementation and real-product result

The backend now exposes `POST /api/v1/analysis/epochs/wcs-comparison`. It accepts two SHA-256-named cached FITS products, recomputes both file hashes, samples their celestial WCS grids in both directions, estimates sampled footprint overlap, and reports WCS inverse-closure and WCS-derived affine mapping residuals. It does not extract or match sources and does not subtract pixels. The response marks source-based alignment **NOT EVALUATED**, leaves calibration compatibility **NOT EVALUATED**, and rejects scientific differencing until source alignment, calibration compatibility, units, and uncertainties all pass. Visual rendering remains a separate, unimplemented result.

For the two Barnard D6 products, a 21 × 21 grid sampled 441 positions in each direction. In both directions, 380/441 samples (86.17%) fell within the other image. The reported WCS-to-WCS affine-map residuals were:

| Direction | RMS | 95th percentile | Maximum |
|---|---:|---:|---:|
| Product `_0594_3` → `_0594_4` | 0.03164 px | 0.06074 px | 0.11232 px |
| Product `_0594_4` → `_0594_3` | 0.02871 px | 0.05453 px | 0.10554 px |

The inverse-closure angular residuals are numerical WCS round-trip diagnostics (maximum 0.00001234 arcsec in the first direction, 0.000000148 arcsec in reverse). Neither these values nor the affine-map residual measures empirical registration accuracy. No stars or other reference sources were matched. The pair-level state is **WARNING**; the sampled WCS geometry itself is **PASS**; source alignment is **NOT EVALUATED**; scientific differencing is **REJECT**.

### Official product-field checks

The current [SPHEREx Data Products guide](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products/) states:

- `FLAGS` is a per-pixel bitmap; its image-flag definitions are in Table 16 of the Explanatory Supplement. The live guide’s linked 30 MB supplement could not be extracted by the available document reader in this run. Older official QR supplement tables and the IRSA Data Explorer spectrophotometry-help flags are not substituted for a release-matched QR3 image-flag table. The project continues to preserve `FLAGS` values without decoding or assigning meanings.
- `EPSF` is the DR1/QR3 effective PSF table; detector 3 uses an 11 × 41 zone grid, while detectors 1, 2, 4, 5, and 6 use 21 × 21. The local products contain EPSF tables, but no PSF-fitting or photometry was performed.
- `ZODI` is a modeled zodiacal background in MJy/sr and has not been subtracted from the spectral image `IMAGE` values.
- `WCS-WAVE` is intended for visualization. Scientific wavelength/bandwidth analysis requires the separate Spectral WCS product’s `CWAVE` and `CBAND` images (both in microns). No such calibration products were retrieved.

These boundaries are consistent with the [IRSA SPHEREx data-access guide](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access/) and the [official ePSF tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-psf/). No flag semantics, wavelength calibration, source detection, photometry, motion, light curve, or variability result is asserted.

### Product and test status

No new FITS products were downloaded in this phase. All five existing verified QR3 FITS files remain in `backend/static/archive_products`; the WCS code recomputed the SHA-256 values of the Barnard pair without changing their bytes. The API also checks SHA-256 against each cache filename before reporting a product comparison. The existing archive validation warnings remain: archive FITS CHECKSUM/DATASUM cards are absent on the verified products.

Automated tests added for this phase use small synthetic WCS-only fixtures for overlap, non-overlap, API hash checks, and fail-closed gating; these fixtures do not represent observations. A separate opt-in test used the two real cached Barnard products and confirms geometry only. Full backend tests: 25 passed, 1 opt-in live archive test skipped. Frontend production build: passed. API lifespan and `/health`, `/health/database` routes passed an isolated in-process ASGI health check. The existing SQLite database was only read during the local coverage check; tests used isolated in-memory databases.

### Remaining blockers

1. Repeat all four SIA image searches per target when a working network route is available, retaining each full row’s ID, collection, detector/band, timestamps, processing path, access URL, and response timestamp. Add separate SIA rows for the WISE wide-cone and catalog-epoch alternatives.
2. Determine exact matched detector/band/release/calibration pairs from retained row-level results. Download only a small pair after its access URL and calibration metadata are verified; calculate and preserve SHA-256, byte size, timestamp, and FITS validation.
3. Require a meaningful temporal baseline before a motion or variability analysis. The 128.929-second Barnard pair does not satisfy that condition.
4. Validate cross-epoch source matching and reference-star registration to obtain empirical alignment residuals. WCS closure residuals reported above cannot substitute for those measurements.
5. Validate compatible calibration references, variance propagation, PSF/ePSF use, and flag masks before photometry or difference analysis.
6. Retrieve the release-matched official image flag table and Spectral WCS `CWAVE`/`CBAND` products before interpreting flags or producing calibrated spectra.

XPLORERS is **not ready for judging**. No target detections, scientific measurements, proper motions measured by SPHEREx, variability, or discoveries are reported.

## 2026-11-14 comparison interface and SIA response handling

### Cached-product interface and real Barnard pair check

The Scientific Analysis page now includes an explicit cached-product pair selector. `GET /api/v1/archive/cached-products` lists only hash-named FITS files in the local archive cache and reads their IMAGE headers/WCS metadata without loading or changing pixel arrays. Its listing marks SHA-256 as **NOT EVALUATED** until a selected product is submitted to the comparison route. `POST /api/v1/analysis/epochs/wcs-comparison` recomputes the file hashes and reports integrity status before returning geometry diagnostics.

The new listing returned the existing five FITS files; no FITS file was changed and no new product was downloaded. The current local SQLite database contains the existing `observations` table but no `archive_products` rows. Accordingly, the interface reports archive collection/release, band, retrieval timestamp, and source/resolved product URLs as **NOT RECORDED** where no local provenance row is available. The validated five-product provenance and SHA-256 records from the preceding phase remain in this document and were preserved.

The real Barnard D6 pair was submitted through the comparison API with an isolated in-memory database. Both cached filenames matched recomputed SHA-256 values (**PASS**). Header observation IDs are `2026W33_2A_0594_3` and `2026W33_2A_0594_4`; `MJD-OBS` is 61268.629319352 and 61268.630811597, giving 128.9299679 seconds separation. Both directions report 86.17% sampled footprint overlap. For `_0594_3` → `_0594_4`, the WCS-derived affine pixel-mapping fit has RMS 0.03164 px and p95 0.06074 px. These remain WCS geometry diagnostics, not source-registration residuals. No target detection or pixel subtraction was performed.

The pair report's scientific eligibility is **REJECT**. Detector headers match and declared image units match; band and release comparisons are **NOT EVALUATED** because neither the FITS headers nor local database registry provide them. Calibration-reference compatibility is **NOT EVALUATED**. Exact elapsed time is reported but the baseline criterion is **NOT EVALUATED**, because no justified acceptance threshold is defined. FLAGS are not decoded or applied as a mask; VARIANCE presence does not establish compatible uncertainty propagation. Empirical source registration is **NOT EVALUATED**. Every check, its evidence, and its reason is included in the comparison response and JSON export. Motion, photometry, spectra, light curves, and change detection remain **NOT EVALUATED**.

### SIA timeout, zero-row, and capped-result handling

IRSA's current [SPHEREx data-access guide](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access/) documents SIA2 position, time, collection, and other query constraints, and IRSA's [SIA v2 parameter reference](https://irsa.ipac.caltech.edu/ibe/sia.html) lists `MAXREC` and `RESPONSEFORMAT`. Neither reference documents a page cursor, offset parameter, or asynchronous job/result interface for SIA2. This implementation therefore does not add speculative pagination or auto-retry behavior. It continues to issue one explicit user-triggered query and supports narrowing `POS`/FOV and MJD `TIME` bounds to reduce a slow query; collection searches remain separate user actions.

SIA searches now request VOTable output and parse `QUERY_STATUS`. IVOA [DALI 1.2](https://www.ivoa.net/documents/DALI/20251024/PR-DALI-1.2-20251024.html) specifies `QUERY_STATUS=OVERFLOW` for truncated VOTable results; it defines no standard truncation signal for plain CSV/TSV. The API maps an explicit `OK` with zero rows to a complete zero-row response, `OVERFLOW` to **CAPPED**, and absent/unknown status to **NOT EVALUATED**. Timeouts remain request failures and do not become zero-row coverage claims. Sanitized VOTable parser tests cover the complete-empty and overflow cases. No new live IRSA query was run in this update, so current service response behavior and all target coverage remain as recorded in the earlier query tables.

### Current implementation validation

- Backend suite: 30 tests run, 29 passed, 1 opt-in live-product test skipped. Tests cover VOTable status parsing, eligibility reasons, cache listing, and the previously verified real Barnard WCS pair.
- Frontend production build: passed after integrating the pair selector and comparison report export.
- API health/startup: Uvicorn started with a temporary isolated SQLite file; `/health` and `/health/database` both returned connected. The running API listed five local cached files and compared the real Barnard pair (SHA-256 PASS/PASS, WCS geometry PASS, scientific eligibility REJECT). The temporary SQLite file was removed afterward.
- Database and products: no writes to `data/spectra.db`; all five FITS products and their prior validation/provenance records remain preserved.
- Preservation check: all five cached FITS files were re-hashed after implementation; each SHA-256 matched its hash-named filename and each original byte size remained available. Read-only SQLite inspection still found 28,953 `observations` rows and no other project-database table; the API health check used and removed a separate temporary database.

## 2026-11-14 target coverage and evidence capture interface

The new **Target Coverage** workspace in `frontend/src/app/page.tsx` presents all five required cases using the catalog positions, proper-motion-only epoch-2025 query centers, and bounded QR3 coverage summaries already recorded above. Its SIMBAD links identify coordinate sources. It labels catalog position and image-footprint inclusion separately from a source detection. The WISE 0855 card continues to report unresolved coverage and the restricted scope of its earlier QR3 zero-row response.

Each case can prepare a live IRSA SIA query with its documented epoch-2025 search center, QR3 wide collection, 0.2-degree FOV diameter, calibration level 2, image product type, and maximum 100 rows. Preparing the form does not call IRSA; the user must press **Search IRSA metadata**. There is no automatic retry. The query remains one bounded cone because SIA has no documented cursor/async continuation in the current integration.

The five previously verified products were not present in the local `archive_products` table, so their preserved records are now consolidated in the read-only `docs/verified_archive_products.json` manifest. `backend/app/provenance.py::cached_product_provenance` makes these documented provenance values available through `GET /api/v1/archive/cached-products` when no database row exists. Manifest matching checks the hash-shaped filename and byte size but explicitly leaves current byte integrity **NOT EVALUATED** until the comparison route recomputes SHA-256. The database and FITS files are not changed.

The Scientific Evidence JSON now captures the active query parameters, exact SIA `query_url` when a response is received, `QUERY_STATUS`, availability, result completeness, returned rows or error, browser-captured submission/receipt timestamps, archive product records returned by the local registry, the complete cached-product inventory with available provenance, selected target case, and the current WCS comparison report. Client timestamps are evidence-capture times, not archive server timestamps. Query history is session-scoped and is not written to `data/spectra.db`.

No SIA query was repeated and no new FITS product was downloaded during this interface/documentation update. Accordingly, all target coverage values remain sourced from the earlier live responses and retain their capped, timeout, and query-limited qualifications. The five existing FITS files and the project SQLite database were not modified. The frontend production build passed after the initial target/evidence integration; final group validation results are recorded in the requirement traceability checklist.

For instrument-field interpretation this update checked the current official [SPHEREx Data Products guide](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products/), [SPHEREx Data Access guide](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access/), and [IRSA ePSF tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-psf/). These sources support the existing handling boundaries: FLAGS remains undecoded without the release-bound Explanatory Supplement table; ePSF is only inventoried; ZODI remains identified as modeled/not subtracted from IMAGE; WCS-WAVE is visualization-only; science wavelengths require matching Spectral WCS `CWAVE` and `CBAND` products. No new scientific interpretation was added.
