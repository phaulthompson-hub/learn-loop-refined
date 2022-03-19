"""Member directory, role changes and removals (`/api/workspaces/{id}/members`)."""

import pytest
from conftest import login
from sqlalchemy import select

from app.models import Activity, Notification, User, Workspace


def members(client, headers, workspace: int, **params) -> dict:
    response = client.get(f"/api/workspaces/{workspace}/members", headers=headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def user_id(db, email: str) -> int:
    return db.scalars(select(User.id).where(User.email == email)).one()


def set_role(client, headers, workspace: int, target: int, role: str):
    return client.patch(f"/api/workspaces/{workspace}/members/{target}", headers=headers, json={"role": role})


# ---------- Directory ----------


def test_members_list_with_counts_and_activity(client, alex, northwind):
    body = members(client, alex, northwind)
    assert body["total"] == 5
    assert body["counts"] == {"learner": 2, "instructor": 1, "admin": 1, "owner": 1}
    by_email = {m["email"]: m for m in body["items"]}
    assert by_email["maya@learnloop.dev"]["role"] == "owner"
    assert by_email["demo@learnloop.dev"]["is_you"] is True
    assert sum(m["is_you"] for m in body["items"]) == 1
    sam = by_email["sam@learnloop.dev"]
    assert sam["answers_30d"] > 0 and sam["courses"] == 2
    assert "2022-03-13T21:00" <= sam["last_active_at"] <= "2022-03-14T09:00"
    assert [m["name"] for m in body["items"]] == sorted(m["name"] for m in body["items"])


def test_learners_can_browse_the_directory(client, sam, northwind):
    assert members(client, sam, northwind)["total"] == 5


def test_members_search_and_role_filter(client, alex, northwind):
    assert [m["name"] for m in members(client, alex, northwind, q="okafor")["items"]] == ["Sam Okafor"]
    assert [m["name"] for m in members(client, alex, northwind, q="instructor northwind")["items"]] == ["Maya Chen"]
    learners = members(client, alex, northwind, role="learner")
    assert {m["name"] for m in learners["items"]} == {"Sam Okafor", "Priya Nair"}
    assert learners["total"] == 2 and learners["counts"]["admin"] == 1


def test_members_sorting(client, alex, northwind):
    by_role = [m["role"] for m in members(client, alex, northwind, sort="-role")["items"]]
    assert by_role == ["owner", "admin", "instructor", "learner", "learner"]
    answers = [m["answers_30d"] for m in members(client, alex, northwind, sort="-answers_30d")["items"]]
    assert answers == sorted(answers, reverse=True)
    active = [m["last_active_at"] for m in members(client, alex, northwind, sort="-last_active_at")["items"]]
    seen = [a for a in active if a is not None]
    assert seen == sorted(seen, reverse=True) and active[: len(seen)] == seen  # never-active members come last


@pytest.mark.parametrize("params", [{"sort": "password"}, {"role": "superuser"}, {"page_size": 500}])
def test_members_rejects_bad_parameters(client, alex, northwind, params):
    assert client.get(f"/api/workspaces/{northwind}/members", headers=alex, params=params).status_code == 422


def test_members_of_another_workspace_are_hidden(client, sam, biology):
    assert client.get(f"/api/workspaces/{biology}/members", headers=sam).status_code == 404


# ---------- Changing roles ----------


def test_admin_promotes_a_learner_and_the_member_is_told(client, alex, northwind, db):
    sam = user_id(db, "sam@learnloop.dev")
    response = set_role(client, alex, northwind, sam, "instructor")
    assert response.status_code == 200
    assert response.json()["role"] == "instructor" and response.json()["email"] == "sam@learnloop.dev"
    note = db.scalars(select(Notification).where(Notification.user_id == sam)).all()[-1]
    assert note.title == "You are now an instructor in Northwind Data Academy"
    activity = db.scalars(
        select(Activity).where(Activity.verb == "member.role_changed", Activity.object_id == sam)
    ).one()
    assert activity.summary == "changed Sam Okafor's role from learner to instructor"
    sam_headers = login(client, "sam@learnloop.dev")
    assert {w["id"]: w["role"] for w in client.get("/api/auth/me", headers=sam_headers).json()["workspaces"]}[
        northwind
    ] == "instructor"


def test_role_change_permissions(client, alex, northwind, db):
    sam, maya, jonas = (user_id(db, f"{n}@learnloop.dev") for n in ("sam", "maya", "jonas"))
    alex_id = user_id(db, "demo@learnloop.dev")
    sam_headers = login(client, "sam@learnloop.dev")
    assert set_role(client, sam_headers, northwind, jonas, "learner").status_code == 403
    assert set_role(client, alex, northwind, sam, "owner").status_code == 403
    assert set_role(client, alex, northwind, maya, "admin").status_code == 403
    assert set_role(client, alex, northwind, alex_id, "owner").status_code == 403
    assert set_role(client, alex, northwind, sam, "learner").status_code == 409
    assert set_role(client, alex, northwind, sam, "wizard").status_code == 422
    assert set_role(client, alex, northwind, 99999, "learner").status_code == 404
    roles = {m["email"]: m["role"] for m in members(client, alex, northwind)["items"]}
    assert roles["sam@learnloop.dev"] == "learner" and roles["maya@learnloop.dev"] == "owner"


def test_ownership_transfer_then_stepping_down(client, maya, alex, northwind, db):
    alex_id, maya_id = user_id(db, "demo@learnloop.dev"), user_id(db, "maya@learnloop.dev")
    last_owner = set_role(client, maya, northwind, maya_id, "admin")
    assert last_owner.status_code == 409 and "only owner" in last_owner.json()["detail"]
    assert set_role(client, maya, northwind, alex_id, "owner").status_code == 200
    stepped_down = set_role(client, maya, northwind, maya_id, "admin")
    assert stepped_down.status_code == 200 and stepped_down.json()["role"] == "admin"
    db.expire_all()
    assert db.get(Workspace, northwind).owner_id == alex_id
    assert members(client, alex, northwind)["counts"]["owner"] == 1
    # Now Alex is the only owner and Maya, as an admin, can no longer touch him.
    assert set_role(client, maya, northwind, alex_id, "admin").status_code == 403


