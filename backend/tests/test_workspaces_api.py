"""Creating, reading, updating, deleting and leaving workspaces (`/api/workspaces`)."""

from conftest import login
from sqlalchemy import func, select

from app.models import Activity, Course, Invitation, Membership, Notification, User, Workspace


def create(client, headers, **fields):
    return client.post("/api/workspaces", headers=headers, json={"name": "Physics Circle", **fields})


def delete(client, headers, workspace: int, confirm_name: str):
    return client.request(
        "DELETE", f"/api/workspaces/{workspace}", headers=headers, json={"confirm_name": confirm_name}
    )


def count(db, model, *where) -> int:
    return db.scalar(select(func.count()).select_from(model).where(*where))


# ---------- Create ----------


def test_create_workspace_makes_the_creator_owner_and_switches_to_it(client, sam, db):
    response = create(client, sam, description="Weekly problem sets", color="#2563EB")
    assert response.status_code == 201
    body = response.json()
    assert (body["name"], body["slug"], body["color"], body["your_role"]) == (
        "Physics Circle",
        "physics-circle",
        "#2563eb",
        "owner",
    )
    assert body["owner"]["email"] == "sam@learnloop.dev"
    assert body["stats"]["members"] == 1 and body["stats"]["members_by_role"]["owner"] == 1
    me = client.get("/api/auth/me", headers=sam).json()
    assert me["current_workspace_id"] == body["id"]
    assert {w["name"]: w["role"] for w in me["workspaces"]}["Physics Circle"] == "owner"
    assert count(db, Activity, Activity.verb == "workspace.created", Activity.workspace_id == body["id"]) == 1


def test_duplicate_names_get_unique_slugs(client, sam):
    first, second = create(client, sam).json(), create(client, sam).json()
    assert (first["slug"], second["slug"]) == ("physics-circle", "physics-circle-2")


def test_create_workspace_validation(client, sam):
    assert create(client, sam, name=" x ").status_code == 422
    assert create(client, sam, name="x" * 81).status_code == 422
    assert create(client, sam, color="blue").status_code == 422
    assert create(client, sam, description="d" * 501).status_code == 422
    assert client.post("/api/workspaces", json={"name": "Anonymous"}).status_code == 401


def test_a_user_without_workspaces_can_create_one(client, sam, northwind):
    assert client.post(f"/api/workspaces/{northwind}/leave", headers=sam).status_code == 200
    assert client.get("/api/auth/me", headers=sam).json()["workspaces"] == []
    assert create(client, sam).status_code == 201
    assert client.get("/api/auth/me", headers=sam).json()["current_workspace_id"] is not None


# ---------- Read ----------


def test_workspace_detail_with_stats(client, alex, northwind):
    body = client.get(f"/api/workspaces/{northwind}", headers=alex).json()
    assert body["name"] == "Northwind Data Academy"
    assert body["your_role"] == "admin"
    assert body["owner"]["name"] == "Maya Chen"
    stats = body["stats"]
    assert stats["members"] == 5
    assert stats["members_by_role"] == {"learner": 2, "instructor": 1, "admin": 1, "owner": 1}
    assert stats["courses"] >= stats["active_courses"] > 0
    # Alex, Sam, Priya and Jonas all answered quiz questions in the last week.
    assert 4 <= stats["active_learners_7d"] <= 5
    assert stats["answers_7d"] > 0
    # Nora and Diego; Tomas's invitation has expired and Ravi's was revoked.
    assert stats["pending_invitations"] == 2


def test_learners_can_read_but_outsiders_cannot(client, sam, northwind, biology):
    assert client.get(f"/api/workspaces/{northwind}", headers=sam).json()["your_role"] == "learner"
    assert client.get(f"/api/workspaces/{biology}", headers=sam).status_code == 404
    assert client.get("/api/workspaces/424242", headers=sam).status_code == 404


# ---------- Update ----------


def test_admin_updates_workspace_settings(client, alex, northwind, db):
    response = client.patch(
        f"/api/workspaces/{northwind}",
        headers=alex,
        json={"name": " Northwind Academy ", "description": "Analytics guild", "color": "#0F766E"},
    )
    assert response.status_code == 200
    body = response.json()
    assert (body["name"], body["description"], body["color"]) == ("Northwind Academy", "Analytics guild", "#0f766e")
    assert body["slug"] == "northwind-data-academy"
    summaries = db.scalars(select(Activity.summary).where(Activity.verb == "workspace.updated")).all()
    assert summaries == ["renamed the workspace to Northwind Academy"]


def test_update_without_changes_records_nothing(client, alex, northwind, db):
    response = client.patch(f"/api/workspaces/{northwind}", headers=alex, json={"name": "Northwind Data Academy"})
    assert response.status_code == 200
    assert count(db, Activity, Activity.verb == "workspace.updated") == 0


def test_update_permissions_and_validation(client, sam, alex, northwind):
    assert client.patch(f"/api/workspaces/{northwind}", headers=sam, json={"name": "Hijacked"}).status_code == 403
    jonas = login(client, "jonas@learnloop.dev")
    assert client.patch(f"/api/workspaces/{northwind}", headers=jonas, json={"name": "Hijacked"}).status_code == 403
    assert client.patch(f"/api/workspaces/{northwind}", headers=alex, json={"color": "#zzzzzz"}).status_code == 422
    assert client.patch(f"/api/workspaces/{northwind}", headers=alex, json={"name": ""}).status_code == 422
    assert client.get(f"/api/workspaces/{northwind}", headers=sam).json()["name"] == "Northwind Data Academy"


# ---------- Delete ----------


