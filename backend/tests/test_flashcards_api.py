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


def test_deck_names_are_unique_per_course(client, alex, northwind, ml_course):
    response = client.post(
        f"/api/workspaces/{northwind}/decks",
        json={"course_id": ml_course["id"], "name": "ml essentials"},
        headers=alex,
    )
    assert response.status_code == 409


@pytest.mark.parametrize("payload", [{"name": "x"}, {"name": "   "}, {"name": "Valid", "description": "d" * 501}])
def test_deck_validation(client, alex, northwind, ml_course, payload):
    response = client.post(
        f"/api/workspaces/{northwind}/decks", json={"course_id": ml_course["id"], **payload}, headers=alex
    )
    assert response.status_code == 422


def test_learners_cannot_create_decks(client, sam, northwind, ml_course):
    response = client.post(
        f"/api/workspaces/{northwind}/decks", json={"course_id": ml_course["id"], "name": "Mine"}, headers=sam
    )
    assert response.status_code == 403


def test_courses_from_another_workspace_are_not_found(client, alex, biology, ml_course):
    response = client.post(
        f"/api/workspaces/{biology}/decks", json={"course_id": ml_course["id"], "name": "Wrong place"}, headers=alex
    )
    assert response.status_code == 404


def test_update_and_delete_deck(client, alex, sam, ml_deck, db):
    assert client.patch(f"/api/decks/{ml_deck['id']}", json={"name": "Hacked"}, headers=sam).status_code == 403
    response = client.patch(
        f"/api/decks/{ml_deck['id']}", json={"name": "ML Core", "description": "Updated"}, headers=alex
    )
    assert response.status_code == 200
    assert (response.json()["name"], response.json()["description"]) == ("ML Core", "Updated")

    card_ids = [c["id"] for c in client.get(f"/api/decks/{ml_deck['id']}/cards", headers=alex).json()["items"]]
    assert client.delete(f"/api/decks/{ml_deck['id']}", headers=sam).status_code == 403
    assert client.delete(f"/api/decks/{ml_deck['id']}", headers=alex).status_code == 204
    assert client.get(f"/api/decks/{ml_deck['id']}", headers=alex).status_code == 404
    # Every learner's schedule and history for those cards is removed with the deck.
    assert db.scalar(select(func.count()).select_from(CardState).where(CardState.card_id.in_(card_ids))) == 0
    assert db.scalar(select(func.count()).select_from(ReviewLog).where(ReviewLog.card_id.in_(card_ids))) == 0


def test_deck_detail_reports_concept_coverage(client, alex, ml_deck):
    detail = client.get(f"/api/decks/{ml_deck['id']}", headers=alex).json()
    cards = client.get(f"/api/decks/{ml_deck['id']}/cards", headers=alex).json()["items"]
    linked = [c["concept_id"] for c in cards if c["concept_id"]]
    assert linked, "the seeded deck links some cards to course concepts"
    assert {c["id"]: c["card_count"] for c in detail["concepts"]} == {
        c["id"]: linked.count(c["id"]) for c in detail["concepts"]
    }


# ---------- Cards ----------


def test_card_list_includes_the_learners_schedule(client, alex, sam, ml_deck):
    alex_cards = client.get(f"/api/decks/{ml_deck['id']}/cards", headers=alex).json()
    sam_cards = client.get(f"/api/decks/{ml_deck['id']}/cards", headers=sam).json()
    assert alex_cards["total"] == 16
    assert [c["position"] for c in alex_cards["items"]] == list(range(16))
    reviewed = [c for c in alex_cards["items"] if c["status"] != "new"]
    assert reviewed and all(c["reviews"] >= 1 and c["due_at"] for c in reviewed)
    assert sum(alex_cards["counts"].values()) == 16
    # Schedules are personal: the same cards have different states for another learner.
    assert alex_cards["counts"] != sam_cards["counts"]


def test_card_list_filters_searches_and_sorts(client, alex, ml_deck):
    url = f"/api/decks/{ml_deck['id']}/cards"
    found = client.get(url, params={"q": "learning rate"}, headers=alex).json()["items"]
    assert {c["front"] for c in found} == {
        "What does the learning rate control?",
        "What happens when the learning rate is too large?",
        "What happens when the learning rate is too small?",
    }
    young = client.get(url, params={"status": "young"}, headers=alex).json()
    assert young["total"] == young["counts"]["young"]
    assert all(c["status"] == "young" for c in young["items"])
    by_due = client.get(url, params={"sort": "due_at"}, headers=alex).json()["items"]
    due_dates = [c["due_at"] for c in by_due if c["due_at"]]
    assert due_dates == sorted(due_dates)
    assert client.get(url, params={"status": "ancient"}, headers=alex).status_code == 422


