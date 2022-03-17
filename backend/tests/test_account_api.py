"""Profile, preferences, password, sessions and deactivation (`/api/me/...`)."""

import pytest
from conftest import login, workspace_id

from app.routers.account import describe_user_agent
from app.schemas import account as account_schemas
from app.seeding import DEMO_PASSWORD

CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"
FIREFOX_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"


def sign_in(client, email: str, user_agent: str = "testclient", password: str = DEMO_PASSWORD) -> dict[str, str]:
    response = client.post(
        "/api/auth/login", json={"email": email, "password": password}, headers={"User-Agent": user_agent}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


# ---------- Profile ----------


def test_get_profile_returns_the_signed_in_user(client, sam):
    body = client.get("/api/me/profile", headers=sam).json()
    assert body["email"] == "sam@learnloop.dev"
    assert body["headline"] == "Backend engineer"
    assert "password_hash" not in body


def test_update_profile_persists_trimmed_values(client, sam):
    response = client.patch(
        "/api/me/profile",
        headers=sam,
        json={
            "name": "  Samuel Okafor ",
            "headline": " Platform engineer ",
            "bio": "Learning ML one quiz at a time.",
            "timezone": "Africa/Lagos",
            "avatar_color": "#0F766E",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert (body["name"], body["headline"], body["timezone"], body["avatar_color"]) == (
        "Samuel Okafor",
        "Platform engineer",
        "Africa/Lagos",
        "#0f766e",
    )
    me = client.get("/api/auth/me", headers=sam).json()["user"]
    assert me["name"] == "Samuel Okafor" and me["bio"] == "Learning ML one quiz at a time."


def test_partial_profile_update_leaves_other_fields_alone(client, sam):
    client.patch("/api/me/profile", headers=sam, json={"headline": ""})
    body = client.get("/api/me/profile", headers=sam).json()
    assert body["headline"] == ""
    assert body["name"] == "Sam Okafor"


@pytest.mark.parametrize(
    "patch",
    [
        {"name": "S"},
        {"name": "x" * 81},
        {"headline": "x" * 121},
        {"bio": "x" * 601},
        {"timezone": "Mars/Olympus"},
        {"timezone": "GMT+3"},
        {"avatar_color": "teal"},
        {"avatar_color": "#12345"},
    ],
)
def test_invalid_profile_values_are_rejected(client, sam, patch):
    assert client.patch("/api/me/profile", headers=sam, json=patch).status_code == 422
    assert client.get("/api/me/profile", headers=sam).json()["name"] == "Sam Okafor"


def test_timezone_check_with_and_without_a_zone_database(monkeypatch):
    monkeypatch.setattr(account_schemas, "known_timezones", lambda: frozenset({"Europe/Berlin"}))
    assert account_schemas.is_timezone("Europe/Berlin") and account_schemas.is_timezone("UTC")
    assert not account_schemas.is_timezone("Europe/Atlantis")
    # Hosts without tzdata fall back to the shape of an IANA name in a known region.
    monkeypatch.setattr(account_schemas, "known_timezones", lambda: frozenset())
    assert account_schemas.is_timezone("America/Argentina/Buenos_Aires")
    assert not account_schemas.is_timezone("Mars/Olympus")
    assert not account_schemas.is_timezone("GMT+3")
    assert not account_schemas.is_timezone("Europe/")


def test_profile_requires_sign_in(client, seeded):
    assert client.get("/api/me/profile").status_code == 401
    assert client.patch("/api/me/profile", json={"name": "Nobody"}).status_code == 401


# ---------- Preferences ----------


def test_update_preferences(client, sam):
    response = client.patch(
        "/api/me/preferences",
        headers=sam,
        json={
            "theme": "dark",
            "daily_goal_minutes": 45,
            "quiz_length": 8,
            "week_starts_on": 6,
            "email_digest": False,
            "reduced_motion": True,
        },
    )
    assert response.status_code == 200
    user = client.get("/api/auth/me", headers=sam).json()["user"]
    assert (user["theme"], user["daily_goal_minutes"], user["quiz_length"], user["week_starts_on"]) == (
        "dark",
        45,
        8,
        6,
    )
    assert user["email_digest"] is False and user["reduced_motion"] is True


