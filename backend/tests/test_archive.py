import io
import tempfile
import unittest
from email.message import Message
from http.client import IncompleteRead
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import numpy as np
from astropy.io import fits
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import main
from app.archive import (
    ArchiveError,
    build_sia_search_url,
    is_allowed_irsa_url,
    is_allowed_product_url,
    official_spherex_s3_url,
    parse_datalink_votable,
    parse_sia_votable,
    retrieve_fits_product,
    search_irsa_sia,
    validate_fits_product,
)
from app.db import Base


class _Response:
    def __init__(self, body: bytes, content_type: str, url: str, *, status=200, headers=None):
        self._stream = io.BytesIO(body)
        self.headers = Message()
        self.headers["Content-Type"] = content_type
        self.headers["Content-Length"] = str(len(body))
        for name, value in (headers or {}).items():
            if name in self.headers:
                self.headers.replace_header(name, str(value))
            else:
                self.headers[name] = str(value)
        self.url = url
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, size=-1):
        return self._stream.read(size)

    def geturl(self):
        return self.url

    def getcode(self):
        return self.status


class _Opener:
    def __init__(self, response):
        self.responses = list(response) if isinstance(response, (list, tuple)) else [response]

    def open(self, *args, **kwargs):
        return self.responses.pop(0)


class _InterruptedResponse(_Response):
    def __init__(self, partial: bytes, expected: int, content_type: str, url: str, *, headers):
        super().__init__(partial, content_type, url, status=206, headers=headers)
        self.expected = expected
        self.interrupt_once = True

    def read(self, size=-1):
        if self.interrupt_once:
            self.interrupt_once = False
            raise IncompleteRead(self._stream.read(size), self.expected)
        return self._stream.read(size)


def _head_response(url: str, size: int, etag='"fixture-etag"'):
    return _Response(
        b"",
        "binary/octet-stream",
        url,
        headers={"Content-Length": size, "ETag": etag},
    )


def _write_sanitized_verified_qr3_fixture(path: Path) -> None:
    """Write tiny zero-valued HDUs matching a verified QR3 product schema.

    Structure comes from the downloaded observation 2026W33_2A_0594_3D6;
    all pixel/table values here are synthetic zeros and are not science data.
    """
    image = fits.ImageHDU(np.zeros((16, 16), dtype=np.float32), name="IMAGE")
    image.header.update({
        "CTYPE1": "RA---TAN", "CTYPE2": "DEC--TAN",
        "CUNIT1": "deg", "CUNIT2": "deg", "RADESYS": "ICRS",
        "CRPIX1": 8.5, "CRPIX2": 8.5, "CRVAL1": 10.0, "CRVAL2": 20.0,
        "CDELT1": -0.001, "CDELT2": 0.001,
        "BUNIT": "MJy / sr", "SANITIZ": True,
    })
    flags = fits.CompImageHDU(np.zeros((16, 16), dtype=np.int32), name="FLAGS")
    flags.header["SANITIZ"] = True
    variance = fits.ImageHDU(np.zeros((16, 16), dtype=np.float32), name="VARIANCE")
    variance.header["BUNIT"] = "MJy2 / sr2"
    variance.header["SANITIZ"] = True
    zodi = fits.ImageHDU(np.zeros((16, 16), dtype=np.float32), name="ZODI")
    zodi.header["BUNIT"] = "MJy / sr"
    zodi.header["SANITIZ"] = True

    epsf_columns = [
        fits.Column(name="BINX", format="J", array=np.array([0], dtype=np.int32)),
        fits.Column(name="BINY", format="J", array=np.array([0], dtype=np.int32)),
        fits.Column(name="XCENTER", format="E", unit="pixel", array=np.array([0.0], dtype=np.float32)),
        fits.Column(name="YCENTER", format="E", unit="pixel", array=np.array([0.0], dtype=np.float32)),
        fits.Column(name="XWIDTH", format="E", unit="pixel", array=np.array([0.0], dtype=np.float32)),
        fits.Column(name="YWIDTH", format="E", unit="pixel", array=np.array([0.0], dtype=np.float32)),
        fits.Column(name="NSTAR", format="J", array=np.array([0], dtype=np.int32)),
        fits.Column(name="NEFF_MEAN", format="E", array=np.array([0.0], dtype=np.float32)),
        fits.Column(name="CWAVE", format="E", unit="um", array=np.array([0.0], dtype=np.float32)),
        fits.Column(name="CBAND", format="E", unit="um", array=np.array([0.0], dtype=np.float32)),
        fits.Column(name="EPSF", format="1089D", dim="(33,33)", array=np.zeros((1, 1089), dtype=np.float64)),
    ]
    epsf = fits.BinTableHDU.from_columns(epsf_columns, name="EPSF")
    epsf.header["SANITIZ"] = True
    wave_columns = [
        fits.Column(name="X", format="2J", dim="(2)", array=np.zeros((1, 2), dtype=np.int32)),
        fits.Column(name="Y", format="2J", dim="(2)", array=np.zeros((1, 2), dtype=np.int32)),
        fits.Column(name="VALUES", format="8E", dim="(2,2,2)", array=np.zeros((1, 8), dtype=np.float32)),
    ]
    wave = fits.BinTableHDU.from_columns(wave_columns, name="WCS-WAVE")
    wave.header["SANITIZ"] = True
    primary = fits.PrimaryHDU()
    primary.header["SANITIZ"] = True
    primary.header["OBS_ID"] = "SANITIZED"
    fits.HDUList([primary, image, flags, variance, zodi, epsf, wave]).writeto(path, checksum=True)


