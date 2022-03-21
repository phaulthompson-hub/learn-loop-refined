"""Inviting people, managing pending invitations and accepting them by link."""

from datetime import datetime, timedelta

from conftest import login, register
from sqlalchemy import select

from app import clock
from app.models import Activity, Invitation, Notification, User

NOW = datetime(2022, 3, 14, 9)


def invitations(client, headers, workspace: int, **params) -> dict:
    response = client.get(f"/api/workspaces/{workspace}/invitations", headers=headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def invite(client, headers, workspace: int, emails: list[str], **fields):
    return client.post(f"/api/workspaces/{workspace}/invitations", headers=headers, json={"emails": emails, **fields})


def by_token(db, token: str) -> Invitation:
    db.expire_all()
    return db.scalars(select(Invitation).where(Invitation.token == token)).one()


# ---------- Listing ----------


def test_admins_list_invitations_with_effective_status(client, alex, northwind):
    body = invitations(client, alex, northwind)
    assert body["counts"] == {"pending": 2, "expired": 1, "accepted": 0, "revoked": 1, "all": 4}
    statuses = {i["email"]: i["status"] for i in body["items"]}
    assert statuses == {
        "nora@learnloop.dev": "pending",
        "diego@learnloop.dev": "pending",
        "tomas@learnloop.dev": "expired",
        "ravi@learnloop.dev": "revoked",
    }
    nora = next(i for i in body["items"] if i["email"] == "nora@learnloop.dev")
    assert nora["token"] == "demo-invite-northwind-nora"
    assert nora["invited_by"]["name"] == "Alex Rivera" and nora["has_account"] is False
    # Newest first.
    assert [i["created_at"] for i in body["items"]] == sorted((i["created_at"] for i in body["items"]), reverse=True)


def test_invitation_filters(client, alex, northwind, biology):
    assert [i["email"] for i in invitations(client, alex, northwind, status="expired")["items"]] == [
        "tomas@learnloop.dev"
    ]
    assert invitations(client, alex, northwind, q="diego")["total"] == 1
    accepted = invitations(client, alex, biology, status="accepted")["items"]
    assert [(i["email"], i["has_account"]) for i in accepted] == [("priya@learnloop.dev", True)]
    bad = client.get(f"/api/workspaces/{northwind}/invitations", headers=alex, params={"status": "lost"})
    assert bad.status_code == 422


def test_learners_and_instructors_cannot_see_invitations(client, sam, northwind):
    assert client.get(f"/api/workspaces/{northwind}/invitations", headers=sam).status_code == 403
    jonas = login(client, "jonas@learnloop.dev")
    assert client.get(f"/api/workspaces/{northwind}/invitations", headers=jonas).status_code == 403


# ---------- Creating ----------


def test_bulk_invite_reports_an_outcome_per_address(client, alex, northwind):
    response = invite(
        client,
        alex,
        northwind,
        ["New.One@Example.com, new.one@example.com", "not-an-email", "sam@learnloop.dev", "Ada <ada@example.org>"],
        role="instructor",
        message="  Welcome to the guild!  ",
    )
    assert response.status_code == 201
    body = response.json()
    outcomes = [(r["email"], r["outcome"], r["reason"]) for r in body["results"]]
    assert outcomes == [
        ("new.one@example.com", "invited", ""),
        ("sam@learnloop.dev", "skipped", "Already a member"),
        ("ada@example.org", "invited", ""),
        ("new.one@example.com", "skipped", "Listed more than once"),
        ("not-an-email", "invalid", "Not a valid email address"),
    ]
    assert (body["invited"], body["skipped"]) == (2, 3)
    created = body["results"][0]["invitation"]
    assert created["role"] == "instructor" and created["status"] == "pending"
    assert created["message"] == "Welcome to the guild!"
    assert created["expires_at"] == "2022-03-28T09:00:00"
    assert len(created["token"]) >= 30
    assert invitations(client, alex, northwind)["counts"]["pending"] == 4


def test_pending_invitations_are_not_duplicated_but_expired_ones_are_renewed(client, alex, northwind, db):
    old = by_token(db, "demo-invite-northwind-tomas")
    body = invite(client, alex, northwind, ["nora@learnloop.dev", "tomas@learnloop.dev"]).json()
    assert [(r["email"], r["outcome"]) for r in body["results"]] == [
        ("nora@learnloop.dev", "skipped"),
        ("tomas@learnloop.dev", "invited"),
    ]
    assert body["results"][0]["reason"] == "Already has a pending invitation"
    renewed = body["results"][1]["invitation"]
    assert renewed["id"] == old.id and renewed["status"] == "pending"
    assert renewed["token"] != "demo-invite-northwind-tomas"
    assert invitations(client, alex, northwind)["counts"]["all"] == 4


def test_invitees_with_an_account_are_notified(client, alex, northwind, db):
    body = invite(client, alex, northwind, ["lena@learnloop.dev"]).json()
    token = body["results"][0]["invitation"]["token"]
    assert body["results"][0]["invitation"]["has_account"] is True
    lena = db.scalars(select(User).where(User.email == "lena@learnloop.dev")).one()
    note = db.scalars(select(Notification).where(Notification.user_id == lena.id)).all()[-1]
    assert (note.kind, note.link) == ("invite", f"/invite/{token}")
    assert note.title == "Alex Rivera invited you to Northwind Data Academy"
    activity = db.scalars(select(Activity).where(Activity.verb == "member.invited")).one()
    assert activity.summary == "invited 1 person to join as learner"


def test_invite_role_rules(client, alex, maya, sam, northwind):
    assert invite(client, alex, northwind, ["boss@example.com"], role="owner").status_code == 403
    assert invite(client, maya, northwind, ["boss@example.com"], role="owner").status_code == 201
    assert invite(client, sam, northwind, ["friend@example.com"]).status_code == 403
    assert invite(client, alex, northwind, ["x@example.com"], role="emperor").status_code == 422


def test_invite_validation(client, alex, northwind):
    assert invite(client, alex, northwind, []).status_code == 422
    assert invite(client, alex, northwind, [" ,; "]).status_code == 422
    too_many = [f"person{n}@example.com" for n in range(51)]
    assert invite(client, alex, northwind, [", ".join(too_many)]).status_code == 422
    assert invite(client, alex, northwind, ["a@example.com"], message="m" * 501).status_code == 422
    only_invalid = invite(client, alex, northwind, ["nope"])
    assert only_invalid.status_code == 201 and only_invalid.json()["invited"] == 0


# ---------- Revoke and resend ----------


def test_revoke_a_pending_invitation(client, alex, northwind, db):
    nora = by_token(db, "demo-invite-northwind-nora")
    url = f"/api/workspaces/{northwind}/invitations/{nora.id}/revoke"
    response = client.post(url, headers=alex)
    assert response.status_code == 200 and response.json()["status"] == "revoked"
    assert client.post(url, headers=alex).status_code == 409
    assert client.get("/api/invitations/demo-invite-northwind-nora").json()["status"] == "revoked"


def test_invitation_ids_are_scoped_to_their_workspace(client, alex, northwind, biology, db):
    kai = by_token(db, "demo-invite-biology-kai")
    assert client.post(f"/api/workspaces/{northwind}/invitations/{kai.id}/revoke", headers=alex).status_code == 404
    sam = login(client, "sam@learnloop.dev")
    nora = by_token(db, "demo-invite-northwind-nora")
    assert client.post(f"/api/workspaces/{northwind}/invitations/{nora.id}/revoke", headers=sam).status_code == 403


def test_resend_gives_a_fresh_expiry_and_keeps_the_link(client, alex, northwind, db):
    tomas = by_token(db, "demo-invite-northwind-tomas")
    response = client.post(f"/api/workspaces/{northwind}/invitations/{tomas.id}/resend", headers=alex)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "pending" and body["token"] == "demo-invite-northwind-tomas"
    assert body["expires_at"] == (NOW + timedelta(days=14)).isoformat()
    ravi = by_token(db, "demo-invite-northwind-ravi")
    assert client.post(f"/api/workspaces/{northwind}/invitations/{ravi.id}/resend", headers=alex).status_code == 409


# ---------- Public preview ----------


def test_preview_works_signed_out(client, seeded):
    response = client.get("/api/invitations/demo-invite-northwind-diego")
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "diego@learnloop.dev" and body["role"] == "instructor"
    assert body["status"] == "pending" and body["expired"] is False
    assert body["workspace"]["name"] == "Northwind Data Academy" and body["workspace"]["members"] == 5
    assert body["inviter"] == {"name": "Maya Chen", "avatar_color": "#9333ea"}
    assert body["viewer_email_matches"] is None and body["viewer_is_member"] is None


def test_preview_of_expired_and_unknown_invitations(client, seeded):
    expired = client.get("/api/invitations/demo-invite-northwind-tomas").json()
    assert expired["status"] == "expired" and expired["expired"] is True
    assert client.get("/api/invitations/not-a-real-token").status_code == 404


def test_preview_tells_a_signed_in_viewer_whether_it_is_theirs(client, alex):
    body = client.get("/api/invitations/demo-invite-biology-kai", headers=alex).json()
    assert body["viewer_email_matches"] is False and body["viewer_is_member"] is True
    stale = client.get("/api/invitations/demo-invite-biology-kai", headers={"Authorization": "Bearer stale"})
    assert stale.status_code == 200 and stale.json()["viewer_email_matches"] is None


def test_diego_invitation_expires_on_schedule(client, seeded):
    # Sent 12 days ago with the 14-day window, so it lapses on Wednesday at 10:30.
    with clock.travel(NOW + timedelta(days=2, hours=1)):
        assert client.get("/api/invitations/demo-invite-northwind-diego").json()["status"] == "pending"
    with clock.travel(NOW + timedelta(days=2, hours=2)):
        assert client.get("/api/invitations/demo-invite-northwind-diego").json()["status"] == "expired"


# ---------- Accepting ----------


def test_accept_joins_the_workspace_and_switches_to_it(client, seeded, db):
    headers, own_workspace, _ = register(client, name="Nora Lind", email="nora@learnloop.dev")
    response = client.post("/api/invitations/demo-invite-northwind-nora/accept", headers=headers)
    assert response.status_code == 200
    body = response.json()
    northwind = body["workspace_id"]
    assert body["current_workspace_id"] == northwind
    assert {w["id"]: w["role"] for w in body["workspaces"]} == {own_workspace: "owner", northwind: "learner"}
    assert by_token(db, "demo-invite-northwind-nora").status == "accepted"
    alex = db.scalars(select(User).where(User.email == "demo@learnloop.dev")).one()
    note = db.scalars(select(Notification).where(Notification.user_id == alex.id)).all()[-1]
    assert note.title == "Nora Lind accepted your invitation"
    nora = db.scalars(select(User).where(User.email == "nora@learnloop.dev")).one()
    joined = db.scalars(select(Activity).where(Activity.verb == "member.joined", Activity.actor_id == nora.id)).one()
    assert (joined.workspace_id, joined.summary) == (northwind, "joined as a learner")
    again = client.post("/api/invitations/demo-invite-northwind-nora/accept", headers=headers)
    assert again.status_code == 404


def test_accept_requires_the_invited_email(client, sam):
    response = client.post("/api/invitations/demo-invite-northwind-nora/accept", headers=sam)
    assert response.status_code == 403
    assert "different email" in response.json()["detail"]


def test_accept_expired_revoked_or_signed_out(client, seeded):
    tomas, _, _ = register(client, name="Tomas Berg", email="tomas@learnloop.dev")
    assert client.post("/api/invitations/demo-invite-northwind-tomas/accept", headers=tomas).status_code == 410
    ravi, _, _ = register(client, name="Ravi Shah", email="ravi@learnloop.dev")
    assert client.post("/api/invitations/demo-invite-northwind-ravi/accept", headers=ravi).status_code == 404
    assert client.post("/api/invitations/demo-invite-northwind-nora/accept").status_code == 401
    assert client.post("/api/invitations/nope/accept", headers=ravi).status_code == 404
