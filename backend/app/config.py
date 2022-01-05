from functools import lru_cache

from pydantic import BaseSettings, Extra


class Settings(BaseSettings):
    ai_mode: str = "demo"
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"
    database_url: str = "sqlite:///./learnloop.db"
    cors_origins: str = "http://localhost:5173"
    # ISO timestamp in UTC (e.g. 2022-03-14T09:00:00). When set, every "now" in the app is this instant,
    # so seeded screens, due dates and relative times are identical on every run.
    frozen_now: str = ""
    session_days: int = 30
    # PBKDF2 work factor for new password hashes (the test suite lowers it to keep runs fast).
    password_iterations: int = 120_000
    # Load the demo workspace on startup when the database has no users yet (used by docker compose).
    seed_on_start: bool = False

    class Config:
        env_file = ("../.env", ".env")
        extra = Extra.ignore


@lru_cache
def get_settings() -> Settings:
    return Settings()
