import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from astropy.io import fits
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import main
from app.db import Base
from app.epoch import build_comparison_eligibility, build_differencing_gate, compare_image_wcs


def _write_wcs_fixture(path: Path, *, ra_deg: float = 10.0, detector: int = 6) -> Path:
    """Create a tiny synthetic geometry fixture, not scientific image data."""
    image = fits.ImageHDU(np.zeros((64, 64), dtype=np.float32), name="IMAGE")
    image.header.update({
        "CTYPE1": "RA---TAN",
        "CTYPE2": "DEC--TAN",
        "CUNIT1": "deg",
        "CUNIT2": "deg",
        "RADESYS": "ICRS",
        "CRPIX1": 32.5,
        "CRPIX2": 32.5,
        "CRVAL1": ra_deg,
        "CRVAL2": 20.0,
        "CDELT1": -1.0 / 3600.0,
        "CDELT2": 1.0 / 3600.0,
        "DETECTOR": detector,
        "DATE-OBS": "2026-01-01T00:00:00.000",
        "MJD-OBS": 61041.0,
        "BUNIT": "MJy / sr",
    })
    fits.HDUList([fits.PrimaryHDU(), image]).writeto(path)
    return path


class EpochWcsTests(unittest.TestCase):
    def test_wcs_overlap_and_mapping_residual_are_not_source_alignment(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path_a = _write_wcs_fixture(Path(temp_dir) / "a.fits")
            path_b = _write_wcs_fixture(Path(temp_dir) / "b.fits", ra_deg=10.0005)
            report = compare_image_wcs(path_a, path_b, grid_size=9)

        self.assertEqual(report["quality_state"], "WARNING")
        self.assertEqual(report["wcs_geometry_state"], "PASS")
        self.assertTrue(report["footprint_comparison"]["sampled_overlap"])
        self.assertGreater(report["footprint_comparison"]["a_to_b"]["inside_destination_samples"], 0)
        self.assertIsNotNone(report["wcs_mapping_residuals"]["a_to_b"]["wcs_mapping_affine_residual_px"])
        self.assertEqual(report["source_alignment"]["quality_state"], "NOT EVALUATED")
        self.assertIsNone(report["source_alignment"]["residual_px"])
        self.assertFalse(report["scientific_differencing"]["allowed"])

    def test_eligibility_is_explicit_about_unknown_metadata_and_no_time_threshold(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path_a = _write_wcs_fixture(Path(temp_dir) / "a.fits")
            path_b = _write_wcs_fixture(Path(temp_dir) / "b.fits")
            pair = compare_image_wcs(path_a, path_b, grid_size=9)
        input_a, input_b = pair["inputs"]["a"], pair["inputs"]["b"]
        eligibility = build_comparison_eligibility(
            input_a, input_b,
            wcs_geometry_state=pair["wcs_geometry_state"],
            footprint_comparison=pair["footprint_comparison"],
        )

        self.assertFalse(eligibility["allowed"])
        self.assertEqual(eligibility["state"], "REJECT")
        self.assertEqual(eligibility["checks"]["detector_match"]["state"], "PASS")
        self.assertEqual(eligibility["checks"]["unit_compatibility"]["state"], "PASS")
        self.assertEqual(eligibility["checks"]["product_integrity"]["state"], "NOT EVALUATED")
        self.assertEqual(eligibility["checks"]["band_match"]["state"], "NOT EVALUATED")
        self.assertEqual(eligibility["checks"]["release_match"]["state"], "NOT EVALUATED")
        self.assertEqual(eligibility["checks"]["time_separation"]["state"], "NOT EVALUATED")
        self.assertEqual(eligibility["checks"]["source_registration"]["state"], "NOT EVALUATED")
        self.assertIn("No time-separation or overlap acceptance threshold", eligibility["threshold_policy"])

    def test_separated_footprints_warn_and_scientific_differencing_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path_a = _write_wcs_fixture(Path(temp_dir) / "a.fits")
            path_b = _write_wcs_fixture(Path(temp_dir) / "b.fits", ra_deg=12.0)
            report = compare_image_wcs(path_a, path_b, grid_size=9)

        self.assertEqual(report["quality_state"], "WARNING")
        self.assertEqual(report["wcs_geometry_state"], "WARNING")
        self.assertFalse(report["footprint_comparison"]["sampled_overlap"])
        self.assertEqual(report["scientific_differencing"]["quality_state"], "REJECT")
        self.assertFalse(report["scientific_differencing"]["allowed"])

    def test_differencing_gate_requires_every_scientific_prerequisite(self):
        blocked = build_differencing_gate(
            wcs_alignment="PASS",
            calibration_compatibility="NOT EVALUATED",
            unit_compatibility="PASS",
            uncertainty_validation="PASS",
        )
        self.assertEqual(blocked["quality_state"], "REJECT")
        self.assertFalse(blocked["allowed"])
        self.assertIn("calibration_compatibility", blocked["blocked_by"])

        ready = build_differencing_gate(
            wcs_alignment="PASS",
            calibration_compatibility="PASS",
            unit_compatibility="PASS",
            uncertainty_validation="PASS",
        )
        self.assertEqual(ready["quality_state"], "PASS")
        self.assertTrue(ready["allowed"])
        self.assertFalse(ready["pixels_subtracted"])

    def test_api_only_compares_hash_named_cached_products_and_keeps_gate_closed(self):
        test_engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(test_engine)
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)
                names = []
                for ra in (10.0, 10.0005):
                    draft = _write_wcs_fixture(temp_path / f"draft-{ra}.fits", ra_deg=ra)
                    digest = hashlib.sha256(draft.read_bytes()).hexdigest()
                    final = temp_path / f"{digest}.fits"
                    draft.replace(final)
                    names.append(final.name)
                request = main.EpochWCSComparisonRequest(image_a=names[0], image_b=names[1])
                with patch("app.main.ARCHIVE_PRODUCTS_DIR", temp_path), patch("app.main.engine", test_engine):
                    response = main.compare_epoch_wcs(request)

            self.assertEqual(response["inputs"]["a"]["integrity_state"], "PASS")
            self.assertEqual(response["inputs"]["b"]["integrity_state"], "PASS")
            self.assertEqual(response["eligibility_report"]["checks"]["product_integrity"]["state"], "PASS")
            self.assertEqual(response["inputs"]["a"]["archive_provenance"]["quality_state"], "NOT EVALUATED")
            self.assertEqual(response["compatibility"]["band_release_calibration"], "NOT EVALUATED")
            self.assertEqual(response["scientific_differencing"]["quality_state"], "REJECT")
            self.assertEqual(response["eligibility_report"]["checks"]["time_separation"]["state"], "NOT EVALUATED")
            self.assertIn("mask_handling", response["scientific_differencing"]["blocked_by"])
            self.assertGreaterEqual(response["footprint_comparison"]["overlap_percent_a_in_b"], 0)
        finally:
            test_engine.dispose()

    def test_cached_product_listing_is_read_only_and_reports_unrecorded_provenance(self):
        test_engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(test_engine)
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                source = _write_wcs_fixture(Path(temp_dir) / "draft.fits")
                digest = hashlib.sha256(source.read_bytes()).hexdigest()
                final = Path(temp_dir) / f"{digest}.fits"
                source.replace(final)
                with patch("app.main.ARCHIVE_PRODUCTS_DIR", Path(temp_dir)), patch("app.main.engine", test_engine):
                    response = main.cached_archive_products()

            self.assertEqual(response["count"], 1)
            self.assertFalse(response["database_modified"])
            item = response["items"][0]
            self.assertEqual(item["integrity_state"], "NOT EVALUATED")
            self.assertEqual(item["metadata"]["date_obs"], "2026-01-01T00:00:00.000")
            self.assertEqual(item["archive_provenance"]["record_state"], "NOT EVALUATED")
        finally:
            test_engine.dispose()

    @unittest.skipUnless(
        (Path(__file__).resolve().parents[1] / "static" / "archive_products" /
         "815e02a989418172e7e408ee925b518f2e9a51bd244aef82b6ca2e5d10974da6.fits").is_file()
        and (Path(__file__).resolve().parents[1] / "static" / "archive_products" /
             "40ce174e9ba2ffac86e7df4b20d3eb949a12090ed586deef982ae6275320ba02.fits").is_file(),
        "verified Barnard's Star products are not present in this checkout",
    )
    def test_verified_barnard_products_have_wcs_geometry_but_only_a_two_minute_baseline(self):
        cache = Path(__file__).resolve().parents[1] / "static" / "archive_products"
        path_a = cache / "815e02a989418172e7e408ee925b518f2e9a51bd244aef82b6ca2e5d10974da6.fits"
        path_b = cache / "40ce174e9ba2ffac86e7df4b20d3eb949a12090ed586deef982ae6275320ba02.fits"
        report = compare_image_wcs(path_a, path_b, grid_size=21)

        self.assertEqual(report["quality_state"], "WARNING")
        self.assertEqual(report["wcs_geometry_state"], "PASS")
        self.assertTrue(report["footprint_comparison"]["sampled_overlap"])
        self.assertEqual(report["inputs"]["a"]["detector"], 6)
        self.assertEqual(report["inputs"]["b"]["detector"], 6)
        self.assertAlmostEqual(
            float(report["inputs"]["b"]["mjd_obs"] - report["inputs"]["a"]["mjd_obs"]) * 86400.0,
            128.929,
            places=2,
        )
        self.assertEqual(report["source_alignment"]["quality_state"], "NOT EVALUATED")
        self.assertEqual(report["scientific_differencing"]["quality_state"], "REJECT")


if __name__ == "__main__":
    unittest.main()
