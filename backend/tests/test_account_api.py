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


def test_preferences_patch_only_changes_given_fields(client, sam):
    client.patch("/api/me/preferences", headers=sam, json={"quiz_length": 3})
    user = client.get("/api/me/profile", headers=sam).json()
    assert user["quiz_length"] == 3
    assert user["daily_goal_minutes"] == 30 and user["theme"] == "light"


@pytest.mark.parametrize(
    "patch",
    [
        {"theme": "blue"},
        {"daily_goal_minutes": 4},
        {"daily_goal_minutes": 481},
        {"quiz_length": 2},
        {"quiz_length": 11},
        {"week_starts_on": 1},
        {"email_digest": "sometimes"},
    ],
)
def test_preference_bounds(client, sam, patch):
    assert client.patch("/api/me/preferences", headers=sam, json=patch).status_code == 422


def test_preference_bounds_are_inclusive(client, sam):
    for patch in ({"daily_goal_minutes": 5}, {"daily_goal_minutes": 480}, {"quiz_length": 10}, {"week_starts_on": 0}):
        assert client.patch("/api/me/preferences", headers=sam, json=patch).status_code == 200


# ---------- Password ----------


def test_change_password_signs_out_other_sessions_only(client, seeded):
    current = sign_in(client, "sam@learnloop.dev")
    other = sign_in(client, "sam@learnloop.dev", FIREFOX_WIN)
    response = client.post(
        "/api/me/password", headers=current, json={"current_password": DEMO_PASSWORD, "new_password": "new-secret-42"}
    )
    assert response.status_code == 200
    assert response.json()["signed_out_sessions"] >= 1
    assert client.get("/api/auth/me", headers=current).status_code == 200
    assert client.get("/api/auth/me", headers=other).status_code == 401
    assert (
        client.post("/api/auth/login", json={"email": "sam@learnloop.dev", "password": DEMO_PASSWORD}).status_code
        == 401
    )
    assert sign_in(client, "sam@learnloop.dev", password="new-secret-42")


def test_change_password_checks_the_current_password_without_signing_out(client, sam):
    response = client.post(
        "/api/me/password", headers=sam, json={"current_password": "wrong-one-1", "new_password": "new-secret-42"}
    )
    assert response.status_code == 400
    assert "incorrect" in response.json()["detail"]
    assert client.get("/api/auth/me", headers=sam).status_code == 200


def test_new_password_must_be_strong_and_different(client, sam):
    weak = client.post("/api/me/password", headers=sam, json={"current_password": DEMO_PASSWORD, "new_password": "abc"})
    assert weak.status_code == 422 and weak.json()["detail"].startswith("New password must be at least 8")
    same = client.post(
        "/api/me/password", headers=sam, json={"current_password": DEMO_PASSWORD, "new_password": DEMO_PASSWORD}
    )
    assert same.status_code == 422 and "different" in same.json()["detail"]


# ---------- Sessions ----------


def test_sessions_list_flags_the_current_one_and_names_devices(client, seeded):
    sign_in(client, "sam@learnloop.dev", FIREFOX_WIN)
    current = sign_in(client, "sam@learnloop.dev", CHROME_MAC)
    sessions = client.get("/api/me/sessions", headers=current).json()
    assert sessions[0]["current"] is True
    assert sessions[0]["device"] == "Chrome on macOS"
    assert [s["current"] for s in sessions].count(True) == 1
    assert "Firefox on Windows" in {s["device"] for s in sessions}


def test_revoke_one_session(client, seeded):
    other = sign_in(client, "sam@learnloop.dev", FIREFOX_WIN)
    current = sign_in(client, "sam@learnloop.dev", CHROME_MAC)
    target = next(s for s in client.get("/api/me/sessions", headers=current).json() if not s["current"])
    assert client.delete(f"/api/me/sessions/{target['id']}", headers=current).status_code == 204
    assert client.get("/api/auth/me", headers=other).status_code == 401
    assert client.delete(f"/api/me/sessions/{target['id']}", headers=current).status_code == 404


