import os
import shutil
import tempfile
from pathlib import Path

# Point the app at an isolated database and a frozen clock before any application module is imported.
_DB_DIR = Path(tempfile.mkdtemp(prefix="learnloop-tests-"))
_DB_FILE = _DB_DIR / "test.db"
_SEED_TEMPLATE = _DB_DIR / "seeded-template.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_DB_FILE.as_posix()}"
os.environ["AI_MODE"] = "demo"
os.environ["OPENAI_API_KEY"] = ""
os.environ["FROZEN_NOW"] = "2022-03-14T09:00:00Z"
os.environ["PASSWORD_ITERATIONS"] = "1000"
os.environ["SEED_ON_START"] = "false"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.database import Base, SessionLocal, engine, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.seeding import DEMO_PASSWORD, run_seed  # noqa: E402

NOW = "2022-03-14T09:00:00"


@pytest.fixture(autouse=True)
def fresh_database():
    engine.dispose()
    Base.metadata.drop_all(engine)
    init_db()
    yield
    engine.dispose()


@pytest.fixture(scope="session")
def _seed_template():
    """Seed once per test run, then copy the SQLite file for each test that needs demo data."""
    engine.dispose()
    run_seed()
    engine.dispose()
    shutil.copyfile(_DB_FILE, _SEED_TEMPLATE)
    return _SEED_TEMPLATE


@pytest.fixture
def seeded(_seed_template):
    """The full deterministic demo data set (users, workspaces, courses, cards, events, tasks, notes...)."""
    engine.dispose()
    shutil.copyfile(_seed_template, _DB_FILE)
    yield


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def settings():
    current = get_settings()
    original = current.dict()
    yield current
    for key, value in original.items():
        setattr(current, key, value)


def login(client, email: str, password: str = DEMO_PASSWORD) -> dict[str, str]:
    """Sign in and return the Authorization header for that user."""
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


def register(client, name: str = "Test Learner", email: str = "learner@example.com", workspace: str = "Test Space"):
    """Create a brand-new user with their own workspace. Returns (headers, workspace_id, me payload)."""
    response = client.post(
        "/api/auth/register",
        json={"name": name, "email": email, "password": "secret-pass-1", "workspace_name": workspace},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    return {"Authorization": f"Bearer {body['token']}"}, body["current_workspace_id"], body


def workspace_id(client, headers, slug: str) -> int:
    me = client.get("/api/auth/me", headers=headers).json()
    return next(w["id"] for w in me["workspaces"] if w["slug"] == slug)


@pytest.fixture
def alex(client, seeded):
    """Headers for the main demo account (admin of Northwind, owner of the biology group)."""
    return login(client, "demo@learnloop.dev")


@pytest.fixture
def maya(client, seeded):
    """Headers for Maya, owner of Northwind Data Academy."""
    return login(client, "maya@learnloop.dev")


@pytest.fixture
def sam(client, seeded):
    """Headers for Sam, a learner in Northwind only."""
    return login(client, "sam@learnloop.dev")


@pytest.fixture
def northwind(client, alex):
    return workspace_id(client, alex, "northwind-data-academy")


@pytest.fixture
def biology(client, alex):
    return workspace_id(client, alex, "biology-201-study-group")


def find_course(client, headers, workspace: int, title: str) -> dict:
    page = client.get(f"/api/workspaces/{workspace}/courses", params={"status": "all", "q": title}, headers=headers)
    assert page.status_code == 200, page.text
    return next(c for c in page.json()["items"] if c["title"] == title)


@pytest.fixture
def ml_course(client, alex, northwind):
    """Alex's view of the seeded "Introduction to Machine Learning" course summary."""
    return find_course(client, alex, northwind, "Introduction to Machine Learning")


@pytest.fixture
def newcomer(client):
    """A fresh account with an empty workspace: (headers, workspace_id)."""
    headers, ws, _ = register(client)
    return headers, ws
