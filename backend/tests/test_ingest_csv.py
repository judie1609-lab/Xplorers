import importlib.util
import tempfile
import unittest
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

BACKEND_DIR = Path(__file__).resolve().parents[1]
import sys

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db import Base
from app.models import Observation

spec = importlib.util.spec_from_file_location(
    "ingest_csv", BACKEND_DIR / "scripts" / "ingest_csv.py"
)
ingest_csv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ingest_csv)


class IngestTransactionTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.engine = create_engine(f"sqlite:///{Path(self.temp_dir.name) / 'test.db'}")
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(bind=self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False)

    def seed_existing_row(self):
        with self.session_factory.begin() as session:
            session.add(Observation(
                obs_id="KEEP-ME",
                collection="existing",
                band="SPHEREx-D1",
                access_url="https://example.invalid/old",
            ))

    @staticmethod
    def make_csv(path: Path, rows):
        pd.DataFrame(rows).to_csv(path, index=False)
        return str(path)

    def test_success_replaces_catalog_atomically(self):
        self.seed_existing_row()
        path = Path(self.temp_dir.name) / "valid.csv"
        self.make_csv(path, [{
            "obs_id": "NEW-1",
            "obs_collection": "spherex_qr3",
            "energy_bandpassname": "SPHEREx-D2",
            "access_url": "https://irsa.ipac.caltech.edu/example",
            "s_ra": 12.0,
            "s_dec": -4.0,
        }])

        ingest_csv.main(
            str(path), session_factory=self.session_factory, schema_engine=self.engine
        )

        with self.session_factory() as session:
            rows = session.scalars(select(Observation)).all()
        self.assertEqual([row.obs_id for row in rows], ["NEW-1"])

    def test_insert_failure_rolls_back_delete_and_partial_rows(self):
        self.seed_existing_row()
        path = Path(self.temp_dir.name) / "invalid-number.csv"
        self.make_csv(path, [
            {
                "obs_id": "NEW-1",
                "obs_collection": "spherex_qr3",
                "energy_bandpassname": "SPHEREx-D2",
                "access_url": "https://irsa.ipac.caltech.edu/example-1",
                "s_ra": 12.0,
                "s_dec": -4.0,
            },
            {
                "obs_id": "NEW-2",
                "obs_collection": "spherex_qr3",
                "energy_bandpassname": "SPHEREx-D2",
                "access_url": "https://irsa.ipac.caltech.edu/example-2",
                "s_ra": "not-a-number",
                "s_dec": -4.0,
            },
        ])

        with self.assertRaises(Exception):
            ingest_csv.main(
                str(path), session_factory=self.session_factory, schema_engine=self.engine
            )

        with self.session_factory() as session:
            rows = session.scalars(select(Observation)).all()
        self.assertEqual([row.obs_id for row in rows], ["KEEP-ME"])

    def test_empty_csv_is_rejected_before_catalog_access(self):
        path = Path(self.temp_dir.name) / "empty.csv"
        self.make_csv(path, [])
        with self.assertRaisesRegex(SystemExit, "CSV is empty"):
            ingest_csv.main(
                str(path), session_factory=self.session_factory, schema_engine=self.engine
            )


if __name__ == "__main__":
    unittest.main()
