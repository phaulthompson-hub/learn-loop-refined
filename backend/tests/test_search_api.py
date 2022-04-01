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


def test_snippets_come_from_the_matching_field(client, alex, northwind):
    result = search(client, alex, northwind, "harmonic", types="note")
    (hit,) = group(result, "note")
    assert hit["title"] == "Precision vs recall"
    text = hit["snippet"]["text"]
    assert [text[s:e] for s, e in hit["snippet"]["highlights"]] == ["harmonic"]
    assert hit["title_highlights"] == []


def test_courses_match_on_description_and_tags(client, alex, northwind):
    result = search(client, alex, northwind, "normalization", types="course")
    (course,) = group(result, "course")
    assert course["title"] == "Relational Databases & SQL"
    assert course["subtitle"] == "Data Engineering · Intermediate"
    assert course["snippet"]["text"].startswith("Keys, joins, aggregation")


def test_counts_include_results_beyond_the_limit(client, alex, northwind, db):
    for index in range(3):
        add_task(db, northwind, f"Review {WORD} chapter {index + 1}")
    result = search(client, alex, northwind, WORD, limit=2)
    assert result["counts"]["task"] == 3
    assert len(group(result, "task")) == 2


# ---------- Other result types ----------


def test_tasks_link_to_the_board_by_number(client, alex, northwind, db):
    task = add_task(db, northwind, "Prepare quiz", description=f"Cover the {WORD} examples first")
    (hit,) = group(search(client, alex, northwind, WORD), "task")
    assert hit["link"] == f"/board?task={task.number}"
    assert hit["subtitle"] == f"NDA-{task.number} · In progress"
    assert WORD in hit["snippet"]["text"]


def test_flashcards_link_to_their_deck(client, alex, northwind, db, ml_course):
    card = add_card(db, ml_course["id"], f"What does {WORD} measure?", "Nothing, it is a made-up word.")
    (hit,) = group(search(client, alex, northwind, WORD), "card")
    assert hit["id"] == card.id
    assert hit["link"] == f"/decks/{card.deck_id}"
    assert hit["subtitle"] == "Search test deck · Introduction to Machine Learning"


def test_events_show_own_and_shared_only(client, sam, northwind, db):
    add_event(db, northwind, "maya@learnloop.dev", f"Private {WORD} prep", shared=False)
    shared = add_event(db, northwind, "maya@learnloop.dev", f"{WORD.title()} midterm", shared=True)
    (hit,) = group(search(client, sam, northwind, WORD), "event")
    assert hit["id"] == shared.id
    assert hit["link"] == "/planner?date=2022-03-17"
    assert hit["subtitle"] == "Exam · Thu 17 Mar, 14:30"


# ---------- Visibility ----------


def test_draft_courses_and_their_content_are_hidden_from_learners(client, alex, sam, northwind, db):
    viz = find_course(client, alex, northwind, "Data Visualization Principles")
    add_card(db, viz["id"], f"{WORD} chart question", "answer")
    learner = search(client, sam, northwind, "visualization principles")
    assert "Data Visualization Principles" not in titles(learner, "course")
    assert search(client, sam, northwind, WORD)["counts"]["card"] == 0
    admin = search(client, alex, northwind, "visualization principles")
    course = group(admin, "course")[0]
    assert course["title"] == "Data Visualization Principles" and course["subtitle"].endswith("Draft")
    assert search(client, alex, northwind, WORD)["counts"]["card"] == 1


def test_private_notes_are_only_found_by_their_author(client, alex, sam, northwind):
    assert "Loss functions compared" not in titles(search(client, sam, northwind, "loss functions"), "note")
    assert "Loss functions compared" in titles(search(client, alex, northwind, "loss functions"), "note")
    assert "Interview prep" not in titles(search(client, alex, northwind, "interview"), "note")
    mine = group(search(client, sam, northwind, "interview"), "note")
    assert [n["title"] for n in mine] == ["Interview prep"] and mine[0]["subtitle"] == "Note"


def test_shared_notes_name_their_author(client, sam, northwind):
    backprop = group(search(client, sam, northwind, "backprop", types="note"), "note")[0]
    assert backprop["subtitle"] == "Neural Networks in Practice · by Maya Chen"


def test_results_stay_inside_the_workspace(client, alex, northwind, biology):
    assert search(client, alex, northwind, "punnett")["counts"]["note"] == 0
    assert titles(search(client, alex, biology, "punnett"), "note")[0] == "Punnett square walkthrough"


def test_archived_notes_are_not_searched(client, alex, northwind):
    assert search(client, alex, northwind, "reading list", types="note")["counts"]["note"] == 0
