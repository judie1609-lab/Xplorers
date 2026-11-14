from contextlib import asynccontextmanager
from datetime import timezone
from pathlib import Path
import re
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

from fastapi import Depends, FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from sqlalchemy import func, select, distinct, or_
from sqlalchemy.orm import Session

from .db import Base, engine, get_db
from .models import ArchiveProduct, Observation
from .archive import ArchiveError, retrieve_fits_product, search_irsa_sia, validate_fits_product
from .epoch import build_comparison_eligibility, compare_image_wcs, inspect_cached_product
from .provenance import cached_product_provenance
from .settings import (
    archive_cache_path_from_environment,
    cors_origins_from_environment,
    low_memory_mode_from_environment,
)


# ==========================================
# PROJECT PATHS
# ==========================================

BACKEND_DIR = Path(__file__).resolve().parents[1]

STATIC_DIR = BACKEND_DIR / "static"
IMAGES_DIR = STATIC_DIR / "images"
ARCHIVE_PRODUCTS_DIR = archive_cache_path_from_environment(BACKEND_DIR)
LOW_MEMORY_MODE = low_memory_mode_from_environment()
HASHED_FITS_NAME = re.compile(r"^[a-fA-F0-9]{64}\.fits$")

IMAGES_DIR.mkdir(parents=True, exist_ok=True)
ARCHIVE_PRODUCTS_DIR.mkdir(parents=True, exist_ok=True)


# ==========================================
# APPLICATION LIFESPAN
# ==========================================

@asynccontextmanager
async def lifespan(app: FastAPI):

    # Create missing tables only.
    # Existing records are not deleted.
    Base.metadata.create_all(bind=engine)

    yield

    engine.dispose()


# ==========================================
# FASTAPI APPLICATION
# ==========================================

app = FastAPI(
    title="SPECTRA API",
    version="1.0.0",
    description="SPHEREx Scientific Data API",
    lifespan=lifespan,
)


# ==========================================
# CORS CONFIGURATION
# ==========================================


