import pytest
from sqlalchemy import select

from app.models import Activity, Notification, Task
from app.services.ordering import STEP
from tests.conftest import login

STATUSES = ["backlog", "todo", "in_progress", "review", "done"]


def board(client, headers, workspace):
    response = client.get(f"/api/workspaces/{workspace}/board", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def member_id(client, headers, workspace, first_name):
    return next(m["id"] for m in board(client, headers, workspace)["members"] if m["name"].startswith(first_name))


def label_id(client, headers, workspace, name):
    return next(label["id"] for label in board(client, headers, workspace)["labels"] if label["name"] == name)


def find_task(client, headers, workspace, title):
    page = client.get(f"/api/workspaces/{workspace}/tasks", params={"q": title}, headers=headers).json()
    return next(t for t in page["items"] if t["title"] == title)


def column(client, headers, workspace, status):
    return next(c for c in board(client, headers, workspace)["columns"] if c["status"] == status)


def create(client, headers, workspace, **fields):
    payload = {"title": "Revise joins", **fields}
    return client.post(f"/api/workspaces/{workspace}/tasks", json=payload, headers=headers)


def notifications_for(db, user_id):
    return db.scalars(select(Notification).where(Notification.user_id == user_id).order_by(Notification.id)).all()


# ---------- Board ----------


def test_board_has_ordered_columns_with_counts_points_and_wip(client, alex, northwind):
    data = board(client, alex, northwind)
    assert data["prefix"] == "NDA"
    assert [c["status"] for c in data["columns"]] == STATUSES
    assert [c["title"] for c in data["columns"]] == ["Backlog", "To do", "In progress", "Review", "Done"]
    assert sum(c["count"] for c in data["columns"]) == 23
    for col in data["columns"]:
        assert col["count"] == len(col["tasks"])
        assert col["points"] == sum(t["estimate"] or 0 for t in col["tasks"])
        positions = [t["position"] for t in col["tasks"]]
        assert positions == sorted(positions)
        assert all(t["status"] == col["status"] for t in col["tasks"])
    wip = {c["status"]: (c["wip_limit"], c["over_limit"]) for c in data["columns"]}
    assert wip["in_progress"] == (6, False)
    assert wip["review"] == (4, False)
    assert wip["todo"] == (None, False)


def test_board_includes_members_labels_and_courses(client, alex, northwind):
    data = board(client, alex, northwind)
    roles = {m["name"]: m["role"] for m in data["members"]}
    assert roles["Maya Chen"] == "owner"
    assert roles["Alex Rivera"] == "admin"
    labels = {label["name"]: label["task_count"] for label in data["labels"]}
    assert set(labels) == {"Reading", "Practice", "Exam prep", "Project", "Blocked", "Group work"}
    assert labels["Blocked"] == 1
    assert "Introduction to Machine Learning" in {c["title"] for c in data["courses"]}


def test_task_summary_fields(client, alex, northwind):
    task = find_task(client, alex, northwind, "Finish gradient descent exercises")
    assert task["key"] == f"NDA-{task['number']}"
    assert task["assignee"]["name"] == "Alex Rivera"
    assert task["reporter"]["name"] == "Maya Chen"
    assert task["course"]["title"] == "Introduction to Machine Learning"
    assert (task["checklist_done"], task["checklist_total"]) == (1, 4)
    assert task["comment_count"] == 2
    assert task["overdue"] is False
    assert [label["name"] for label in task["labels"]] == ["Practice"]


def test_board_is_private_to_members(client, northwind, newcomer):
    # `northwind` first: it loads the seeded database, which the newcomer is then added to.
    headers, _ = newcomer
    assert client.get(f"/api/workspaces/{northwind}/board", headers=headers).status_code == 404
    assert client.get(f"/api/workspaces/{northwind}/tasks", headers=headers).status_code == 404


def test_board_requires_sign_in(client, seeded, northwind):
    assert client.get(f"/api/workspaces/{northwind}/board").status_code == 401


def test_new_workspace_has_an_empty_board(client, newcomer):
    headers, workspace = newcomer
    data = board(client, headers, workspace)
    assert all(c["count"] == 0 for c in data["columns"])
    assert data["labels"] == []


# ---------- Task list filters ----------


def list_tasks(client, headers, workspace, **params):
    response = client.get(f"/api/workspaces/{workspace}/tasks", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_list_filters_by_me_and_unassigned(client, alex, northwind):
    mine = list_tasks(client, alex, northwind, assignee_id="me")["items"]
    assert mine and all(t["assignee"]["name"] == "Alex Rivera" for t in mine)
    unassigned = list_tasks(client, alex, northwind, unassigned=True)["items"]
    assert len(unassigned) == 2 and all(t["assignee"] is None for t in unassigned)


