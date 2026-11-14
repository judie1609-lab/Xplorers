import json
import unittest
from pathlib import Path


TARGET_CASES_PATH = Path(__file__).resolve().parents[2] / "frontend" / "src" / "app" / "target-cases.json"


class TargetCasePresetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.targets = json.loads(TARGET_CASES_PATH.read_text(encoding="utf-8"))

    def test_all_five_required_target_cases_are_present_once(self):
        self.assertEqual(
            [target["name"] for target in self.targets],
            ["Barnard's Star", "WISE 0855", "Epsilon Indi B", "RW Aurigae", "R Draconis"],
        )
        self.assertEqual(len({target["id"] for target in self.targets}), 5)

    def test_coordinate_presets_have_catalog_source_and_valid_search_center(self):
        for target in self.targets:
            with self.subTest(target=target["name"]):
                self.assertTrue(target["referenceUrl"].startswith("https://simbad."))
                self.assertEqual(target["catalogEpoch"], "J2000.0")
                self.assertIn("propagated to 2025.0", target["searchCenter"])
                self.assertGreaterEqual(float(target["raDeg"]), 0.0)
                self.assertLess(float(target["raDeg"]), 360.0)
                self.assertGreaterEqual(float(target["decDeg"]), -90.0)
                self.assertLessEqual(float(target["decDeg"]), 90.0)
                self.assertTrue(target["coverageSummary"])
                self.assertTrue(target["pairState"])

    def test_wise_0855_is_explicitly_unresolved_not_zero_coverage(self):
        wise = next(target for target in self.targets if target["id"] == "wise0855")
        self.assertIn("UNRESOLVED", wise["coverageState"])
        self.assertIn("timeouts", wise["coverageState"])
        self.assertEqual(wise["cachedProducts"], [])


if __name__ == "__main__":
    unittest.main()
