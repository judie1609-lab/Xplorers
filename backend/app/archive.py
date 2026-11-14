"""IRSA SIA/DataLink access with explicit product-format checks.

SIA metadata URLs whose format is DataLink are always resolved through the
DataLink VOTable. Only a FITS product tagged with the standard ``#this``
semantics is eligible for retrieval; service descriptors, cutouts and
calibration links are not silently treated as the requested science image.
"""

import hashlib
import io
import math
import os
import re
import tempfile
import xml.etree.ElementTree as ET
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import datetime, timezone
from http.client import IncompleteRead
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from astropy.io import fits
from astropy.io.votable import parse as parse_votable
from astropy import units as astro_units
from astropy.wcs import WCS
import numpy as np


IRSA_HOST = "irsa.ipac.caltech.edu"
SPHEREX_S3_HOST = "nasa-irsa-spherex.s3.us-east-1.amazonaws.com"
SIA_ENDPOINT = "https://irsa.ipac.caltech.edu/SIA"
# QR2 is no longer searchable through SIA2. Current image searches include
# both wide and deep survey products from DR1 and QR3.
SUPPORTED_COLLECTIONS = {
    "spherex_qr3",
    "spherex_qr3_deep",
    "spherex_dr1",
    "spherex_dr1_deep",
}
MAX_METADATA_BYTES = 8 * 1024 * 1024
MAX_PRODUCT_BYTES = 80 * 1024 * 1024
PRODUCT_RANGE_BYTES = 4 * 1024 * 1024
PRODUCT_RANGE_WORKERS = 8


class ArchiveError(Exception):
    def __init__(self, message: str, *, quality_state: str = "NOT EVALUATED"):
        super().__init__(message)
        self.quality_state = quality_state


def is_allowed_irsa_url(url: str, *, datalink: bool = False) -> bool:
    try:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname != IRSA_HOST or parsed.username or parsed.password:
            return False
        if datalink:
            return parsed.path == "/datalink/links/spherex"
        return parsed.path.startswith("/ibe/data/spherex/")
    except (TypeError, ValueError):
        return False


def is_allowed_product_url(url: str) -> bool:
    """Allow only documented IRSA IBE products or the official QR S3 mirror."""
    if is_allowed_irsa_url(url):
        return True
    try:
        parsed = urlsplit(url)
        return (
            parsed.scheme == "https"
            and parsed.hostname == SPHEREX_S3_HOST
            and not parsed.username
            and not parsed.password
            and parsed.path.startswith(("/qr2/", "/qr3/"))
        )
    except (TypeError, ValueError):
        return False


def official_spherex_s3_url(url: str) -> str | None:
    """Map an IRSA IBE QR2/QR3 object to the documented public S3 mirror."""
    if not is_allowed_irsa_url(url):
        return None
    parsed = urlsplit(url)
    prefix = "/ibe/data/spherex/"
    if not parsed.path.startswith(prefix) or parsed.query or parsed.fragment:
        return None
    object_key = parsed.path[len(prefix):].lstrip("/")
    release = object_key.split("/", 1)[0]
    if release not in {"qr2", "qr3"} or not object_key:
        return None
    return f"https://{SPHEREX_S3_HOST}/{object_key}"


class _IRSAOnlyRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        try:
            parsed = urlsplit(newurl)
            if parsed.hostname == IRSA_HOST:
                allowed_path = (
                    parsed.path == "/SIA"
                    or parsed.path == "/datalink/links/spherex"
                    or parsed.path.startswith("/ibe/data/spherex/")
                )
            elif parsed.hostname == SPHEREX_S3_HOST:
                allowed_path = parsed.path.startswith(("/qr2/", "/qr3/"))
            else:
                allowed_path = False
            allowed = (
                parsed.scheme == "https"
                and parsed.hostname in {IRSA_HOST, SPHEREX_S3_HOST}
                and not parsed.username
                and not parsed.password
                and allowed_path
            )
        except (TypeError, ValueError):
            allowed = False
        if not allowed:
            raise ArchiveError("IRSA redirected outside the approved data endpoints")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _opener():
    return build_opener(_IRSAOnlyRedirect())


