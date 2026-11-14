import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.provenance import cached_product_provenance, load_verified_product_manifest


class VerifiedProductProvenanceTests(unittest.TestCase):
    def test_manifest_contains_five_unique_hash_named_records(self):
        records = load_verified_product_manifest()
        self.assertEqual(len(records), 5)
        for filename, record in records.items():
            with self.subTest(filename=filename):
                self.assertEqual(filename.removesuffix(".fits").lower(), record["sha256"].lower())
                self.assertEqual(record["release"], "QR3")
                self.assertTrue(record["source_access_url"].startswith("https://irsa.ipac.caltech.edu/"))
                self.assertTrue(record["resolved_access_url"].startswith("https://nasa-irsa-spherex.s3."))

    def test_documented_provenance_does_not_mark_byte_integrity_pass(self):
        filename, record = next(iter(load_verified_product_manifest().items()))
        result = cached_product_provenance(filename, record["size_bytes"])
        self.assertEqual(result["record_state"], "DOCUMENTED")
        self.assertTrue(result["size_matches_manifest"])
        self.assertEqual(result["integrity_state"], "NOT EVALUATED")
        self.assertEqual(result["scientific_quality_state"], "NOT EVALUATED")

    def test_size_mismatch_warns_and_unknown_products_are_not_mapped(self):
        filename, record = next(iter(load_verified_product_manifest().items()))
        mismatch = cached_product_provenance(filename, record["size_bytes"] + 1)
        self.assertEqual(mismatch["record_state"], "WARNING")
        self.assertFalse(mismatch["size_matches_manifest"])
        self.assertIsNone(cached_product_provenance("0" * 64 + ".fits", 1))


if __name__ == "__main__":
    unittest.main()
