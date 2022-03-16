"""Sign up, sign in, sign out, the current-user payload and switching workspaces (app/routers/auth.py)."""

from datetime import timedelta

from conftest import login, register, workspace_id
from sqlalchemy import select

from app import clock
from app.models import AuthSession, Invitation, User
from app.seeding import DEMO_PASSWORD


def signup(client, **fields):
    body = {"name": "Robin Park", "email": "robin@example.com", "password": "sturdy-pass-1", **fields}
    return client.post("/api/auth/register", json=body)


# ---------- Registration ----------


def test_register_creates_user_owned_workspace_and_session(client):
    response = signup(client, workspace_name="Chemistry Crew")
    assert response.status_code == 201
    body = response.json()
    assert body["token"]
    assert body["user"]["email"] == "robin@example.com"
    assert "password_hash" not in body["user"]
    assert [(w["name"], w["role"]) for w in body["workspaces"]] == [("Chemistry Crew", "owner")]
    assert body["current_workspace_id"] == body["workspaces"][0]["id"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.status_code == 200 and me.json()["user"]["name"] == "Robin Park"


def test_register_names_the_default_workspace_after_the_user(client):
    body = signup(client).json()
    assert body["workspaces"][0]["name"] == "Robin's workspace"


def test_register_rejects_duplicate_email_case_insensitively(client):
    assert signup(client).status_code == 201
    response = signup(client, email="ROBIN@Example.com")
    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]


def test_register_rejects_weak_passwords_with_reasons(client):
    response = signup(client, password="short")
    assert response.status_code == 422
    assert response.json()["detail"] == (
        "Password must be at least 8 characters and must mix letters with numbers or symbols"
    )


def test_register_validates_name_and_email(client):
    assert signup(client, name=" R ").status_code == 422
    assert signup(client, email="robin@example").status_code == 422
    assert signup(client, workspace_name="x").status_code == 422


def test_register_with_invitation_joins_that_workspace_instead(client, seeded, db):
    response = signup(client, email="nora@learnloop.dev", invitation_token="demo-invite-northwind-nora")
    assert response.status_code == 201
    body = response.json()
    assert [(w["slug"], w["role"]) for w in body["workspaces"]] == [("northwind-data-academy", "learner")]
    assert body["current_workspace_id"] == body["workspaces"][0]["id"]
    invitation = db.scalars(select(Invitation).where(Invitation.token == "demo-invite-northwind-nora")).one()
    assert invitation.status == "accepted"


def test_register_with_someone_elses_invitation_creates_nothing(client, seeded):
    response = signup(client, email="imposter@example.com", invitation_token="demo-invite-northwind-nora")
    assert response.status_code == 403
    login_attempt = client.post("/api/auth/login", json={"email": "imposter@example.com", "password": "sturdy-pass-1"})
    assert login_attempt.status_code == 401


def test_register_with_expired_or_unknown_invitation(client, seeded):
    expired = signup(client, email="tomas@learnloop.dev", invitation_token="demo-invite-northwind-tomas")
    assert expired.status_code == 410
    unknown = signup(client, email="tomas@learnloop.dev", invitation_token="no-such-token")
    assert unknown.status_code == 404


# ---------- Login and logout ----------


def test_login_returns_token_and_workspaces(client, seeded):
    response = client.post("/api/auth/login", json={"email": "Demo@LearnLoop.dev", "password": DEMO_PASSWORD})
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["name"] == "Alex Rivera"
    assert {w["slug"]: w["role"] for w in body["workspaces"]} == {
        "biology-201-study-group": "owner",
        "northwind-data-academy": "admin",
    }
    assert body["current_workspace_id"] == next(w["id"] for w in body["workspaces"] if w["slug"].startswith("north"))


def test_login_failures_do_not_reveal_which_part_was_wrong(client, seeded):
    wrong_password = client.post("/api/auth/login", json={"email": "demo@learnloop.dev", "password": "nope-1234"})
    unknown_user = client.post("/api/auth/login", json={"email": "ghost@learnloop.dev", "password": "nope-1234"})
    assert wrong_password.status_code == unknown_user.status_code == 401
    assert wrong_password.json() == unknown_user.json()


def test_login_records_the_user_agent(client, seeded, db):
    client.post(
        "/api/auth/login",
        json={"email": "sam@learnloop.dev", "password": DEMO_PASSWORD},
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0) Firefox/128.0"},
    )
    sam = db.scalars(select(User).where(User.email == "sam@learnloop.dev")).one()
    agents = db.scalars(select(AuthSession.user_agent).where(AuthSession.user_id == sam.id)).all()
    assert "Mozilla/5.0 (Windows NT 10.0) Firefox/128.0" in agents


def test_deactivated_accounts_cannot_sign_in(client, seeded, db):
    sam = db.scalars(select(User).where(User.email == "sam@learnloop.dev")).one()
    sam.is_active = False
    db.commit()
    response = client.post("/api/auth/login", json={"email": "sam@learnloop.dev", "password": DEMO_PASSWORD})
    assert response.status_code == 403
    assert "deactivated" in response.json()["detail"]


def test_logout_invalidates_only_that_token(client, seeded):
    first = login(client, "sam@learnloop.dev")
    second = login(client, "sam@learnloop.dev")
    assert client.post("/api/auth/logout", headers=first).status_code == 204
    assert client.get("/api/auth/me", headers=first).status_code == 401
    assert client.get("/api/auth/me", headers=second).status_code == 200
    assert client.post("/api/auth/logout", headers=first).status_code == 401


def test_me_requires_a_valid_bearer_token(client, seeded):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer made-up"}).status_code == 401
    token = login(client, "sam@learnloop.dev")["Authorization"].split()[1]
    assert client.get("/api/auth/me", headers={"Authorization": f"Basic {token}"}).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer "}).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": f"bearer {token}"}).status_code == 200


def test_sessions_expire_after_the_configured_lifetime(client, seeded):
    headers = login(client, "sam@learnloop.dev")
    with clock.travel(clock.now() + timedelta(days=29)):
        assert client.get("/api/auth/me", headers=headers).status_code == 200
    with clock.travel(clock.now() + timedelta(days=31)):
        assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_me_counts_unread_notifications(client, newcomer):
    headers, _ = newcomer
    assert client.get("/api/auth/me", headers=headers).json()["unread_notifications"] == 0


# ---------- Switching workspaces ----------


def test_switch_workspace_is_remembered_for_the_next_sign_in(client, alex, biology):
    response = client.put(f"/api/auth/me/workspace/{biology}", headers=alex)
    assert response.status_code == 200
    assert response.json()["current_workspace_id"] == biology
    again = login(client, "demo@learnloop.dev")
    assert client.get("/api/auth/me", headers=again).json()["current_workspace_id"] == biology


def test_switch_to_a_workspace_you_are_not_in_is_404(client, sam, biology):
    assert client.put(f"/api/auth/me/workspace/{biology}", headers=sam).status_code == 404
    assert client.put("/api/auth/me/workspace/99999", headers=sam).status_code == 404


def test_switch_requires_sign_in(client, seeded):
    assert client.put("/api/auth/me/workspace/1").status_code == 401


def test_new_account_helpers_agree(client):
    headers, ws, body = register(client, email="helper@example.com", workspace="Helper Space")
    assert body["current_workspace_id"] == ws
    assert workspace_id(client, headers, "helper-space") == ws
