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


