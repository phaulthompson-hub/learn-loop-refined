import pytest
from conftest import NOW, find_course
from sqlalchemy import select

from app.models import Activity, Note


def notes_url(workspace: int) -> str:
    return f"/api/workspaces/{workspace}/notes"


def list_notes(client, headers, workspace: int, **params) -> dict:
    response = client.get(notes_url(workspace), params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def find_note(client, headers, workspace: int, title: str, **params) -> dict:
    page = list_notes(client, headers, workspace, q=title, page_size=100, **params)
    return next(n for n in page["items"] if n["title"] == title)


def create(client, headers, workspace: int, **body) -> dict:
    response = client.post(notes_url(workspace), json={"title": "Scratch", **body}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def concept_named(course: dict, name: str) -> dict:
    return next(c for c in course["concepts"] if c["name"] == name)


def course_detail(client, headers, course_id: int) -> dict:
    return client.get(f"/api/courses/{course_id}", headers=headers).json()


# ---------- Listing and visibility ----------


def test_list_shows_own_and_shared_notes_with_pinned_first(client, alex, northwind):
    page = list_notes(client, alex, northwind, page_size=100)
    assert page["counts"] == {"mine": 10, "shared": 3, "archived": 1}
    assert page["total"] == 13
    titles = [n["title"] for n in page["items"]]
    assert titles[:2] == ["Gradient descent cheat sheet", "SQL joins field guide"]
    assert all(n["pinned"] for n in page["items"][:2]) and not any(n["pinned"] for n in page["items"][2:])
    unpinned = [n["updated_at"] for n in page["items"][2:]]
    assert unpinned == sorted(unpinned, reverse=True)
    assert "Interview prep" not in titles  # Sam's private note
    assert "ML reading list (old)" not in titles  # archived


def test_author_filters_split_mine_and_others(client, alex, northwind):
    others = list_notes(client, alex, northwind, author="others")
    assert {n["title"] for n in others["items"]} == {
        "Common SQL mistakes (instructor notes)",
        "Backprop derivation notes",
        "Index tuning notes",
    }
    assert all(not n["mine"] and n["shared"] for n in others["items"])
    mine = list_notes(client, alex, northwind, author="me", page_size=100)
    assert mine["total"] == 10 and all(n["mine"] for n in mine["items"])


def test_archived_tab_lists_only_own_archived_notes(client, alex, northwind):
    page = list_notes(client, alex, northwind, archived=True)
    assert [n["title"] for n in page["items"]] == ["ML reading list (old)"]
    assert page["items"][0]["archived"] is True


def test_filters_by_tag_course_concept_and_pinned(client, alex, northwind):
    sql_tagged = list_notes(client, alex, northwind, tag="#SQL", page_size=100)
    assert sql_tagged["total"] == 5
    sql = find_course(client, alex, northwind, "Relational Databases & SQL")
    by_course = list_notes(client, alex, northwind, course_id=sql["id"], page_size=100)
    assert {n["course"]["id"] for n in by_course["items"]} == {sql["id"]}
    ml = course_detail(client, alex, find_course(client, alex, northwind, "Introduction to Machine Learning")["id"])
    gradient = concept_named(ml, "Gradient Descent")
    by_concept = list_notes(client, alex, northwind, concept_id=gradient["id"])
    assert [n["title"] for n in by_concept["items"]] == ["Gradient descent cheat sheet"]
    assert by_concept["items"][0]["concept"] == {"id": gradient["id"], "name": "Gradient Descent"}
    pinned = list_notes(client, alex, northwind, pinned=True)
    assert {n["title"] for n in pinned["items"]} == {"Gradient descent cheat sheet", "SQL joins field guide"}


def test_query_ranks_by_relevance_and_highlights_the_excerpt(client, alex, northwind):
    page = list_notes(client, alex, northwind, q="joins")
    assert page["items"][0]["title"] == "SQL joins field guide"
    # The excerpt skips the title heading, so highlight a phrase from the body instead.
    matched = list_notes(client, alex, northwind, q="match rows")["items"][0]
    excerpt = matched["excerpt"]
    assert matched["title"] == "SQL joins field guide"
    assert {excerpt["text"][s:e].lower() for s, e in excerpt["highlights"]} >= {"match", "rows"}
    both = list_notes(client, alex, northwind, q="window partition")
    assert [n["title"] for n in both["items"]] == ["Window functions scratchpad"]


def test_sort_by_title_and_invalid_sort(client, alex, northwind):
    page = list_notes(client, alex, northwind, sort="title", author="others")
    assert [n["title"] for n in page["items"]] == [
        "Backprop derivation notes",
        "Common SQL mistakes (instructor notes)",
        "Index tuning notes",
    ]
    assert client.get(notes_url(northwind), params={"sort": "body"}, headers=alex).status_code == 422
    assert client.get(notes_url(northwind), params={"author": "everyone"}, headers=alex).status_code == 422


def test_pagination(client, alex, northwind):
    first = list_notes(client, alex, northwind, page_size=5)
    second = list_notes(client, alex, northwind, page_size=5, page=2)
    assert first["total"] == second["total"] == 13
    assert len(first["items"]) == 5
    assert not {n["id"] for n in first["items"]} & {n["id"] for n in second["items"]}


def test_summary_fields(client, alex, northwind):
    note = find_note(client, alex, northwind, "Index tuning notes")
    assert note["author"]["name"] == "Sam Okafor"
    assert note["mine"] is False and note["shared"] is True
    assert note["course"]["title"] == "Relational Databases & SQL"
    assert note["words"] > 20
    assert "```" not in note["excerpt"]["text"] and "#" not in note["excerpt"]["text"]