app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins_from_environment(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================
# STATIC SCIENTIFIC IMAGES
# ==========================================

app.mount(
    "/static/archive_products",
    StaticFiles(directory=str(ARCHIVE_PRODUCTS_DIR)),
    name="archive-products",
)

app.mount(
    "/static",
    StaticFiles(directory=str(STATIC_DIR)),
    name="static",
)


class ArchiveRetrievalRequest(BaseModel):
    access_url: str = Field(min_length=1, max_length=4096)
    access_format: str = Field(min_length=1, max_length=200)
    obs_publisher_did: str | None = Field(default=None, max_length=2048)
    obs_id: str | None = Field(default=None, max_length=120)
    collection: str | None = Field(default=None, max_length=100)
    band: str | None = Field(default=None, max_length=40)
    mjd_start: float | None = None


class EpochWCSComparisonRequest(BaseModel):
    image_a: str = Field(pattern=r"^[a-fA-F0-9]{64}\.fits$", max_length=69)
    image_b: str = Field(pattern=r"^[a-fA-F0-9]{64}\.fits$", max_length=69)
    grid_size: int = Field(default=21, ge=5, le=65)


def _iso_utc_timestamp(value):
    if value is None:
        return None
    if value.tzinfo is None:
        # SQLite drops timezone metadata for timestamps created by the UTC retrieval path.
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _archive_product_json(product: ArchiveProduct) -> dict:
    return {
        "id": product.id,
        "sha256": product.sha256,
        "obs_publisher_did": product.obs_publisher_did,
        "obs_id": product.obs_id,
        "collection": product.collection,
        "release": _release_from_collection(product.collection),
        "band": product.band,
        "mjd_start": product.mjd_start,
        "source_access_url": product.source_access_url,
        "resolved_access_url": product.resolved_access_url,
        "source_access_format": product.source_access_format,
        "content_type": product.content_type,
        "filename": product.filename,
        "static_url": product.static_url,
        "size_bytes": product.size_bytes,
        "retrieved_at": _iso_utc_timestamp(product.retrieved_at),
        "quality_state": product.quality_state,
        "validation": product.validation_report,
        "scientific_quality_state": "NOT EVALUATED",
    }


def _release_from_collection(collection: str | None) -> str | None:
    if not collection:
        return None
    lowered = collection.casefold()
    if lowered.startswith("spherex_qr3"):
        return "QR3"
    if lowered.startswith("spherex_dr1"):
        return "DR1"
    return None


def _guard_low_memory_analysis(feature: str) -> None:
    """Fail closed for resource-heavy analysis when explicitly enabled on Free."""
    if LOW_MEMORY_MODE:
        raise HTTPException(
            status_code=503,
            detail=(
                f"NOT EVALUATED: {feature} is disabled by XPLORERS_LOW_MEMORY_MODE. "
                "This deployment is configured for Render Free's 512 MB RAM limit; "
                "run this analysis on a suitably provisioned environment."
            ),
        )


def _archive_provenance_for_filename(filename: str) -> dict:
    try:
        with Session(engine) as db:
            product = db.scalar(select(ArchiveProduct).where(ArchiveProduct.filename == filename))
    except Exception:
        product = None
    if product is None:
        try:
            path = ARCHIVE_PRODUCTS_DIR / filename
            documented = cached_product_provenance(filename, path.stat().st_size)
        except OSError:
            documented = None
        if documented is not None:
            return {
                **documented,
                "archive_provenance_state": documented["record_state"],
            }
        return {
            "record_state": "NOT EVALUATED",
            "obs_id": None,
            "collection": None,
            "release": None,
            "band": None,
            "retrieved_at": None,
            "source_access_url": None,
            "resolved_access_url": None,
            "reason": "No matching archive provenance row is available in the local product registry.",
        }
    return {
        "record_state": "AVAILABLE",
        "obs_id": product.obs_id,
        "collection": product.collection,
        "release": _release_from_collection(product.collection),
        "band": product.band,
        "retrieved_at": _iso_utc_timestamp(product.retrieved_at),
        "source_access_url": product.source_access_url,
        "resolved_access_url": product.resolved_access_url,
        "product_quality_state": product.quality_state,
        "validation": product.validation_report,
    }


@app.get("/api/v1/archive/search")
def archive_search(
    ra_deg: float = Query(...),
    dec_deg: float = Query(...),
    fov_deg: float = Query(...),
    collection: str = Query(...),
    max_records: int = Query(default=100, ge=1, le=200),
    min_mjd: float | None = None,
    max_mjd: float | None = None,
):
    try:
        return search_irsa_sia(
            ra_deg=ra_deg,
            dec_deg=dec_deg,
            fov_deg=fov_deg,
            collection=collection,
            max_records=max_records,
            min_mjd=min_mjd,
            max_mjd=max_mjd,
        )
    except ArchiveError as error:
        raise HTTPException(status_code=502, detail={
            "message": str(error),
            "quality_state": error.quality_state,
        }) from error


@app.get("/api/v1/archive/products")
def archive_products(db: Session = Depends(get_db)):
    products = db.scalars(
        select(ArchiveProduct).order_by(ArchiveProduct.retrieved_at.desc(), ArchiveProduct.id.desc())
    ).all()
    return {"count": len(products), "items": [_archive_product_json(product) for product in products]}


@app.get("/api/v1/archive/cached-products")
def cached_archive_products():
    """List hash-named local FITS products without changing files or the database."""
    items = []
    if ARCHIVE_PRODUCTS_DIR.is_dir():
        for path in sorted(ARCHIVE_PRODUCTS_DIR.iterdir(), key=lambda item: item.name.casefold()):
            if not path.is_file() or not HASHED_FITS_NAME.fullmatch(path.name):
                continue
            try:
                metadata = inspect_cached_product(path)
                metadata_state = "AVAILABLE"
                metadata_reason = "FITS IMAGE header and celestial WCS metadata were read without loading pixel arrays."
            except (OSError, ValueError) as error:
                metadata = None
                metadata_state = "REJECT"
                metadata_reason = str(error)
            items.append({
                "filename": path.name,
                "sha256_from_filename": path.stem.lower(),
                "size_bytes": path.stat().st_size,
                "integrity_state": "NOT EVALUATED",
                "integrity_reason": "The SHA-256 is recomputed when this product is selected for comparison.",
                "metadata_state": metadata_state,
                "metadata_reason": metadata_reason,
                "metadata": metadata,
                "archive_provenance": _archive_provenance_for_filename(path.name),
            })
    return {"count": len(items), "items": items, "database_modified": False}


@app.post("/api/v1/archive/products/retrieve")
def archive_product_retrieve(request: ArchiveRetrievalRequest, db: Session = Depends(get_db)):
    try:
        result = retrieve_fits_product(
            access_url=request.access_url,
            access_format=request.access_format,
            cache_dir=ARCHIVE_PRODUCTS_DIR,
        )
    except ArchiveError as error:
        status_code = 422 if error.quality_state == "REJECT" else 502
        raise HTTPException(status_code=status_code, detail={
            "message": str(error),
            "quality_state": error.quality_state,
        }) from error

    existing = db.scalar(select(ArchiveProduct).where(ArchiveProduct.sha256 == result["sha256"]))
    if existing is None:
        from datetime import datetime
        record = ArchiveProduct(
            sha256=result["sha256"],
            obs_publisher_did=request.obs_publisher_did,
            obs_id=request.obs_id,
            collection=request.collection,
            band=request.band,
            mjd_start=request.mjd_start,
            source_access_url=result["source_access_url"],
            resolved_access_url=result["resolved_access_url"],
            source_access_format=request.access_format,
            content_type=result["response_content_type"],
            filename=result["filename"],
            static_url=result["static_url"],
            size_bytes=result["size_bytes"],
            retrieved_at=datetime.fromisoformat(result["retrieved_at"]),
            quality_state=result["validation"]["quality_state"],
            validation_report=result["validation"],
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        existing = record

    return _archive_product_json(existing)


@app.post("/api/v1/analysis/epochs/wcs-comparison")
def compare_epoch_wcs(request: EpochWCSComparisonRequest):
    """Compare cached FITS WCS footprints; source alignment/differencing stay gated."""
    if request.image_a == request.image_b:
        raise HTTPException(status_code=422, detail="Select two different FITS products")
    paths = [ARCHIVE_PRODUCTS_DIR / request.image_a, ARCHIVE_PRODUCTS_DIR / request.image_b]
    for path in paths:
        if not path.is_file():
            raise HTTPException(status_code=404, detail=f"Cached FITS product not found: {path.name}")
    try:
        report = compare_image_wcs(paths[0], paths[1], grid_size=request.grid_size)
        for label, path in zip(("a", "b"), paths):
            if report["inputs"][label]["sha256"].lower() != path.stem.lower():
                report["quality_state"] = "REJECT"
                report["quality_reason"] = f"Cached product {path.name} failed SHA-256 filename integrity validation."
                report["inputs"][label]["integrity_state"] = "REJECT"
                report["inputs"][label]["integrity_reason"] = "Cached filename does not match the file SHA-256"
            else:
                report["inputs"][label]["integrity_state"] = "PASS"
                report["inputs"][label]["integrity_reason"] = "Cached filename matches recomputed SHA-256"
            product = None
            try:
                with Session(engine) as db:
                    product = db.scalar(select(ArchiveProduct).where(ArchiveProduct.filename == path.name))
            except Exception:
                # A missing archive-product registry is not evidence of provenance.
                product = None
            report["inputs"][label]["archive_provenance"] = (
                {
                    "obs_id": product.obs_id,
                    "collection": product.collection,
                    "release": _release_from_collection(product.collection),
                    "band": product.band,
                    "retrieved_at": _iso_utc_timestamp(product.retrieved_at),
                    "source_access_url": product.source_access_url,
                    "resolved_access_url": product.resolved_access_url,
                    "record_state": "PASS",
                    "product_quality_state": product.quality_state,
                }
                if product is not None
                else {
                    "obs_id": None,
                    "collection": None,
                    "release": None,
                    "band": None,
                    "retrieved_at": None,
                    "source_access_url": None,
                    "resolved_access_url": None,
                    "quality_state": "NOT EVALUATED",
                    "reason": "No matching archive provenance record is stored in the application database.",
                }
            )
            provenance = report["inputs"][label]["archive_provenance"]
            if not report["inputs"][label].get("obs_id"):
                report["inputs"][label]["obs_id"] = provenance.get("obs_id")
            if not report["inputs"][label].get("band"):
                report["inputs"][label]["band"] = provenance.get("band")
            report["inputs"][label]["release"] = provenance.get("release")
        report["compatibility"]["reason"] = (
            "Detector and declared BUNIT can be compared from the FITS headers, "
            "but WCS overlap alone cannot establish matching archive release, band, "
            "or calibration references."
        )
        eligibility = build_comparison_eligibility(
            report["inputs"]["a"],
            report["inputs"]["b"],
            wcs_geometry_state=report["wcs_geometry_state"],
            footprint_comparison=report["footprint_comparison"],
        )
        report["eligibility_report"] = eligibility
        report["compatibility"].update({
            "detector_match": eligibility["checks"]["detector_match"]["state"],
            "band_match": eligibility["checks"]["band_match"]["state"],
            "release_match": eligibility["checks"]["release_match"]["state"],
            "calibration_compatibility": eligibility["checks"]["calibration_compatibility"]["state"],
            "unit_compatibility": eligibility["checks"]["unit_compatibility"]["state"],
            "reason": "Pair eligibility is reported check-by-check below. WCS geometry alone never enables differencing.",
        })
        report["scientific_differencing"] = {
            "quality_state": eligibility["state"],
            "allowed": eligibility["allowed"],
            "evidence": {key: check["state"] for key, check in eligibility["checks"].items()},
            "blocked_by": eligibility["blocked_by"],
            "reasons": eligibility["reasons"],
            "reason": eligibility["reason"],
            "pixels_subtracted": False,
        }
        return report
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=422, detail=f"WCS comparison could not be evaluated: {error}") from error


# ==========================================
# HEALTH CHECK
# ==========================================

@app.get("/health")
def health():

    return {
        "status": "ok",
        "service": "spectra-api",
        "database": "configured",
    }


@app.get("/health/database")
def database_health(db: Session = Depends(get_db)):

    try:

        db.execute(select(1))

        return {
            "status": "connected",
            "database": "SPHEREx",
        }

    except Exception as error:

        raise HTTPException(
            status_code=503,
            detail=f"Database connection failed: {str(error)}",
        )


# ==========================================
# DATABASE SUMMARY
# ==========================================

@app.get("/api/v1/metadata/summary")
def metadata_summary(db: Session = Depends(get_db)):

    total = db.scalar(
        select(func.count()).select_from(Observation)
    ) or 0

    unique_ids = db.scalar(
        select(
            func.count(
                distinct(Observation.obs_id)
            )
        )
    ) or 0

    collections = db.execute(
        select(
            Observation.collection,
            func.count()
        )
        .where(Observation.collection.is_not(None))
        .group_by(Observation.collection)
        .order_by(func.count().desc())
    ).all()

    bands = db.execute(
        select(
            Observation.band,
            func.count()
        )
        .where(Observation.band.is_not(None))
        .group_by(Observation.band)
        .order_by(func.count().desc())
    ).all()

    return {

        "total_rows": total,

        "unique_obs_ids": unique_ids,

        "total_collections": len(collections),

        "total_bands": len(bands),

        "collections": [
            {
                "name": name,
                "rows": count,
            }
            for name, count in collections
        ],

        "bands": [
            {
                "name": name,
                "rows": count,
            }
            for name, count in bands
        ],
    }


# ==========================================
# OBSERVATION EXPLORER
# ==========================================

@app.get("/api/v1/observations")
def list_observations(

    collection: str | None = None,

    band: str | None = None,

    obs_id: str | None = None,

    min_mjd: float | None = None,

    max_mjd: float | None = None,

    limit: int = Query(
        default=50,
        ge=1,
        le=500,
    ),

    offset: int = Query(
        default=0,
        ge=0,
    ),

    db: Session = Depends(get_db),

):

    stmt = select(Observation)

    # Collection filter
    if collection:

        stmt = stmt.where(
            Observation.collection == collection
        )

    # Spectral band filter
    if band:

        stmt = stmt.where(
            Observation.band == band
        )

    # Observation ID filter
    if obs_id:

        stmt = stmt.where(
            Observation.obs_id == obs_id
        )

    # Date filters
    if min_mjd is not None:

        stmt = stmt.where(
            Observation.mjd_start >= min_mjd
        )

    if max_mjd is not None:

        stmt = stmt.where(
            Observation.mjd_start <= max_mjd
        )

    # Fetch records
    rows = db.scalars(

        stmt
        .order_by(
            Observation.mjd_start.desc()
        )
        .offset(offset)
        .limit(limit)

    ).all()

    # Return JSON
    return [

        {
            "id": r.id,

            "obs_id": r.obs_id,

            "collection": r.collection,

            "band": r.band,

            "ra_deg": r.ra_deg,

            "dec_deg": r.dec_deg,

            "mjd_start": r.mjd_start,

            "mjd_end": r.mjd_end,

            "exposure_seconds": r.exposure_seconds,

            "calibration_status": r.calibration_status,

            "access_url": r.access_url,

        }

        for r in rows

    ]


def search_catalog_rows(
    db: Session,
    *,
    q: str | None = None,
    collection: str | None = None,
    band: str | None = None,
    ra_min: float | None = None,
    ra_max: float | None = None,
    dec_min: float | None = None,
    dec_max: float | None = None,
    min_mjd: float | None = None,
    max_mjd: float | None = None,
    ra_deg: float | None = None,
    dec_deg: float | None = None,
    fov_deg: float | None = None,
    page: int = 1,
    page_size: int = 50,
):
    """Search the full local catalog; FOV is a full diameter in degrees."""
    if (ra_deg is None) != (dec_deg is None):
        raise HTTPException(status_code=422, detail="ra_deg and dec_deg must be supplied together")
    if fov_deg is not None and ra_deg is None:
        raise HTTPException(status_code=422, detail="ra_deg and dec_deg are required with fov_deg")
    if fov_deg is not None and not (0 < fov_deg <= 360):
        raise HTTPException(status_code=422, detail="fov_deg is the full cone diameter and must be in (0, 360]")
    if ra_deg is not None and not (0 <= ra_deg < 360):
        raise HTTPException(status_code=422, detail="ra_deg must be in [0, 360)")
    if dec_deg is not None and not (-90 <= dec_deg <= 90):
        raise HTTPException(status_code=422, detail="dec_deg must be in [-90, 90]")
    if ra_min is not None and not (0 <= ra_min < 360) or ra_max is not None and not (0 <= ra_max < 360):
        raise HTTPException(status_code=422, detail="RA bounds must be in [0, 360)")
    if dec_min is not None and not (-90 <= dec_min <= 90) or dec_max is not None and not (-90 <= dec_max <= 90):
        raise HTTPException(status_code=422, detail="Declination bounds must be in [-90, 90]")
    if dec_min is not None and dec_max is not None and dec_min > dec_max:
        raise HTTPException(status_code=422, detail="dec_min must not exceed dec_max")
    if min_mjd is not None and max_mjd is not None and min_mjd > max_mjd:
        raise HTTPException(status_code=422, detail="min_mjd must not exceed max_mjd")
    if page < 1 or page_size < 1 or page_size > 200:
        raise HTTPException(status_code=422, detail="page must be >= 1 and page_size must be in [1, 200]")

    stmt = select(Observation)
    count_stmt = select(func.count()).select_from(Observation)
    filters = []
    if q:
        term = q.strip()[:100]
        if term:
            escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{escaped}%"
            filters.append(or_(
                Observation.obs_id.ilike(pattern, escape="\\"),
                Observation.collection.ilike(pattern, escape="\\"),
                Observation.band.ilike(pattern, escape="\\"),
                Observation.calibration_status.ilike(pattern, escape="\\"),
            ))
    if collection:
        filters.append(Observation.collection == collection)
    if band:
        filters.append(Observation.band == band)
    if ra_min is not None and ra_max is not None and ra_min > ra_max:
        filters.append(or_(Observation.ra_deg >= ra_min, Observation.ra_deg <= ra_max))
    else:
        if ra_min is not None:
            filters.append(Observation.ra_deg >= ra_min)
        if ra_max is not None:
            filters.append(Observation.ra_deg <= ra_max)
    if dec_min is not None:
        filters.append(Observation.dec_deg >= dec_min)
    if dec_max is not None:
        filters.append(Observation.dec_deg <= dec_max)
    if min_mjd is not None:
        filters.append(Observation.mjd_start >= min_mjd)
    if max_mjd is not None:
        filters.append(Observation.mjd_start <= max_mjd)

    cone_radius = None
    if fov_deg is not None and ra_deg is not None and dec_deg is not None:
        import math
        # Dot-product threshold gives an exact spherical cone test without a
        # flat-sky RA approximation and naturally handles RA wraparound.
        dot_product = (
            func.sin(func.radians(Observation.dec_deg)) * math.sin(math.radians(dec_deg))
            + func.cos(func.radians(Observation.dec_deg))
            * math.cos(math.radians(dec_deg))
            * func.cos(func.radians(Observation.ra_deg - ra_deg))
        )
        cone_radius = fov_deg / 2.0
        filters.append(dot_product >= math.cos(math.radians(cone_radius)) - 1e-12)

    if filters:
        stmt = stmt.where(*filters)
        count_stmt = count_stmt.where(*filters)

    total = int(db.scalar(count_stmt) or 0)
    rows = db.scalars(
        stmt.order_by(Observation.mjd_start.desc(), Observation.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "items": [
            {
                "id": row.id,
                "obs_id": row.obs_id,
                "collection": row.collection,
                "band": row.band,
                "ra_deg": row.ra_deg,
                "dec_deg": row.dec_deg,
                "mjd_start": row.mjd_start,
                "mjd_end": row.mjd_end,
                "exposure_seconds": row.exposure_seconds,
                "calibration_status": row.calibration_status,
                "access_url": row.access_url,
            }
            for row in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
        "fov_semantics": "fov_deg is the full angular diameter; cone radius is fov_deg / 2",
        "cone_radius_deg": cone_radius,
    }


@app.get("/api/v1/catalog/search")
def catalog_search(
    q: str | None = Query(default=None, max_length=100),
    collection: str | None = None,
    band: str | None = None,
    ra_min: float | None = None,
    ra_max: float | None = None,
    dec_min: float | None = None,
    dec_max: float | None = None,
    min_mjd: float | None = None,
    max_mjd: float | None = None,
    ra_deg: float | None = None,
    dec_deg: float | None = None,
    fov_deg: float | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    return search_catalog_rows(
        db, q=q, collection=collection, band=band,
        ra_min=ra_min, ra_max=ra_max, dec_min=dec_min, dec_max=dec_max,
        min_mjd=min_mjd, max_mjd=max_mjd, ra_deg=ra_deg, dec_deg=dec_deg,
        fov_deg=fov_deg, page=page, page_size=page_size,
    )


# ==========================================
# SCIENTIFIC IMAGE EXPLORER
# ==========================================

@app.get("/api/v1/images")
def list_scientific_images():

    supported_formats = {
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".fits",
        ".fit",
    }

    images = []

    for file in sorted(IMAGES_DIR.iterdir()):

        if not file.is_file():
            continue

        if file.suffix.lower() not in supported_formats:
            continue

        images.append({

            "name": file.name,

            "format": file.suffix.lower(),

            "size_bytes": file.stat().st_size,

            "url": f"/static/images/{file.name}",

        })

    return {

        "total": len(images),

        "images": images,

    }


# ==========================================
# SINGLE OBSERVATION DETAILS
# ==========================================

@app.get("/api/v1/observations/{observation_id}")
def observation_details(

    observation_id: int,

    db: Session = Depends(get_db),

):

    observation = db.get(
        Observation,
        observation_id,
    )

    if observation is None:

        raise HTTPException(
            status_code=404,
            detail="Observation not found",
        )

    return {

        "id": observation.id,

        "obs_id": observation.obs_id,

        "collection": observation.collection,

        "band": observation.band,

        "ra_deg": observation.ra_deg,

        "dec_deg": observation.dec_deg,

        "mjd_start": observation.mjd_start,

        "mjd_end": observation.mjd_end,

        "exposure_seconds": observation.exposure_seconds,

        "calibration_level": observation.calibration_level,

        "calibration_status": observation.calibration_status,

        "spatial_resolution_arcsec": observation.spatial_resolution_arcsec,

        "image_width": observation.image_width,

        "image_height": observation.image_height,

        "access_url": observation.access_url,

        "access_format": observation.access_format,

        "raw_metadata": observation.raw_metadata,

    }

# ==========================================
# SPHEREx SCIENTIFIC FITS ANALYSIS ENGINE
# ==========================================

def array_statistics(data):
    """Calculate safe statistics for a scientific FITS array."""

    if data is None:
        return None

    array = np.asarray(data)
    valid = np.isfinite(array)

    if not np.any(valid):
        return {
            "shape": list(array.shape),
            "valid_pixels": 0,
            "min": None,
            "max": None,
            "mean": None,
            "std": None,
        }

    values = array[valid]

    return {
        "shape": list(array.shape),
        "valid_pixels": int(valid.sum()),
        "min": float(np.min(values)),
        "max": float(np.max(values)),
        "mean": float(np.mean(values)),
        "std": float(np.std(values)),
    }


@app.get("/api/v1/analysis/fits/{image_name}")
def analyze_fits_image(image_name: str):
    _guard_low_memory_analysis("Full-image FITS summary")

    # Only allow FITS files from the scientific images folder.
    if Path(image_name).name != image_name:
        raise HTTPException(
            status_code=400,
            detail="Invalid image filename",
        )

    if Path(image_name).suffix.lower() not in {".fits", ".fit"}:
        raise HTTPException(
            status_code=400,
            detail="Only FITS files are supported",
        )

    fits_path = IMAGES_DIR / image_name

    if not fits_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="FITS file not found",
        )

    try:
        integrity_report = validate_fits_product(fits_path)
        with fits.open(
            fits_path,
            memmap=True,
            mode="readonly",
        ) as hdul:

            # Main scientific image
            if "IMAGE" not in hdul:
                raise HTTPException(
                    status_code=422,
                    detail="Scientific IMAGE extension not found",
                )

            science_hdu = hdul["IMAGE"]
            science_data = science_hdu.data

            if science_data is None or science_data.ndim != 2:
                raise HTTPException(
                    status_code=422,
                    detail="Invalid scientific image dimensions",
                )

            # Main image statistics
            science_stats = array_statistics(science_data)

            # Variance statistics
            variance_stats = None

            if "VARIANCE" in hdul:
                variance_stats = array_statistics(
                    hdul["VARIANCE"].data
                )

            # FLAGS information.
            # Values are reported without assuming their meanings.
            flags_summary = None

            if "FLAGS" in hdul and hdul["FLAGS"].data is not None:

                flags_data = np.asarray(hdul["FLAGS"].data)

                unique_values, counts = np.unique(
                    flags_data,
                    return_counts=True,
                )

                order = np.argsort(counts)[::-1][:20]

                flags_summary = {
                    "shape": list(flags_data.shape),
                    "unique_values_count": int(len(unique_values)),
                    "most_common_values": [
                        {
                            "value": int(unique_values[i]),
                            "count": int(counts[i]),
                        }
                        for i in order
                    ],
                }

            # WCS coordinate information
            wcs_summary = None

            try:
                wcs = WCS(science_hdu.header)

                if wcs.has_celestial:

                    height, width = science_data.shape

                    positions = {
                        "center": (
                            (width - 1) / 2,
                            (height - 1) / 2,
                        ),
                        "top_left": (0, 0),
                        "top_right": (width - 1, 0),
                        "bottom_left": (0, height - 1),
                        "bottom_right": (
                            width - 1,
                            height - 1,
                        ),
                    }

                    coordinates = {}

                    for name, (x, y) in positions.items():

                        sky = wcs.pixel_to_world(x, y)

                        coordinates[name] = {
                            "ra_deg": float(sky.ra.deg),
                            "dec_deg": float(sky.dec.deg),
                        }

                    wcs_summary = {
                        "coordinate_system": "ICRS",
                        "pixel_to_sky": coordinates,
                    }

            except Exception:
                wcs_summary = {
                    "available": False,
                    "message": "Could not calculate celestial coordinates",
                }

            # Scientific metadata
            header = science_hdu.header

            metadata = {
                "image_name": image_name,
                "width": int(science_data.shape[1]),
                "height": int(science_data.shape[0]),
                "unit": header.get("BUNIT"),
                "variance_unit": hdul["VARIANCE"].header.get("BUNIT") if "VARIANCE" in hdul else None,
                "flags_unit": hdul["FLAGS"].header.get("BUNIT") if "FLAGS" in hdul else None,
                "date_obs": header.get("DATE-OBS"),
                "mjd_obs": (
                    float(header["MJD-OBS"])
                    if header.get("MJD-OBS") is not None
                    else None
                ),
                "telescope": header.get("TELESCOP"),
                "instrument": header.get("INSTRUME"),
                "fits_hdu_count": len(hdul),
                "integrity_quality_state": integrity_report["quality_state"],
                "scientific_quality_state": "NOT EVALUATED",
            }

            return {
                "status": "success",
                "metadata": metadata,
                "integrity": integrity_report,
                "science_image": science_stats,
                "variance": variance_stats,
                "flags": flags_summary,
                "wcs": wcs_summary,
                "scientific_note": (
                    "FLAG values are reported without interpretation. "
                    "Scientific quality masks require the official "
                    "SPHEREx flag definitions. FITS structure/checksums are "
                    "reported separately from scientific calibration, WCS "
                    "alignment, PSF/ePSF validation, and quality assessment; "
                    "those remain NOT EVALUATED here. Extension names, values, "
                    "headers, and units are reported without renaming or "
                    "scientific interpretation."
                ),
            }

    except ArchiveError as error:
        raise HTTPException(
            status_code=422,
            detail={"message": str(error), "quality_state": error.quality_state},
        ) from error

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"FITS analysis failed: {str(error)}",
        )


# ==========================================
# INTERACTIVE SCIENTIFIC PIXEL INSPECTION
# ==========================================

@app.get("/api/v1/analysis/pixel/{image_name}")
def inspect_fits_pixel(
    image_name: str,
    x: int = Query(..., ge=0),
    y: int = Query(..., ge=0),
):
    """Return measured FITS values and sky coordinates for one image pixel."""

    if Path(image_name).name != image_name:
        raise HTTPException(status_code=400, detail="Invalid image filename")

    if Path(image_name).suffix.lower() not in {".fits", ".fit"}:
        raise HTTPException(status_code=400, detail="Only FITS files are supported")

    fits_path = IMAGES_DIR / image_name
    if not fits_path.is_file():
        raise HTTPException(status_code=404, detail="FITS file not found")

    try:
        with fits.open(fits_path, memmap=True, mode="readonly") as hdul:
            if "IMAGE" not in hdul or hdul["IMAGE"].data is None:
                raise HTTPException(status_code=422, detail="Scientific IMAGE extension not found")

            science_hdu = hdul["IMAGE"]
            science = science_hdu.data
            if science.ndim != 2:
                raise HTTPException(status_code=422, detail="Scientific image must be two-dimensional")

            height, width = science.shape
            if x >= width or y >= height:
                raise HTTPException(
                    status_code=422,
                    detail=f"Pixel is outside the image. Valid x: 0-{width - 1}, y: 0-{height - 1}",
                )

            raw_value = float(science[y, x])
            pixel_value = raw_value if np.isfinite(raw_value) else None

            variance_value = None
            if "VARIANCE" in hdul and hdul["VARIANCE"].data is not None:
                variance = hdul["VARIANCE"].data
                if variance.ndim == 2 and y < variance.shape[0] and x < variance.shape[1]:
                    candidate = float(variance[y, x])
                    variance_value = candidate if np.isfinite(candidate) else None

            flag_value = None
            if "FLAGS" in hdul and hdul["FLAGS"].data is not None:
                flags = hdul["FLAGS"].data
                if flags.ndim == 2 and y < flags.shape[0] and x < flags.shape[1]:
                    flag_value = int(flags[y, x])

            sky_coordinates = None
            try:
                wcs = WCS(science_hdu.header)
                if wcs.has_celestial:
                    sky = wcs.pixel_to_world(x, y)
                    sky_coordinates = {
                        "ra_deg": float(sky.ra.deg),
                        "dec_deg": float(sky.dec.deg),
                        "coordinate_system": "ICRS",
                    }
            except Exception:
                sky_coordinates = None

            return {
                "status": "success",
                "image_name": image_name,
                "pixel": {"x": x, "y": y},
                "science_value": pixel_value,
                "unit": science_hdu.header.get("BUNIT"),
                "variance_value": variance_value,
                "flag_value": flag_value,
                "sky_coordinates": sky_coordinates,
                "note": (
                    "FLAG value is reported as stored. Its scientific meaning "
                    "requires the official SPHEREx flag definitions."
                ),
            }

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Pixel inspection failed: {str(error)}")


# ==========================================
# REGION OF INTEREST (ROI) SCIENTIFIC ANALYSIS
# ==========================================

@app.get("/api/v1/analysis/roi/{image_name}")
def analyze_fits_region(
    image_name: str,
    x1: int = Query(..., ge=0),
    y1: int = Query(..., ge=0),
    x2: int = Query(..., ge=1),
    y2: int = Query(..., ge=1),
    bins: int = Query(default=12, ge=4, le=40),
):
    """Analyze a rectangular region using the original FITS science array.

    x2 and y2 are exclusive bounds, matching normal Python array slicing.
    """
    if Path(image_name).name != image_name:
        raise HTTPException(status_code=400, detail="Invalid image filename")
    if Path(image_name).suffix.lower() not in {".fits", ".fit"}:
        raise HTTPException(status_code=400, detail="Only FITS files are supported")
    if x2 <= x1 or y2 <= y1:
        raise HTTPException(status_code=422, detail="x2 must be greater than x1 and y2 greater than y1")

    fits_path = IMAGES_DIR / image_name
    if not fits_path.is_file():
        raise HTTPException(status_code=404, detail="FITS file not found")

    try:
        with fits.open(fits_path, memmap=True, mode="readonly") as hdul:
            if "IMAGE" not in hdul or hdul["IMAGE"].data is None:
                raise HTTPException(status_code=422, detail="Scientific IMAGE extension not found")

            science_hdu = hdul["IMAGE"]
            science = science_hdu.data
            if science.ndim != 2:
                raise HTTPException(status_code=422, detail="Scientific image must be two-dimensional")

            height, width = science.shape
            if x2 > width or y2 > height:
                raise HTTPException(
                    status_code=422,
                    detail=f"Region is outside the image. x2 must be <= {width}, y2 must be <= {height}",
                )

            region = np.asarray(science[y1:y2, x1:x2], dtype=np.float64)
            valid_mask = np.isfinite(region)
            valid_values = region[valid_mask]
            if valid_values.size == 0:
                raise HTTPException(status_code=422, detail="Selected region contains no finite science pixels")

            histogram_counts, histogram_edges = np.histogram(valid_values, bins=bins)
            histogram = [
                {
                    "bin_start": float(histogram_edges[index]),
                    "bin_end": float(histogram_edges[index + 1]),
                    "count": int(histogram_counts[index]),
                }
                for index in range(len(histogram_counts))
            ]

            variance_result = None
            if "VARIANCE" in hdul and hdul["VARIANCE"].data is not None:
                variance_data = hdul["VARIANCE"].data
                if variance_data.ndim == 2 and y2 <= variance_data.shape[0] and x2 <= variance_data.shape[1]:
                    variance_result = array_statistics(variance_data[y1:y2, x1:x2])

            flag_result = None
            if "FLAGS" in hdul and hdul["FLAGS"].data is not None:
                flags_data = np.asarray(hdul["FLAGS"].data[y1:y2, x1:x2])
                unique_flags, flag_counts = np.unique(flags_data, return_counts=True)
                order = np.argsort(flag_counts)[::-1][:10]
                flag_result = {
                    "unique_values_count": int(len(unique_flags)),
                    "most_common_values": [
                        {"value": int(unique_flags[index]), "count": int(flag_counts[index])}
                        for index in order
                    ],
                }

            center_x = (x1 + x2 - 1) / 2
            center_y = (y1 + y2 - 1) / 2
            sky_center = None
            try:
                wcs = WCS(science_hdu.header)
                if wcs.has_celestial:
                    sky = wcs.pixel_to_world(center_x, center_y)
                    sky_center = {
                        "ra_deg": float(sky.ra.deg),
                        "dec_deg": float(sky.dec.deg),
                        "coordinate_system": "ICRS",
                    }
            except Exception:
                sky_center = None

            return {
                "status": "success",
                "image_name": image_name,
                "region": {
                    "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                    "width": x2 - x1, "height": y2 - y1,
                    "total_pixels": int(region.size),
                    "valid_pixels": int(valid_values.size),
                    "invalid_pixels": int(region.size - valid_values.size),
                },
                "science_statistics": {
                    "min": float(np.min(valid_values)),
                    "max": float(np.max(valid_values)),
                    "mean": float(np.mean(valid_values)),
                    "median": float(np.median(valid_values)),
                    "std": float(np.std(valid_values)),
                },
                "unit": science_hdu.header.get("BUNIT"),
                "histogram": histogram,
                "variance": variance_result,
                "flags": flag_result,
                "sky_center": sky_center,
                "note": (
                    "Statistics and histogram are calculated from finite values "
                    "in the selected region of the original FITS science image. "
                    "Stored FLAGS values are reported without assigning meanings."
                ),
            }

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"ROI analysis failed: {str(error)}")


# ==========================================
# COMPARE TWO SCIENTIFIC REGIONS (ROI A vs B)
# ==========================================

@app.get("/api/v1/analysis/compare-regions/{image_name}")
def compare_fits_regions(
    image_name: str,
    ax1: int = Query(..., ge=0),
    ay1: int = Query(..., ge=0),
    ax2: int = Query(..., ge=1),
    ay2: int = Query(..., ge=1),
    bx1: int = Query(..., ge=0),
    by1: int = Query(..., ge=0),
    bx2: int = Query(..., ge=1),
    by2: int = Query(..., ge=1),
    bins: int = Query(default=12, ge=4, le=40),
):
    """Compare two rectangular regions using the original FITS science array.

    x2/y2 bounds are exclusive, matching normal Python array slicing.
    Differences are reported as Region B minus Region A.
    """
    if Path(image_name).name != image_name:
        raise HTTPException(status_code=400, detail="Invalid image filename")
    if Path(image_name).suffix.lower() not in {".fits", ".fit"}:
        raise HTTPException(status_code=400, detail="Only FITS files are supported")

    regions = {
        "A": (ax1, ay1, ax2, ay2),
        "B": (bx1, by1, bx2, by2),
    }
    for label, (x1, y1, x2, y2) in regions.items():
        if x2 <= x1 or y2 <= y1:
            raise HTTPException(
                status_code=422,
                detail=f"Region {label}: x2 must exceed x1 and y2 must exceed y1",
            )

    fits_path = IMAGES_DIR / image_name
    if not fits_path.is_file():
        raise HTTPException(status_code=404, detail="FITS file not found")

    try:
        with fits.open(fits_path, memmap=True, mode="readonly") as hdul:
            if "IMAGE" not in hdul or hdul["IMAGE"].data is None:
                raise HTTPException(status_code=422, detail="Scientific IMAGE extension not found")

            science_hdu = hdul["IMAGE"]
            science = science_hdu.data
            if science.ndim != 2:
                raise HTTPException(status_code=422, detail="Scientific image must be two-dimensional")

            height, width = science.shape
            values_by_region = {}
            result_by_region = {}

            for label, (x1, y1, x2, y2) in regions.items():
                if x2 > width or y2 > height:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Region {label} is outside the image. x2 must be <= {width}, y2 must be <= {height}",
                    )

                section = np.asarray(science[y1:y2, x1:x2], dtype=np.float64)
                valid_values = section[np.isfinite(section)]
                if valid_values.size == 0:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Region {label} contains no finite science pixels",
                    )

                values_by_region[label] = valid_values
                result_by_region[label] = {
                    "bounds": {
                        "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                        "width": x2 - x1, "height": y2 - y1,
                        "total_pixels": int(section.size),
                        "valid_pixels": int(valid_values.size),
                        "invalid_pixels": int(section.size - valid_values.size),
                    },
                    "statistics": {
                        "min": float(np.min(valid_values)),
                        "max": float(np.max(valid_values)),
                        "mean": float(np.mean(valid_values)),
                        "median": float(np.median(valid_values)),
                        "std": float(np.std(valid_values)),
                    },
                }

                variance_mean = None
                if "VARIANCE" in hdul and hdul["VARIANCE"].data is not None:
                    variance_data = hdul["VARIANCE"].data
                    if variance_data.ndim == 2 and y2 <= variance_data.shape[0] and x2 <= variance_data.shape[1]:
                        variance_section = np.asarray(variance_data[y1:y2, x1:x2], dtype=np.float64)
                        variance_valid = variance_section[np.isfinite(variance_section)]
                        if variance_valid.size:
                            variance_mean = float(np.mean(variance_valid))
                result_by_region[label]["mean_variance"] = variance_mean

            # Shared histogram edges make the two distributions directly comparable.
            combined = np.concatenate([values_by_region["A"], values_by_region["B"]])
            if float(np.min(combined)) == float(np.max(combined)):
                padding = max(abs(float(combined[0])) * 1e-9, 1e-12)
                histogram_edges = np.linspace(float(combined[0]) - padding, float(combined[0]) + padding, bins + 1)
            else:
                histogram_edges = np.linspace(float(np.min(combined)), float(np.max(combined)), bins + 1)

            for label in ("A", "B"):
                counts, _ = np.histogram(values_by_region[label], bins=histogram_edges)
                result_by_region[label]["histogram"] = [
                    {
                        "bin_start": float(histogram_edges[i]),
                        "bin_end": float(histogram_edges[i + 1]),
                        "count": int(counts[i]),
                    }
                    for i in range(len(counts))
                ]

            mean_a = result_by_region["A"]["statistics"]["mean"]
            mean_b = result_by_region["B"]["statistics"]["mean"]
            median_a = result_by_region["A"]["statistics"]["median"]
            median_b = result_by_region["B"]["statistics"]["median"]
            std_a = result_by_region["A"]["statistics"]["std"]
            std_b = result_by_region["B"]["statistics"]["std"]

            mean_difference = mean_b - mean_a
            relative_difference_percent = (
                (mean_difference / abs(mean_a)) * 100.0 if mean_a != 0 else None
            )

            return {
                "status": "success",
                "image_name": image_name,
                "unit": science_hdu.header.get("BUNIT"),
                "regions": result_by_region,
                "comparison": {
                    "difference_direction": "B - A",
                    "mean_difference": float(mean_difference),
                    "mean_relative_difference_percent": (
                        float(relative_difference_percent)
                        if relative_difference_percent is not None else None
                    ),
                    "median_difference": float(median_b - median_a),
                    "std_difference": float(std_b - std_a),
                    "mean_variance_difference": (
                        float(result_by_region["B"]["mean_variance"] - result_by_region["A"]["mean_variance"])
                        if result_by_region["A"]["mean_variance"] is not None
                        and result_by_region["B"]["mean_variance"] is not None
                        else None
                    ),
                },
                "histogram_note": "Both regions use the same bin edges for a direct distribution comparison.",
                "scientific_note": (
                    "Statistics use finite values from the original FITS IMAGE extension. "
                    "Differences are calculated as Region B minus Region A. "
                    "No scientific interpretation is assigned to stored FLAGS values."
                ),
            }

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Region comparison failed: {str(error)}")


