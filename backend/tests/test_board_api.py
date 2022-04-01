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


def test_list_filters_by_status_label_priority_and_query(client, alex, northwind):
    open_review = list_tasks(client, alex, northwind, status="todo,review")["items"]
    assert {t["status"] for t in open_review} == {"todo", "review"}
    blocked = list_tasks(client, alex, northwind, label_id=label_id(client, alex, northwind, "Blocked"))["items"]
    assert [t["title"] for t in blocked] == ["Normalise the Northwind orders schema to 3NF"]
    urgent = list_tasks(client, alex, northwind, priority="urgent")["items"]
    assert [t["priority"] for t in urgent] == ["urgent"]
    by_key = list_tasks(client, alex, northwind, q="nda-5")["items"]
    assert [t["key"] for t in by_key] == ["NDA-5"]


def test_list_due_filters(client, alex, northwind):
    overdue = list_tasks(client, alex, northwind, due="overdue")["items"]
    assert len(overdue) == 3 and all(t["overdue"] for t in overdue)
    today = list_tasks(client, alex, northwind, due="today")["items"]
    assert today and all(t["due_date"] == "2022-03-14" for t in today)
    week = list_tasks(client, alex, northwind, due="week")["items"]
    assert all("2022-03-14" <= t["due_date"] <= "2022-03-20" and t["status"] != "done" for t in week)
    undated = list_tasks(client, alex, northwind, due="none")["items"]
    assert undated and all(t["due_date"] is None for t in undated)


def test_list_sorting_and_pagination(client, alex, northwind):
    by_priority = list_tasks(client, alex, northwind, sort="-priority")["items"]
    assert by_priority[0]["priority"] == "urgent"
    by_due = [t["due_date"] for t in list_tasks(client, alex, northwind, sort="due_date")["items"]]
    dated = [d for d in by_due if d]
    assert dated == sorted(dated) and by_due[-1] is None  # undated last
    page = list_tasks(client, alex, northwind, page=2, page_size=10)
    assert (page["total"], page["page"], len(page["items"])) == (23, 2, 10)


@pytest.mark.parametrize(
    "params", [{"status": "doing"}, {"sort": "colour"}, {"due": "soon"}, {"assignee_id": "someone"}]
)
def test_list_rejects_bad_filters(client, alex, northwind, params):
    assert client.get(f"/api/workspaces/{northwind}/tasks", params=params, headers=alex).status_code == 422


# ---------- Create ----------


def test_create_numbers_positions_and_records(client, alex, northwind, db):
    sam_id = member_id(client, alex, northwind, "Sam")
    last = column(client, alex, northwind, "todo")["tasks"][-1]
    response = create(
        client,
        alex,
        northwind,
        title="  Revise joins  ",
        assignee_id=sam_id,
        estimate=3,
        due_date="2022-03-18",
        label_ids=[label_id(client, alex, northwind, "Practice")] * 2,
        checklist=["Inner joins", "Left joins"],
    )
    assert response.status_code == 201, response.text
    task = response.json()
    assert task["title"] == "Revise joins"
    assert task["number"] == 24 and task["key"] == "NDA-24"
    assert task["status"] == "todo" and task["position"] > last["position"]
    assert task["reporter"]["name"] == "Alex Rivera"
    assert [label["name"] for label in task["labels"]] == ["Practice"]
    assert [i["text"] for i in task["checklist"]] == ["Inner joins", "Left joins"]
    assert task["can_delete"] is True

    verbs = db.scalars(
        select(Activity.verb).where(Activity.object_type == "task", Activity.object_id == task["id"])
    ).all()
    assert set(verbs) == {"task.created", "task.assigned"}
    note = notifications_for(db, sam_id)[-1]
    assert note.kind == "task_assigned"
    assert note.link == "/board?task=24"
    assert "NDA-24" in note.title


def test_self_assignment_does_not_notify(client, alex, northwind, db):
    alex_id = member_id(client, alex, northwind, "Alex")
    before = len(notifications_for(db, alex_id))
    assert create(client, alex, northwind, assignee_id=alex_id).status_code == 201
    assert len(notifications_for(db, alex_id)) == before


def test_create_in_done_sets_completed_at(client, alex, northwind):
    task = create(client, alex, northwind, status="done").json()
    assert task["completed_at"] == "2022-03-14T09:00:00"