def build_sia_search_url(
    *,
    ra_deg: float,
    dec_deg: float,
    fov_deg: float,
    collection: str,
    max_records: int = 100,
    min_mjd: float | None = None,
    max_mjd: float | None = None,
) -> str:
    """Build official IRSA SIA v2 query. FOV is a diameter; POS uses radius."""
    if collection not in SUPPORTED_COLLECTIONS:
        raise ArchiveError(
            "collection must be spherex_qr3, spherex_qr3_deep, "
            "spherex_dr1, or spherex_dr1_deep; QR2 is not searchable via SIA2"
        )
    if not math.isfinite(ra_deg) or not 0 <= ra_deg < 360:
        raise ArchiveError("ra_deg must be finite and in [0, 360)")
    if not math.isfinite(dec_deg) or not -90 <= dec_deg <= 90:
        raise ArchiveError("dec_deg must be finite and in [-90, 90]")
    if not math.isfinite(fov_deg) or not 0 < fov_deg <= 360:
        raise ArchiveError("fov_deg is the full cone diameter and must be in (0, 360]")
    if not 1 <= max_records <= 1000:
        raise ArchiveError("max_records must be in [1, 1000]")
    if min_mjd is not None and not math.isfinite(min_mjd):
        raise ArchiveError("min_mjd must be finite")
    if max_mjd is not None and not math.isfinite(max_mjd):
        raise ArchiveError("max_mjd must be finite")
    if min_mjd is not None and max_mjd is not None and min_mjd > max_mjd:
        raise ArchiveError("min_mjd must not exceed max_mjd")

    params = {
        "COLLECTION": collection,
        "POS": f"CIRCLE {ra_deg:.10f} {dec_deg:.10f} {fov_deg / 2.0:.10f}",
        "CALIB": "2",
        "DPTYPE": "image",
        "MAXREC": str(max_records),
        # VOTable carries the standard QUERY_STATUS=OVERFLOW marker when
        # MAXREC truncates results; CSV has no standard truncation signal.
        "RESPONSEFORMAT": "VOTABLE",
    }
    if min_mjd is not None or max_mjd is not None:
        params["TIME"] = f"{min_mjd if min_mjd is not None else '-Inf'} {max_mjd if max_mjd is not None else '+Inf'}"
    return f"{SIA_ENDPOINT}?{urlencode(params)}"


def search_irsa_sia(**kwargs) -> dict:
    query_url = build_sia_search_url(**kwargs)
    request = Request(query_url, headers={"Accept": "application/x-votable+xml"})
    try:
        with _opener().open(request, timeout=30) as response:
            content_type = response.headers.get_content_type().lower()
            if content_type not in {"application/x-votable+xml", "text/xml", "application/xml"}:
                raise ArchiveError(f"Unexpected SIA response type: {content_type}")
            body = response.read(MAX_METADATA_BYTES + 1)
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        raise ArchiveError(f"IRSA SIA request failed: {error}") from error
    if len(body) > MAX_METADATA_BYTES:
        raise ArchiveError("IRSA SIA response exceeded the metadata size limit")

    records, query_status = parse_sia_votable(body)
    items = []
    for row in records:
        access_format = (row.get("access_format") or "").strip()
        access_url = (row.get("access_url") or "").strip()
        format_lower = access_format.lower()
        mode = (
            "DATALINK" if "datalink" in format_lower
            else "DIRECT_FITS" if format_lower in {"image/fits", "application/fits"}
            else "UNSUPPORTED"
        )
        if mode == "DIRECT_FITS" and not is_allowed_irsa_url(access_url):
            mode = "UNSUPPORTED"
        if mode == "DATALINK" and not is_allowed_irsa_url(access_url, datalink=True):
            mode = "UNSUPPORTED"
        items.append({
            "obs_publisher_did": row.get("obs_publisher_did") or "",
            "obs_id": row.get("obs_id") or "",
            "collection": row.get("obs_collection") or kwargs["collection"],
            "band": row.get("energy_bandpassname") or "",
            "ra_deg": _optional_float(row.get("s_ra")),
            "dec_deg": _optional_float(row.get("s_dec")),
            "mjd_start": _optional_float(row.get("t_min")),
            "mjd_end": _optional_float(row.get("t_max")),
            "fov_deg": _optional_float(row.get("s_fov")),
            "calibration_level": row.get("calib_level") or "",
            "calibration_status": row.get("s_calib_status") or "",
            "access_url": access_url,
            "access_format": access_format,
            "product_access_mode": mode,
            "product_available": mode in {"DATALINK", "DIRECT_FITS"},
        })
    completeness = (
        "CAPPED" if query_status == "OVERFLOW"
        else "COMPLETE" if query_status == "OK"
        else "NOT EVALUATED"
    )
    availability = (
        "MATCHES_FOUND" if items
        else "NO_MATCHES" if query_status == "OK"
        else "UNKNOWN"
    )
    return {
        "source": "IRSA SIA v2",
        "query_url": query_url,
        "count": len(items),
        "availability": availability,
        "query_status": query_status,
        "result_completeness": completeness,
        "max_records": kwargs.get("max_records", 100),
        "pagination_supported": False,
        "query_strategy_note": "IRSA SIA2 documents MAXREC and query constraints but no page cursor or async job interface. Use one user-triggered bounded query; narrow the sky cone or split MJD ranges when a request times out.",
        "quality_state": "NOT EVALUATED",
        "items": items,
    }


