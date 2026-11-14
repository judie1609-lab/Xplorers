"""Runtime settings for storage paths and browser origins."""

import os
from pathlib import Path
from urllib.parse import urlsplit


LOCAL_DEVELOPMENT_ORIGINS = (
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
)


def parse_cors_allowed_origins(configured: str | None) -> list[str]:
    """Merge validated production origins with the fixed local dev origins."""
    origins = list(LOCAL_DEVELOPMENT_ORIGINS)
    for raw_origin in (configured or "").split(","):
        value = raw_origin.strip()
        if not value:
            continue
        if value == "*":
            raise ValueError(
                "CORS_ALLOWED_ORIGINS must contain explicit origins; '*' is not allowed"
            )

        parsed = urlsplit(value)
        try:
            port = parsed.port
        except ValueError as error:
            raise ValueError(f"Invalid CORS origin: {value}") from error
        if (
            parsed.scheme.lower() not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError(
                f"CORS_ALLOWED_ORIGINS entries must be origins without paths: {value}"
            )

        scheme = parsed.scheme.lower()
        hostname = parsed.hostname.lower()
        if ":" in hostname:
            hostname = f"[{hostname}]"
        if port and not (scheme == "https" and port == 443) and not (
            scheme == "http" and port == 80
        ):
            hostname = f"{hostname}:{port}"
        normalized = f"{scheme}://{hostname}"
        if normalized not in origins:
            origins.append(normalized)
    return origins


def cors_origins_from_environment(environ=None) -> list[str]:
    source = os.environ if environ is None else environ
    return parse_cors_allowed_origins(source.get("CORS_ALLOWED_ORIGINS"))


def low_memory_mode_from_environment(environ=None) -> bool:
    """Parse the explicit low-memory safeguards switch; default remains local behavior."""
    source = os.environ if environ is None else environ
    raw_value = source.get("XPLORERS_LOW_MEMORY_MODE")
    if raw_value is None:
        return False
    normalized = raw_value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off", ""}:
        return False
    raise ValueError(
        "XPLORERS_LOW_MEMORY_MODE must be one of: true, false, 1, 0, yes, no, on, off"
    )


def archive_cache_path(backend_dir: Path, configured: str | None) -> Path:
    """Resolve the archive cache path, keeping the existing local default."""
    if configured is None:
        return (backend_dir / "static" / "archive_products").resolve()
    value = configured.strip()
    if not value:
        raise ValueError("SPHEREX_ARCHIVE_CACHE_DIR cannot be empty")
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = backend_dir / path
    return path.resolve()


def archive_cache_path_from_environment(backend_dir: Path, environ=None) -> Path:
    source = os.environ if environ is None else environ
    return archive_cache_path(backend_dir, source.get("SPHEREX_ARCHIVE_CACHE_DIR"))
