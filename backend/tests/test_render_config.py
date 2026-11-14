import tempfile
import unittest
import os
from pathlib import Path

from sqlalchemy.engine import URL

from app.db import create_database_engine, database_url_from_environment
from app import main
from app.settings import (
    LOCAL_DEVELOPMENT_ORIGINS,
    archive_cache_path,
    archive_cache_path_from_environment,
    cors_origins_from_environment,
    low_memory_mode_from_environment,
    parse_cors_allowed_origins,
)


class RenderConfigurationTests(unittest.TestCase):
    def test_database_url_override_creates_its_parent_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "persistent" / "nested" / "catalog.db"
            configured_url = URL.create("sqlite", database=str(database_path))
            self.assertEqual(
                database_url_from_environment({"DATABASE_URL": str(configured_url)}),
                str(configured_url),
            )

            engine = create_database_engine(configured_url)
            try:
                self.assertTrue(database_path.parent.is_dir())
                self.assertFalse(database_path.exists())
                self.assertEqual(engine.url.database, str(database_path))
            finally:
                engine.dispose()

    def test_empty_database_url_fails_instead_of_falling_back_to_ephemeral_default(self):
        with self.assertRaisesRegex(ValueError, "DATABASE_URL is set but empty"):
            database_url_from_environment({"DATABASE_URL": "   "})

    def test_archive_cache_override_and_default(self):
        backend_dir = Path("/srv/xplorers/backend")
        self.assertEqual(
            archive_cache_path(backend_dir, None),
            (backend_dir / "static" / "archive_products").resolve(),
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            configured = str(Path(temp_dir) / "archive-products")
            self.assertEqual(archive_cache_path(backend_dir, configured), Path(configured).resolve())
            self.assertEqual(
                archive_cache_path_from_environment(
                    backend_dir,
                    {"SPHEREX_ARCHIVE_CACHE_DIR": configured},
                ),
                Path(configured).resolve(),
            )
        with self.assertRaisesRegex(ValueError, "SPHEREX_ARCHIVE_CACHE_DIR cannot be empty"):
            archive_cache_path(backend_dir, " ")

    def test_cors_keeps_local_origins_and_adds_explicit_production_origins(self):
        configured = " https://xplorers.example.com/ , https://preview.example.com:8443, "
        origins = cors_origins_from_environment(
            {"CORS_ALLOWED_ORIGINS": configured}
        )
        self.assertEqual(origins[: len(LOCAL_DEVELOPMENT_ORIGINS)], list(LOCAL_DEVELOPMENT_ORIGINS))
        self.assertIn("https://xplorers.example.com", origins)
        self.assertIn("https://preview.example.com:8443", origins)

    def test_cors_rejects_wildcard_and_non_origin_paths(self):
        with self.assertRaisesRegex(ValueError, "explicit origins"):
            parse_cors_allowed_origins("*")
        with self.assertRaisesRegex(ValueError, "without paths"):
            parse_cors_allowed_origins("https://xplorers.example.com/app")

    def test_low_memory_mode_is_explicit_and_rejects_misspelled_values(self):
        self.assertFalse(low_memory_mode_from_environment({}))
        self.assertTrue(low_memory_mode_from_environment({"XPLORERS_LOW_MEMORY_MODE": " TRUE "}))
        self.assertFalse(low_memory_mode_from_environment({"XPLORERS_LOW_MEMORY_MODE": "off"}))
        with self.assertRaisesRegex(ValueError, "must be one of"):
            low_memory_mode_from_environment({"XPLORERS_LOW_MEMORY_MODE": "treu"})

    def test_low_memory_mode_blocks_only_resource_heavy_analysis_routes(self):
        from fastapi import HTTPException
        from unittest.mock import patch

        heavy_routes = (
            lambda: main.analyze_fits_image("does-not-need-to-exist.fits"),
            lambda: main.detect_fits_anomalies("does-not-need-to-exist.fits"),
            lambda: main.cluster_observation_profiles(db=None),
        )
        with patch.object(main, "LOW_MEMORY_MODE", True):
            for call in heavy_routes:
                with self.subTest(route=call), self.assertRaises(HTTPException) as caught:
                    call()
                self.assertEqual(caught.exception.status_code, 503)
                self.assertIn("NOT EVALUATED", caught.exception.detail)
                self.assertIn("512 MB RAM", caught.exception.detail)

    def test_fastapi_wires_environment_origins_and_cache_static_mount(self):
        cors = next(
            middleware
            for middleware in main.app.user_middleware
            if middleware.cls.__name__ == "CORSMiddleware"
        )
        self.assertEqual(cors.kwargs["allow_origins"], cors_origins_from_environment(os.environ))

        product_mount_index = next(
            index for index, route in enumerate(main.app.routes)
            if getattr(route, "path", None) == "/static/archive_products"
        )
        general_mount_index = next(
            index for index, route in enumerate(main.app.routes)
            if getattr(route, "path", None) == "/static"
        )
        self.assertLess(product_mount_index, general_mount_index)
        product_mount = main.app.routes[product_mount_index]
        self.assertEqual(
            Path(product_mount.app.directory).resolve(),
            main.ARCHIVE_PRODUCTS_DIR.resolve(),
        )


if __name__ == "__main__":
    unittest.main()