def test_create_update_and_delete_a_card(client, alex, ml_deck, ml_course):
    concept = next(c for c in client.get(f"/api/courses/{ml_course['id']}", headers=alex).json()["concepts"])
    created = client.post(
        f"/api/decks/{ml_deck['id']}/cards",
        json={"front": "What is a label?", "back": "The target value", "hint": "y", "concept_id": concept["id"]},
        headers=alex,
    )
    assert created.status_code == 201, created.text
    card = created.json()
    assert card["status"] == "new"
    assert card["position"] == 16
    assert card["concept_name"] == concept["name"]

    updated = client.patch(f"/api/cards/{card['id']}", json={"back": "The value to predict"}, headers=alex).json()
    assert updated["back"] == "The value to predict"
    assert updated["concept_id"] == concept["id"]
    unlinked = client.patch(f"/api/cards/{card['id']}", json={"concept_id": None}, headers=alex).json()
    assert unlinked["concept_id"] is None

    assert client.delete(f"/api/cards/{card['id']}", headers=alex).status_code == 204
    assert client.patch(f"/api/cards/{card['id']}", json={"back": "x"}, headers=alex).status_code == 404


def test_card_validation(client, alex, ml_deck):
    url = f"/api/decks/{ml_deck['id']}/cards"
    assert client.post(url, json={"front": "  ", "back": "x"}, headers=alex).status_code == 422
    assert client.post(url, json={"front": "x", "back": "y" * 2001}, headers=alex).status_code == 422
    duplicate = client.post(url, json={"front": "define   PRECISION.", "back": "x"}, headers=alex)
    assert duplicate.status_code == 409


def test_cards_can_only_link_concepts_of_their_course(client, alex, northwind, ml_deck):
    stats = find_course(client, alex, northwind, "Statistics Fundamentals")
    foreign = client.get(f"/api/courses/{stats['id']}", headers=alex).json()["concepts"][0]["id"]
    response = client.post(
        f"/api/decks/{ml_deck['id']}/cards", json={"front": "Q", "back": "A", "concept_id": foreign}, headers=alex
    )
    assert response.status_code == 422


def test_learners_can_read_but_not_edit_cards(client, sam, ml_deck):
    cards = client.get(f"/api/decks/{ml_deck['id']}/cards", headers=sam)
    assert cards.status_code == 200
    card_id = cards.json()["items"][0]["id"]
    assert (
        client.post(f"/api/decks/{ml_deck['id']}/cards", json={"front": "Q", "back": "A"}, headers=sam).status_code
        == 403
    )
    assert client.patch(f"/api/cards/{card_id}", json={"back": "x"}, headers=sam).status_code == 403
    assert client.delete(f"/api/cards/{card_id}", headers=sam).status_code == 403


# ---------- Import and generation ----------


def test_import_dry_run_reports_without_creating(client, alex, ml_deck):
    text = "Bias :: Systematic error\nno separator\nDefine recall. :: duplicate\n# comment"
    response = client.post(
        f"/api/decks/{ml_deck['id']}/cards/import", json={"text": text, "dry_run": True}, headers=alex
    )
    assert response.status_code == 200
    body = response.json()
    assert body["created"] == 0
    assert [a["front"] for a in body["accepted"]] == ["Bias"]
    assert [(r["line"], r["reason"]) for r in body["rejected"]] == [
        (2, "Missing the ' :: ' separator between front and back"),
        (3, "A card with this front already exists"),
    ]
    assert client.get(f"/api/decks/{ml_deck['id']}", headers=alex).json()["card_count"] == 16


def test_import_creates_accepted_cards_in_order(client, own_deck):
    headers, _, deck = own_deck
    body = import_cards(client, headers, deck["id"], 3)
    assert body["created"] == 3
    cards = client.get(f"/api/decks/{deck['id']}/cards", headers=headers).json()["items"]
    assert [(c["front"], c["position"]) for c in cards] == [("Card 1", 0), ("Card 2", 1), ("Card 3", 2)]


def test_import_limits(client, own_deck):
    headers, _, deck = own_deck
    url = f"/api/decks/{deck['id']}/cards/import"
    assert client.post(url, json={"text": "# only a comment\n\n"}, headers=headers).status_code == 422
    too_many = "\n".join(f"q{n} :: a" for n in range(501))
    assert client.post(url, json={"text": too_many}, headers=headers).status_code == 422