# ==========================================
# ML ENGINE: UNSUPERVISED SCIENTIFIC ANOMALY DETECTION
# ==========================================

@app.get("/api/v1/ai/anomaly/{image_name}")
def detect_fits_anomalies(
    image_name: str,
    tile_size: int = Query(default=64, ge=16, le=512),
    contamination: float = Query(default=0.03, gt=0.0, le=0.25),
    max_results: int = Query(default=30, ge=1, le=100),
):
    """Find statistically unusual image tiles with an unsupervised Isolation Forest.

    This identifies unusual measured patterns; it does not classify astronomical
    source types or establish a physical cause.
    """
    _guard_low_memory_analysis("FITS anomaly analysis")
    if Path(image_name).name != image_name:
        raise HTTPException(status_code=400, detail="Invalid image filename")
    if Path(image_name).suffix.lower() not in {".fits", ".fit"}:
        raise HTTPException(status_code=400, detail="Only FITS files are supported")

    fits_path = IMAGES_DIR / image_name
    if not fits_path.is_file():
        raise HTTPException(status_code=404, detail="FITS file not found")

    try:
        from sklearn.ensemble import IsolationForest
        from sklearn.preprocessing import RobustScaler
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Machine-learning dependency missing. Install it with: python -m pip install scikit-learn",
        )

    try:
        with fits.open(fits_path, memmap=True, mode="readonly") as hdul:
            if "IMAGE" not in hdul or hdul["IMAGE"].data is None:
                raise HTTPException(status_code=422, detail="Scientific IMAGE extension not found")

            science_hdu = hdul["IMAGE"]
            science = np.asarray(science_hdu.data, dtype=np.float64)
            if science.ndim != 2:
                raise HTTPException(status_code=422, detail="Scientific IMAGE must be two-dimensional")

            height, width = science.shape
            variance = None
            if "VARIANCE" in hdul and hdul["VARIANCE"].data is not None:
                candidate = np.asarray(hdul["VARIANCE"].data, dtype=np.float64)
                if candidate.ndim == 2 and candidate.shape == science.shape:
                    variance = candidate

            feature_names = [
                "mean_intensity",
                "median_intensity",
                "std_intensity",
                "p10_intensity",
                "p90_intensity",
                "valid_fraction",
            ]
            if variance is not None:
                feature_names.append("mean_variance")

            feature_rows = []
            tile_rows = []

            for y1 in range(0, height, tile_size):
                y2 = min(y1 + tile_size, height)
                for x1 in range(0, width, tile_size):
                    x2 = min(x1 + tile_size, width)
                    tile = science[y1:y2, x1:x2]
                    valid = tile[np.isfinite(tile)]
                    total = int(tile.size)

                    # Skip tiles with too few finite science measurements.
                    if valid.size < max(8, int(total * 0.10)):
                        continue

                    features = [
                        float(np.mean(valid)),
                        float(np.median(valid)),
                        float(np.std(valid)),
                        float(np.percentile(valid, 10)),
                        float(np.percentile(valid, 90)),
                        float(valid.size / total),
                    ]

                    if variance is not None:
                        variance_tile = variance[y1:y2, x1:x2]
                        variance_valid = variance_tile[np.isfinite(variance_tile)]
                        features.append(
                            float(np.mean(variance_valid)) if variance_valid.size else 0.0
                        )

                    if not np.all(np.isfinite(features)):
                        continue

                    feature_rows.append(features)
                    tile_rows.append({
                        "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                        "width": x2 - x1, "height": y2 - y1,
                        "valid_pixels": int(valid.size), "total_pixels": total,
                    })

            if len(feature_rows) < 10:
                raise HTTPException(
                    status_code=422,
                    detail="Not enough valid image tiles for anomaly detection. Try a smaller tile_size.",
                )

            matrix = np.asarray(feature_rows, dtype=np.float64)
            scaler = RobustScaler()
            scaled = scaler.fit_transform(matrix)

            model = IsolationForest(
                n_estimators=200,
                contamination=contamination,
                random_state=42,
                n_jobs=-1,
            )
            labels = model.fit_predict(scaled)
            raw_scores = model.decision_function(scaled)
            anomaly_scores = -raw_scores

            # Robust, descriptive feature deviations for transparent explanations.
            medians = np.median(matrix, axis=0)
            q25 = np.percentile(matrix, 25, axis=0)
            q75 = np.percentile(matrix, 75, axis=0)
            spreads = q75 - q25
            spreads[spreads == 0] = np.maximum(np.abs(medians[spreads == 0]) * 1e-9, 1e-12)

            records = []
            for index, tile_info in enumerate(tile_rows):
                deviations = (matrix[index] - medians) / spreads
                strongest = np.argsort(np.abs(deviations))[::-1][:3]
                explanation = []
                for feature_index in strongest:
                    direction = "above" if deviations[feature_index] > 0 else "below"
                    explanation.append({
                        "feature": feature_names[int(feature_index)],
                        "direction": direction,
                        "robust_deviation": float(deviations[feature_index]),
                    })

                records.append({
                    **tile_info,
                    "classification": "anomalous" if int(labels[index]) == -1 else "typical",
                    "anomaly_score": float(anomaly_scores[index]),
                    "explanation": explanation,
                })

            records.sort(key=lambda item: item["anomaly_score"], reverse=True)
            anomaly_count = int(np.sum(labels == -1))
            top_records = records[:max_results]

            return {
                "status": "success",
                "image_name": image_name,
                "model": "IsolationForest",
                "learning_type": "unsupervised",
                "tile_size": tile_size,
                "contamination_setting": contamination,
                "total_tiles_analyzed": int(len(tile_rows)),
                "anomalous_tiles_detected": anomaly_count,
                "typical_tiles_detected": int(len(tile_rows) - anomaly_count),
                "unit": science_hdu.header.get("BUNIT"),
                "features_used": feature_names,
                "anomalies": top_records,
                "score_note": (
                    "Higher anomaly_score means the model considers a tile more unusual "
                    "relative to the other analyzed tiles. It is not a probability."
                ),
                "explanation_note": (
                    "Feature deviations are descriptive comparisons with the image-wide "
                    "median and interquartile range. They are not causal explanations."
                ),
                "scientific_limitations": (
                    "This model detects unusual image-tile statistics only. It does not "
                    "identify galaxies, stars, or other source classes, and it does not "
                    "establish astrophysical causes or statistical significance. "
                    "Stored FLAGS values are not interpreted."
                ),
            }

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"ML anomaly detection failed: {str(error)}")


