import json, math, sys
from pathlib import Path
import pandas as pd

# Ensure imports work when launched as `python scripts\ingest_csv.py` on Windows.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
from sqlalchemy import delete
from app.db import Base, SessionLocal, engine
from app.models import Observation

COLUMN_MAP = {
    "obs_id": "obs_id", "obs_collection": "collection", "energy_bandpassname": "band",
    "s_ra": "ra_deg", "s_dec": "dec_deg", "t_min": "mjd_start", "t_max": "mjd_end",
    "t_exptime": "exposure_seconds", "calib_level": "calibration_level",
    "s_calib_status": "calibration_status", "s_resolution": "spatial_resolution_arcsec",
    "s_xel1": "image_width", "s_xel2": "image_height", "access_url": "access_url",
    "access_format": "access_format",
}

def clean_value(value):
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)

def main(csv_path: str, *, session_factory=None, schema_engine=None):
    path = Path(csv_path).expanduser().resolve()
    if not path.exists():
        raise SystemExit(f"CSV not found: {path}")
    print(f"Reading CSV: {path}")
    try:
        frame = pd.read_csv(path, low_memory=False)
    except pd.errors.EmptyDataError as error:
        raise SystemExit("CSV is empty; the existing catalog was not changed.") from error
    required = {"obs_id", "obs_collection", "energy_bandpassname", "access_url"}
    missing = required.difference(frame.columns)
    if missing:
        raise SystemExit(f"CSV is missing required columns: {', '.join(sorted(missing))}")
    if frame.empty:
        raise SystemExit("CSV contains no observations; the existing catalog was not changed.")

    # Reject incomplete source rows before opening a transaction that replaces
    # the current catalog.
    for column in sorted(required):
        invalid = frame[column].isna() | frame[column].astype(str).str.strip().eq("")
        if invalid.any():
            rows = ", ".join(str(index + 2) for index in frame.index[invalid][:5])
            raise SystemExit(
                f"CSV contains empty values in required column '{column}' "
                f"(line(s): {rows}); the existing catalog was not changed."
            )

    target_engine = schema_engine or engine
    make_session = session_factory or SessionLocal
    Base.metadata.create_all(bind=target_engine)
    session = make_session()
    try:
        # The delete and every insert are one database transaction. A failed
        # flush rolls the delete back, preserving the previously committed
        # catalog. Batches bound ORM memory without committing partial imports.
        with session.begin():
            session.execute(delete(Observation))
            batch = []
            records = frame.to_dict(orient="records")
            for i, record in enumerate(records, start=1):
                normalized = {dest: clean_value(record.get(src)) for src, dest in COLUMN_MAP.items()}
                normalized["raw_metadata"] = {k: clean_value(v) for k, v in record.items()}
                batch.append(Observation(**normalized))
                if len(batch) >= 500:
                    session.add_all(batch)
                    session.flush()
                    batch.clear()
                    print(f"Imported {i:,}/{len(records)} rows... (uncommitted)")
            if batch:
                session.add_all(batch)
                session.flush()
        print(json.dumps({"imported_rows": len(frame), "csv": str(path), "database": str(target_engine.url)}, indent=2))
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/ingest_csv.py ..\\table_Spectral-Images-1.csv")
    main(sys.argv[1])
