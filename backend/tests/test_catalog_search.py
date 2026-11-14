import sys
import tempfile
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.main import search_catalog_rows
from app.models import Observation


class CatalogSearchTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.engine = create_engine(f"sqlite:///{Path(self.temp_dir.name) / 'catalog.db'}")
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as session, session.begin():
            session.add_all([
                Observation(obs_id="wrap-west", collection="spherex_qr3", band="D1", ra_deg=359.9, dec_deg=0.0, mjd_start=4.0),
                Observation(obs_id="wrap-east", collection="spherex_qr3", band="D1", ra_deg=0.1, dec_deg=0.0, mjd_start=3.0),
                Observation(obs_id="outside", collection="spherex_qr2", band="D2", ra_deg=1.0, dec_deg=0.0, mjd_start=2.0),
                Observation(obs_id="north", collection="spherex_qr2", band="D2", ra_deg=180.0, dec_deg=90.0, mjd_start=1.0),
            ])

    def test_cone_fov_is_full_diameter_and_handles_ra_wrap(self):
        with Session(self.engine) as session:
            result = search_catalog_rows(
                session, ra_deg=0.0, dec_deg=0.0, fov_deg=0.6, page=1, page_size=10
            )
        self.assertEqual(result["total"], 2)
        self.assertAlmostEqual(result["cone_radius_deg"], 0.3)
        self.assertEqual({item["obs_id"] for item in result["items"]}, {"wrap-west", "wrap-east"})

    def test_ra_range_can_cross_zero_and_pagination_is_server_side(self):
        with Session(self.engine) as session:
            result = search_catalog_rows(
                session, ra_min=359.0, ra_max=1.0, page=2, page_size=1
            )
        self.assertEqual(result["total"], 3)
        self.assertEqual(result["pages"], 3)
        self.assertEqual(len(result["items"]), 1)

    def test_text_filter_is_applied_before_pagination(self):
        with Session(self.engine) as session:
            result = search_catalog_rows(session, q="wrap", page=1, page_size=1)
        self.assertEqual(result["total"], 2)
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(result["pages"], 2)

    def test_invalid_partial_center_is_not_silently_ignored(self):
        with Session(self.engine) as session:
            with self.assertRaises(HTTPException):
                search_catalog_rows(session, ra_deg=1.0)


if __name__ == "__main__":
    unittest.main()
