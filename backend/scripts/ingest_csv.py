import csv
import json
import math
import sys
from pathlib import Path

# Ensure imports work when launched as `python scripts\\ingest_csv.py` on Windows.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import insert, select

from app.db import Base, SessionLocal, engine
from app.models import Observation


DEFAULT_CSV_PATH = Path(__file__).resolve().parents[2] / "table_Spectral-Images-1.csv"

COLUMN_MAP = {
    "obs_id": "obs_id",
    "obs_collection": "collection",
    "energy_bandpassname": "band",
    "s_ra": "ra_deg",
    "s_dec": "dec_deg",
    "t_min": "mjd_start",
    "t_max": "mjd_end",
    "t_exptime": "exposure_seconds",
    "calib_level": "calibration_level",
    "s_calib_status": "calibration_status",
    "s_resolution": "spatial_resolution_arcsec",
    "s_xel1": "image_width",
    "s_xel2": "image_height",
    "access_url": "access_url",
    "access_format": "access_format",
}

FLOAT_FIELDS = {
    "ra_deg",
    "dec_deg",
    "mjd_start",
    "mjd_end",
    "exposure_seconds",
    "spatial_resolution_arcsec",
}
INTEGER_FIELDS = {"calibration_level", "image_width", "image_height"}
REQUIRED_COLUMNS = {
    "obs_id",
    "obs_publisher_did",
    "obs_collection",
    "energy_bandpassname",
    "access_url",
}


def clean_value(value):
    if value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
        return value if value else None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, (int, float, bool)):
        return value
    return str(value)


def parse_number(value, *, field, line_number, integer=False):
    value = clean_value(value)
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(
            f"Invalid numeric value for '{field}' on CSV line {line_number}"
        ) from error
    if not math.isfinite(number):
        return None
    if integer:
        if not number.is_integer():
            raise ValueError(f"Non-integer value for '{field}' on CSV line {line_number}")
        return int(number)
    return number


def normalize_record(record, line_number):
    normalized = {}
    for source, destination in COLUMN_MAP.items():
        value = record.get(source)
        if destination in FLOAT_FIELDS:
            normalized[destination] = parse_number(
                value, field=source, line_number=line_number
            )
        elif destination in INTEGER_FIELDS:
            normalized[destination] = parse_number(
                value, field=source, line_number=line_number, integer=True
            )
        else:
            normalized[destination] = clean_value(value)

    normalized["obs_id"] = str(clean_value(record.get("obs_id"))).strip()
    normalized["raw_metadata"] = {
        key: clean_value(value) for key, value in record.items()
    }
    return normalized


def main(csv_path: str | None = None, *, session_factory=None, schema_engine=None):
    """Add missing observations from CSV without deleting or updating existing rows."""
    path = Path(csv_path).expanduser().resolve() if csv_path else DEFAULT_CSV_PATH
    if not path.exists():
        raise SystemExit(f"CSV not found: {path}")
    print(f"Reading CSV: {path}")

    try:
        with path.open("r", encoding="utf-8-sig", newline="") as csv_file:
            reader = csv.DictReader(csv_file)
            columns = reader.fieldnames
    except (OSError, UnicodeError, csv.Error) as error:
        raise SystemExit(
            f"CSV could not be read; the existing catalog was not changed: {error}"
        ) from error

    if not columns:
        raise SystemExit("CSV is empty; the existing catalog was not changed.")
    if len(columns) != len(set(columns)):
        raise SystemExit("CSV contains duplicate column names; the existing catalog was not changed.")
    missing = REQUIRED_COLUMNS.difference(columns)
    if missing:
        raise SystemExit(f"CSV is missing required columns: {', '.join(sorted(missing))}")

    target_engine = schema_engine or engine
    make_session = session_factory or SessionLocal
    Base.metadata.create_all(bind=target_engine)
    session = make_session()
    inserted_rows = 0
    skipped_existing_rows = 0
    duplicate_csv_rows = 0
    input_rows = 0
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as csv_file:
            reader = csv.DictReader(csv_file)
            with session.begin():
                existing_publisher_ids = set()
                for (raw_metadata,) in session.execute(select(Observation.raw_metadata)).yield_per(1000):
                    if isinstance(raw_metadata, dict):
                        publisher_id = raw_metadata.get("obs_publisher_did")
                        if publisher_id is not None and str(publisher_id).strip():
                            existing_publisher_ids.add(str(publisher_id).strip())
                seen_publisher_ids = set()
                batch = []

                for line_number, record in enumerate(reader, start=2):
                    input_rows += 1
                    if None in record:
                        raise ValueError(f"CSV line {line_number} has more fields than the header")
                    for column in sorted(REQUIRED_COLUMNS):
                        value = record.get(column)
                        if value is None or not value.strip():
                            raise ValueError(
                                f"CSV contains an empty required value in '{column}' "
                                f"on line {line_number}; existing observations were preserved."
                            )

                    normalized = normalize_record(record, line_number)
                    publisher_id = str(record["obs_publisher_did"]).strip()
                    if publisher_id in seen_publisher_ids:
                        duplicate_csv_rows += 1
                        continue
                    seen_publisher_ids.add(publisher_id)
                    if publisher_id in existing_publisher_ids:
                        skipped_existing_rows += 1
                        continue

                    existing_publisher_ids.add(publisher_id)
                    batch.append(normalized)
                    if len(batch) >= 500:
                        session.execute(insert(Observation), batch)
                        inserted_rows += len(batch)
                        batch.clear()

                if input_rows == 0:
                    raise SystemExit(
                        "CSV contains no observations; the existing catalog was not changed."
                    )
                if batch:
                    session.execute(insert(Observation), batch)
                    inserted_rows += len(batch)

        report = {
            "input_rows": input_rows,
            "inserted_rows": inserted_rows,
            "skipped_existing_rows": skipped_existing_rows,
            "duplicate_csv_rows": duplicate_csv_rows,
            "csv": str(path),
        }
        print(json.dumps(report, indent=2))
        return report
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


if __name__ == "__main__":
    if len(sys.argv) > 2:
        raise SystemExit("Usage: python scripts/ingest_csv.py [path-to-csv]")
    main(sys.argv[1] if len(sys.argv) == 2 else None)
