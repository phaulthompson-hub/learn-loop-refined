from datetime import datetime, timedelta

import pytest
from conftest import NOW, find_course, login
from sqlalchemy import func, select

from app.models import Activity, CardState, ReviewLog, StudyLog, User
from app.services.review_queue import DAILY_NEW_LIMIT, due_summary

MATERIAL = (
    "Photosynthesis converts light energy into chemical energy. Chlorophyll absorbs light in the "
    "chloroplast. The Calvin cycle fixes carbon dioxide into sugars using ATP and NADPH."
)


def decks(client, headers, workspace, **params) -> dict:
    response = client.get(f"/api/workspaces/{workspace}/decks", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def deck_named(client, headers, workspace, name) -> dict:
    return next(d for d in decks(client, headers, workspace)["items"] if d["name"] == name)


def user_id(db, email) -> int:
    return db.scalar(select(User.id).where(User.email == email))


@pytest.fixture
def ml_deck(client, alex, northwind):
    return deck_named(client, alex, northwind, "ML Essentials")


@pytest.fixture
def own_deck(client, newcomer):
    """A fresh workspace with one course and one empty deck owned by the newcomer."""
    headers, workspace = newcomer
    course = client.post(
        f"/api/workspaces/{workspace}/courses", json={"title": "Plant Biology", "text": MATERIAL}, headers=headers
    )
    assert course.status_code == 201, course.text
    deck = client.post(
        f"/api/workspaces/{workspace}/decks",
        json={"course_id": course.json()["id"], "name": "Photosynthesis", "description": "Light reactions"},
        headers=headers,
    )
    assert deck.status_code == 201, deck.text
    return headers, workspace, deck.json()


def import_cards(client, headers, deck_id, count: int, prefix: str = "Card"):
    text = "\n".join(f"{prefix} {n} :: Answer {n}" for n in range(1, count + 1))
    response = client.post(f"/api/decks/{deck_id}/cards/import", json={"text": text}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


# ---------- Deck listing ----------


def test_deck_list_counts_match_the_shared_due_summary(client, alex, northwind, db):
    page = decks(client, alex, northwind)
    names = [d["name"] for d in page["items"]]
    assert set(names) == {"ML Essentials", "Statistics Core Terms", "SQL & Relational Basics"}
    summary = due_summary(db, user_id(db, "demo@learnloop.dev"), northwind)
    assert page["totals"] == summary
    assert page["totals"]["due"] == sum(d["due"] for d in page["items"])
    for deck in page["items"]:
        assert deck["card_count"] == deck["new"] + deck["learning"] + deck["young"] + deck["mature"]
        assert 0 <= deck["mastery"] <= 100


def test_seeded_demo_has_a_realistic_review_load_for_alex(client, alex, northwind):
    totals = decks(client, alex, northwind)["totals"]
    assert 12 <= totals["due"] <= 18
    assert totals["new"] > 0


def test_decks_filter_by_course_and_search(client, alex, northwind, ml_course):
    by_course = decks(client, alex, northwind, course_id=ml_course["id"])
    assert [d["name"] for d in by_course["items"]] == ["ML Essentials"]
    assert by_course["totals"]["total"] == by_course["items"][0]["card_count"]
    searched = decks(client, alex, northwind, q="joins transactions")
    assert [d["name"] for d in searched["items"]] == ["SQL & Relational Basics"]


def test_decks_can_be_sorted_by_due_count(client, alex, northwind):
    items = decks(client, alex, northwind, sort="-due")["items"]
    assert [d["due"] for d in items] == sorted((d["due"] for d in items), reverse=True)
    response = client.get(f"/api/workspaces/{northwind}/decks", params={"sort": "colour"}, headers=alex)
    assert response.status_code == 422


def test_course_facets_hide_drafts_from_learners(client, alex, sam, northwind):
    admin_courses = {c["title"]: c for c in decks(client, alex, northwind)["courses"]}
    learner_courses = {c["title"]: c for c in decks(client, sam, northwind)["courses"]}
    assert "Data Visualization Principles" in admin_courses
    assert "Data Visualization Principles" not in learner_courses
    assert all(c["can_edit"] for c in admin_courses.values())
    assert not any(c["can_edit"] for c in learner_courses.values())
    assert learner_courses["Introduction to Machine Learning"]["decks"] == 1


def test_non_members_cannot_see_decks(client, northwind, ml_deck, newcomer):
    headers, _ = newcomer
    assert client.get(f"/api/workspaces/{northwind}/decks", headers=headers).status_code == 404
    assert client.get(f"/api/decks/{ml_deck['id']}", headers=headers).status_code == 404
    assert client.get(f"/api/decks/{ml_deck['id']}/cards", headers=headers).status_code == 404


def test_requests_need_a_session(client, seeded):
    assert client.get("/api/workspaces/1/decks").status_code == 401


# ---------- Deck CRUD ----------


def test_admin_creates_a_deck_and_it_appears_in_the_feed(client, alex, northwind, ml_course, db):
    response = client.post(
        f"/api/workspaces/{northwind}/decks",
        json={"course_id": ml_course["id"], "name": "  Evaluation metrics  ", "description": "Precision & recall"},
        headers=alex,
    )
    assert response.status_code == 201, response.text
    deck = response.json()
    assert deck["name"] == "Evaluation metrics"
    assert deck["card_count"] == 0
    assert deck["can_edit"] is True
    assert deck["created_by_name"] == "Alex Rivera"
    assert len(deck["concepts"]) == 6
    feed = db.scalars(select(Activity).where(Activity.verb == "deck.created", Activity.object_id == deck["id"])).all()
    assert [a.link for a in feed] == [f"/decks/{deck['id']}"]