def test_generate_from_concepts_skips_covered_concepts(client, own_deck):
    headers, _, deck = own_deck
    detail = client.get(f"/api/decks/{deck['id']}", headers=headers).json()
    concepts = detail["concepts"]
    assert concepts
    first = client.post(f"/api/decks/{deck['id']}/cards/generate", headers=headers).json()
    assert len(first["created"]) == len(concepts)
    assert first["skipped"] == 0
    card = first["created"][0]
    assert card["front"] == f"What should you remember about {concepts[0]['name']}?"
    assert card["back"] == concepts[0]["summary"]
    assert card["concept_id"] == concepts[0]["id"]
    again = client.post(f"/api/decks/{deck['id']}/cards/generate", headers=headers).json()
    assert again == {"created": [], "skipped": len(concepts)}


def test_generate_skips_concepts_with_hand_written_cards(client, alex, ml_deck):
    concepts = client.get(f"/api/decks/{ml_deck['id']}", headers=alex).json()["concepts"]
    uncovered = [c["id"] for c in concepts if c["card_count"] == 0]
    body = client.post(f"/api/decks/{ml_deck['id']}/cards/generate", headers=alex).json()
    assert [c["concept_id"] for c in body["created"]] == uncovered
    assert body["skipped"] == len(concepts) - len(uncovered) > 0
    assert [c["position"] for c in body["created"]] == list(range(16, 16 + len(uncovered)))


# ---------- Review queue ----------


def test_queue_lists_due_cards_by_due_date_then_new_cards(client, alex, northwind):
    response = client.get(f"/api/workspaces/{northwind}/review/queue", headers=alex)
    assert response.status_code == 200
    queue = response.json()
    due = [c for c in queue["cards"] if c["status"] != "new"]
    new = [c for c in queue["cards"] if c["status"] == "new"]
    assert queue["cards"] == due + new
    assert len(due) == queue["due"]
    assert len(new) == min(queue["new"], queue["new_allowance"])
    assert [c["due_at"] for c in due] == sorted(c["due_at"] for c in due)
    assert all(datetime.fromisoformat(c["due_at"]) < datetime.fromisoformat(NOW) + timedelta(days=1) for c in due)
    assert all(len(c["previews"]) == 4 for c in queue["cards"])
    assert queue["next_due_at"] > NOW


def test_queue_can_be_scoped_to_one_deck(client, alex, northwind):
    sql_deck = deck_named(client, alex, northwind, "SQL & Relational Basics")
    queue = client.get(
        f"/api/workspaces/{northwind}/review/queue", params={"deck_id": sql_deck["id"]}, headers=alex
    ).json()
    assert {c["deck_id"] for c in queue["cards"]} == {sql_deck["id"]}
    assert queue["due"] == sql_deck["due"]
    fresh = [c for c in queue["cards"] if c["status"] == "new"]
    assert len(fresh) == sql_deck["new"] > 0
    assert [p["interval_days"] for p in fresh[0]["previews"]] == [0, 1, 1, 4]
    assert [p["display"] for p in fresh[0]["previews"]] == ["10m", "1d", "1d", "4d"]


def test_queue_respects_the_new_card_parameter_and_limit(client, alex, northwind):
    url = f"/api/workspaces/{northwind}/review/queue"
    no_new = client.get(url, params={"new": 0}, headers=alex).json()
    assert all(c["status"] != "new" for c in no_new["cards"])
    limited = client.get(url, params={"limit": 3}, headers=alex).json()
    assert len(limited["cards"]) == 3
    assert client.get(url, params={"new": DAILY_NEW_LIMIT + 1}, headers=alex).status_code == 422


def test_queue_for_a_deck_in_another_workspace_is_not_found(client, alex, biology, ml_deck):
    response = client.get(f"/api/workspaces/{biology}/review/queue", params={"deck_id": ml_deck["id"]}, headers=alex)
    assert response.status_code == 404


