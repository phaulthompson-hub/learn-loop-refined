from datetime import datetime

from conftest import login
from sqlalchemy import select

from app import clock
from app.models import Activity, User
from app.services.events import record


def feed(client, headers, workspace: int, **params) -> dict:
    response = client.get(f"/api/workspaces/{workspace}/activity", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def order_key(item: dict) -> tuple[str, int]:
    return item["created_at"], item["id"]


def test_feed_requires_membership(client, sam, biology):
    assert client.get(f"/api/workspaces/{biology}/activity").status_code == 401
    assert client.get(f"/api/workspaces/{biology}/activity", headers=sam).status_code == 404


def test_feed_is_newest_first_with_actor_briefs(client, alex, northwind):
    data = feed(client, alex, northwind, limit=50)
    items = data["items"]
    assert items and data["total"] >= len(items)
    assert [order_key(i) for i in items] == sorted((order_key(i) for i in items), reverse=True)
    actor = next(i["actor"] for i in items if i["actor"])
    assert set(actor) == {"id", "name", "avatar_color"}  # no emails in the feed


def test_cursor_pagination_walks_the_whole_feed_without_gaps(client, alex, northwind):
    first = feed(client, alex, northwind, limit=7)
    seen = [item["id"] for item in first["items"]]
    cursor = first["next_before_id"]
    assert first["has_more"] is True and cursor == seen[-1]
    while cursor is not None:
        page = feed(client, alex, northwind, limit=7, before_id=cursor)
        seen.extend(item["id"] for item in page["items"])
        cursor = page["next_before_id"]
        assert page["has_more"] == (cursor is not None)
    assert len(seen) == len(set(seen)) == first["total"]
    everything = feed(client, alex, northwind, limit=50)
    if everything["total"] <= 50:
        assert seen == [item["id"] for item in everything["items"]]


def test_filters_by_actor_and_object_type(client, alex, northwind, db):
    sam = db.scalars(select(User).where(User.email == "sam@learnloop.dev")).one()
    by_sam = feed(client, alex, northwind, actor_id=sam.id, limit=50)
    assert by_sam["total"] > 0
    assert all(item["actor"]["id"] == sam.id for item in by_sam["items"])
    courses = feed(client, alex, northwind, object_type="course", limit=50)
    assert courses["total"] > 0
    assert all(item["object_type"] == "course" for item in courses["items"])
    both = feed(client, alex, northwind, actor_id=sam.id, object_type="course", limit=50)
    assert both["total"] <= min(by_sam["total"], courses["total"])


def test_invalid_filters_are_rejected(client, alex, northwind):
    url = f"/api/workspaces/{northwind}/activity"
    assert client.get(url, params={"object_type": "Course!"}, headers=alex).status_code == 422
    assert client.get(url, params={"limit": 51}, headers=alex).status_code == 422
    assert client.get(url, params={"before_id": 0}, headers=alex).status_code == 422


def test_facets_list_members_and_object_types(client, alex, northwind):
    facets = feed(client, alex, northwind)["facets"]
    names = [actor["name"] for actor in facets["actors"]]
    assert names == sorted(names, key=str.lower)
    assert {"Alex Rivera", "Maya Chen", "Sam Okafor", "Priya Nair", "Jonas Weber"} == set(names)
    assert {"course", "member"} <= set(facets["object_types"])


def test_seeded_feed_shows_recent_arrivals_and_published_courses(client, alex, biology, northwind):
    joins = feed(client, alex, biology, object_type="member")["items"]
    priya = next(item for item in joins if item["actor"]["name"] == "Priya Nair")
    assert priya["verb"] == "member.joined"
    assert priya["created_at"].startswith("2022-03-11")
    published = [i for i in feed(client, alex, northwind, limit=50)["items"] if i["verb"] == "course.published"]
    assert published and published[0]["summary"] == "published Neural Networks in Practice"


def test_a_cursor_from_another_workspace_is_ignored(client, alex, northwind, biology):
    foreign = feed(client, alex, biology)["items"][0]["id"]
    assert feed(client, alex, northwind, before_id=foreign)["items"] == feed(client, alex, northwind)["items"]


def test_new_entries_appear_at_the_top(client, alex, northwind, db):
    maya = db.scalars(select(User).where(User.email == "maya@learnloop.dev")).one()
    with clock.travel(datetime(2022, 3, 14, 8, 59)):
        entry = record(
            db,
            workspace_id=northwind,
            actor_id=maya.id,
            verb="deck.created",
            object_type="deck",
            object_id=None,
            summary="created the deck Metrics",
        )
    db.commit()
    top = feed(client, login(client, "sam@learnloop.dev"), northwind, limit=1)["items"][0]
    assert top["id"] == entry.id
    assert top["actor"]["name"] == "Maya Chen"
    assert db.get(Activity, entry.id).created_at == datetime(2022, 3, 14, 8, 59)