class ArchiveTests(unittest.TestCase):
    def test_sia_search_uses_circle_radius_half_the_fov_diameter(self):
        query = urlsplit(build_sia_search_url(
            ra_deg=12.5,
            dec_deg=-4,
            fov_deg=0.2,
            collection="spherex_qr3",
            max_records=20,
            min_mjd=60000,
        ))
        params = parse_qs(query.query)
        self.assertEqual(query.path, "/SIA")
        self.assertEqual(params["POS"], ["CIRCLE 12.5000000000 -4.0000000000 0.1000000000"])
        self.assertEqual(params["COLLECTION"], ["spherex_qr3"])
        self.assertEqual(params["TIME"], ["60000 +Inf"])
        self.assertEqual(params["RESPONSEFORMAT"], ["VOTABLE"])

    @staticmethod
    def _sia_votable(*, query_status="OK", include_row=False):
        fields = [
            ("obs_publisher_did", "char", "*"), ("obs_id", "char", "*"),
            ("obs_collection", "char", "*"), ("energy_bandpassname", "char", "*"),
            ("s_ra", "double", None), ("s_dec", "double", None),
            ("t_min", "double", None), ("t_max", "double", None),
            ("s_fov", "double", None), ("calib_level", "int", None),
            ("s_calib_status", "char", "*"), ("access_url", "char", "*"),
            ("access_format", "char", "*"),
        ]
        fields_xml = "".join(
            f'<FIELD name="{name}" datatype="{datatype}"'
            + (f' arraysize="{arraysize}"' if arraysize else "") + "/>"
            for name, datatype, arraysize in fields
        )
        values = [
            "ivo://irsa/test", "SANITIZED_OBS", "spherex_qr3", "D6",
            "10.0", "2.0", "60000.0", "60000.1", "0.1", "2", "OK",
            "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/test.fits", "image/fits",
        ]
        row_xml = "<TR>" + "".join(f"<TD>{value}</TD>" for value in values) + "</TR>" if include_row else ""
        return (
            '<VOTABLE version="1.4" xmlns="http://www.ivoa.net/xml/VOTable/v1.3">'
            '<RESOURCE type="results">'
            f'<INFO name="QUERY_STATUS" value="{query_status}"/>'
            f"<TABLE>{fields_xml}<DATA><TABLEDATA>{row_xml}</TABLEDATA></DATA></TABLE>"
            f"</RESOURCE></VOTABLE>"
        ).encode("utf-8")

    def test_sia_votable_distinguishes_complete_zero_rows_from_overflow(self):
        empty_rows, empty_status = parse_sia_votable(self._sia_votable())
        self.assertEqual(empty_rows, [])
        self.assertEqual(empty_status, "OK")

        capped_rows, capped_status = parse_sia_votable(self._sia_votable(query_status="OVERFLOW", include_row=True))
        self.assertEqual(capped_status, "OVERFLOW")
        self.assertEqual(capped_rows[0]["obs_id"], "SANITIZED_OBS")

    def test_sia_search_response_marks_zero_and_capped_results_distinctly(self):
        test_cases = [
            ("OK", False, "NO_MATCHES", "COMPLETE"),
            ("OVERFLOW", True, "MATCHES_FOUND", "CAPPED"),
        ]
        for status, include_row, availability, completeness in test_cases:
            with self.subTest(status=status):
                with patch("app.archive._opener") as opener_factory:
                    opener_factory.return_value.open.return_value = _Response(
                        self._sia_votable(query_status=status, include_row=include_row),
                        "application/x-votable+xml",
                        "https://irsa.ipac.caltech.edu/SIA",
                    )
                    result = search_irsa_sia(
                        ra_deg=10, dec_deg=2, fov_deg=0.2,
                        collection="spherex_qr3", max_records=1,
                    )
                self.assertEqual(result["availability"], availability)
                self.assertEqual(result["result_completeness"], completeness)
                self.assertFalse(result["pagination_supported"])
                self.assertEqual(result["count"], 1 if include_row else 0)

    def test_dr1_collection_is_supported_in_sia_query(self):
        query = urlsplit(build_sia_search_url(
            ra_deg=10, dec_deg=20, fov_deg=0.2,
            collection="spherex_dr1", max_records=20,
        ))
        self.assertEqual(parse_qs(query.query)["COLLECTION"], ["spherex_dr1"])

    def test_current_deep_survey_collections_are_supported_and_qr2_is_not_searchable(self):
        for collection in ("spherex_qr3_deep", "spherex_dr1_deep"):
            with self.subTest(collection=collection):
                query = urlsplit(build_sia_search_url(
                    ra_deg=10, dec_deg=20, fov_deg=0.2,
                    collection=collection, max_records=20,
                ))
                self.assertEqual(parse_qs(query.query)["COLLECTION"], [collection])
        with self.assertRaisesRegex(ArchiveError, "QR2 is not searchable"):
            build_sia_search_url(
                ra_deg=10, dec_deg=20, fov_deg=0.2,
                collection="spherex_qr2", max_records=20,
            )

    def test_invalid_collection_and_untrusted_product_urls_are_rejected(self):
        with self.assertRaises(ArchiveError):
            build_sia_search_url(ra_deg=0, dec_deg=0, fov_deg=1, collection="other")
        self.assertTrue(is_allowed_irsa_url("https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/x.fits"))
        self.assertFalse(is_allowed_irsa_url("http://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/x.fits"))
        self.assertFalse(is_allowed_irsa_url("https://example.org/ibe/data/spherex/qr3/x.fits"))
        self.assertFalse(is_allowed_irsa_url("https://irsa.ipac.caltech.edu/datalink/links/spherex?id=x"))

    def test_official_ibe_product_maps_only_to_the_documented_qr_s3_prefix(self):
        ibe_url = "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/example/file.fits"
        cloud_url = "https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/qr3/level2/example/file.fits"
        self.assertEqual(official_spherex_s3_url(ibe_url), cloud_url)
        self.assertTrue(is_allowed_product_url(cloud_url))
        self.assertIsNone(official_spherex_s3_url("https://example.org/ibe/data/spherex/qr3/example.fits"))
        self.assertIsNone(official_spherex_s3_url("https://irsa.ipac.caltech.edu/ibe/data/spherex/other/example.fits"))
        self.assertIsNone(official_spherex_s3_url("https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/example.fits"))

    def test_datalink_parser_retains_semantics_and_does_not_use_calibration(self):
        votable = b'''<?xml version="1.0"?>
        <VOTABLE xmlns="http://www.ivoa.net/xml/VOTable/v1.3"><RESOURCE type="results"><TABLE>
        <FIELD name="semantics"/><FIELD name="content_type"/><FIELD name="access_url"/>
        <DATA><TABLEDATA>
        <TR><TD>#this</TD><TD>image/fits</TD><TD>https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/a.fits</TD></TR>
        <TR><TD>#calibration</TD><TD>image/fits</TD><TD>https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/cal.fits</TD></TR>
        </TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>'''
        rows = parse_datalink_votable(votable)
        this_row = next(row for row in rows if row["semantics"] == "#this")
        self.assertTrue(this_row["access_url"].endswith("a.fits"))
        self.assertEqual(rows[1]["semantics"], "#calibration")

    def test_datalink_format_resolves_before_fits_retrieval_and_records_hash(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture_path = Path(temp_dir) / "fixture.fits"
            fits.HDUList([
                fits.PrimaryHDU(),
                fits.ImageHDU(np.array([[1.0, 2.0], [3.0, 4.0]], dtype=np.float32), name="IMAGE"),
            ]).writeto(fixture_path)
            payload = fixture_path.read_bytes()
            url = "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/test.fits"
            cloud_url = official_spherex_s3_url(url)
            response = _Response(
                payload,
                "binary/octet-stream",
                cloud_url,
                status=206,
                headers={
                    "Content-Range": f"bytes 0-{len(payload) - 1}/{len(payload)}",
                    "ETag": '"fixture-etag"',
                },
            )
            with patch("app.archive.resolve_datalink_product", return_value=(url, "image/fits", {"semantics": "#this"})) as resolver, \
                 patch("app.archive._opener", return_value=_Opener([_head_response(cloud_url, len(payload)), response])):
                result = retrieve_fits_product(
                    access_url="https://irsa.ipac.caltech.edu/datalink/links/spherex?ID=test",
                    access_format="application/x-votable+xml;content=datalink",
                    cache_dir=Path(temp_dir) / "cache",
                )
            resolver.assert_called_once()
            cached = Path(result["local_path"])
            self.assertTrue(cached.is_file())
            self.assertEqual(result["size_bytes"], len(payload))
            self.assertEqual(len(result["sha256"]), 64)
            self.assertEqual(result["validation"]["quality_state"], "WARNING")
            self.assertEqual(result["validation"]["extensions"][1]["name"], "IMAGE")

    def test_product_retrieval_resumes_short_range_and_verifies_full_size(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture_path = Path(temp_dir) / "fixture.fits"
            fits.HDUList([
                fits.PrimaryHDU(),
                fits.ImageHDU(np.array([[1.0, 2.0], [3.0, 4.0]], dtype=np.float32), name="IMAGE"),
            ]).writeto(fixture_path)
            payload = fixture_path.read_bytes()
            split = len(payload) // 3
            url = "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/test.fits"
            cloud_url = official_spherex_s3_url(url)
            first = _InterruptedResponse(
                payload[:split],
                len(payload) - split,
                "binary/octet-stream",
                cloud_url,
                headers={
                    "Content-Range": f"bytes 0-{len(payload) - 1}/{len(payload)}",
                    "Content-Length": str(len(payload)),
                    "ETag": '"fixture-etag"',
                },
            )
            second = _Response(
                payload[split:],
                "binary/octet-stream",
                cloud_url,
                status=206,
                headers={
                    "Content-Range": f"bytes {split}-{len(payload) - 1}/{len(payload)}",
                    "Content-Length": str(len(payload) - split),
                    "ETag": '"fixture-etag"',
                },
            )
            with patch("app.archive._opener", return_value=_Opener([_head_response(cloud_url, len(payload)), first, second])):
                result = retrieve_fits_product(
                    access_url=url,
                    access_format="image/fits",
                    cache_dir=Path(temp_dir) / "cache",
                )
            cached = Path(result["local_path"])
            self.assertEqual(cached.stat().st_size, len(payload))
            self.assertEqual(result["declared_size_bytes"], len(payload))
            self.assertEqual(result["sha256"], __import__("hashlib").sha256(payload).hexdigest())
            self.assertEqual(cached.read_bytes(), payload)

    def test_fits_validation_does_not_pass_when_checksum_evidence_is_missing(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "no-checksum.fits"
            fits.HDUList([
                fits.PrimaryHDU(),
                fits.ImageHDU(np.zeros((2, 2), dtype=np.float32), name="IMAGE"),
            ]).writeto(path)
            report = validate_fits_product(path)
            self.assertEqual(report["quality_state"], "WARNING")
            self.assertTrue(all(check["state"] == "WARNING" for check in report["checks"]))

    def test_sanitized_fixture_from_verified_qr3_structure_passes_layout_units_and_wcs(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "sanitized-qr3.fits"
            _write_sanitized_verified_qr3_fixture(path)
            with fits.open(path, memmap=False) as hdul:
                self.assertTrue(hdul[0].header["SANITIZ"])
                self.assertEqual(
                    [hdu.name for hdu in hdul],
                    ["PRIMARY", "IMAGE", "FLAGS", "VARIANCE", "ZODI", "EPSF", "WCS-WAVE"],
                )
                self.assertTrue(all(hdu.header.get("CHECKSUM") for hdu in hdul if hdu.name != "FLAGS"))
                self.assertFalse(hdul["FLAGS"].header.get("CHECKSUM"))
            report = validate_fits_product(path)
            self.assertEqual(report["quality_state"], "WARNING")
            self.assertEqual(report["wcs"]["quality_state"], "PASS")
            self.assertEqual(
                next(check for check in report["checks"] if check["extension"] == "FLAGS")["state"],
                "WARNING",
            )
            layout = next(check for check in report["checks"] if check["extension"] == "SPHEREx layout")
            self.assertEqual(layout["state"], "PASS")
            self.assertEqual(
                [check["state"] for check in report["checks"] if check["extension"].endswith(" unit")],
                ["PASS", "PASS", "PASS"],
            )
            self.assertEqual(report["spectral_calibration"]["quality_state"], "NOT EVALUATED")
            self.assertEqual(report["flag_interpretation"]["quality_state"], "NOT EVALUATED")

    def test_documented_image_unit_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "wrong-unit.fits"
            _write_sanitized_verified_qr3_fixture(path)
            with fits.open(path, mode="update") as hdul:
                hdul["IMAGE"].header["BUNIT"] = "electron / s"
            report = validate_fits_product(path)
            self.assertEqual(report["quality_state"], "REJECT")
            image_unit = next(check for check in report["checks"] if check["extension"] == "IMAGE unit")
            self.assertEqual(image_unit["state"], "REJECT")

    def test_archive_api_search_and_retrieval_provenance_endpoints(self):
        test_engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(test_engine)
        testing_sessions = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)
        session = testing_sessions()
        try:
            with patch("app.main.search_irsa_sia", return_value={"source": "IRSA SIA v2", "items": [], "quality_state": "NOT EVALUATED"}) as search, \
                 patch("app.main.retrieve_fits_product", return_value={
                     "source_access_url": "https://irsa.ipac.caltech.edu/datalink/links/spherex?ID=test",
                     "resolved_access_url": "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/test.fits",
                     "response_content_type": "application/fits",
                     "retrieved_at": "2026-11-13T00:00:00+00:00",
                     "sha256": "a" * 64,
                     "size_bytes": 2048,
                     "filename": f"{'a' * 64}.fits",
                     "static_url": f"/static/archive_products/{'a' * 64}.fits",
                     "validation": {"quality_state": "WARNING", "checks": [], "extensions": []},
                 }), \
                 patch("app.main.ARCHIVE_PRODUCTS_DIR", Path(tempfile.gettempdir()) / "not-written-archive-test"):
                search_result = main.archive_search(
                    ra_deg=10, dec_deg=-2, fov_deg=0.1, collection="spherex_qr3",
                )
                self.assertEqual(search_result["quality_state"], "NOT EVALUATED")
                search.assert_called_once()

                retrieval_request = main.ArchiveRetrievalRequest(
                    access_url="https://irsa.ipac.caltech.edu/datalink/links/spherex?ID=test",
                    access_format="application/x-votable+xml;content=datalink",
                    obs_id="fixture-observation",
                    collection="spherex_qr3",
                )
                retrieved = main.archive_product_retrieve(retrieval_request, session)
                self.assertEqual(retrieved["sha256"], "a" * 64)
                self.assertEqual(retrieved["quality_state"], "WARNING")
                self.assertEqual(retrieved["scientific_quality_state"], "NOT EVALUATED")
                self.assertTrue(retrieved["retrieved_at"].endswith("+00:00"))

                history = main.archive_products(session)
                self.assertEqual(history["count"], 1)
                self.assertEqual(history["items"][0]["obs_id"], "fixture-observation")
        finally:
            session.close()
            test_engine.dispose()


if __name__ == "__main__":
    unittest.main()
