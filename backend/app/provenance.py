"""Read-only provenance lookup for the five previously verified archive files."""

import json
import re
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[2]
MANIFEST_PATH = PROJECT_DIR / "docs" / "verified_archive_products.json"
HASHED_FITS_NAME = re.compile(r"^(?P<sha256>[a-fA-F0-9]{64})\.fits$")


def load_verified_product_manifest(path: Path = MANIFEST_PATH) -> dict[str, dict]:
    """Load records whose filename and SHA-256 agree; do not hash FITS bytes here."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}

    records = {}
    for record in payload.get("products", []) if isinstance(payload, dict) else []:
        if not isinstance(record, dict):
            continue
        filename = record.get("filename")
        digest = record.get("sha256")
        match = HASHED_FITS_NAME.fullmatch(str(filename or ""))
        if not match or not isinstance(digest, str) or match.group("sha256").lower() != digest.lower():
            continue
        if filename in records:
            # Duplicated filenames are ambiguous; omit rather than select one silently.
            records.pop(filename, None)
            continue
        records[filename] = record
    return records


def cached_product_provenance(filename: str, size_bytes: int) -> dict | None:
    """Return documented provenance only when the filename and byte size agree."""
    record = load_verified_product_manifest().get(filename)
    if record is None:
        return None

    size_matches = record.get("size_bytes") == size_bytes
    return {
        "record_state": "DOCUMENTED" if size_matches else "WARNING",
        "record_source": "docs/verified_archive_products.json",
        "evidence_source": "docs/real_archive_validation.md",
        "manifest_note": "Provenance transcribed from the retained live validation record; file bytes are not re-hashed by the listing route.",
        "integrity_state": "NOT EVALUATED",
        "integrity_reason": "SHA-256 is recomputed by the comparison route when this product is selected.",
        "size_matches_manifest": size_matches,
        "size_bytes": record.get("size_bytes"),
        "sha256": record.get("sha256"),
        "obs_id": record.get("obs_id"),
        "target_case": record.get("target_case"),
        "collection": record.get("collection"),
        "release": record.get("release"),
        "band": record.get("band"),
        "detector": record.get("detector"),
        "observed_at": record.get("observed_at"),
        "mjd_obs": record.get("mjd_obs"),
        "retrieved_at": record.get("retrieved_at"),
        "etag": record.get("etag"),
        "source_access_url": record.get("source_access_url"),
        "resolved_access_url": record.get("resolved_access_url"),
        "source_sia_query_url": record.get("source_sia_query_url"),
        "pipeline_version": record.get("pipeline_version"),
        "processing_path": record.get("processing_path"),
        "target_coordinate_inside_image": record.get("target_coordinate_inside_image"),
        "product_quality_state": record.get("product_quality_state", "NOT EVALUATED"),
        "scientific_quality_state": record.get("scientific_quality_state", "NOT EVALUATED"),
        "reason": (
            "Cached byte size matches the documented provenance record; SHA-256 remains NOT EVALUATED until selected."
            if size_matches
            else "Cached byte size does not match the documented provenance record."
        ),
    }
