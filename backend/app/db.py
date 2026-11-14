import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import URL, make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()
BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR.parent / "data"
DEFAULT_DB = f"sqlite:///{(DATA_DIR / 'spectra.db').as_posix()}"


def database_url_from_environment(environ=None) -> str:
    """Return DATABASE_URL or the unchanged repository-local SQLite default."""
    source = os.environ if environ is None else environ
    configured = source.get("DATABASE_URL")
    if configured is None:
        return DEFAULT_DB
    value = configured.strip()
    if not value:
        raise ValueError("DATABASE_URL is set but empty")
    return value


def prepare_sqlite_storage(database_url: str | URL) -> URL:
    """Create only the selected SQLite database's parent directory."""
    url = make_url(database_url)
    if url.drivername.startswith("sqlite") and url.database:
        database = url.database
        if database != ":memory:" and not database.startswith("file:"):
            path = Path(database).expanduser()
            if not path.is_absolute():
                path = Path.cwd() / path
            path.parent.mkdir(parents=True, exist_ok=True)
    return url


def create_database_engine(database_url: str | URL):
    url = prepare_sqlite_storage(database_url)
    connect_args = {"check_same_thread": False} if url.drivername.startswith("sqlite") else {}
    return create_engine(url, pool_pre_ping=True, connect_args=connect_args)


DATABASE_URL = database_url_from_environment()
engine = create_database_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
