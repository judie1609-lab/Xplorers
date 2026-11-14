"""Fail-closed WCS geometry comparison for cached SPHEREx image products.

This module compares spatial WCS mappings only. It does not match sources,
register images from measured objects, resample science pixels, or calculate
an image difference. The reported affine-fit residual describes how well the
WCS-to-WCS pixel mapping is approximated by an affine transform; it is not an
empirical astrometric alignment residual.
"""

from __future__ import annotations

import hashlib
import math
from pathlib import Path

import numpy as np
from astropy import units as astro_units
from astropy.io import fits
from astropy.wcs import WCS


QUALITY_STATES = {"PASS", "WARNING", "REJECT", "NOT EVALUATED"}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_image_wcs(path: Path) -> dict:
    with fits.open(path, mode="readonly", memmap=True, lazy_load_hdus=True) as hdul:
        if "IMAGE" not in hdul:
            raise ValueError("FITS product has no IMAGE extension")
        image = hdul["IMAGE"]
        header = image.header
        if int(header.get("NAXIS", 0)) != 2:
            raise ValueError("IMAGE must be two-dimensional")
        nx = int(header.get("NAXIS1", 0))
        ny = int(header.get("NAXIS2", 0))
        if nx < 1 or ny < 1:
            raise ValueError("IMAGE dimensions are invalid")
        wcs = WCS(header, relax=True).celestial
        if not wcs.has_celestial:
            raise ValueError("IMAGE has no celestial WCS")
        primary = hdul[0].header
        variance = hdul["VARIANCE"] if "VARIANCE" in hdul else None
        flags = hdul["FLAGS"] if "FLAGS" in hdul else None
        metadata = {
            "obs_id": header.get("OBSID") or primary.get("OBSID") or primary.get("OBS_ID"),
            "date_obs": header.get("DATE-OBS") or primary.get("DATE-OBS"),
            "mjd_obs": header.get("MJD-OBS") or primary.get("MJD-OBS"),
            "detector": header.get("DETECTOR") or primary.get("DETECTOR"),
            "band": header.get("BAND") or primary.get("BAND"),
            "pipeline_version": primary.get("VERSION") or header.get("VERSION"),
            "unit": header.get("BUNIT"),
            "radesys": header.get("RADESYS") or primary.get("RADESYS"),
            "ctype": [header.get("CTYPE1"), header.get("CTYPE2")],
            "shape": [ny, nx],
            "hdu_names": [hdu.name for hdu in hdul],
            "flags_available": flags is not None,
            "flags_shape": list(flags.shape) if flags is not None and flags.shape else None,
            "variance_available": variance is not None,
            "variance_shape": list(variance.shape) if variance is not None and variance.shape else None,
            "variance_unit": variance.header.get("BUNIT") if variance is not None else None,
        }
    return {"wcs": wcs, "metadata": metadata, "shape": (ny, nx)}


def _angular_separation_arcsec(lon_a, lat_a, lon_b, lat_b) -> np.ndarray:
    """Spherical separation from two celestial longitude/latitude arrays."""
    lon_a = np.deg2rad(np.asarray(lon_a, dtype=np.float64))
    lat_a = np.deg2rad(np.asarray(lat_a, dtype=np.float64))
    lon_b = np.deg2rad(np.asarray(lon_b, dtype=np.float64))
    lat_b = np.deg2rad(np.asarray(lat_b, dtype=np.float64))
    delta_lon = (lon_b - lon_a + np.pi) % (2.0 * np.pi) - np.pi
    delta_lat = lat_b - lat_a
    haversine = (
        np.sin(delta_lat / 2.0) ** 2
        + np.cos(lat_a) * np.cos(lat_b) * np.sin(delta_lon / 2.0) ** 2
    )
    haversine = np.clip(haversine, 0.0, 1.0)
    return np.rad2deg(2.0 * np.arctan2(np.sqrt(haversine), np.sqrt(1.0 - haversine))) * 3600.0


