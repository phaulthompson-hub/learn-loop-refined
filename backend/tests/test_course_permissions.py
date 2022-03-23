"""Who may do what with a course: roles, ownership, drafts and workspace membership."""

import pytest
from conftest import find_course, login

TEXT = "Probability measures how likely an event is. Conditional probability updates beliefs with evidence. " * 2


@pytest.fixture
def jonas(client, seeded):
    """Instructor in Northwind; owns the SQL course but not ML."""
    return login(client, "jonas@learnloop.dev")


@pytest.fixture
def priya(client, seeded):
    """Learner in both Northwind and the biology group."""
    return login(client, "priya@learnloop.dev")


@pytest.fixture
def viz(client, alex, northwind):
    return find_course(client, alex, northwind, "Data Visualization Principles")


def concept_of(client, headers, course_id):
    return client.get(f"/api/courses/{course_id}", headers=headers).json()["concepts"][0]


# ---------- Creating ----------


def test_learners_cannot_create_courses(client, sam, northwind):
    response = client.post(f"/api/workspaces/{northwind}/courses", json={"title": "Mine", "text": TEXT}, headers=sam)
    assert response.status_code == 403
    assert "instructor" in response.json()["detail"]
    upload = client.post(
        f"/api/workspaces/{northwind}/courses/upload",
        data={"title": "Mine"},
        files={"file": ("n.txt", TEXT.encode(), "text/plain")},
        headers=sam,
    )
    assert upload.status_code == 403


def test_instructors_create_courses_in_their_workspace(client, jonas, northwind):
    response = client.post(
        f"/api/workspaces/{northwind}/courses", json={"title": "Probability", "text": TEXT}, headers=jonas
    )
    assert response.status_code == 201


def test_non_members_cannot_list_or_create(client, northwind, newcomer):
    headers, _ = newcomer
    assert client.get(f"/api/workspaces/{northwind}/courses", headers=headers).status_code == 404
    response = client.post(
        f"/api/workspaces/{northwind}/courses", json={"title": "Sneaky", "text": TEXT}, headers=headers
    )
    assert response.status_code == 404


def test_anonymous_requests_are_rejected(client, seeded, ml_course):
    assert client.get(f"/api/courses/{ml_course['id']}").status_code == 401
    assert client.get("/api/workspaces/1/courses").status_code == 401


# ---------- Reading ----------


def test_non_members_get_404_for_every_course_route(client, ml_course, newcomer):
    headers, _ = newcomer
    course_id = ml_course["id"]
    for path in ("", "/quiz", "/summary", "/attempts", "/recommendation", "/learners", "/activity"):
        assert client.get(f"/api/courses/{course_id}{path}", headers=headers).status_code == 404, path
    assert (
        client.post(f"/api/courses/{course_id}/tutor", json={"message": "hi there"}, headers=headers).status_code == 404
    )
    assert client.put(f"/api/courses/{course_id}/enrollment", json={"pinned": True}, headers=headers).status_code == 404
    assert client.post(f"/api/courses/{course_id}/reset-progress", headers=headers).status_code == 404
    assert client.delete(f"/api/courses/{course_id}", headers=headers).status_code == 404


def test_members_of_one_workspace_cannot_reach_anothers_courses(client, sam, alex, biology):
    cells = find_course(client, alex, biology, "Cell Biology")
    assert client.get(f"/api/courses/{cells['id']}", headers=sam).status_code == 404
    assert client.get(f"/api/workspaces/{biology}/courses", headers=sam).status_code == 404


def test_drafts_are_hidden_from_learners(client, sam, viz):
    for path in ("", "/quiz", "/summary", "/activity"):
        assert client.get(f"/api/courses/{viz['id']}{path}", headers=sam).status_code == 404, path
    assert client.put(f"/api/courses/{viz['id']}/enrollment", json={"pinned": True}, headers=sam).status_code == 404


def test_drafts_are_visible_to_instructors(client, jonas, viz):
    response = client.get(f"/api/courses/{viz['id']}", headers=jonas)
    assert response.status_code == 200
    assert response.json()["status"] == "draft"


def test_publishing_a_draft_makes_it_visible_to_learners(client, maya, sam, viz):
    assert client.patch(f"/api/courses/{viz['id']}", json={"status": "active"}, headers=maya).status_code == 200
    assert client.get(f"/api/courses/{viz['id']}", headers=sam).status_code == 200


def test_archived_courses_stay_readable_for_learners(client, maya, sam, ml_course):
    client.patch(f"/api/courses/{ml_course['id']}", json={"status": "archived"}, headers=maya)
    response = client.get(f"/api/courses/{ml_course['id']}", headers=sam)
    assert response.status_code == 200
    assert response.json()["status"] == "archived"


# ---------- Editing ----------


def test_learners_cannot_edit_course_content(client, sam, ml_course):
    course_id = ml_course["id"]
    concept = concept_of(client, sam, course_id)
    source_id = client.get(f"/api/courses/{course_id}", headers=sam).json()["sources"][0]["id"]
    attempts = [
        client.patch(f"/api/courses/{course_id}", json={"title": "Hijacked"}, headers=sam),
        client.post(f"/api/courses/{course_id}/sources", json={"text": TEXT}, headers=sam),
        client.delete(f"/api/courses/{course_id}/sources/{source_id}", headers=sam),
        client.patch(f"/api/courses/{course_id}/concepts/{concept['id']}", json={"name": "Renamed"}, headers=sam),
        client.put(f"/api/courses/{course_id}/concepts/order", json={"concept_ids": [concept["id"]]}, headers=sam),
        client.post(f"/api/courses/{course_id}/duplicate", headers=sam),
        client.delete(f"/api/courses/{course_id}", headers=sam),
    ]
    assert [r.status_code for r in attempts] == [403] * len(attempts)
    assert client.get(f"/api/courses/{course_id}", headers=sam).json()["title"] == "Introduction to Machine Learning"