def test_numbers_are_per_workspace(client, alex, biology):
    assert create(client, alex, biology).json()["key"] == "BSG-9"


def test_create_validation(client, alex, northwind, biology):
    lena = member_id(client, alex, biology, "Lena")
    bio_label = label_id(client, alex, biology, "Reading")
    bio_course = board(client, alex, biology)["courses"][0]["id"]
    cases = [
        ({"assignee_id": lena}, "member"),
        ({"label_ids": [bio_label]}, "Labels"),
        ({"course_id": bio_course}, "course"),
        ({"title": " x "}, None),
        ({"estimate": 101}, None),
        ({"priority": "critical"}, None),
        ({"status": "blocked"}, None),
        ({"checklist": [" "]}, None),
    ]
    for fields, message in cases:
        response = create(client, alex, northwind, **fields)
        assert response.status_code == 422, fields
        if message:
            assert message in response.json()["detail"]


def test_learners_can_create_tasks(client, sam, northwind):
    assert create(client, sam, northwind).status_code == 201


# ---------- Read ----------


def test_get_by_id_and_number(client, alex, northwind):
    task = find_task(client, alex, northwind, "Implement backpropagation by hand for a 2-layer net")
    by_id = client.get(f"/api/tasks/{task['id']}", headers=alex).json()
    by_number = client.get(f"/api/workspaces/{northwind}/tasks/by-number/{task['number']}", headers=alex).json()
    assert by_id == by_number
    assert [c["author"]["name"] for c in by_id["comments"]] == ["Jonas Weber", "Maya Chen", "Jonas Weber"]
    jonas = member_id(client, alex, northwind, "Jonas")
    assert by_id["comments"][1]["mentions"] == [jonas]
    assert [i["position"] for i in by_id["checklist"]] == [0, 1, 2, 3, 4]


def test_missing_and_foreign_tasks_are_404(client, alex, northwind):
    assert client.get(f"/api/workspaces/{northwind}/tasks/by-number/999", headers=alex).status_code == 404
    assert client.get("/api/tasks/99999", headers=alex).status_code == 404
    task = find_task(client, alex, northwind, "Draft SQL join cheat sheet")
    lena = login(client, "lena@learnloop.dev")
    assert client.get(f"/api/tasks/{task['id']}", headers=lena).status_code == 404


# ---------- Update ----------