def parse_sia_votable(payload: bytes) -> tuple[list[dict[str, str]], str]:
    """Parse SIA rows and the standard VOTable QUERY_STATUS overflow marker."""
    try:
        votable = parse_votable(io.BytesIO(payload), verify="warn")
    except Exception as error:
        raise ArchiveError("IRSA SIA returned an invalid VOTable response") from error

    statuses = [
        str(info.value or "").strip().upper()
        for info in votable.iter_info()
        if str(info.name or "").strip().upper() == "QUERY_STATUS"
    ]
    if "ERROR" in statuses:
        raise ArchiveError("IRSA SIA reports QUERY_STATUS=ERROR")
    query_status = "OVERFLOW" if "OVERFLOW" in statuses else "OK" if "OK" in statuses else "NOT REPORTED"

    try:
        table = votable.get_first_table()
        if table is None or table.array is None:
            return [], query_status
        field_names = [str(name).strip().lower() for name in (table.array.dtype.names or ())]
        records = []
        for row in table.array:
            record = {}
            for index, name in enumerate(field_names):
                value = row[index]
                if np.ma.is_masked(value):
                    record[name] = ""
                elif isinstance(value, bytes):
                    record[name] = value.decode("utf-8", errors="replace").strip()
                else:
                    record[name] = str(value).strip()
            records.append(record)
        return records, query_status
    except Exception as error:
        raise ArchiveError("IRSA SIA VOTable has no readable results table") from error


def _optional_float(value):
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else None
    except (TypeError, ValueError):
        return None


def parse_datalink_votable(payload: bytes) -> list[dict[str, str]]:
    """Read the VOTable results resource, never service-descriptor PARAM URLs."""
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as error:
        raise ArchiveError("IRSA DataLink returned malformed VOTable XML") from error

    def local(tag):
        return tag.rsplit("}", 1)[-1].upper()

    for info in root.iter():
        if local(info.tag) == "INFO" and info.attrib.get("name", "").upper() == "QUERY_STATUS" and info.attrib.get("value", "").upper() == "ERROR":
            raise ArchiveError("IRSA DataLink reports a query error")

    resources = [node for node in root.iter() if local(node.tag) == "RESOURCE" and node.attrib.get("type", "").lower() == "results"]
    if not resources:
        raise ArchiveError("IRSA DataLink response has no results resource")
    rows = []
    for resource in resources:
        table = next((node for node in resource.iter() if local(node.tag) == "TABLE"), None)
        if table is None:
            continue
        fields = [node.attrib.get("name", "").lower() for node in table if local(node.tag) == "FIELD"]
        tabledata = next((node for node in table.iter() if local(node.tag) == "TABLEDATA"), None)
        if tabledata is None:
            # Do not partially decode BINARY/BINARY2 encodings.
            if any(local(node.tag) in {"BINARY", "BINARY2", "FITS"} for node in table.iter()):
                raise ArchiveError("IRSA DataLink used an unsupported VOTable data encoding")
            continue
        for tr in tabledata:
            if local(tr.tag) != "TR":
                continue
            cells = [td.text or "" for td in tr if local(td.tag) == "TD"]
            rows.append({fields[index]: cells[index].strip() if index < len(cells) else "" for index in range(len(fields))})
    return rows