def test_daily_new_card_limit_applies_across_sessions(client, own_deck):
    headers, workspace, deck = own_deck
    import_cards(client, headers, deck["id"], DAILY_NEW_LIMIT + 5)
    url = f"/api/workspaces/{workspace}/review/queue"
    first = client.get(url, headers=headers).json()
    assert len(first["cards"]) == DAILY_NEW_LIMIT
    for card in first["cards"][:15]:
        assert client.post(f"/api/cards/{card['id']}/review", json={"grade": 2}, headers=headers).status_code == 200
    later = client.get(url, headers=headers).json()
    assert later["new_allowance"] == DAILY_NEW_LIMIT - 15
    assert [c["status"] for c in later["cards"]] == ["new"] * 5
    assert later["new"] == 10


# ---------- Grading ----------


def test_grading_a_new_card_schedules_it_and_logs_the_review(client, own_deck, db):
    headers, workspace, deck = own_deck
    import_cards(client, headers, deck["id"], 2)
    card = client.get(f"/api/workspaces/{workspace}/review/queue", headers=headers).json()["cards"][0]
    response = client.post(f"/api/cards/{card['id']}/review", json={"grade": 2}, headers=headers)
    assert response.status_code == 200
    result = response.json()
    assert (result["interval_before"], result["interval_days"], result["display"]) == (0, 1, "1d")
    assert result["status"] == "young"
    assert result["due_at"] == "2022-03-15T09:00:00"
    log = db.scalars(select(ReviewLog).where(ReviewLog.card_id == card["id"])).one()
    assert (log.grade, log.interval_after, log.ease_after) == (2, 1, 2.5)
    # Graded "good" -> not due again today, so it leaves the queue.
    queue = client.get(f"/api/workspaces/{workspace}/review/queue", headers=headers).json()
    assert card["id"] not in [c["id"] for c in queue["cards"]]


def test_again_brings_the_card_back_today(client, own_deck):
    headers, workspace, deck = own_deck
    import_cards(client, headers, deck["id"], 1)
    card = client.get(f"/api/workspaces/{workspace}/review/queue", headers=headers).json()["cards"][0]
    result = client.post(f"/api/cards/{card['id']}/review", json={"grade": 0}, headers=headers).json()
    assert (result["interval_days"], result["display"], result["status"]) == (0, "10m", "learning")
    queue = client.get(f"/api/workspaces/{workspace}/review/queue", headers=headers).json()
    assert [c["id"] for c in queue["cards"]] == [card["id"]]
    assert queue["cards"][0]["status"] == "learning"


def test_grading_a_due_card_follows_the_scheduler(client, alex, northwind):
    card = next(
        c
        for c in client.get(f"/api/workspaces/{northwind}/review/queue", headers=alex).json()["cards"]
        if c["status"] == "young" and c["repetitions"] >= 2
    )
    preview = {p["grade"]: p["interval_days"] for p in card["previews"]}
    result = client.post(f"/api/cards/{card['id']}/review", json={"grade": 3}, headers=alex).json()
    assert result["interval_days"] == preview[3]
    assert result["interval_before"] == card["interval_days"]
    assert result["ease"] == pytest.approx(card["ease"] + 0.15)
    assert result["repetitions"] == card["repetitions"] + 1


@pytest.mark.parametrize("grade", [-1, 4, "good"])
def test_invalid_grades_are_rejected(client, alex, ml_deck, grade):
    card_id = client.get(f"/api/decks/{ml_deck['id']}/cards", headers=alex).json()["items"][0]["id"]
    assert client.post(f"/api/cards/{card_id}/review", json={"grade": grade}, headers=alex).status_code == 422


def test_non_members_cannot_review(client, alex, ml_deck, newcomer):
    headers, _ = newcomer
    card_id = client.get(f"/api/decks/{ml_deck['id']}/cards", headers=alex).json()["items"][0]["id"]
    assert client.post(f"/api/cards/{card_id}/review", json={"grade": 2}, headers=headers).status_code == 404


# ---------- Sessions and stats ----------


def test_finishing_a_session_logs_study_time_and_activity(client, own_deck, db):
    headers, workspace, deck = own_deck
    import_cards(client, headers, deck["id"], 3)
    for card in client.get(f"/api/workspaces/{workspace}/review/queue", headers=headers).json()["cards"]:
        client.post(
            f"/api/cards/{card['id']}/review", json={"grade": 0 if card["front"] == "Card 1" else 2}, headers=headers
        )
    response = client.post(
        f"/api/workspaces/{workspace}/review/sessions",
        json={"deck_id": deck["id"], "reviewed": 3, "again": 1, "duration_seconds": 150},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["minutes"], body["reviewed"], body["accuracy"]) == (3, 3, 66.7)
    log = db.get(StudyLog, body["study_log_id"])
    assert (log.activity, log.minutes, log.course_id) == ("flashcards", 3, deck["course_id"])
    assert log.note == "Reviewed 3 flashcards in Photosynthesis"
    activity = db.scalars(select(Activity).where(Activity.verb == "flashcards.reviewed")).one()
    assert activity.link == f"/decks/{deck['id']}"


