import asyncio
import json
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import db as db_module
from app import main


class ApplicationStartupTests(unittest.TestCase):
    def test_lifespan_starts_and_stops_with_isolated_database(self):
        test_engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        testing_sessions = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)

        async def exercise_lifespan():
            with patch("app.main.engine", test_engine), patch.object(db_module, "SessionLocal", testing_sessions):
                async with main.app.router.lifespan_context(main.app):
                    self.assertEqual(main.app.title, "SPECTRA API")

                    async def request(path: str):
                        sent = []
                        scope = {
                            "type": "http",
                            "asgi": {"version": "3.0", "spec_version": "2.3"},
                            "http_version": "1.1",
                            "method": "GET",
                            "scheme": "http",
                            "path": path,
                            "raw_path": path.encode("ascii"),
                            "query_string": b"",
                            "root_path": "",
                            "headers": [(b"host", b"testserver")],
                            "client": ("testclient", 50000),
                            "server": ("testserver", 80),
                        }

                        async def receive():
                            return {"type": "http.request", "body": b"", "more_body": False}

                        async def send(message):
                            sent.append(message)

                        await main.app(scope, receive, send)
                        status = next(item["status"] for item in sent if item["type"] == "http.response.start")
                        body = b"".join(item.get("body", b"") for item in sent if item["type"] == "http.response.body")
                        return status, json.loads(body)

                    status, health = await request("/health")
                    self.assertEqual(status, 200)
                    self.assertEqual(health["status"], "ok")
                    self.assertEqual(health["service"], "spectra-api")

                    status, database_health = await request("/health/database")
                    self.assertEqual(status, 200)
                    self.assertEqual(database_health["status"], "connected")

        try:
            asyncio.run(exercise_lifespan())
        finally:
            test_engine.dispose()


if __name__ == "__main__":
    unittest.main()
