from sqlalchemy import (
    Float,
    Integer,
    String,
    Text,
    JSON,
    Index,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import DateTime
from datetime import datetime

from .db import Base


class Observation(Base):

    __tablename__ = "observations"

    # Primary key
    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    # SPHEREx observation identification
    obs_id: Mapped[str] = mapped_column(
        String(100),
        index=True,
    )

    # Collection information
    collection: Mapped[str | None] = mapped_column(
        String(80),
        index=True,
    )

    # Spectral band
    band: Mapped[str | None] = mapped_column(
        String(30),
        index=True,
    )

    # Sky coordinates
    ra_deg: Mapped[float | None] = mapped_column(
        Float,
        index=True,
    )

    dec_deg: Mapped[float | None] = mapped_column(
        Float,
        index=True,
    )

    # Observation time
    mjd_start: Mapped[float | None] = mapped_column(
        Float,
        index=True,
    )

    mjd_end: Mapped[float | None] = mapped_column(
        Float,
    )

    # Exposure
    exposure_seconds: Mapped[float | None] = mapped_column(
        Float,
    )

    # Calibration
    calibration_level: Mapped[int | None] = mapped_column(
        Integer,
    )

    calibration_status: Mapped[str | None] = mapped_column(
        String(40),
    )

    # Image properties
    spatial_resolution_arcsec: Mapped[float | None] = mapped_column(
        Float,
    )

    image_width: Mapped[int | None] = mapped_column(
        Integer,
    )

    image_height: Mapped[int | None] = mapped_column(
        Integer,
    )

    # Original SPHEREx data access
    access_url: Mapped[str | None] = mapped_column(
        Text,
    )

    access_format: Mapped[str | None] = mapped_column(
        String(200),
    )

    # Original metadata
    raw_metadata: Mapped[dict | None] = mapped_column(
        JSON,
        nullable=True,
    )

    # Database indexes
    __table_args__ = (
        Index(
            "ix_observations_sky_position",
            "ra_deg",
            "dec_deg",
        ),
        Index(
            "ix_observations_time_band",
            "mjd_start",
            "band",
        ),
    )


class ArchiveProduct(Base):
    """Provenance record for an IRSA product copied into the local cache."""

    __tablename__ = "archive_products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sha256: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    obs_publisher_did: Mapped[str | None] = mapped_column(Text, nullable=True)
    obs_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    collection: Mapped[str | None] = mapped_column(String(100), nullable=True)
    band: Mapped[str | None] = mapped_column(String(40), nullable=True)
    mjd_start: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_access_url: Mapped[str] = mapped_column(Text)
    resolved_access_url: Mapped[str] = mapped_column(Text)
    source_access_format: Mapped[str] = mapped_column(String(200))
    content_type: Mapped[str] = mapped_column(String(120))
    filename: Mapped[str] = mapped_column(String(100))
    static_url: Mapped[str] = mapped_column(String(200))
    size_bytes: Mapped[int] = mapped_column(Integer)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    quality_state: Mapped[str] = mapped_column(String(24))
    validation_report: Mapped[dict | None] = mapped_column(JSON, nullable=True)