def resolve_datalink_product(url: str) -> tuple[str, str, dict]:
    if not is_allowed_irsa_url(url, datalink=True):
        raise ArchiveError("DataLink URL is not an approved IRSA endpoint")
    request = Request(url, headers={"Accept": "application/x-votable+xml"})
    try:
        with _opener().open(request, timeout=30) as response:
            if response.headers.get_content_type().lower() not in {"application/x-votable+xml", "text/xml", "application/xml"}:
                raise ArchiveError("IRSA DataLink response is not a VOTable")
            payload = response.read(2 * 1024 * 1024 + 1)
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        raise ArchiveError(f"IRSA DataLink request failed: {error}") from error
    if len(payload) > 2 * 1024 * 1024:
        raise ArchiveError("IRSA DataLink response exceeded the size limit")

    links = parse_datalink_votable(payload)
    for link in links:
        semantics = (link.get("semantics") or "").strip().lower()
        content_type = (link.get("content_type") or "").strip().lower()
        candidate = (link.get("access_url") or "").strip()
        if semantics.endswith("#this") and content_type in {"image/fits", "application/fits"} and is_allowed_irsa_url(candidate):
            return candidate, content_type, link
    raise ArchiveError("DataLink contains no accessible FITS product with #this semantics")


def validate_fits_product(path: Path) -> dict:
    """Validate structure, checksums, declared units, and image celestial WCS.

    This deliberately validates the spatial WCS only. The WCS-WAVE extension
    is an approximate visualization lookup; calibrated spectral analysis
    requires the separate CWAVE/CBAND products and is not evaluated here.
    """
    try:
        with path.open("rb") as stream:
            signature = stream.read(9)
        if not signature.startswith(b"SIMPLE  ="):
            raise ArchiveError("Downloaded product does not have a FITS primary header", quality_state="REJECT")

        checks = []
        extensions = []
        with fits.open(path, mode="readonly", memmap=False, lazy_load_hdus=True) as hdul:
            hdul.verify("exception")
            if "IMAGE" not in hdul:
                raise ArchiveError("FITS product has no two-dimensional IMAGE extension", quality_state="REJECT")
            image_hdu = hdul["IMAGE"]
            image_naxis = int(image_hdu.header.get("NAXIS", 0))
            image_shape = [int(image_hdu.header.get(f"NAXIS{axis}", 0)) for axis in range(image_naxis, 0, -1)]
            if image_naxis != 2 or len(image_shape) != 2 or any(size <= 0 for size in image_shape):
                raise ArchiveError("FITS product has no two-dimensional IMAGE extension", quality_state="REJECT")
            for hdu in hdul:
                name = (hdu.name or "PRIMARY").upper()
                header = hdu.header
                naxis = int(header.get("NAXIS", 0))
                shape = [int(header.get(f"NAXIS{axis}", 0)) for axis in range(naxis, 0, -1)] if naxis else None
                bitpix_dtype = {8: "uint8", 16: "int16", 32: "int32", 64: "int64", -32: "float32", -64: "float64"}
                dtype = bitpix_dtype.get(int(header.get("BITPIX", 0))) if not isinstance(hdu, fits.BinTableHDU) else "table"
                checksum_present = "CHECKSUM" in hdu.header and "DATASUM" in hdu.header
                checksum = hdu.verify_checksum() if "CHECKSUM" in hdu.header else 0
                datasum = hdu.verify_datasum() if "DATASUM" in hdu.header else 0
                if checksum_present and (checksum == -1 or datasum == -1):
                    checks.append({"extension": name, "state": "REJECT", "reason": "FITS checksum mismatch"})
                elif not checksum_present:
                    checks.append({"extension": name, "state": "WARNING", "reason": "CHECKSUM/DATASUM not both present"})
                else:
                    checks.append({"extension": name, "state": "PASS", "reason": "FITS checksums verified"})
                columns = [column.name for column in hdu.columns] if isinstance(hdu, fits.BinTableHDU) else []
                table_columns = [
                    {"name": column.name, "unit": column.unit}
                    for column in hdu.columns
                ] if isinstance(hdu, fits.BinTableHDU) else []
                extensions.append({
                    "name": name,
                    "hdu_type": type(hdu).__name__,
                    "shape": shape,
                    "dtype": dtype,
                    "unit": hdu.header.get("BUNIT"),
                    "extver": hdu.header.get("EXTVER"),
                    "columns": columns,
                    "table_columns": table_columns,
                    "checksum_present": checksum_present,
                    "header_wcs": {key: hdu.header.get(key) for key in ("CTYPE1", "CTYPE2", "CTYPE3", "CUNIT1", "CUNIT2", "CUNIT3") if hdu.header.get(key) is not None},
                })

            wcs_report = _validate_celestial_wcs(image_hdu.header, image_shape)
            checks.append({
                "extension": "IMAGE WCS",
                "state": wcs_report["quality_state"],
                "reason": wcs_report["reason"],
            })

            present_names = {extension["name"] for extension in extensions}
            expected_extensions = {"IMAGE", "FLAGS", "VARIANCE", "ZODI", "WCS-WAVE"}
            missing_extensions = sorted(expected_extensions - present_names)
            if not present_names.intersection({"PSF", "EPSF"}):
                missing_extensions.append("PSF or EPSF")
            checks.append({
                "extension": "SPHEREx layout",
                "state": "WARNING" if missing_extensions else "PASS",
                "reason": (
                    "Expected documented extensions are present"
                    if not missing_extensions
                    else "Missing documented extensions: " + ", ".join(missing_extensions)
                ),
            })

            # These are the documented calibrated surface-brightness units.
            # No flag bits are decoded here; that needs the official flag table.
            expected_units = {
                "IMAGE": "MJy / sr",
                "VARIANCE": "MJy2 / sr2",
                "ZODI": "MJy / sr",
            }
            for extension_name, expected_unit in expected_units.items():
                if extension_name not in hdul:
                    continue
                declared_unit = hdul[extension_name].header.get("BUNIT")
                if not declared_unit:
                    unit_state, reason = "WARNING", "Documented BUNIT is missing"
                else:
                    try:
                        if astro_units.Unit(declared_unit) == astro_units.Unit(expected_unit):
                            unit_state, reason = "PASS", f"BUNIT is compatible with {expected_unit}"
                        else:
                            unit_state, reason = "REJECT", f"BUNIT {declared_unit!r} is incompatible with {expected_unit}"
                    except (ValueError, TypeError):
                        unit_state, reason = "REJECT", f"BUNIT {declared_unit!r} is not a recognized unit"
                checks.append({"extension": f"{extension_name} unit", "state": unit_state, "reason": reason})

            metadata_keys = (
                "OBS_ID", "OBSERVID", "DATE-OBS", "MJD-OBS", "MJDSTART", "TSTART", "TSTOP",
                "DETECTOR", "ARRAY", "SPS_LON_ECL", "SPS_LAT_ECL", "SPS_PA_ECL", "TELESCOP",
                "INSTRUME", "CREATOR", "PIPELINE", "CALIBVER", "BUNIT",
            )
            metadata = {
                "primary": {key: hdul[0].header[key] for key in metadata_keys if key in hdul[0].header},
                "image": {key: image_hdu.header[key] for key in metadata_keys if key in image_hdu.header},
            }
        if any(check["state"] == "REJECT" for check in checks):
            state = "REJECT"
        elif any(check["state"] != "PASS" for check in checks):
            state = "WARNING"
        else:
            state = "PASS"
        return {
            "quality_state": state,
            "format": "FITS",
            "checks": checks,
            "extensions": extensions,
            "metadata": metadata,
            "wcs": wcs_report,
            "spectral_calibration": {
                "quality_state": "NOT EVALUATED",
                "reason": "CWAVE/CBAND spectral calibration products were not retrieved or validated",
            },
            "flag_interpretation": {
                "quality_state": "NOT EVALUATED",
                "reason": "FLAGS values are preserved; no bit meanings are applied without the official Table 16 mapping",
            },
        }
    except ArchiveError:
        raise
    except Exception as error:
        raise ArchiveError(f"FITS validation failed: {error}", quality_state="REJECT") from error