def _mapping_report(source: dict, destination: dict, grid_size: int) -> dict:
    ny, nx = source["shape"]
    dest_ny, dest_nx = destination["shape"]
    x_values = np.linspace(0.0, nx - 1.0, grid_size)
    y_values = np.linspace(0.0, ny - 1.0, grid_size)
    xx, yy = np.meshgrid(x_values, y_values)
    ra, dec = source["wcs"].pixel_to_world_values(xx, yy)
    ra = np.asarray(ra, dtype=np.float64)
    dec = np.asarray(dec, dtype=np.float64)
    finite_world = np.isfinite(ra) & np.isfinite(dec) & (np.abs(dec) <= 90.0)
    if not np.any(finite_world):
        return {
            "sample_count": int(xx.size),
            "valid_sky_samples": 0,
            "inside_destination_samples": 0,
            "inside_destination_fraction": 0.0,
            "wcs_roundtrip_residual_arcsec": None,
            "wcs_mapping_affine_residual_px": None,
        }

    dest_x, dest_y = destination["wcs"].world_to_pixel_values(ra, dec)
    dest_x = np.asarray(dest_x, dtype=np.float64)
    dest_y = np.asarray(dest_y, dtype=np.float64)
    inside = (
        finite_world
        & np.isfinite(dest_x)
        & np.isfinite(dest_y)
        & (dest_x >= 0.0)
        & (dest_x <= dest_nx - 1.0)
        & (dest_y >= 0.0)
        & (dest_y <= dest_ny - 1.0)
    )
    inside_count = int(np.count_nonzero(inside))
    valid_count = int(np.count_nonzero(finite_world))
    if inside_count == 0:
        return {
            "sample_count": int(xx.size),
            "valid_sky_samples": valid_count,
            "inside_destination_samples": 0,
            "inside_destination_fraction": 0.0,
            "wcs_roundtrip_residual_arcsec": None,
            "wcs_mapping_affine_residual_px": None,
        }

    back_ra, back_dec = destination["wcs"].pixel_to_world_values(dest_x[inside], dest_y[inside])
    roundtrip = _angular_separation_arcsec(ra[inside], dec[inside], back_ra, back_dec)

    source_xy = np.column_stack((xx[inside], yy[inside], np.ones(inside_count)))
    destination_xy = np.column_stack((dest_x[inside], dest_y[inside]))
    coefficients, _, rank, _ = np.linalg.lstsq(source_xy, destination_xy, rcond=None)
    if rank == 3:
        residual_px = np.linalg.norm(destination_xy - source_xy @ coefficients, axis=1)
        affine_summary = {
            "rms": float(np.sqrt(np.mean(np.square(residual_px)))),
            "median": float(np.median(residual_px)),
            "p95": float(np.percentile(residual_px, 95)),
            "max": float(np.max(residual_px)),
            "sample_count": int(residual_px.size),
        }
    else:
        affine_summary = None

    return {
        "sample_count": int(xx.size),
        "valid_sky_samples": valid_count,
        "inside_destination_samples": inside_count,
        "inside_destination_fraction": float(inside_count / valid_count),
        "wcs_roundtrip_residual_arcsec": {
            "median": float(np.median(roundtrip)),
            "p95": float(np.percentile(roundtrip, 95)),
            "max": float(np.max(roundtrip)),
            "sample_count": int(roundtrip.size),
        },
        "wcs_mapping_affine_residual_px": affine_summary,
    }


