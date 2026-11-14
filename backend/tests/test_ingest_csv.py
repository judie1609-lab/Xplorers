import importlib.util
import tempfile
import unittest
from pathlib import Path
import sys

import pandas as pd
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

BACKEND_DIR = Path(__file__).resolve().parents[1]
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
                raw_metadata={"obs_publisher_did": "KEEP-PUBLISHER"},
            ))

    @staticmethod
    def make_csv(path: Path, rows):
        pd.DataFrame(rows).to_csv(path, index=False)
        return str(path)

    def test_success_adds_new_observation_without_replacing_existing(self):
        self.seed_existing_row()
        path = Path(self.temp_dir.name) / "valid.csv"
        self.make_csv(path, [{
            "obs_id": "NEW-1",
            "obs_publisher_did": "NEW-PUBLISHER-1",
            "obs_collection": "spherex_qr3",
            "energy_bandpassname": "SPHEREx-D2",
            "access_url": "https://irsa.ipac.caltech.edu/example",
            "s_ra": 12.0,
            "s_dec": -4.0,
        }])

        ingest_csv.main(str(path), session_factory=self.session_factory, schema_engine=self.engine)

        with self.session_factory() as session:
            rows = session.scalars(select(Observation).order_by(Observation.obs_id)).all()
        self.assertEqual([row.obs_id for row in rows], ["KEEP-ME", "NEW-1"])
        self.assertEqual(rows[0].collection, "existing")

    def test_reimport_and_duplicate_publisher_ids_do_not_duplicate_rows(self):
        self.seed_existing_row()
        path = Path(self.temp_dir.name) / "duplicates.csv"
        self.make_csv(path, [
            {
                "obs_id": "NEW-1",
                "obs_publisher_did": "NEW-PUBLISHER-1",
                "obs_collection": "spherex_qr3",
                "energy_bandpassname": "SPHEREx-D2",
                "access_url": "https://irsa.ipac.caltech.edu/new",
                "s_ra": 12.0,
                "s_dec": -4.0,
            },
            {
                "obs_id": "NEW-ALIAS",
                "obs_publisher_did": "NEW-PUBLISHER-1",
                "obs_collection": "spherex_qr3",
                "energy_bandpassname": "SPHEREx-D9",
                "access_url": "https://irsa.ipac.caltech.edu/duplicate",
                "s_ra": 99.0,
                "s_dec": -4.0,
            },
            {
                "obs_id": "KEEP-ME",
                "obs_publisher_did": "KEEP-PUBLISHER",
                "obs_collection": "changed-in-csv",
                "energy_bandpassname": "SPHEREx-D9",
                "access_url": "https://irsa.ipac.caltech.edu/keep",
            },
        ])

        first_report = ingest_csv.main(
            str(path), session_factory=self.session_factory, schema_engine=self.engine
        )
        second_report = ingest_csv.main(
            str(path), session_factory=self.session_factory, schema_engine=self.engine
        )
        self.assertEqual(first_report["inserted_rows"], 1)
        self.assertEqual(first_report["duplicate_csv_rows"], 1)
        self.assertEqual(first_report["skipped_existing_rows"], 1)
        self.assertEqual(second_report["inserted_rows"], 0)

        with self.session_factory() as session:
            rows = session.scalars(select(Observation).order_by(Observation.obs_id)).all()
        self.assertEqual([row.obs_id for row in rows], ["KEEP-ME", "NEW-1"])
        self.assertEqual(rows[0].collection, "existing")

    def test_insert_failure_rolls_back_new_rows_and_preserves_existing(self):
        self.seed_existing_row()
        path = Path(self.temp_dir.name) / "invalid-number.csv"
        rows = [{
            "obs_id": f"NEW-{index}",
            "obs_publisher_did": f"NEW-PUBLISHER-{index}",
            "obs_collection": "spherex_qr3",
            "energy_bandpassname": "SPHEREx-D2",
            "access_url": f"https://irsa.ipac.caltech.edu/example-{index}",
            "s_ra": 12.0,
            "s_dec": -4.0,
        } for index in range(500)]
        rows.append({
            "obs_id": "INVALID",
            "obs_publisher_did": "INVALID-PUBLISHER",
            "obs_collection": "spherex_qr3",
            "energy_bandpassname": "SPHEREx-D2",
            "access_url": "https://irsa.ipac.caltech.edu/invalid",
            "s_ra": "not-a-number",
            "s_dec": -4.0,
        })
        self.make_csv(path, rows)

        with self.assertRaises(Exception):
            ingest_csv.main(str(path), session_factory=self.session_factory, schema_engine=self.engine)

        with self.session_factory() as session:
            rows = session.scalars(select(Observation)).all()
        self.assertEqual([row.obs_id for row in rows], ["KEEP-ME"])

    def test_empty_csv_is_rejected_before_catalog_access(self):
        path = Path(self.temp_dir.name) / "empty.csv"
        self.make_csv(path, [])
        with self.assertRaisesRegex(SystemExit, "CSV is empty"):
            ingest_csv.main(str(path), session_factory=self.session_factory, schema_engine=self.engine)

    def test_default_path_is_committed_public_catalog(self):
        expected = Path(__file__).resolve().parents[2] / "table_Spectral-Images-1.csv"
        self.assertEqual(ingest_csv.DEFAULT_CSV_PATH, expected)
        self.assertTrue(expected.is_file())

    def test_committed_catalog_import_is_complete_and_idempotent(self):
        first = ingest_csv.main(
            session_factory=self.session_factory,
            schema_engine=self.engine,
        )
        second = ingest_csv.main(
            session_factory=self.session_factory,
            schema_engine=self.engine,
        )

        with self.session_factory() as session:
            rows = session.scalars(select(Observation.raw_metadata)).yield_per(1000)
            publisher_ids = {
                str(metadata["obs_publisher_did"])
                for metadata in rows
                if metadata and metadata.get("obs_publisher_did")
            }
            count = len(publisher_ids)
        self.assertEqual(first["input_rows"], 28953)
        self.assertEqual(first["inserted_rows"], 28953)
        self.assertEqual(first["duplicate_csv_rows"], 0)
        self.assertEqual(second["inserted_rows"], 0)
        self.assertEqual(second["skipped_existing_rows"], 28953)
        self.assertEqual(count, 28953)


if __name__ == "__main__":
    unittest.main()
