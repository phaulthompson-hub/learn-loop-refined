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


def test_tag_counts_cover_visible_active_notes(client, alex, sam, northwind):
    tags = client.get(f"{notes_url(northwind)}/tags", headers=alex).json()
    assert tags[0] == {"tag": "sql", "count": 5}
    counts = {t["tag"]: t["count"] for t in tags}
    assert counts["ml"] == 4  # the archived reading list is not counted
    assert counts["cheat-sheet"] == 3
    assert "career" not in counts  # Sam's private note
    assert "career" in {t["tag"] for t in client.get(f"{notes_url(northwind)}/tags", headers=sam).json()}


def test_titles_list_readable_notes_alphabetically(client, sam, northwind):
    titles = client.get(f"{notes_url(northwind)}/titles", headers=sam).json()
    names = [t["title"] for t in titles]
    assert names == sorted(names, key=str.casefold)
    assert "Interview prep" in names and "SQL joins field guide" in names
    assert "Loss functions compared" not in names
    assert next(t for t in titles if t["title"] == "Interview prep")["mine"] is True


def test_non_members_cannot_list_or_read(client, alex, northwind, newcomer):
    headers, _ = newcomer
    assert client.get(notes_url(northwind), headers=headers).status_code == 404
    note = find_note(client, alex, northwind, "SQL joins field guide")
    assert client.get(f"/api/notes/{note['id']}", headers=headers).status_code == 404


# ---------- Detail, links and permissions ----------


def test_detail_resolves_links_and_flags_unresolved_ones(client, alex, northwind):
    note = find_note(client, alex, northwind, "Window functions scratchpad")
    detail = client.get(f"/api/notes/{note['id']}", headers=alex).json()
    joins = find_note(client, alex, northwind, "SQL joins field guide")
    assert detail["body"].startswith("# Window functions scratchpad")
    assert detail["can_edit"] is True
    assert detail["links"] == [
        {"target": "Query plans", "label": "Query plans", "heading": None, "note_id": None, "resolved": False},
        {
            "target": "SQL joins field guide",
            "label": "SQL joins field guide",
            "heading": None,
            "note_id": joins["id"],
            "resolved": True,
        },
    ]


def test_links_only_resolve_to_notes_the_viewer_can_read(client, alex, sam, northwind):
    plan = find_note(client, alex, northwind, "Gradient descent cheat sheet")
    by_target = {link["target"]: link for link in client.get(f"/api/notes/{plan['id']}", headers=sam).json()["links"]}
    assert by_target["Backprop derivation notes"]["resolved"] is True
    assert by_target["Loss functions compared"]["resolved"] is False  # Alex's private note


def test_others_can_read_shared_notes_but_not_change_them(client, alex, sam, northwind):
    shared = find_note(client, alex, northwind, "SQL joins field guide")
    private = find_note(client, alex, northwind, "Loss functions compared")
    detail = client.get(f"/api/notes/{shared['id']}", headers=sam)
    assert detail.status_code == 200 and detail.json()["can_edit"] is False
    assert client.get(f"/api/notes/{private['id']}", headers=sam).status_code == 404
    assert client.patch(f"/api/notes/{shared['id']}", json={"title": "Mine now"}, headers=sam).status_code == 403
    assert client.delete(f"/api/notes/{shared['id']}", headers=sam).status_code == 403
    assert client.post(f"/api/notes/{shared['id']}/pin", headers=sam).status_code == 403
    assert client.post(f"/api/notes/{shared['id']}/archive", headers=sam).status_code == 403


def test_backlinks_list_linking_notes_with_context(client, alex, sam, northwind):
    note = find_note(client, alex, northwind, "Gradient descent cheat sheet")
    backlinks = client.get(f"/api/notes/{note['id']}/backlinks", headers=alex).json()
    assert {b["title"] for b in backlinks} == {
        "Loss functions compared",
        "Weekly study plan: March",
        "Backprop derivation notes",
    }
    assert [b["updated_at"] for b in backlinks] == sorted((b["updated_at"] for b in backlinks), reverse=True)
    losses = next(b for b in backlinks if b["title"] == "Loss functions compared")
    (start, end), *_ = losses["context"]["highlights"]
    assert losses["context"]["text"][start:end] == "[[Gradient descent cheat sheet|gradient descent]]"
    detail = client.get(f"/api/notes/{note['id']}", headers=alex).json()
    assert detail["backlinks"] == 3
    # Sam only sees backlinks from notes he can read.
    assert [b["title"] for b in client.get(f"/api/notes/{note['id']}/backlinks", headers=sam).json()] == [
        "Backprop derivation notes"
    ]


# ---------- Create and validate ----------


def test_create_note_with_placement_and_normalised_tags(client, alex, northwind):
    ml = course_detail(client, alex, find_course(client, alex, northwind, "Introduction to Machine Learning")["id"])
    concept = concept_named(ml, "Loss Function")
    note = create(
        client,
        alex,
        northwind,
        title="  Regularisation ideas ",
        body="Links to [[Overfitting checklist]] and [[Nowhere]].",
        tags=["#Machine Learning", "SQL", "sql", " ", "l2/penalty"],
        concept_id=concept["id"],
    )
    assert note["title"] == "Regularisation ideas"
    assert note["tags"] == ["machine-learning", "sql", "l2penalty"]
    assert note["course"]["id"] == ml["id"]  # implied by the concept
    assert note["concept"]["id"] == concept["id"]
    assert note["created_at"] == note["updated_at"] == NOW
    assert note["mine"] and note["can_edit"] and not note["shared"]
    assert [(link["target"], link["resolved"]) for link in note["links"]] == [
        ("Overfitting checklist", True),
        ("Nowhere", False),
    ]


@pytest.mark.parametrize(
    "body",
    [
        {"title": "   "},
        {"title": "x" * 161},
        {"body": "x" * 50_001},
        {"tags": ["x" * 25]},
        {"tags": [f"t{i}" for i in range(11)]},
    ],
)
def test_create_rejects_invalid_input(client, alex, northwind, body):
    response = client.post(notes_url(northwind), json={"title": "Valid", **body}, headers=alex)
    assert response.status_code == 422