def test_session_counts_must_match_recorded_reviews(client, own_deck):
    headers, workspace, deck = own_deck
    url = f"/api/workspaces/{workspace}/review/sessions"
    payload = {"reviewed": 2, "duration_seconds": 60}
    assert client.post(url, json=payload, headers=headers).status_code == 422
    import_cards(client, headers, deck["id"], 1)
    card = client.get(f"/api/workspaces/{workspace}/review/queue", headers=headers).json()["cards"][0]
    client.post(f"/api/cards/{card['id']}/review", json={"grade": 3}, headers=headers)
    assert client.post(url, json=payload, headers=headers).status_code == 422
    response = client.post(url, json={"reviewed": 1, "duration_seconds": 20}, headers=headers)
    assert response.status_code == 201
    assert response.json()["minutes"] == 1
    assert response.json()["course_id"] == deck["course_id"]


def test_session_minutes_are_capped(client, own_deck):
    headers, workspace, deck = own_deck
    import_cards(client, headers, deck["id"], 1)
    card = client.get(f"/api/workspaces/{workspace}/review/queue", headers=headers).json()["cards"][0]
    client.post(f"/api/cards/{card['id']}/review", json={"grade": 2}, headers=headers)
    url = f"/api/workspaces/{workspace}/review/sessions"
    assert client.post(url, json={"reviewed": 1, "duration_seconds": 5 * 3600}, headers=headers).status_code == 422
    capped = client.post(url, json={"reviewed": 1, "duration_seconds": 4 * 3600}, headers=headers).json()
    assert capped["minutes"] == 240


def test_stats_summarise_workload_retention_and_forecast(client, alex, northwind, db):
    stats = client.get(f"/api/workspaces/{northwind}/review/stats", headers=alex).json()
    summary = due_summary(db, user_id(db, "demo@learnloop.dev"), northwind)
    assert stats["due_today"] == summary["due"]
    assert stats["new_available"] == summary["new"]
    assert stats["total_cards"] == summary["total"]
    assert stats["reviewed_today"] == 0
    assert len(stats["forecast"]) == 14 and stats["forecast"][0]["date"] == "2022-03-14"
    assert stats["forecast"][0]["due"] == summary["due"]
    assert len(stats["history"]) == 14 and stats["history"][-1]["date"] == "2022-03-14"
    assert stats["reviews_30d"] >= sum(h["reviews"] for h in stats["history"]) > 0
    assert 0 < stats["retention_30d"] <= 100
    assert stats["learning"] + stats["young"] + stats["mature"] == summary["total"] - summary["new"]


def test_stats_update_after_reviewing(client, alex, northwind):
    url = f"/api/workspaces/{northwind}/review/stats"
    before = client.get(url, headers=alex).json()
    card = client.get(f"/api/workspaces/{northwind}/review/queue", headers=alex).json()["cards"][0]
    client.post(f"/api/cards/{card['id']}/review", json={"grade": 0}, headers=alex)
    after = client.get(url, headers=alex).json()
    assert after["reviewed_today"] == before["reviewed_today"] + 1
    assert after["again_today"] == before["again_today"] + 1
    assert after["history"][-1] == {"date": "2022-03-14", "reviews": 1, "again": 1}
    assert after["retention_30d"] < before["retention_30d"]


def test_stats_can_be_scoped_to_a_deck(client, alex, northwind, ml_deck):
    stats = client.get(
        f"/api/workspaces/{northwind}/review/stats", params={"deck_id": ml_deck["id"]}, headers=alex
    ).json()
    assert stats["total_cards"] == ml_deck["card_count"]
    assert stats["due_today"] == ml_deck["due"]


def test_other_learners_have_their_own_schedules(client, sam, northwind, db):
    stats = client.get(f"/api/workspaces/{northwind}/review/stats", headers=sam).json()
    assert stats["due_today"] == due_summary(db, user_id(db, "sam@learnloop.dev"), northwind)["due"]
    priya = login(client, "priya@learnloop.dev")
    priya_decks = client.get(f"/api/workspaces/{northwind}/decks", headers=priya).json()
    assert priya_decks["totals"]["new"] > stats["new_available"]
