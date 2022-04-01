from sqlalchemy import select

from app.models import Notification, User

URL = "/api/notifications"


def page(client, headers, **params) -> dict:
    response = client.get(URL, params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def unread(client, headers) -> int:
    count = client.get(f"{URL}/unread-count", headers=headers).json()["unread"]
    assert client.get("/api/auth/me", headers=headers).json()["unread_notifications"] == count
    return count


def test_notifications_require_sign_in(client):
    assert client.get(URL).status_code == 401
    assert client.post(f"{URL}/read-all").status_code == 401


def test_seeded_inbox_is_newest_first_with_actor_and_workspace(client, alex):
    data = page(client, alex, limit=50)
    items = data["items"]
    assert data["total"] == len(items) >= 15
    assert data["unread"] == unread(client, alex) == sum(1 for i in items if not i["read"])
    assert 0 < data["unread"] < data["total"]
    stamps = [(i["created_at"], i["id"]) for i in items]
    assert stamps == sorted(stamps, reverse=True)
    assigned = next(i for i in items if i["kind"] == "task_assigned")
    assert assigned["actor"]["name"] == "Maya Chen"
    assert assigned["workspace"]["name"] == "Northwind Data Academy"
    assert sum(data["kinds"].values()) == data["total"]


def test_unread_filter_and_kind_filter(client, alex):
    only_unread = page(client, alex, unread=True, limit=50)
    assert only_unread["items"] and all(not i["read"] for i in only_unread["items"])
    assert only_unread["total"] == only_unread["unread"]
    comments = page(client, alex, kind="comment", limit=50)
    assert comments["total"] == comments["kinds"]["comment"] > 0
    assert all(i["kind"] == "comment" for i in comments["items"])
    assert client.get(URL, params={"kind": "spam"}, headers=alex).status_code == 422


def test_workspace_filter(client, alex, biology):
    data = page(client, alex, workspace_id=biology, limit=50)
    assert data["total"] > 0
    assert all(i["workspace"]["id"] == biology for i in data["items"])


def test_cursor_pagination(client, alex):
    first = page(client, alex, limit=5)
    assert first["has_more"] is True and len(first["items"]) == 5
    second = page(client, alex, limit=5, before_id=first["next_before_id"])
    ids = [i["id"] for i in first["items"] + second["items"]]
    assert len(set(ids)) == 10
    assert ids == [i["id"] for i in page(client, alex, limit=10)["items"]]


def test_mark_one_read_and_unread(client, alex):
    target = page(client, alex, unread=True)["items"][0]
    before = unread(client, alex)
    response = client.patch(f"{URL}/{target['id']}", json={"read": True}, headers=alex)
    assert response.status_code == 200
    assert response.json()["read"] is True
    assert response.json()["read_at"] == "2022-03-14T09:00:00"
    assert unread(client, alex) == before - 1
    # Marking an already-read notification read again is a no-op.
    assert client.patch(f"{URL}/{target['id']}", json={"read": True}, headers=alex).status_code == 200
    assert unread(client, alex) == before - 1
    back = client.patch(f"{URL}/{target['id']}", json={"read": False}, headers=alex).json()
    assert back["read"] is False and back["read_at"] is None
    assert unread(client, alex) == before


def test_other_peoples_notifications_are_not_found(client, alex, sam, db):
    maya = db.scalars(select(User).where(User.email == "maya@learnloop.dev")).one()
    theirs = db.scalars(select(Notification).where(Notification.user_id == maya.id)).first()
    assert client.patch(f"{URL}/{theirs.id}", json={"read": True}, headers=alex).status_code == 404
    assert client.delete(f"{URL}/{theirs.id}", headers=sam).status_code == 404
    assert client.patch(f"{URL}/999999", json={"read": True}, headers=alex).status_code == 404
    assert db.get(Notification, theirs.id) is not None


def test_read_all_can_be_scoped_to_one_workspace(client, alex, biology):
    bio_unread = page(client, alex, workspace_id=biology, unread=True)["total"]
    total_unread = unread(client, alex)
    assert bio_unread > 0
    result = client.post(f"{URL}/read-all", params={"workspace_id": biology}, headers=alex).json()
    assert result == {"changed": bio_unread, "unread": total_unread - bio_unread}
    assert page(client, alex, workspace_id=biology, unread=True)["total"] == 0
    everything = client.post(f"{URL}/read-all", headers=alex).json()
    assert everything == {"changed": total_unread - bio_unread, "unread": 0}
    assert unread(client, alex) == 0


def test_delete_one(client, alex):
    target = page(client, alex)["items"][0]
    total = page(client, alex)["total"]
    assert client.delete(f"{URL}/{target['id']}", headers=alex).status_code == 204
    assert page(client, alex)["total"] == total - 1
    assert client.delete(f"{URL}/{target['id']}", headers=alex).status_code == 404


def test_clear_read_keeps_unread_notifications(client, alex):
    data = page(client, alex, limit=50)
    read = sum(1 for i in data["items"] if i["read"])
    result = client.delete(f"{URL}/read", headers=alex).json()
    assert result == {"changed": read, "unread": data["unread"]}
    after = page(client, alex, limit=50)
    assert after["total"] == data["unread"]
    assert all(not i["read"] for i in after["items"])


def test_each_user_only_sees_their_own_inbox(client, alex, sam):
    alex_ids = {i["id"] for i in page(client, alex, limit=50)["items"]}
    sam_data = page(client, sam, limit=50)
    assert sam_data["total"] > 0
    assert not alex_ids & {i["id"] for i in sam_data["items"]}


def test_system_notifications_have_no_actor_or_workspace(client, alex):
    system = [i for i in page(client, alex, kind="system", limit=50)["items"] if i["workspace"] is None]
    assert system and system[0]["actor"] is None
    assert system[0]["title"] == "Welcome to the new LearnLoop"