def compare_image_wcs(path_a: Path, path_b: Path, *, grid_size: int = 21) -> dict:
    """Compare sampled spatial footprints without claiming source alignment."""
    if not 5 <= grid_size <= 65:
        raise ValueError("grid_size must be between 5 and 65")
    image_a = _read_image_wcs(Path(path_a))
    image_b = _read_image_wcs(Path(path_b))
    a_to_b = _mapping_report(image_a, image_b, grid_size)
    b_to_a = _mapping_report(image_b, image_a, grid_size)
    has_sampled_overlap = (
        a_to_b["inside_destination_samples"] > 0
        and b_to_a["inside_destination_samples"] > 0
    )
    path_a = Path(path_a)
    path_b = Path(path_b)
    input_a = {**image_a["metadata"], "filename": path_a.name,
               "size_bytes": path_a.stat().st_size, "sha256": _sha256(path_a)}
    input_b = {**image_b["metadata"], "filename": path_b.name,
               "size_bytes": path_b.stat().st_size, "sha256": _sha256(path_b)}
    unit_a = input_a["unit"]
    unit_b = input_b["unit"]
    if not unit_a or not unit_b:
        unit_state = "NOT EVALUATED"
        unit_reason = "BUNIT is missing from one or both IMAGE headers."
    else:
        try:
            units_a = astro_units.Unit(unit_a)
            units_b = astro_units.Unit(unit_b)
            if units_a == units_b:
                unit_state = "PASS"
                unit_reason = "The declared IMAGE BUNIT values are equivalent without a unit conversion."
            elif units_a.is_equivalent(units_b):
                unit_state = "WARNING"
                unit_reason = "The declared IMAGE BUNIT values are equivalent but differ; no conversion was applied."
            else:
                unit_state = "REJECT"
                unit_reason = "Declared IMAGE BUNIT values are not equivalent."
        except (ValueError, TypeError):
            unit_state = "REJECT"
            unit_reason = "One or both declared IMAGE BUNIT values are invalid."
    return {
        "quality_state": "WARNING",
        "quality_reason": "This report is limited to WCS geometry; source registration and calibration compatibility are not evaluated.",
        "wcs_geometry_state": "PASS" if has_sampled_overlap else "WARNING",
        "inputs": {"a": input_a, "b": input_b},
        "footprint_comparison": {
            "state": "PASS" if has_sampled_overlap else "WARNING",
            "sampled_overlap": has_sampled_overlap,
            "method": "bidirectional regular WCS pixel-grid sampling",
            "grid_size": grid_size,
            "a_to_b": a_to_b,
            "b_to_a": b_to_a,
            "overlap_percent_a_in_b": float(a_to_b["inside_destination_fraction"] * 100.0),
            "overlap_percent_b_in_a": float(b_to_a["inside_destination_fraction"] * 100.0),
            "limitation": "Sampled footprint overlap is an estimate; it does not establish a detected common source.",
        },
        "wcs_mapping_residuals": {
            "state": "PASS" if has_sampled_overlap else "NOT EVALUATED",
            "definition": (
                "WCS inverse-closure angular residual and WCS-derived affine pixel-mapping fit residual. "
                "These are geometry diagnostics, not empirical source-registration residuals."
            ),
            "a_to_b": a_to_b,
            "b_to_a": b_to_a,
        },
        "source_alignment": {
            "quality_state": "NOT EVALUATED",
            "residual_px": None,
            "residual_arcsec": None,
            "reason": "No source extraction, cross-match, or measured reference-star registration was performed.",
        },
        "visual_comparison": {
            "quality_state": "NOT EVALUATED",
            "reason": "This endpoint reports WCS geometry only; it does not render or compare pixel values.",
        },
        "compatibility": {
            "detector_match": (
                "NOT EVALUATED" if input_a["detector"] is None or input_b["detector"] is None
                else "PASS" if input_a["detector"] == input_b["detector"]
                else "REJECT"
            ),
            "unit_compatibility": unit_state,
            "unit_reason": unit_reason,
            "band_release_calibration": "NOT EVALUATED",
            "reason": "Full archive release, band, and calibration reference metadata must be available to validate like-with-like processing.",
        },
        "scientific_differencing": build_differencing_gate(
            wcs_alignment="NOT EVALUATED",
            calibration_compatibility="NOT EVALUATED",
            unit_compatibility=unit_state,
            uncertainty_validation="NOT EVALUATED",
        ),
    }


def inspect_cached_product(path: Path) -> dict:
    """Return FITS header/extension metadata without reading or changing pixels."""
    inspected = _read_image_wcs(Path(path))
    return inspected["metadata"]