def _validate_celestial_wcs(header, image_shape: list[int]) -> dict:
    """Transform the image center and corners; this is not an alignment test."""
    try:
        celestial = WCS(header, relax=True).celestial
        if not celestial.has_celestial:
            return {
                "quality_state": "WARNING",
                "reason": "IMAGE has no celestial coordinate transform",
                "samples": [],
            }
        ny, nx = image_shape
        pixels = [
            ("center", (nx - 1) / 2.0, (ny - 1) / 2.0),
            ("lower_left", 0.0, 0.0),
            ("lower_right", nx - 1.0, 0.0),
            ("upper_left", 0.0, ny - 1.0),
            ("upper_right", nx - 1.0, ny - 1.0),
        ]
        x = np.asarray([item[1] for item in pixels], dtype=float)
        y = np.asarray([item[2] for item in pixels], dtype=float)
        ra, dec = celestial.pixel_to_world_values(x, y)
        ra = np.asarray(ra, dtype=float)
        dec = np.asarray(dec, dtype=float)
        if not np.all(np.isfinite(ra)) or not np.all(np.isfinite(dec)) or np.any(np.abs(dec) > 90.0):
            return {
                "quality_state": "REJECT",
                "reason": "IMAGE celestial transform returned non-finite or invalid sky coordinates",
                "samples": [],
            }
        samples = [
            {
                "pixel": [float(item[1]), float(item[2])],
                "ra_deg": float(ra[index] % 360.0),
                "dec_deg": float(dec[index]),
            }
            for index, item in enumerate(pixels)
        ]
        return {
            "quality_state": "PASS",
            "reason": "IMAGE celestial WCS transformed center and four corners to finite sky coordinates",
            "axes": [header.get("CTYPE1"), header.get("CTYPE2")],
            "frame": header.get("RADESYS"),
            "samples": samples,
        }
    except Exception as error:
        return {
            "quality_state": "REJECT",
            "reason": f"IMAGE celestial WCS could not be validated: {error}",
            "samples": [],
        }