def test_patch_fields_and_clear_nullable_ones(client, alex, northwind):
    task = find_task(client, alex, northwind, "Draft SQL join cheat sheet")
    response = client.patch(
        f"/api/tasks/{task['id']}",
        json={"title": "Draft SQL join cheat sheet v2", "priority": "urgent", "assignee_id": None, "due_date": None},
        headers=alex,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["title"] == "Draft SQL join cheat sheet v2"
    assert body["priority"] == "urgent"
    assert body["assignee"] is None and body["due_date"] is None
    assert body["course"] is not None  # untouched fields stay


def test_patch_labels(client, alex, northwind):
    task = find_task(client, alex, northwind, "Draft SQL join cheat sheet")
    exam = label_id(client, alex, northwind, "Exam prep")
    body = client.patch(f"/api/tasks/{task['id']}", json={"label_ids": [exam]}, headers=alex).json()
    assert [label["name"] for label in body["labels"]] == ["Exam prep"]
    body = client.patch(f"/api/tasks/{task['id']}", json={"label_ids": []}, headers=alex).json()
    assert body["labels"] == []


def test_patch_status_to_done_and_back(client, alex, northwind, db):
    task = find_task(client, alex, northwind, "Draft SQL join cheat sheet")
    done = client.patch(f"/api/tasks/{task['id']}", json={"status": "done"}, headers=alex).json()
    assert done["completed_at"] == "2022-03-14T09:00:00"
    assert done["position"] > max(t["position"] for t in column(client, alex, northwind, "done")["tasks"][:-1])
    completed = select(Activity).where(Activity.verb == "task.completed", Activity.object_id == task["id"])
    assert db.scalars(completed).first() is not None
    reopened = client.patch(f"/api/tasks/{task['id']}", json={"status": "todo"}, headers=alex).json()
    assert reopened["completed_at"] is None


def test_reassignment_notifies_new_assignee(client, alex, northwind, db):
    task = find_task(client, alex, northwind, "Draft SQL join cheat sheet")
    priya = member_id(client, alex, northwind, "Priya")
    client.patch(f"/api/tasks/{task['id']}", json={"assignee_id": priya}, headers=alex)
    note = notifications_for(db, priya)[-1]
    assert note.kind == "task_assigned" and "Draft SQL join cheat sheet" in note.title
    # Saving the same assignee again is not a new assignment.
    client.patch(f"/api/tasks/{task['id']}", json={"assignee_id": priya}, headers=alex)
    assert notifications_for(db, priya)[-1].id == note.id


def test_patch_validation(client, alex, northwind):
    task = find_task(client, alex, northwind, "Draft SQL join cheat sheet")
    url = f"/api/tasks/{task['id']}"
    assert client.patch(url, json={"assignee_id": 99999}, headers=alex).status_code == 422
    assert client.patch(url, json={"label_ids": [99999]}, headers=alex).status_code == 422
    assert client.patch(url, json={"title": ""}, headers=alex).status_code == 422
    assert client.patch(url, json={"estimate": -1}, headers=alex).status_code == 422


# ---------- Move ----------


def move(client, headers, task_id, **payload):
    return client.post(f"/api/tasks/{task_id}/move", json=payload, headers=headers)


def test_move_between_neighbours(client, alex, northwind):
    review = column(client, alex, northwind, "review")["tasks"]
    task = find_task(client, alex, northwind, "Draft SQL join cheat sheet")
    response = move(client, alex, task["id"], status="review", after_id=review[0]["id"], before_id=review[1]["id"])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["rebalanced"] is False
    assert body["task"]["status"] == "review"
    ids = [t["id"] for t in column(client, alex, northwind, "review")["tasks"]]
    assert ids == [review[0]["id"], task["id"], *[t["id"] for t in review[1:]]]
    assert [c["id"] for c in body["column"]] == ids


def test_move_to_top_by_index_and_within_column(client, alex, northwind):
    todo = column(client, alex, northwind, "todo")["tasks"]
    last = todo[-1]
    assert move(client, alex, last["id"], status="todo", index=0).status_code == 200
    ids = [t["id"] for t in column(client, alex, northwind, "todo")["tasks"]]
    assert ids == [last["id"], *[t["id"] for t in todo[:-1]]]


def test_move_to_done_and_out_again(client, alex, northwind, db):
    task = find_task(client, alex, northwind, "Peer-review Priya's regression notebook")
    done = move(client, alex, task["id"], status="done").json()["task"]
    assert done["completed_at"] == "2022-03-14T09:00:00"
    assert column(client, alex, northwind, "done")["tasks"][-1]["id"] == task["id"]
    completed = select(Activity).where(Activity.verb == "task.completed", Activity.object_id == task["id"])
    assert len(db.scalars(completed).all()) == 1
    back = move(client, alex, task["id"], status="review", index=0).json()["task"]
    assert back["completed_at"] is None


def test_move_with_foreign_neighbour_is_rejected(client, alex, northwind):
    todo = column(client, alex, northwind, "todo")["tasks"]
    review = column(client, alex, northwind, "review")["tasks"]
    response = move(client, alex, todo[0]["id"], status="todo", after_id=review[0]["id"])
    assert response.status_code == 422
    assert move(client, alex, todo[0]["id"], status="doing").status_code == 422


def test_move_rebalances_crowded_column(client, alex, northwind, db):
    review = column(client, alex, northwind, "review")["tasks"]
    for i, task in enumerate(review):
        db.get(Task, task["id"]).position = 1.0 + i * 1e-9  # squeeze the column
    db.commit()
    mover = find_task(client, alex, northwind, "Draft SQL join cheat sheet")
    body = move(client, alex, mover["id"], status="review", after_id=review[0]["id"]).json()
    assert body["rebalanced"] is True
    assert [c["position"] for c in body["column"]] == [STEP * (i + 1) for i in range(len(review) + 1)]
    ids = [t["id"] for t in column(client, alex, northwind, "review")["tasks"]]
    assert ids[:2] == [review[0]["id"], mover["id"]]


# ---------- Delete ----------


def test_delete_permissions(client, alex, sam, northwind):
    # Sam is a learner: neither reporter nor assignee of this task.
    other = find_task(client, alex, northwind, "Collect examples of misleading bar charts")
    assert client.delete(f"/api/tasks/{other['id']}", headers=sam).status_code == 403
    # ...but he can delete a task assigned to him, and admins can delete anything.
    his = find_task(client, alex, northwind, "Draft SQL join cheat sheet")
    assert client.get(f"/api/tasks/{his['id']}", headers=sam).json()["can_delete"] is True
    assert client.delete(f"/api/tasks/{his['id']}", headers=sam).status_code == 204
    assert client.delete(f"/api/tasks/{other['id']}", headers=alex).status_code == 204
    assert client.get(f"/api/tasks/{other['id']}", headers=alex).status_code == 404


# ---------- Checklist ----------


def test_checklist_crud_and_progress(client, alex, northwind):
    task = find_task(client, alex, northwind, "Draft SQL join cheat sheet")
    url = f"/api/tasks/{task['id']}/checklist"
    first = client.post(url, json={"text": "Inner join"}, headers=alex).json()
    second = client.post(url, json={"text": "Left join"}, headers=alex).json()
    third = client.post(url, json={"text": "Anti join"}, headers=alex).json()
    assert [first["position"], second["position"], third["position"]] == [0, 1, 2]

    assert client.post(f"{url}/{first['id']}/toggle", headers=alex).json()["done"] is True
    renamed = client.patch(f"{url}/{second['id']}", json={"text": "Left outer join", "done": True}, headers=alex)
    assert renamed.json() == {**second, "text": "Left outer join", "done": True}
    summary = find_task(client, alex, northwind, "Draft SQL join cheat sheet")
    assert (summary["checklist_done"], summary["checklist_total"]) == (2, 3)

    order = client.put(f"{url}/order", json={"ids": [third["id"], first["id"], second["id"]]}, headers=alex)
    assert [i["id"] for i in order.json()] == [third["id"], first["id"], second["id"]]
    assert client.put(f"{url}/order", json={"ids": [third["id"]]}, headers=alex).status_code == 422

    assert client.delete(f"{url}/{third['id']}", headers=alex).status_code == 204
    items = client.get(f"/api/tasks/{task['id']}", headers=alex).json()["checklist"]
    assert [(i["text"], i["position"]) for i in items] == [("Inner join", 0), ("Left outer join", 1)]
    assert client.delete(f"{url}/{third['id']}", headers=alex).status_code == 404
    assert client.post(url, json={"text": "   "}, headers=alex).status_code == 422


def test_checklist_item_must_belong_to_task(client, alex, northwind):
    a = find_task(client, alex, northwind, "Finish gradient descent exercises")
    b = find_task(client, alex, northwind, "Draft SQL join cheat sheet")
    item = client.get(f"/api/tasks/{a['id']}", headers=alex).json()["checklist"][0]
    assert client.post(f"/api/tasks/{b['id']}/checklist/{item['id']}/toggle", headers=alex).status_code == 404


# ---------- Comments ----------


def test_comment_notifies_assignee_and_reporter_but_not_author(client, sam, northwind, db, alex):
    # Assignee Alex, reporter Maya; Sam comments.
    task = find_task(client, sam, northwind, "Finish gradient descent exercises")
    alex_id = member_id(client, alex, northwind, "Alex")
    maya_id = member_id(client, alex, northwind, "Maya")
    sam_id = member_id(client, alex, northwind, "Sam")
    sam_before = len(notifications_for(db, sam_id))
    response = client.post(f"/api/tasks/{task['id']}/comments", json={"body": "Nice plots!"}, headers=sam)
    assert response.status_code == 201
    comment = response.json()
    assert comment["can_edit"] and comment["can_delete"] and comment["author"]["id"] == sam_id
    assert "commented on" in notifications_for(db, alex_id)[-1].title
    assert "commented on" in notifications_for(db, maya_id)[-1].title
    assert len(notifications_for(db, sam_id)) == sam_before


def test_mentions_notify_once_and_edits_only_notify_new_mentions(client, alex, northwind, db):
    task = find_task(client, alex, northwind, "Finish gradient descent exercises")  # assignee Alex, reporter Maya
    maya_id = member_id(client, alex, northwind, "Maya")
    priya_id = member_id(client, alex, northwind, "Priya")
    jonas_id = member_id(client, alex, northwind, "Jonas")
    maya_before = len(notifications_for(db, maya_id))
    body = {"body": "@Maya Chen and @Priya can you sanity-check exercise 3.3?"}
    comment = client.post(f"/api/tasks/{task['id']}/comments", json=body, headers=alex).json()
    assert comment["mentions"] == [maya_id, priya_id]
    maya_notes = notifications_for(db, maya_id)[maya_before:]
    assert [n.title for n in maya_notes] == [f"Alex Rivera mentioned you on {task['key']}"]
    assert "mentioned you" in notifications_for(db, priya_id)[-1].title

    priya_count = len(notifications_for(db, priya_id))
    edited = client.patch(
        f"/api/tasks/{task['id']}/comments/{comment['id']}",
        json={"body": "@Maya Chen, @Priya and @Jonas can you sanity-check exercise 3.3?"},
        headers=alex,
    ).json()
    assert edited["edited_at"] == "2022-03-14T09:00:00"
    assert len(notifications_for(db, priya_id)) == priya_count
    assert "mentioned you" in notifications_for(db, jonas_id)[-1].title


def test_comment_permissions(client, alex, sam, maya, northwind):
    task = find_task(client, alex, northwind, "Finish gradient descent exercises")
    url = f"/api/tasks/{task['id']}/comments"
    maya_comment = client.get(url, headers=alex).json()[0]
    assert maya_comment["author"]["name"] == "Maya Chen"
    assert maya_comment["can_edit"] is False and maya_comment["can_delete"] is True  # Alex is admin
    assert client.patch(f"{url}/{maya_comment['id']}", json={"body": "hijack"}, headers=alex).status_code == 403

    sam_comment = client.post(url, json={"body": "Following along"}, headers=sam).json()
    as_sam = client.get(url, headers=sam).json()
    assert [c["can_delete"] for c in as_sam if c["id"] == maya_comment["id"]] == [False]
    assert client.delete(f"{url}/{maya_comment['id']}", headers=sam).status_code == 403
    assert client.delete(f"{url}/{sam_comment['id']}", headers=maya).status_code == 204  # owner moderates
    assert client.delete(f"{url}/{maya_comment['id']}", headers=alex).status_code == 204
    assert client.post(url, json={"body": "  "}, headers=sam).status_code == 422
    remaining = find_task(client, alex, northwind, "Finish gradient descent exercises")["comment_count"]
    assert remaining == 1


# ---------- Labels ----------


def test_label_crud_for_admins(client, alex, northwind):
    url = f"/api/workspaces/{northwind}/labels"
    created = client.post(url, json={"name": " Revision ", "color": "#AABBCC"}, headers=alex)
    assert created.status_code == 201
    label = created.json()
    assert (label["name"], label["color"], label["task_count"]) == ("Revision", "#aabbcc", 0)

    assert client.post(url, json={"name": "revision"}, headers=alex).status_code == 409
    assert client.post(url, json={"name": "Colourful", "color": "red"}, headers=alex).status_code == 422
    assert client.post(url, json={"name": ""}, headers=alex).status_code == 422
    assert client.patch(f"/api/labels/{label['id']}", json={"name": "reading"}, headers=alex).status_code == 409

    renamed = client.patch(f"/api/labels/{label['id']}", json={"name": "Revision week"}, headers=alex).json()
    assert renamed["name"] == "Revision week"
    assert [x["name"] for x in client.get(url, headers=alex).json()].count("Revision week") == 1


def test_learners_cannot_manage_labels(client, sam, northwind):
    url = f"/api/workspaces/{northwind}/labels"
    assert client.get(url, headers=sam).status_code == 200
    assert client.post(url, json={"name": "Mine"}, headers=sam).status_code == 403
    reading = next(x for x in client.get(url, headers=sam).json() if x["name"] == "Reading")
    assert client.patch(f"/api/labels/{reading['id']}", json={"name": "X"}, headers=sam).status_code == 403
    assert client.delete(f"/api/labels/{reading['id']}", headers=sam).status_code == 403


def test_deleting_a_label_removes_it_from_tasks(client, alex, northwind):
    blocked = label_id(client, alex, northwind, "Blocked")
    assert client.delete(f"/api/labels/{blocked}", headers=alex).status_code == 204
    task = find_task(client, alex, northwind, "Normalise the Northwind orders schema to 3NF")
    assert [label["name"] for label in task["labels"]] == ["Project"]
    assert client.delete(f"/api/labels/{blocked}", headers=alex).status_code == 404