def test_cannot_revoke_the_current_session_or_someone_elses(client, seeded):
    sam = sign_in(client, "sam@learnloop.dev")
    maya = sign_in(client, "maya@learnloop.dev")
    own = client.get("/api/me/sessions", headers=sam).json()[0]
    assert client.delete(f"/api/me/sessions/{own['id']}", headers=sam).status_code == 409
    assert client.delete(f"/api/me/sessions/{own['id']}", headers=maya).status_code == 404
    assert client.get("/api/auth/me", headers=sam).status_code == 200


def test_revoke_all_other_sessions(client, seeded):
    others = [sign_in(client, "sam@learnloop.dev", agent) for agent in (FIREFOX_WIN, CHROME_MAC)]
    current = sign_in(client, "sam@learnloop.dev")
    response = client.post("/api/me/sessions/revoke-others", headers=current)
    assert response.status_code == 200 and response.json()["revoked"] == 2
    assert all(client.get("/api/auth/me", headers=h).status_code == 401 for h in others)
    assert [s["current"] for s in client.get("/api/me/sessions", headers=current).json()] == [True]


@pytest.mark.parametrize(
    ("agent", "label"),
    [
        (CHROME_MAC, "Chrome on macOS"),
        (FIREFOX_WIN, "Firefox on Windows"),
        ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Version/17.4 Mobile Safari/604.1", "Safari on iPhone"),
        ("Mozilla/5.0 (Windows NT 10.0) Chrome/124.0 Safari/537.36 Edg/124.0", "Edge on Windows"),
        ("Mozilla/5.0 (Linux; Android 14) Chrome/124.0 Mobile Safari/537.36", "Chrome on Android"),
        ("curl/8.4.0", "curl"),
        ("", "Unknown device"),
    ],
)
def test_describe_user_agent(agent, label):
    assert describe_user_agent(agent) == label


# ---------- Deactivation ----------


def test_deactivate_signs_out_everywhere_and_blocks_login(client, newcomer):
    headers, _ = newcomer
    wrong = client.post("/api/me/deactivate", headers=headers, json={"password": "not-it-123"})
    assert wrong.status_code == 400
    assert client.post("/api/me/deactivate", headers=headers, json={"password": "secret-pass-1"}).status_code == 204
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    again = client.post("/api/auth/login", json={"email": "learner@example.com", "password": "secret-pass-1"})
    assert again.status_code == 403


def test_only_owner_of_a_shared_workspace_cannot_deactivate(client, maya):
    response = client.post("/api/me/deactivate", headers=maya, json={"password": DEMO_PASSWORD})
    assert response.status_code == 409
    assert "Northwind Data Academy" in response.json()["detail"]
    assert client.get("/api/auth/me", headers=maya).status_code == 200


def test_deactivation_is_allowed_once_another_owner_exists(client, maya, alex, northwind, biology):
    alex_id = client.get("/api/auth/me", headers=alex).json()["user"]["id"]
    blocked = client.post("/api/me/deactivate", headers=alex, json={"password": DEMO_PASSWORD})
    assert blocked.status_code == 409 and "Biology 201 Study Group" in blocked.json()["detail"]
    promoted = client.patch(f"/api/workspaces/{northwind}/members/{alex_id}", headers=maya, json={"role": "owner"})
    assert promoted.status_code == 200
    assert client.post("/api/me/deactivate", headers=maya, json={"password": DEMO_PASSWORD}).status_code == 204
    # Maya is still listed (her history stays) but shows as deactivated, and no longer counts as an owner.
    members = client.get(f"/api/workspaces/{northwind}/members", headers=alex).json()["items"]
    maya_row = next(m for m in members if m["email"] == "maya@learnloop.dev")
    assert maya_row["is_active"] is False
    assert client.post(f"/api/workspaces/{northwind}/leave", headers=alex).status_code == 409


def test_learners_can_deactivate(client, seeded):
    priya = login(client, "priya@learnloop.dev")
    assert client.post("/api/me/deactivate", headers=priya, json={"password": DEMO_PASSWORD}).status_code == 204
    alex = login(client, "demo@learnloop.dev")
    biology = workspace_id(client, alex, "biology-201-study-group")
    members = client.get(f"/api/workspaces/{biology}/members", headers=alex).json()["items"]
    assert {m["email"]: m["is_active"] for m in members}["priya@learnloop.dev"] is False