# ==========================================
# ML ENGINE: OBSERVATION PROFILE CLUSTERING
# ==========================================

@app.get("/api/v1/ai/observation-clusters")
def cluster_observation_profiles(
    clusters: int = Query(default=4, ge=2, le=8),
    max_records: int = Query(default=10000, ge=100, le=20000),
    db: Session = Depends(get_db),
):
    """Group observations by available numeric metadata using K-Means.

    These are exploratory metadata clusters, not astrophysical source classes.
    """
    _guard_low_memory_analysis("Observation clustering")
    try:
        from sklearn.cluster import KMeans
        from sklearn.preprocessing import StandardScaler
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Machine-learning dependency missing. Install it with: python -m pip install scikit-learn",
        )

    try:
        stmt = (
            select(Observation)
            .where(
                Observation.ra_deg.is_not(None),
                Observation.dec_deg.is_not(None),
                Observation.mjd_start.is_not(None),
                Observation.exposure_seconds.is_not(None),
            )
            .order_by(Observation.id)
            .limit(max_records)
        )
        observations = db.scalars(stmt).all()

        feature_rows = []
        usable_records = []

        for item in observations:
            try:
                ra = float(item.ra_deg)
                dec = float(item.dec_deg)
                mjd = float(item.mjd_start)
                exposure = float(item.exposure_seconds)
            except (TypeError, ValueError):
                continue

            if not all(np.isfinite(value) for value in (ra, dec, mjd, exposure)):
                continue
            if exposure < 0 or not -90 <= dec <= 90:
                continue

            ra_radians = np.deg2rad(ra % 360.0)
            feature_rows.append([
                np.sin(ra_radians),
                np.cos(ra_radians),
                dec,
                mjd,
                np.log1p(exposure),
            ])
            usable_records.append(item)

        if len(feature_rows) < clusters:
            raise HTTPException(
                status_code=422,
                detail=f"Not enough complete observations. Need at least {clusters}; found {len(feature_rows)}.",
            )

        matrix = np.asarray(feature_rows, dtype=np.float64)
        scaler = StandardScaler()
        scaled = scaler.fit_transform(matrix)

        model = KMeans(
            n_clusters=clusters,
            random_state=42,
            n_init=10,
        )
        labels = model.fit_predict(scaled)

        cluster_summaries = []
        for cluster_id in range(clusters):
            indexes = np.flatnonzero(labels == cluster_id)
            members = [usable_records[int(index)] for index in indexes]

            ras = np.asarray([float(item.ra_deg) for item in members], dtype=float)
            decs = np.asarray([float(item.dec_deg) for item in members], dtype=float)
            mjds = np.asarray([float(item.mjd_start) for item in members], dtype=float)
            exposures = np.asarray([float(item.exposure_seconds) for item in members], dtype=float)

            band_counts = {}
            collection_counts = {}
            for item in members:
                if item.band:
                    band_counts[str(item.band)] = band_counts.get(str(item.band), 0) + 1
                if item.collection:
                    collection_counts[str(item.collection)] = collection_counts.get(str(item.collection), 0) + 1

            cluster_summaries.append({
                "cluster_id": cluster_id,
                "observation_count": int(len(indexes)),
                "median_ra_deg": float(np.median(ras)),
                "median_dec_deg": float(np.median(decs)),
                "median_mjd_start": float(np.median(mjds)),
                "median_exposure_seconds": float(np.median(exposures)),
                "band_distribution": band_counts,
                "collection_distribution": collection_counts,
            })

        # Return a bounded sample so the API response stays lightweight.
        assignments = [
            {
                "id": int(item.id),
                "obs_id": item.obs_id,
                "cluster_id": int(labels[index]),
                "band": item.band,
                "collection": item.collection,
                "ra_deg": float(item.ra_deg),
                "dec_deg": float(item.dec_deg),
                "mjd_start": float(item.mjd_start),
                "exposure_seconds": float(item.exposure_seconds),
            }
            for index, item in enumerate(usable_records[:250])
        ]

        return {
            "status": "success",
            "model": "KMeans",
            "learning_type": "unsupervised",
            "cluster_count": clusters,
            "records_requested_limit": max_records,
            "records_loaded": int(len(observations)),
            "records_used": int(len(usable_records)),
            "features_used": [
                "sin(RA)", "cos(RA)", "Dec", "MJD start", "log1p(exposure seconds)"
            ],
            "inertia": float(model.inertia_),
            "clusters": cluster_summaries,
            "sample_assignments": assignments,
            "interpretation_note": (
                "Cluster IDs are arbitrary groups based on the selected observation metadata. "
                "They are not labels for galaxies, stars, or other astrophysical object classes."
            ),
            "limitations": (
                "This exploratory grouping uses sky coordinates, observation time, and exposure "
                "duration. It does not use calibrated spectra or verified astrophysical labels, "
                "and it should not be interpreted as a scientific source classification."
            ),
        }

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Observation clustering failed: {str(error)}",
        )