def _download_product_ranges(url: str, temp_path: Path, max_bytes: int) -> dict:
    """Download one verified object with bounded parallel HTTP byte ranges."""
    headers = {"Accept-Encoding": "identity"}
    head_request = Request(url, method="HEAD", headers=headers)
    with _opener().open(head_request, timeout=30) as response:
        final_url = response.geturl()
        if not is_allowed_product_url(final_url):
            raise ArchiveError("Product metadata resolved outside approved IRSA/SPHEREx endpoints")
        response_type = response.headers.get_content_type().lower()
        if response_type not in {"image/fits", "application/fits", "application/octet-stream", "binary/octet-stream"}:
            raise ArchiveError(f"IRSA product metadata is not FITS-compatible: {response_type}")
        declared = response.headers.get("Content-Length")
        etag = response.headers.get("ETag")
    if not declared:
        raise ArchiveError("IRSA product supplied no Content-Length; bounded completeness validation is unavailable", quality_state="REJECT")
    total = int(declared)
    if total <= 0:
        raise ArchiveError("IRSA product declared an invalid Content-Length", quality_state="REJECT")
    if total > max_bytes:
        raise ArchiveError(f"IRSA product exceeds {max_bytes} byte download limit")

    chunks = [
        (start, min(start + PRODUCT_RANGE_BYTES, total) - 1)
        for start in range(0, total, PRODUCT_RANGE_BYTES)
    ]

    def fetch_range(start: int, end: int) -> bytes:
        received = bytearray()
        no_progress = 0
        while start + len(received) <= end:
            offset = start + len(received)
            request_headers = {
                "Accept": "image/fits, application/fits",
                "Accept-Encoding": "identity",
                "Range": f"bytes={offset}-{end}",
            }
            if etag:
                request_headers["If-Match"] = etag
            request = Request(url, headers=request_headers)
            try:
                with _opener().open(request, timeout=360) as response:
                    resolved = response.geturl()
                    if not is_allowed_product_url(resolved):
                        raise ArchiveError("IRSA range request resolved outside approved data endpoints")
                    if response.getcode() != 206:
                        raise ArchiveError("IRSA did not honor the product byte-range request", quality_state="REJECT")
                    response_type = response.headers.get_content_type().lower()
                    if response_type not in {"image/fits", "application/fits", "application/octet-stream", "binary/octet-stream"}:
                        raise ArchiveError(f"IRSA range response is not FITS-compatible: {response_type}")
                    response_etag = response.headers.get("ETag")
                    if etag and response_etag and response_etag != etag:
                        raise ArchiveError("IRSA product ETag changed during retrieval", quality_state="REJECT")
                    content_range = response.headers.get("Content-Range")
                    match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", content_range or "", re.IGNORECASE)
                    if not match:
                        raise ArchiveError("IRSA returned an invalid Content-Range", quality_state="REJECT")
                    range_start, range_end, range_total = map(int, match.groups())
                    if range_start != offset or range_end < range_start or range_end > end or range_total != total:
                        raise ArchiveError("IRSA returned a mismatched Content-Range", quality_state="REJECT")
                    expected_range_size = range_end - range_start + 1
                    response_length = response.headers.get("Content-Length")
                    if response_length and int(response_length) != expected_range_size:
                        raise ArchiveError("IRSA range Content-Length does not match Content-Range", quality_state="REJECT")
                    try:
                        payload = response.read()
                    except IncompleteRead as error:
                        payload = error.partial or b""
                    except TimeoutError:
                        payload = b""
            except ArchiveError:
                raise
            except (HTTPError, URLError, TimeoutError, OSError):
                payload = b""

            if len(payload) > end - offset + 1:
                raise ArchiveError("IRSA range response exceeded the requested byte interval", quality_state="REJECT")
            if payload:
                received.extend(payload)
                no_progress = 0
            else:
                no_progress += 1
                if no_progress >= 3:
                    raise ArchiveError("IRSA range transfer repeatedly made no progress", quality_state="REJECT")
        return bytes(received)

    temp_path.write_bytes(b"")
    with temp_path.open("wb") as output:
        output.truncate(total)
    completed_bytes = 0
    pending_ranges = iter(chunks)
    with temp_path.open("r+b") as output, ThreadPoolExecutor(max_workers=PRODUCT_RANGE_WORKERS) as executor:
        pending = {}
        for _ in range(PRODUCT_RANGE_WORKERS):
            try:
                start, end = next(pending_ranges)
            except StopIteration:
                break
            pending[executor.submit(fetch_range, start, end)] = (start, end)
        while pending:
            done, _ = wait(pending, return_when=FIRST_COMPLETED)
            for future in done:
                start, end = pending.pop(future)
                payload = future.result()
                expected_size = end - start + 1
                if len(payload) != expected_size:
                    raise ArchiveError(
                        f"IRSA range size mismatch at bytes {start}-{end}: received {len(payload)} of {expected_size}",
                        quality_state="REJECT",
                    )
                output.seek(start)
                output.write(payload)
                output.flush()
                completed_bytes += len(payload)
                try:
                    next_start, next_end = next(pending_ranges)
                except StopIteration:
                    continue
                pending[executor.submit(fetch_range, next_start, next_end)] = (next_start, next_end)
    if completed_bytes != total or temp_path.stat().st_size != total:
        raise ArchiveError("IRSA range retrieval did not cover the complete product", quality_state="REJECT")
    return {
        "resolved_url": final_url,
        "response_content_type": response_type,
        "declared_size_bytes": total,
        "etag": etag,
        "download_method": f"parallel HTTP Range ({PRODUCT_RANGE_WORKERS} workers)",
    }


