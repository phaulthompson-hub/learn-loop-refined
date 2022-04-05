from datetime import date, datetime, timedelta

from conftest import login, register
from sqlalchemy import select

from app.models import Attempt, Deck, Event, Flashcard, Goal, ReviewLog, StudyLog, Task, User, Workspace
from app.seeding.materials import SQL_TEXT
from app.services.accounts import add_member
from app.services.learning import create_course
from app.services.progress import goal_progress
from app.services.review_queue import due_summary

NOW = datetime(2022, 3, 14, 9, 0)
TODAY = NOW.date()


def home(client, headers, workspace: int) -> dict:
    response = client.get(f"/api/workspaces/{workspace}/home", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def user_by_email(db, email: str) -> User:
    return db.scalars(select(User).where(User.email == email)).one()


def second_member(client, db, workspace: int) -> tuple[dict, User]:
    """Register a classmate and add them to `workspace` as a learner."""
    headers, _, _ = register(client, name="Casey Park", email="casey@example.com", workspace="Casey's space")
    casey = user_by_email(db, "casey@example.com")
    add_member(db, db.get(Workspace, workspace), casey)
    db.commit()
    return headers, casey


def event(db, workspace: int, user: User, title: str, start: datetime, minutes: int = 60, **extra) -> Event:
    row = Event(
        workspace_id=workspace,
        user_id=user.id,
        title=title,
        starts_at=start,
        ends_at=start + timedelta(minutes=minutes),
        **extra,
    )
    db.add(row)
    db.commit()
    return row


# ---------- Access ----------


def test_home_requires_sign_in_and_membership(client, alex, biology, sam):
    assert client.get(f"/api/workspaces/{biology}/home").status_code == 401
    assert client.get(f"/api/workspaces/{biology}/home", headers=sam).status_code == 404


# ---------- Seeded dashboard ----------


def test_greeting_uses_first_name_and_the_frozen_clock(client, alex, northwind):
    greeting = home(client, alex, northwind)["greeting"]
    assert greeting == {
        "first_name": "Alex",
        "part_of_day": "morning",
        "today": "2022-03-14",
        "now": "2022-03-14T09:00:00",
    }


def test_due_cards_match_the_review_queue(client, alex, northwind, db):
    data = home(client, alex, northwind)
    user = user_by_email(db, "demo@learnloop.dev")
    assert data["flashcards"] == due_summary(db, user.id, northwind)


def test_continue_learning_puts_pinned_then_recently_opened_courses_first(client, alex, northwind):
    cards = home(client, alex, northwind)["continue_learning"]
    titles = [c["title"] for c in cards]
    assert titles[0] == "Introduction to Machine Learning"
    assert cards[0]["pinned"] is True
    assert titles.index("Statistics Fundamentals") < titles.index("Relational Databases & SQL")
    assert "Data Visualization Principles" not in titles  # draft courses never appear
    for card in cards:
        expected = round(100 * card["mastered_concepts"] / card["concepts"], 1)
        assert card["progress"] == expected


def test_continue_learning_recommends_the_same_concept_as_the_course_page(client, alex, northwind):
    for card in home(client, alex, northwind)["continue_learning"]:
        recommendation = client.get(f"/api/courses/{card['id']}/recommendation", headers=alex).json()
        assert card["next"] == recommendation


def test_focus_is_the_weakest_recommendation_across_enrolled_courses(client, alex, northwind):
    data = home(client, alex, northwind)
    recommendations = [
        client.get(f"/api/courses/{c['id']}/recommendation", headers=alex).json() for c in data["continue_learning"]
    ]
    weakest = min((r for r in recommendations if r["concept_id"]), key=lambda r: r["mastery"])
    focus = data["focus"]
    assert focus["concept_id"] == weakest["concept_id"]
    assert focus["mastery"] == weakest["mastery"]
    assert focus["level"] in {"needs review", "learning", "proficient"}


def test_recent_activity_is_newest_first_and_limited(client, alex, northwind):
    items = home(client, alex, northwind)["activity"]
    assert 0 < len(items) <= 6
    stamps = [item["created_at"] for item in items]
    assert stamps == sorted(stamps, reverse=True)
    assert all(item["workspace_id"] == northwind for item in items)


# ---------- A fresh workspace ----------


def test_empty_workspace_returns_onboarding_state(client, newcomer):
    headers, workspace = newcomer
    data = home(client, headers, workspace)
    assert data["greeting"]["first_name"] == "Test"
    assert data["onboarding"] == {
        "courses": 0,
        "enrolled": 0,
        "decks": 0,
        "events": 0,
        "goals": 0,
        "can_create_courses": True,
    }
    assert data["continue_learning"] == []
    assert data["focus"] is None
    assert data["agenda"] == []
    assert data["tasks"] == {"items": [], "total_open": 0, "overdue": 0}
    assert data["flashcards"] == {"due": 0, "new": 0, "total": 0}
    assert data["week"]["answers"] == {"value": 0, "previous": 0, "change": 0, "percent": None}
    assert len(data["week"]["days"]) == 7
    assert data["streak"]["current"] == 0


