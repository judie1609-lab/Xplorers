"""Opt-in live IRSA test; set SPHEREX_LIVE_PRODUCT_URL to trigger a download."""

import hashlib
import os
import tempfile
import unittest
from pathlib import Path

from app.archive import MAX_PRODUCT_BYTES, retrieve_fits_product


LIVE_PRODUCT_URL = os.getenv("SPHEREX_LIVE_PRODUCT_URL", "").strip()
LIVE_PRODUCT_FORMAT = os.getenv("SPHEREX_LIVE_PRODUCT_FORMAT", "image/fits").strip()
EXPECTED_SHA256 = os.getenv("SPHEREX_LIVE_EXPECTED_SHA256", "").strip().lower()
EXPECTED_SIZE = os.getenv("SPHEREX_LIVE_EXPECTED_SIZE", "").strip()
EXPECTED_OBS_ID = os.getenv("SPHEREX_LIVE_EXPECTED_OBS_ID", "").strip()
EXPECTED_RELEASE = os.getenv("SPHEREX_LIVE_EXPECTED_RELEASE", "").strip().lower()


@unittest.skipUnless(LIVE_PRODUCT_URL, "set SPHEREX_LIVE_PRODUCT_URL to run the bounded live IRSA test")
class LiveIRSAProductTests(unittest.TestCase):
    def test_live_archive_product_is_retrieved_and_validated(self):
        with tempfile.TemporaryDirectory(prefix="spherex-live-") as temp_dir:
            result = retrieve_fits_product(
                access_url=LIVE_PRODUCT_URL,
                access_format=LIVE_PRODUCT_FORMAT,
                cache_dir=Path(temp_dir) / "products",
                max_bytes=MAX_PRODUCT_BYTES,
            )
            product_path = Path(result["local_path"])
            digest = hashlib.sha256(product_path.read_bytes()).hexdigest()
            self.assertEqual(result["sha256"], digest)
            self.assertGreater(result["size_bytes"], 0)
            self.assertLessEqual(result["size_bytes"], MAX_PRODUCT_BYTES)
            self.assertTrue(result["retrieved_at"])
            if result["declared_size_bytes"] is not None:
                self.assertEqual(result["size_bytes"], result["declared_size_bytes"])
            if EXPECTED_SIZE:
                self.assertEqual(result["size_bytes"], int(EXPECTED_SIZE))
            if EXPECTED_SHA256:
                self.assertEqual(digest, EXPECTED_SHA256)
            if EXPECTED_OBS_ID:
                self.assertIn(EXPECTED_OBS_ID, result["source_access_url"])
            if EXPECTED_RELEASE:
                self.assertIn(f"/{EXPECTED_RELEASE}/", result["resolved_access_url"])
            self.assertNotEqual(result["validation"]["quality_state"], "REJECT")
            self.assertEqual(result["validation"]["wcs"]["quality_state"], "PASS")
            names = {extension["name"] for extension in result["validation"]["extensions"]}
            self.assertTrue({"IMAGE", "FLAGS", "VARIANCE", "ZODI", "WCS-WAVE"}.issubset(names))
            self.assertTrue(names.intersection({"PSF", "EPSF"}))
            self.assertEqual(result["validation"]["spectral_calibration"]["quality_state"], "NOT EVALUATED")
            self.assertEqual(result["validation"]["flag_interpretation"]["quality_state"], "NOT EVALUATED")


if __name__ == "__main__":
    unittest.main()
