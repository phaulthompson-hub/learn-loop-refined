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


