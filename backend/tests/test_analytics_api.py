from datetime import datetime, timedelta

import pytest
from conftest import find_course, login, register
from sqlalchemy import select

from app.models import Attempt, CardState, ConceptProgress, Deck, Flashcard, ReviewLog, StudyLog, User
from app.seeding.materials import SQL_TEXT
from app.services.learning import create_course

NOW = datetime(2022, 3, 14, 9, 0)


def analytics(client, headers, workspace: int, **params) -> dict:
    response = client.get(f"/api/workspaces/{workspace}/analytics", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


# ---------- Validation and access ----------


def test_analytics_requires_membership(client, sam, biology):
    assert client.get(f"/api/workspaces/{biology}/analytics").status_code == 401
    assert client.get(f"/api/workspaces/{biology}/analytics", headers=sam).status_code == 404


@pytest.mark.parametrize("days", [0, 1, 14, 365])
def test_only_supported_ranges_are_accepted(client, alex, northwind, days):
    response = client.get(f"/api/workspaces/{northwind}/analytics", params={"days": days}, headers=alex)
    assert response.status_code == 422


def test_course_filter_must_belong_to_the_workspace(client, alex, northwind, biology):
    cells = find_course(client, alex, biology, "Cell Biology")
    other = client.get(f"/api/workspaces/{northwind}/analytics", params={"course_id": cells["id"]}, headers=alex)
    assert other.status_code == 404
    missing = client.get(f"/api/workspaces/{northwind}/analytics", params={"course_id": 99999}, headers=alex)
    assert missing.status_code == 404


def test_draft_courses_are_hidden_from_learners_but_not_from_their_owner(client, sam, maya, northwind):
    draft = find_course(client, maya, northwind, "Data Visualization Principles")
    params = {"course_id": draft["id"]}
    assert client.get(f"/api/workspaces/{northwind}/analytics", params=params, headers=sam).status_code == 404
    assert client.get(f"/api/workspaces/{northwind}/analytics", params=params, headers=maya).status_code == 200


# ---------- Seeded data consistency ----------


def test_default_scope_is_the_learners_engaged_courses(client, alex, northwind):
    data = analytics(client, alex, northwind)
    titles = {c["title"] for c in data["courses_in_scope"]}
    assert {"Introduction to Machine Learning", "Statistics Fundamentals", "Relational Databases & SQL"} <= titles
    assert "Data Visualization Principles" not in titles
    assert data["range"] == {
        "days": 30,
        "start": "2022-02-13",
        "end": "2022-03-14",
        "previous_start": "2022-01-14",
        "previous_end": "2022-02-12",
        "course_id": None,
    }


@pytest.mark.parametrize("days", [7, 30, 90])
def test_kpis_agree_with_the_daily_series(client, alex, northwind, days):
    data = analytics(client, alex, northwind, days=days)
    daily, kpis = data["daily"], data["kpis"]
    assert len(daily) == days
    assert daily[-1]["date"] == "2022-03-14"
    answers = sum(d["correct"] + d["incorrect"] for d in daily)
    correct = sum(d["correct"] for d in daily)
    assert kpis["answers"]["value"] == answers
    assert kpis["accuracy"]["value"] == (round(100 * correct / answers, 1) if answers else 0)
    assert kpis["reviews"]["value"] == sum(d["reviews"] for d in daily)
    assert kpis["minutes"]["value"] == sum(d["minutes"] for d in daily)
    assert kpis["mastery"]["value"] == daily[-1]["mastery"]
    assert kpis["active_days"]["value"] <= days


def test_course_filter_narrows_every_section(client, alex, northwind, ml_course):
    data = analytics(client, alex, northwind, days=90, course_id=ml_course["id"])
    assert [c["id"] for c in data["courses_in_scope"]] == [ml_course["id"]]
    assert {row["course"]["id"] for row in data["concepts"]} == {ml_course["id"]}
    assert [c["id"] for c in data["courses"]] == [ml_course["id"]]
    assert all(s["key"] != "none" for s in data["time"]["by_course"])
    attempts = client.get(f"/api/courses/{ml_course['id']}/attempts", params={"limit": 100}, headers=alex).json()
    assert data["kpis"]["answers"]["value"] == len(attempts)
    assert data["courses"][0]["attempts"] == len(attempts)


def test_weakest_concepts_are_open_and_sorted(client, alex, northwind):
    weakest = analytics(client, alex, northwind)["weakest"]
    assert 0 < len(weakest) <= 5
    masteries = [row["mastery"] for row in weakest]
    assert masteries == sorted(masteries)
    assert all(row["unlocked"] and row["mastery"] < 85 for row in weakest)


def test_forecast_starts_with_everything_due_today(client, alex, northwind):
    cards = analytics(client, alex, northwind)["flashcards"]
    assert len(cards["forecast"]) == 14
    assert cards["forecast"][0] == {"date": "2022-03-14", "count": cards["due_now"]}
    assert sum(cards["grades"].values()) == cards["reviews"]


def test_leaderboard_shows_first_names_to_learners(client, sam, northwind):
    board = analytics(client, sam, northwind)["leaderboard"]
    me = [row for row in board if row["is_me"]]
    assert len(me) == 1 and me[0]["name"] == "Sam Okafor"
    others = [row for row in board if not row["is_me"]]
    assert others and all(" " not in row["name"] for row in others)
    ranks = [row["rank"] for row in board]
    assert ranks == sorted(ranks) and ranks[0] == 1


def test_leaderboard_shows_full_names_to_staff(client, alex, northwind):
    data = analytics(client, alex, northwind)
    assert data["can_view_learners"] is True
    assert any(row["name"] == "Sam Okafor" for row in data["leaderboard"])


# ---------- Instructor learner table ----------


def test_learner_table_is_for_instructors_only(client, sam, maya, northwind):
    assert client.get(f"/api/workspaces/{northwind}/analytics/learners", headers=sam).status_code == 403
    assert analytics(client, sam, northwind)["can_view_learners"] is False
    response = client.get(f"/api/workspaces/{northwind}/analytics/learners", headers=maya)
    assert response.status_code == 200
    data = response.json()
    assert len(data["learners"]) == 5  # every Northwind member
    course_ids = [c["id"] for c in data["courses"]]
    sam_row = next(row for row in data["learners"] if row["name"] == "Sam Okafor")
    assert [cell["course_id"] for cell in sam_row["cells"]] == course_ids
    ml = find_course(client, maya, northwind, "Introduction to Machine Learning")
    stats = find_course(client, maya, northwind, "Statistics Fundamentals")
    cells = {cell["course_id"]: cell for cell in sam_row["cells"]}
    assert cells[ml["id"]]["enrolled"] is True and cells[ml["id"]]["mastery"] is not None
    assert cells[stats["id"]]["mastery"] is None  # never enrolled or practised
    assert sam_row["answers"] > 0


def test_learner_table_mastery_matches_the_learners_own_view(client, maya, northwind):
    data = client.get(f"/api/workspaces/{northwind}/analytics/learners", headers=maya).json()
    sam_headers = login(client, "sam@learnloop.dev")
    ml = find_course(client, sam_headers, northwind, "Introduction to Machine Learning")
    sam_row = next(row for row in data["learners"] if row["name"] == "Sam Okafor")
    cell = next(cell for cell in sam_row["cells"] if cell["course_id"] == ml["id"])
    assert cell["mastery"] == ml["mastery"]


def test_learner_table_validates_days(client, maya, northwind):
    params = {"days": 5}
    assert client.get(f"/api/workspaces/{northwind}/analytics/learners", params=params, headers=maya).status_code == 422


# ---------- Exact numbers on constructed data ----------


@pytest.fixture
def scenario(client, db):
    """A fresh workspace with one course and a small, fully known history."""
    headers, workspace, _ = register(client, name="Robin Vale", email="robin@example.com", workspace="Robin")
    me = db.scalars(select(User).where(User.email == "robin@example.com")).one()
    course = create_course(db, workspace_id=workspace, owner=me, title="SQL", text=SQL_TEXT, source_name="sql.md")
    first, second = course.concepts[0], course.concepts[1]

    def attempt(concept, when: datetime, correct: bool, after: float) -> Attempt:
        return Attempt(
            user_id=me.id,
            course_id=course.id,
            concept_id=concept.id,
            concept_name=concept.name,
            selected=0,
            correct=correct,
            mastery_before=35,
            mastery_after=after,
            created_at=when,
        )

    db.add_all(
        [
            attempt(first, NOW - timedelta(days=10), True, 50),  # previous 7-day period
            attempt(first, NOW - timedelta(days=2), True, 60),
            attempt(second, NOW, False, 25),
            ConceptProgress(user_id=me.id, concept_id=first.id, mastery=60, updated_at=NOW),
            ConceptProgress(user_id=me.id, concept_id=second.id, mastery=25, updated_at=NOW),
        ]
    )
    deck = Deck(course_id=course.id, name="Keys")
    db.add(deck)
    db.flush()
    card = Flashcard(deck_id=deck.id, front="Primary key?", back="Unique row id")
    db.add(card)
    db.flush()
    for grade in (0, 2, 3, 3):
        db.add(ReviewLog(user_id=me.id, card_id=card.id, course_id=course.id, grade=grade, reviewed_at=NOW))
    db.add(ReviewLog(user_id=me.id, card_id=card.id, course_id=course.id, grade=1, reviewed_at=NOW - timedelta(9)))
    db.add(CardState(user_id=me.id, card_id=card.id, due_at=NOW + timedelta(days=3)))
    db.add_all(
        [
            StudyLog(user_id=me.id, course_id=course.id, minutes=20, activity="quiz", logged_at=NOW),
            StudyLog(user_id=me.id, minutes=10, activity="reading", logged_at=NOW - timedelta(days=1)),
        ]
    )
    db.commit()
    return headers, workspace, course


def test_mastery_is_reconstructed_from_attempt_history(client, scenario):
    headers, workspace, course = scenario
    n = len(course.concepts)
    data = analytics(client, headers, workspace, days=7)
    start = round((50 + 35 * (n - 1)) / n, 1)
    end = round((60 + 25 + 35 * (n - 2)) / n, 1)
    assert data["kpis"]["mastery"]["previous"] == start
    assert data["kpis"]["mastery"]["value"] == end
    assert [d["mastery"] for d in data["daily"]][:4] == [start] * 4
    assert data["daily"][-3]["mastery"] == round((60 + 35 * (n - 1)) / n, 1)
    assert data["courses"][0]["mastery"] == end
    assert data["courses"][0]["mastery_change"] == round(end - start, 1)


def test_period_over_period_kpis(client, scenario):
    headers, workspace, _ = scenario
    kpis = analytics(client, headers, workspace, days=7)["kpis"]
    assert kpis["answers"] == {"value": 2, "previous": 1, "change": 1, "percent": 100.0}
    assert kpis["accuracy"]["value"] == 50.0
    assert kpis["accuracy"]["previous"] == 100.0
    assert kpis["reviews"]["value"] == 4 and kpis["reviews"]["previous"] == 1
    assert kpis["retention"]["value"] == 75.0 and kpis["retention"]["previous"] == 0
    assert kpis["minutes"]["value"] == 30
    assert kpis["active_days"]["value"] == 3  # today, yesterday (study log) and two days ago


def test_concept_table_and_flashcards(client, scenario):
    headers, workspace, course = scenario
    data = analytics(client, headers, workspace, days=7)
    rows = {row["id"]: row for row in data["concepts"]}
    first, second = course.concepts[0], course.concepts[1]
    assert rows[first.id]["attempts"] == 1  # the 10-day-old answer is outside the period
    assert rows[first.id]["last_practiced"] == "2022-03-12T09:00:00"
    assert rows[second.id]["accuracy"] == 0.0
    assert rows[second.id]["level"] == "needs review"
    assert data["weakest"][0]["id"] == second.id
    cards = data["flashcards"]
    assert cards["retention"] == 75.0
    assert cards["grades"] == {"again": 1, "hard": 0, "good": 1, "easy": 2}
    assert cards["due_now"] == 0
    assert [d["count"] for d in cards["forecast"]][:4] == [0, 0, 0, 1]


def test_time_breakdown_includes_unlinked_study_only_without_a_course_filter(client, scenario):
    headers, workspace, course = scenario
    time = analytics(client, headers, workspace, days=7)["time"]
    assert time["total"] == 30
    assert [(s["label"], s["minutes"]) for s in time["by_course"]] == [("SQL", 20), ("Not linked to a course", 10)]
    assert {s["key"]: s["minutes"] for s in time["by_activity"]} == {"quiz": 20, "reading": 10}
    filtered = analytics(client, headers, workspace, days=7, course_id=course.id)["time"]
    assert filtered["total"] == 20


def test_leaderboard_always_includes_the_viewer(client, scenario, newcomer):
    headers, workspace, _ = scenario
    board = analytics(client, headers, workspace, days=7)["leaderboard"]
    assert board == [
        {
            "rank": 1,
            "user_id": board[0]["user_id"],
            "name": "Robin Vale",
            "avatar_color": board[0]["avatar_color"],
            "answers": 2,
            "correct": 1,
            "accuracy": 50.0,
            "is_me": True,
        }
    ]
    empty_headers, empty_workspace = newcomer
    empty = analytics(client, empty_headers, empty_workspace, days=7)
    assert empty["leaderboard"][0]["answers"] == 0
    assert empty["courses_in_scope"] == [] and empty["concepts"] == []
    assert empty["kpis"]["mastery"]["value"] == 0