def build_comparison_eligibility(
    input_a: dict,
    input_b: dict,
    *,
    wcs_geometry_state: str,
    footprint_comparison: dict,
) -> dict:
    """Report every comparison prerequisite without using undocumented thresholds."""
    provenance_a = input_a.get("archive_provenance") or {}
    provenance_b = input_b.get("archive_provenance") or {}

    integrity_a = input_a.get("integrity_state")
    integrity_b = input_b.get("integrity_state")
    if integrity_a == "REJECT" or integrity_b == "REJECT":
        product_integrity = {
            "state": "REJECT",
            "evidence": {"a": integrity_a or "NOT EVALUATED", "b": integrity_b or "NOT EVALUATED"},
            "reason": "At least one cached filename does not match its recomputed SHA-256.",
        }
    elif integrity_a == "PASS" and integrity_b == "PASS":
        product_integrity = {
            "state": "PASS",
            "evidence": {"a": integrity_a, "b": integrity_b},
            "reason": "Both cached filenames match their recomputed SHA-256 values.",
        }
    else:
        product_integrity = {
            "state": "NOT EVALUATED",
            "evidence": {"a": integrity_a or "NOT EVALUATED", "b": integrity_b or "NOT EVALUATED"},
            "reason": "Both local product hashes must be recomputed before eligibility can be evaluated.",
        }

    def metadata_value(item: dict, provenance: dict, name: str):
        value = item.get(name)
        return value if value not in (None, "") else provenance.get(name)

    def exact_match(name: str, value_a, value_b, label: str) -> dict:
        evidence = {"a": value_a, "b": value_b}
        if value_a in (None, "") or value_b in (None, ""):
            return {"state": "NOT EVALUATED", "evidence": evidence,
                    "reason": f"{label} is missing for one or both selected products."}
        if str(value_a).strip().casefold() == str(value_b).strip().casefold():
            return {"state": "PASS", "evidence": evidence,
                    "reason": f"Both selected products report the same {label.lower()}."}
        return {"state": "REJECT", "evidence": evidence,
                "reason": f"Selected products report different {label.lower()} values."}

    detector = exact_match("detector_match", input_a.get("detector"), input_b.get("detector"), "Detector")
    band = exact_match(
        "band_match", metadata_value(input_a, provenance_a, "band"),
        metadata_value(input_b, provenance_b, "band"), "Band",
    )
    release = exact_match(
        "release_match", metadata_value(input_a, provenance_a, "release"),
        metadata_value(input_b, provenance_b, "release"), "Archive release",
    )

    pipeline_a = input_a.get("pipeline_version")
    pipeline_b = input_b.get("pipeline_version")
    calibration_reason = (
        "Pipeline version cards match, but calibration compatibility still requires validated calibration-reference provenance."
        if pipeline_a and pipeline_b and str(pipeline_a) == str(pipeline_b)
        else "Calibration-reference compatibility cannot be verified from the available FITS headers and archive provenance."
    )
    calibration_state = "NOT EVALUATED"
    if pipeline_a and pipeline_b and str(pipeline_a) != str(pipeline_b):
        calibration_reason = "Pipeline version cards differ; no official compatibility mapping is available to resolve the difference."
        calibration_state = "WARNING"

    mjd_a = _number_or_none(input_a.get("mjd_obs"))
    mjd_b = _number_or_none(input_b.get("mjd_obs"))
    if mjd_a is not None and mjd_b is not None:
        separation_seconds = abs(mjd_b - mjd_a) * 86400.0
        time_evidence = {"mjd_a": mjd_a, "mjd_b": mjd_b, "separation_seconds": separation_seconds}
        time_reason = "Exact elapsed time is reported; no validated scientific baseline threshold is defined for this comparison."
    else:
        separation_seconds = None
        time_evidence = {"mjd_a": mjd_a, "mjd_b": mjd_b, "separation_seconds": None}
        time_reason = "Observation time is missing for one or both products, so elapsed time cannot be calculated."

    unit_a = input_a.get("unit")
    unit_b = input_b.get("unit")
    if not unit_a or not unit_b:
        unit_check = {"state": "NOT EVALUATED", "evidence": {"a": unit_a, "b": unit_b},
                      "reason": "BUNIT is missing from one or both IMAGE headers."}
    else:
        try:
            parsed_a, parsed_b = astro_units.Unit(unit_a), astro_units.Unit(unit_b)
            if parsed_a == parsed_b:
                unit_check = {"state": "PASS", "evidence": {"a": unit_a, "b": unit_b},
                              "reason": "Declared IMAGE units match; no unit conversion is required."}
            elif parsed_a.is_equivalent(parsed_b):
                unit_check = {"state": "WARNING", "evidence": {"a": unit_a, "b": unit_b},
                              "reason": "Declared IMAGE units are equivalent but differ; no conversion was applied."}
            else:
                unit_check = {"state": "REJECT", "evidence": {"a": unit_a, "b": unit_b},
                              "reason": "Declared IMAGE units are not physically equivalent."}
        except (TypeError, ValueError):
            unit_check = {"state": "REJECT", "evidence": {"a": unit_a, "b": unit_b},
                          "reason": "At least one declared IMAGE unit is invalid or unparseable."}

    flags_a, flags_b = bool(input_a.get("flags_available")), bool(input_b.get("flags_available"))
    variance_a, variance_b = bool(input_a.get("variance_available")), bool(input_b.get("variance_available"))
    variance_shapes_match = (
        input_a.get("variance_shape") is not None
        and input_a.get("variance_shape") == input_b.get("variance_shape")
        and input_a.get("shape") == input_a.get("variance_shape")
        and input_b.get("shape") == input_b.get("variance_shape")
    )
    variance_units_match = bool(input_a.get("variance_unit")) and input_a.get("variance_unit") == input_b.get("variance_unit")

    checks = {
        "product_integrity": product_integrity,
        "detector_match": detector,
        "band_match": band,
        "release_match": release,
        "calibration_compatibility": {
            "state": calibration_state,
            "evidence": {"pipeline_version_a": pipeline_a, "pipeline_version_b": pipeline_b,
                          "archive_collection_a": provenance_a.get("collection"),
                          "archive_collection_b": provenance_b.get("collection")},
            "reason": calibration_reason,
        },
        "time_separation": {
            "state": "NOT EVALUATED", "evidence": time_evidence, "reason": time_reason,
        },
        "wcs_geometry": {
            "state": wcs_geometry_state,
            "evidence": {
                "overlap_percent_a_in_b": footprint_comparison.get("overlap_percent_a_in_b"),
                "overlap_percent_b_in_a": footprint_comparison.get("overlap_percent_b_in_a"),
                "sample_method": footprint_comparison.get("method"),
            },
            "reason": (
                "Sampled WCS footprints overlap; this does not demonstrate source registration or scientific differencing eligibility."
                if wcs_geometry_state == "PASS"
                else "No shared sampled WCS footprint was established."
            ),
        },
        "unit_compatibility": unit_check,
        "mask_handling": {
            "state": "NOT EVALUATED",
            "evidence": {"flags_hdu_a_available": flags_a, "flags_hdu_b_available": flags_b,
                          "flags_shapes_match": input_a.get("flags_shape") == input_b.get("flags_shape")},
            "reason": "FLAGS availability is reported, but release-matched flag definitions and a validated mask policy are not applied.",
        },
        "uncertainty_compatibility": {
            "state": "NOT EVALUATED",
            "evidence": {"variance_hdu_a_available": variance_a, "variance_hdu_b_available": variance_b,
                          "variance_shapes_match_image": variance_shapes_match,
                          "variance_units_match": variance_units_match,
                          "variance_unit_a": input_a.get("variance_unit"),
                          "variance_unit_b": input_b.get("variance_unit")},
            "reason": "VARIANCE availability is reported, but compatible uncertainty propagation and its validation have not been implemented.",
        },
        "source_registration": {
            "state": "NOT EVALUATED",
            "evidence": {"method": None, "matched_source_count": None,
                          "rms_px": None, "p95_px": None},
            "reason": "No source extraction, source matching, or reference-star registration was performed.",
        },
    }
    blocked_by = [name for name, check in checks.items() if check["state"] != "PASS"]
    reasons = [f"{name}: {checks[name]['reason']}" for name in blocked_by]
    return {
        "state": "PASS" if not blocked_by else "REJECT",
        "allowed": not blocked_by,
        "checks": checks,
        "blocked_by": blocked_by,
        "reasons": reasons,
        "reason": "All documented prerequisites passed." if not blocked_by else "Scientific comparison is rejected until every required check passes.",
        "time_separation_seconds": separation_seconds,
        "threshold_policy": "No time-separation or overlap acceptance threshold is applied without a documented scientific justification.",
        "pixels_subtracted": False,
    }


def _number_or_none(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def build_differencing_gate(
    *,
    wcs_alignment: str,
    calibration_compatibility: str,
    unit_compatibility: str,
    uncertainty_validation: str,
) -> dict:
    """Fail closed unless every scientific differencing prerequisite passes."""
    evidence = {
        "source_based_wcs_alignment": wcs_alignment,
        "calibration_compatibility": calibration_compatibility,
        "unit_compatibility": unit_compatibility,
        "uncertainty_validation": uncertainty_validation,
    }
    normalized = {
        key: value if value in QUALITY_STATES else "NOT EVALUATED"
        for key, value in evidence.items()
    }
    allowed = all(value == "PASS" for value in normalized.values())
    blocked = [key for key, value in normalized.items() if value != "PASS"]
    return {
        "quality_state": "PASS" if allowed else "REJECT",
        "allowed": allowed,
        "evidence": normalized,
        "blocked_by": blocked,
        "reason": (
            "All required scientific compatibility checks passed."
            if allowed
            else "Scientific image differencing is rejected until WCS source alignment, calibration, units, and uncertainties are validated."
        ),
        "pixels_subtracted": False,
    }
