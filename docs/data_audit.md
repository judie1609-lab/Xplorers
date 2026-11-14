# SPHEREx CSV — Initial Data Audit

Source file: `table_Spectral-Images-1.csv`

- Shape: 28,953 rows × 62 columns
- Exact duplicate rows: 0
- Distinct `obs_id`: 14,669
- `obs_id` multiplicity: 14,284 IDs occur twice; 385 IDs occur once
- All rows are `dataproduct_type=image`, `facility_name=SPHEREx`, `calib_level=2`, `s_calib_status=calibrated`
- All rows have `s_xel1=s_xel2=2040`, `t_exptime=113.5826 s`, `s_resolution=3.08` (as recorded in this export)
- All 28,953 rows have a distinct, non-null `access_url`

## Collection counts

| Collection | Rows | Distinct obs_id | MJD start min | MJD start max |
|---|---:|---:|---:|---:|
| spherex_qr2_deep | 23,863 | 12,096 | 60796.058765 | 61240.998211 |
| spherex_qr3_deep | 4,437 | 2,240 | 61241.056036 | 61317.966464 |
| spherex_qr2 | 563 | 288 | 60798.235998 | 61239.158083 |
| spherex_qr3 | 90 | 45 | 61244.723004 | 61311.657601 |

## Band counts

| Band | Rows |
|---|---:|
| SPHEREx-D1 | 5,110 |
| SPHEREx-D2 | 5,073 |
| SPHEREx-D3 | 4,365 |
| SPHEREx-D4 | 5,115 |
| SPHEREx-D5 | 4,987 |
| SPHEREx-D6 | 4,303 |

## Data-quality observations

- Several columns are entirely null in this export (for example `environment_photometric`, `target_keywords`, `em_xel`, `o_ucd`, `proposal_pi`, `access_estsize`, `facility_keywords`, `instrument_keywords`, `proposal_id`, `t_xel`, `pol_xel`). Keep them in `raw_metadata`, but do not use them as model features unless populated in a later source.
- `obs_id` is a grouping field, not a unique primary key.
- The `access_format` value for every row is `application/x-votable+xml;content=datalink`. Therefore `access_url` is a DataLink endpoint, not a direct FITS URL. Resolve the DataLink document to obtain the image product URL.
- The export includes both QR2 and QR3, wide and deep collections. Keep these labels and processing versions visible and avoid cross-release pixel-level comparisons until calibration compatibility is verified.

## Safe next step
Resolve a small number of DataLink records, download one representative FITS MEF, inspect its HDUs, WCS, uncertainty/mask/PSF extensions, and confirm the exact image plane and units before implementing difference imaging.
