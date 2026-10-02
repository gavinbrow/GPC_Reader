"""Application configuration for Astra Reader backend."""

from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings, loaded from environment variables with defaults."""

    # App
    APP_NAME: str = "Astra Reader API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # Database
    DATABASE_URL: str = "sqlite:///./data/astra.db"
    DATABASE_PATH: str = ""  # set in __init__ below

    # File upload
    MAX_UPLOAD_SIZE_BYTES: int = 500 * 1024 * 1024  # 500 MB
    UPLOAD_DIR: str = ""  # set in __init__ below

    # Rate limiting
    RATE_LIMIT_UPLOADS_PER_MINUTE: int = 10

    # Session
    SESSION_EXPIRY_DAYS: int = 7

    # Backup
    BACKUP_RETENTION_DAYS: int = 30
    BACKUP_ON_STARTUP: bool = False

    @classmethod
    def create(cls) -> "Settings":
        """Create settings with computed paths relative to the backend root."""
        backend_root = Path(__file__).resolve().parent.parent
        data_dir = backend_root / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        uploads_dir = data_dir / "uploads"
        uploads_dir.mkdir(parents=True, exist_ok=True)
        db_path = data_dir / "astra.db"

        s = cls()
        s.DATABASE_URL = f"sqlite:///{db_path}"
        s.DATABASE_PATH = str(db_path)
        s.UPLOAD_DIR = str(uploads_dir)
        return s


settings = Settings.create()