def retrieve_fits_product(
    *,
    access_url: str,
    access_format: str,
    cache_dir: Path,
    max_bytes: int = MAX_PRODUCT_BYTES,
) -> dict:
    """Resolve and cache a validated FITS product without overwriting files."""
    original_url = access_url
    normalized_format = (access_format or "").strip().lower()
    datalink_info = {}
    if "datalink" in normalized_format:
        direct_url, content_type, datalink_info = resolve_datalink_product(access_url)
    elif normalized_format in {"image/fits", "application/fits"}:
        if not is_allowed_irsa_url(access_url):
            raise ArchiveError("Direct FITS URL is not an approved IRSA product endpoint")
        direct_url, content_type = access_url, normalized_format
    else:
        raise ArchiveError(f"Unsupported archive product format: {access_format}")

    # IRSA officially documents a public SPHEREx QR2/QR3 S3 mirror. Prefer
    # that byte-identical object path for large payloads; keep the SIA/DataLink
    # URL as provenance and verify the returned bytes before caching.
    direct_url = official_spherex_s3_url(direct_url) or direct_url

    cache_dir.mkdir(parents=True, exist_ok=True)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".irsa-", suffix=".part", dir=cache_dir, delete=False) as temp:
            temp_path = Path(temp.name)
        transfer = _download_product_ranges(direct_url, temp_path, max_bytes)
        final_url = transfer["resolved_url"]
        response_type = transfer["response_content_type"]
        expected_total = transfer["declared_size_bytes"]
        size = temp_path.stat().st_size
        if size != expected_total:
            raise ArchiveError(
                f"IRSA FITS transfer size mismatch: received {size} of {expected_total} bytes",
                quality_state="REJECT",
            )

        digest = hashlib.sha256()
        with temp_path.open("rb") as downloaded:
            for chunk in iter(lambda: downloaded.read(1024 * 1024), b""):
                digest.update(chunk)
        validation = validate_fits_product(temp_path)
        validation["transfer"] = {
            "quality_state": "PASS" if size == expected_total else "REJECT",
            "received_bytes": size,
            "declared_total_bytes": expected_total,
            "size_evidence": "HTTP Content-Length/Content-Range",
            "etag": transfer["etag"],
            "download_method": transfer["download_method"],
        }
        validation["checks"].append({
            "extension": "HTTP transfer size",
            "state": "PASS",
            "reason": "Every byte range matched the archive-advertised object size",
        })
        if validation["quality_state"] == "REJECT":
            raise ArchiveError("FITS integrity validation rejected the product", quality_state="REJECT")
        sha256 = digest.hexdigest()
        filename = f"{sha256}.fits"
        final_path = cache_dir / filename
        if final_path.exists():
            existing_hash = hashlib.sha256(final_path.read_bytes()).hexdigest()
            if existing_hash != sha256:
                raise ArchiveError("Content-addressed cache filename checksum mismatch", quality_state="REJECT")
            temp_path.unlink(missing_ok=True)
        else:
            try:
                os.rename(temp_path, final_path)
            except FileExistsError:
                existing_hash = hashlib.sha256(final_path.read_bytes()).hexdigest()
                if existing_hash != sha256:
                    raise ArchiveError("Product cache collision failed checksum verification", quality_state="REJECT")
                temp_path.unlink(missing_ok=True)
        temp_path = None
        return {
            "source_access_url": original_url,
            "resolved_access_url": final_url,
            "resolved_content_type": content_type,
            "response_content_type": response_type,
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "sha256": sha256,
            "size_bytes": size,
            "declared_size_bytes": expected_total,
            "etag": transfer["etag"],
            "download_method": transfer["download_method"],
            "filename": filename,
            "local_path": str(final_path),
            "static_url": f"/static/archive_products/{filename}",
            "validation": validation,
            "datalink": datalink_info,
        }
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        raise ArchiveError(f"IRSA FITS retrieval failed: {error}") from error
    finally:
        if temp_path is not None:
            try:
                temp_path.unlink(missing_ok=True)
            except PermissionError:
                # Do not replace the scientific validation result with a Windows
                # file-lock error. The uniquely named partial remains untrusted.
                pass
