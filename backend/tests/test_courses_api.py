"""End-to-end behaviour of the course API: catalogue, authoring, enrolment, practice, learners and progress."""

import math

import pytest
from conftest import NOW, find_course, login
from sqlalchemy import select

from app.models import Activity, ConceptProgress, Notification, User

TEXT = (
    "Recursion solves a problem by solving smaller instances of the same problem. "
    "A base case stops the recursion, and every recursive call must move closer to the base case. "
    "The call stack stores one frame per recursive call until the base case returns. "
    "Tail recursion reuses the current stack frame, so tail recursion avoids growing the call stack."
)
EXTRA = (
    "Memoization caches the result of each recursive call so repeated subproblems are solved once. "
    "Dynamic programming builds on memoization by filling a table of subproblem results bottom up. "
    "Dynamic programming turns exponential recursion into polynomial time for overlapping subproblems."
)


@pytest.fixture
def jonas(client, seeded):
    """Headers for Jonas, an instructor in Northwind who does not own the ML course."""
    return login(client, "jonas@learnloop.dev")


def create(client, headers, workspace, **fields):
    payload = {"title": "Recursion", "text": TEXT, **fields}
    return client.post(f"/api/workspaces/{workspace}/courses", json=payload, headers=headers)


def catalogue(client, headers, workspace, **params):
    response = client.get(f"/api/workspaces/{workspace}/courses", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def titles(page):
    return [c["title"] for c in page["items"]]


def detail(client, headers, course_id):
    response = client.get(f"/api/courses/{course_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def correct_index(question, course):
    concept = next(c for c in course["concepts"] if c["id"] == question["concept_id"])
    return question["options"].index(concept["summary"][:130])


def answer(client, headers, course_id, question, selected):
    return client.post(
        f"/api/courses/{course_id}/answers",
        json={"question_id": question["id"], "concept_id": question["concept_id"], "selected": selected},
        headers=headers,
    )


def question_for(client, headers, course_id, concept_id):
    quiz = client.get(f"/api/courses/{course_id}/quiz", params={"count": 10}, headers=headers).json()
    return next(q for q in quiz if q["concept_id"] == concept_id)


# ---------- Catalogue ----------


def test_catalogue_defaults_to_active_courses_and_reports_facets(client, alex, northwind):
    page = catalogue(client, alex, northwind)
    assert set(titles(page)) == {
        "Introduction to Machine Learning",
        "Statistics Fundamentals",
        "Relational Databases & SQL",
        "Neural Networks in Practice",
    }
    assert page["total"] == 4
    assert page["facets"]["statuses"] == {"draft": 1, "active": 4, "archived": 0}
    assert page["facets"]["subjects"] == ["Communication", "Data Engineering", "Machine Learning", "Statistics"]
    assert page["facets"]["difficulties"] == {"intro": 3, "intermediate": 1, "advanced": 1}
    assert "deep-learning" in page["facets"]["tags"]


def test_learners_never_see_drafts_in_the_catalogue_or_its_facets(client, sam, northwind):
    page = catalogue(client, sam, northwind, status="all")
    assert "Data Visualization Principles" not in titles(page)
    assert page["facets"]["statuses"]["draft"] == 0
    assert "Communication" not in page["facets"]["subjects"]


def test_status_tabs_filter_the_catalogue(client, alex, northwind):
    assert titles(catalogue(client, alex, northwind, status="draft")) == ["Data Visualization Principles"]
    assert catalogue(client, alex, northwind, status="all")["total"] == 5
    assert catalogue(client, alex, northwind, status="archived")["items"] == []


def test_search_matches_title_description_subject_and_tags(client, alex, northwind):
    assert titles(catalogue(client, alex, northwind, q="deep-learning")) == ["Neural Networks in Practice"]
    assert titles(catalogue(client, alex, northwind, q="keys joins")) == ["Relational Databases & SQL"]
    assert titles(catalogue(client, alex, northwind, q="STATISTICS")) == ["Statistics Fundamentals"]
    assert catalogue(client, alex, northwind, q="quantum")["total"] == 0


def test_subject_difficulty_and_tag_filters_combine(client, alex, northwind):
    ml_subject = catalogue(client, alex, northwind, subject="machine learning", sort="title")
    assert titles(ml_subject) == ["Introduction to Machine Learning", "Neural Networks in Practice"]
    assert titles(catalogue(client, alex, northwind, subject="Machine Learning", difficulty="advanced")) == [
        "Neural Networks in Practice"
    ]
    foundations = catalogue(client, alex, northwind, tag="Foundations", sort="title")
    assert titles(foundations) == ["Introduction to Machine Learning", "Statistics Fundamentals"]


def test_enrolled_filter_is_per_user(client, sam, northwind):
    assert set(titles(catalogue(client, sam, northwind, enrolled=True))) == {
        "Introduction to Machine Learning",
        "Relational Databases & SQL",
    }
    assert set(titles(catalogue(client, sam, northwind, enrolled=False))) == {
        "Statistics Fundamentals",
        "Neural Networks in Practice",
    }


def test_pinned_courses_lead_every_sort_order(client, alex, northwind):
    ordered = titles(catalogue(client, alex, northwind, sort="title"))
    assert ordered == [
        "Introduction to Machine Learning",
        "Neural Networks in Practice",
        "Relational Databases & SQL",
        "Statistics Fundamentals",
    ]
    assert titles(catalogue(client, alex, northwind, sort="-title"))[0] == "Introduction to Machine Learning"


def test_sort_by_difficulty_and_learners(client, sam, northwind):
    by_difficulty = titles(catalogue(client, sam, northwind, sort="-difficulty"))
    assert by_difficulty[:2] == ["Neural Networks in Practice", "Relational Databases & SQL"]
    page = catalogue(client, sam, northwind, sort="-learners")
    counts = [c["learners"] for c in page["items"]]
    assert counts == sorted(counts, reverse=True)


def test_sort_by_mastery_uses_the_viewers_own_progress(client, alex, northwind):
    page = catalogue(client, alex, northwind, sort="-mastery", status="all")
    unpinned = [c for c in page["items"] if not c["pinned"]]
    values = [c["mastery"] for c in unpinned]
    assert values == sorted(values, reverse=True)


def test_pagination_reports_totals_and_clamps_the_page(client, alex, northwind):
    second = catalogue(client, alex, northwind, page_size=3, page=2, sort="title")
    assert (second["total"], second["page"], second["page_size"], len(second["items"])) == (4, 2, 3, 1)
    beyond = catalogue(client, alex, northwind, page_size=3, page=99)
    assert beyond["page"] == 2


def test_unknown_sort_field_is_rejected_with_a_readable_message(client, alex, northwind):
    response = client.get(f"/api/workspaces/{northwind}/courses", params={"sort": "-owner"}, headers=alex)
    assert response.status_code == 422
    assert "Cannot sort by 'owner'" in response.json()["detail"]


def test_summaries_are_personal(client, alex, sam, ml_course, northwind):
    sams = find_course(client, sam, northwind, "Introduction to Machine Learning")
    assert ml_course["id"] == sams["id"]
    assert ml_course["pinned"] is True and sams["pinned"] is False
    assert ml_course["attempts"] == 31 and sams["attempts"] == 9
    assert ml_course["mastery"] != sams["mastery"]
    assert ml_course["learners"] == sams["learners"] == 4


# ---------- Creating courses ----------


def test_create_course_from_pasted_text(client, newcomer, db):
    headers, workspace = newcomer
    response = create(
        client,
        headers,
        workspace,
        title="  Recursion  ",
        subject=" Computer Science ",
        difficulty="intermediate",
        tags=" Algorithms, algorithms ,CS ",
        description="How functions call themselves.",
        status="draft",
        color="#2563EB",
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["title"] == "Recursion"
    assert (body["subject"], body["difficulty"], body["status"]) == ("Computer Science", "intermediate", "draft")
    assert body["tags"] == ["algorithms", "cs"]
    assert body["color"] == "#2563eb"
    assert body["sources"][0]["name"] == "pasted-notes.txt"
    assert body["sources"][0]["characters"] == len(TEXT)
    assert body["enrolled"] is True and body["learners"] == 1
    concepts = body["concepts"]
    assert "Base Case" in [c["name"] for c in concepts]
    assert concepts[0]["prerequisite_id"] is None
    for previous, current in zip(concepts, concepts[1:], strict=False):
        assert current["prerequisite_id"] == previous["id"]
    assert [c["unlocked"] for c in concepts] == [True] + [False] * (len(concepts) - 1)
    verbs = db.scalars(select(Activity.verb).where(Activity.workspace_id == workspace)).all()
    assert "course.created" in verbs


def test_created_courses_get_a_default_description_and_palette_colour(client, newcomer):
    headers, workspace = newcomer
    first = create(client, headers, workspace).json()
    second = create(client, headers, workspace, title="Recursion II").json()
    assert first["description"] == "Adaptive path generated from pasted-notes.txt"
    assert first["color"] != second["color"]


def test_upload_markdown_file_creates_course_with_details(client, newcomer):
    headers, workspace = newcomer
    response = client.post(
        f"/api/workspaces/{workspace}/courses/upload",
        data={
            "title": "Graph basics",
            "subject": "Algorithms",
            "difficulty": "advanced",
            "tags": "graphs, search",
            "status": "draft",
            "color": "#9333ea",
        },
        files={"file": ("notes/graphs.md", TEXT.encode(), "text/markdown")},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["sources"][0]["name"] == "graphs.md"
    assert (body["subject"], body["difficulty"], body["status"], body["color"]) == (
        "Algorithms",
        "advanced",
        "draft",
        "#9333ea",
    )
    assert body["tags"] == ["graphs", "search"]


# ---------- One course ----------


def test_course_detail_combines_shared_content_with_my_progress(client, alex, ml_course):
    body = detail(client, alex, ml_course["id"])
    assert body["concept_count"] == len(body["concepts"]) == 6
    assert body["source_count"] == 1
    assert body["sources"][0]["name"] == "ml-foundations.txt"
    assert body["sources"][0]["words"] > 150
    assert "Gradient Descent" in [c["name"] for c in body["concepts"]]
    assert body["recommendation"]["reason"]
    levels = {c["level"] for c in body["concepts"]}
    assert levels <= {"needs review", "learning", "proficient", "mastered"}


def test_editor_updates_details_and_tags(client, maya, ml_course):
    response = client.patch(
        f"/api/courses/{ml_course['id']}",
        json={"title": "  ML Foundations ", "tags": ["ML", "Core", "ml"], "difficulty": "intermediate"},
        headers=maya,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["title"], body["tags"], body["difficulty"]) == ("ML Foundations", ["ml", "core"], "intermediate")
    assert body["updated_at"] == NOW


def test_archive_and_restore_move_the_course_between_tabs(client, maya, alex, ml_course, northwind, db):
    course_id = ml_course["id"]
    assert client.patch(f"/api/courses/{course_id}", json={"status": "archived"}, headers=maya).status_code == 200
    page = catalogue(client, alex, northwind)
    assert "Introduction to Machine Learning" not in titles(page)
    assert page["facets"]["statuses"]["archived"] == 1
    assert titles(catalogue(client, alex, northwind, status="archived")) == ["Introduction to Machine Learning"]
    assert client.patch(f"/api/courses/{course_id}", json={"status": "active"}, headers=maya).status_code == 200
    verbs = db.scalars(select(Activity.verb).where(Activity.object_id == course_id)).all()
    assert {"course.archived", "course.restored"} <= set(verbs)


def test_owner_deletes_course_and_everyones_progress_with_it(client, maya, alex, ml_course, db):
    concept_ids = [c["id"] for c in detail(client, alex, ml_course["id"])["concepts"]]
    assert client.delete(f"/api/courses/{ml_course['id']}", headers=maya).status_code == 204
    assert client.get(f"/api/courses/{ml_course['id']}", headers=alex).status_code == 404
    left = db.scalars(select(ConceptProgress).where(ConceptProgress.concept_id.in_(concept_ids))).all()
    assert left == []


# ---------- Enrolment ----------


def test_pin_enrols_and_moves_the_course_to_the_top(client, sam, northwind):
    stats = find_course(client, sam, northwind, "Statistics Fundamentals")
    assert stats["enrolled"] is False
    response = client.put(f"/api/courses/{stats['id']}/enrollment", json={"pinned": True}, headers=sam)
    assert response.status_code == 200
    assert (response.json()["enrolled"], response.json()["pinned"]) == (True, True)
    assert titles(catalogue(client, sam, northwind, sort="title"))[0] == "Statistics Fundamentals"
    assert client.delete(f"/api/courses/{stats['id']}/enrollment", headers=sam).status_code == 204
    assert find_course(client, sam, northwind, "Statistics Fundamentals")["enrolled"] is False


def test_opening_a_course_records_last_opened(client, sam, northwind):
    nn = find_course(client, sam, northwind, "Neural Networks in Practice")
    assert client.post(f"/api/courses/{nn['id']}/opened", headers=sam).status_code == 204
    summary = client.get(f"/api/courses/{nn['id']}/summary", headers=sam).json()
    assert summary["last_opened_at"] == NOW
    assert summary["enrolled"] is True


# ---------- Sources and concepts ----------


def test_adding_material_appends_new_concepts_to_the_chain(client, newcomer):
    headers, workspace = newcomer
    course = create(client, headers, workspace).json()
    response = client.post(
        f"/api/courses/{course['id']}/sources", json={"name": "memo.md", "text": EXTRA}, headers=headers
    )
    assert response.status_code == 201
    assert response.json()["words"] == len(EXTRA.split())
    updated = detail(client, headers, course["id"])
    assert updated["source_count"] == 2
    names = [c["name"] for c in updated["concepts"]]
    assert "Dynamic Programming" in names
    assert len(names) == len({n.lower() for n in names})
    first_new = updated["concepts"][len(course["concepts"])]
    assert first_new["prerequisite_id"] == course["concepts"][-1]["id"]


def test_source_reader_returns_the_full_text(client, alex, ml_course):
    source = detail(client, alex, ml_course["id"])["sources"][0]
    body = client.get(f"/api/courses/{ml_course['id']}/sources/{source['id']}", headers=alex).json()
    assert body["content"].startswith("Machine learning is the study of algorithms")
    assert body["words"] == len(body["content"].split())
    assert body["characters"] == len(body["content"])
    assert body["course_id"] == ml_course["id"]


def test_removing_sources_keeps_at_least_one(client, newcomer):
    headers, workspace = newcomer
    course = create(client, headers, workspace).json()
    added = client.post(f"/api/courses/{course['id']}/sources", json={"text": EXTRA}, headers=headers).json()
    assert client.delete(f"/api/courses/{course['id']}/sources/{added['id']}", headers=headers).status_code == 204
    only = course["sources"][0]["id"]
    response = client.delete(f"/api/courses/{course['id']}/sources/{only}", headers=headers)
    assert response.status_code == 409
    assert "at least one source" in response.json()["detail"]
    assert detail(client, headers, course["id"])["source_count"] == 1


def test_editor_renames_a_concept_and_rewrites_its_summary(client, jonas, ml_course):
    concept = detail(client, jonas, ml_course["id"])["concepts"][1]
    response = client.patch(
        f"/api/courses/{ml_course['id']}/concepts/{concept['id']}",
        json={"name": " Model Performance ", "summary": "How well a model does on data it has not seen before."},
        headers=jonas,
    )
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Model Performance"
    quiz = client.get(f"/api/courses/{ml_course['id']}/quiz", params={"count": 10}, headers=jonas).json()
    question = next(q for q in quiz if q["concept_id"] == concept["id"])
    assert question["prompt"] == "Which statement best explains Model Performance?"
    assert "How well a model does on data it has not seen before." in question["options"]


