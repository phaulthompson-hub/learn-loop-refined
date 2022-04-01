from datetime import datetime

import pytest
from conftest import find_course
from sqlalchemy import func, select

from app.models import Deck, Event, Flashcard, Task, User

# A made-up word that appears nowhere in the demo data, so counts are exact.
WORD = "zephyrine"


def search(client, headers, workspace: int, q: str, **params) -> dict:
    response = client.get(f"/api/workspaces/{workspace}/search", params={"q": q, **params}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def group(result: dict, kind: str) -> list[dict]:
    return next((g["items"] for g in result["groups"] if g["type"] == kind), [])


def titles(result: dict, kind: str) -> list[str]:
    return [item["title"] for item in group(result, kind)]


def user_id(db, email: str) -> int:
    return db.scalars(select(User.id).where(User.email == email)).one()


def add_task(db, workspace: int, title: str, description: str = "") -> Task:
    number = (db.scalar(select(func.max(Task.number)).where(Task.workspace_id == workspace)) or 0) + 1
    task = Task(
        workspace_id=workspace,
        number=number,
        title=title,
        description=description,
        status="in_progress",
        reporter_id=user_id(db, "maya@learnloop.dev"),
    )
    db.add(task)
    db.commit()
    return task


def add_card(db, course_id: int, front: str, back: str) -> Flashcard:
    deck = Deck(course_id=course_id, name="Search test deck")
    db.add(deck)
    db.flush()
    card = Flashcard(deck_id=deck.id, front=front, back=back)
    db.add(card)
    db.commit()
    return card


def add_event(db, workspace: int, owner: str, title: str, shared: bool) -> Event:
    event = Event(
        workspace_id=workspace,
        user_id=user_id(db, owner),
        title=title,
        kind="exam",
        starts_at=datetime(2022, 3, 17, 14, 30),
        ends_at=datetime(2022, 3, 17, 16, 0),
        shared=shared,
    )
    db.add(event)
    db.commit()
    return event


# ---------- Request handling ----------


def test_blank_query_returns_no_groups(client, alex, northwind):
    result = search(client, alex, northwind, "   ")
    assert result["groups"] == [] and result["total"] == 0
    assert result["counts"] == {"course": 0, "concept": 0, "note": 0, "task": 0, "card": 0, "event": 0}


@pytest.mark.parametrize("params", [{"types": "note,widgets"}, {"limit": 0}, {"limit": 51}, {"q": "x" * 101}])
def test_invalid_parameters_are_rejected(client, alex, northwind, params):
    response = client.get(f"/api/workspaces/{northwind}/search", params={"q": "sql", **params}, headers=alex)
    assert response.status_code == 422


def test_non_members_get_404(client, northwind, newcomer):
    headers, _ = newcomer
    assert client.get(f"/api/workspaces/{northwind}/search", params={"q": "sql"}, headers=headers).status_code == 404


def test_types_restrict_the_searched_groups(client, alex, northwind):
    result = search(client, alex, northwind, "joins", types="note, NOTE")
    assert list(result["counts"]) == ["note"]
    assert {g["type"] for g in result["groups"]} == {"note"}
    assert result["terms"] == ["joins"]


# ---------- Ranking, grouping and links ----------


def test_results_are_grouped_with_links_and_highlights(client, alex, northwind, ml_course):
    result = search(client, alex, northwind, "gradient descent")
    concept = group(result, "concept")[0]
    assert concept["title"] == "Gradient Descent"
    assert concept["link"] == f"/courses/{ml_course['id']}"
    assert concept["subtitle"] == "Introduction to Machine Learning"
    note = next(n for n in group(result, "note") if n["title"] == "Gradient descent cheat sheet")
    assert note["link"] == f"/notes/{note['id']}"
    assert [note["title"][s:e] for s, e in note["title_highlights"]] == ["Gradient descent"]
    assert result["total"] == sum(result["counts"].values())
    top_scores = [g["items"][0]["score"] for g in result["groups"]]
    assert top_scores == sorted(top_scores, reverse=True)


def test_exact_title_ranks_above_partial_matches(client, alex, northwind):
    result = search(client, alex, northwind, "sql joins field guide", types="note")
    assert titles(result, "note")[0] == "SQL joins field guide"


def test_all_terms_must_match(client, alex, northwind):
    assert search(client, alex, northwind, f"joins {WORD}")["total"] == 0


