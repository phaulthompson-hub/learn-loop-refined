"""Request validation for the course API: every bad input gets a 4xx with a readable reason and changes nothing."""

import pytest

LONG_TEXT = "Sorting algorithms arrange items into order. Merge sort splits the list and merges sorted halves. " * 2


@pytest.fixture
def space(newcomer):
    return newcomer


@pytest.fixture
def course(client, space):
    headers, workspace = space
    response = client.post(
        f"/api/workspaces/{workspace}/courses", json={"title": "Sorting", "text": LONG_TEXT}, headers=headers
    )
    assert response.status_code == 201, response.text
    return response.json()


def post_course(client, space, payload):
    headers, workspace = space
    return client.post(f"/api/workspaces/{workspace}/courses", json=payload, headers=headers)


def upload(client, space, filename, content, **data):
    headers, workspace = space
    return client.post(
        f"/api/workspaces/{workspace}/courses/upload",
        data={"title": "Notes", **data},
        files={"file": (filename, content, "application/octet-stream")},
        headers=headers,
    )


# ---------- Creating ----------


@pytest.mark.parametrize(
    "payload",
    [
        {"title": "A", "text": LONG_TEXT},
        {"title": "   ", "text": LONG_TEXT},
        {"title": "x" * 161, "text": LONG_TEXT},
        {"title": "Sorting", "text": "short"},
        {"title": "Sorting", "text": " " * 100},
        {"title": "Sorting"},
        {"text": LONG_TEXT},
        {"title": "Sorting", "text": LONG_TEXT, "difficulty": "expert"},
        {"title": "Sorting", "text": LONG_TEXT, "status": "archived"},
        {"title": "Sorting", "text": LONG_TEXT, "color": "green"},
        {"title": "Sorting", "text": LONG_TEXT, "subject": "  "},
        {"title": "Sorting", "text": LONG_TEXT, "description": "d" * 601},
    ],
)
def test_create_course_rejects_invalid_payloads(client, space, payload):
    assert post_course(client, space, payload).status_code == 422


def test_validation_errors_name_the_field(client, space):
    detail = post_course(client, space, {"title": "A", "text": LONG_TEXT}).json()["detail"]
    assert detail[0]["loc"] == ["body", "title"]
    assert "at least 2 characters" in detail[0]["msg"]


def test_rejected_course_is_not_created(client, space):
    headers, workspace = space
    post_course(client, space, {"title": "Sorting", "text": "short"})
    page = client.get(f"/api/workspaces/{workspace}/courses", params={"status": "all"}, headers=headers).json()
    assert page["total"] == 0


def test_tags_are_trimmed_lowercased_deduplicated_and_capped(client, space):
    tags = ", ".join([" ML ", "ml", "Stats"] + [f"t{i}" for i in range(12)] + ["x" * 40])
    body = post_course(client, space, {"title": "Sorting", "text": LONG_TEXT, "tags": tags}).json()
    assert body["tags"][:3] == ["ml", "stats", "t0"]
    assert len(body["tags"]) == 10


# ---------- Uploading ----------


def test_upload_rejects_unsupported_extension(client, space):
    assert upload(client, space, "deck.pptx", b"x" * 200).status_code == 415


def test_upload_rejects_too_little_text(client, space):
    response = upload(client, space, "n.txt", b"hi")
    assert response.status_code == 400
    assert "80 characters" in response.json()["detail"]


def test_upload_rejects_non_utf8_text(client, space):
    assert upload(client, space, "n.txt", b"\xff\xfe\x00" * 100).status_code == 400


def test_upload_rejects_corrupt_pdf(client, space):
    assert upload(client, space, "paper.pdf", b"not a pdf" * 20).status_code == 400


def test_upload_rejects_files_over_8_mb(client, space):
    assert upload(client, space, "big.txt", b"a" * 8_000_001).status_code == 413


@pytest.mark.parametrize(
    ("fields", "message"),
    [
        ({"title": " "}, "title: must be at least 2 characters"),
        ({"difficulty": "expert"}, "difficulty:"),
        ({"status": "archived"}, "status:"),
        ({"color": "#12"}, "color: must be a hex colour"),
        ({"subject": "   "}, "subject: must not be blank"),
    ],
)
def test_upload_rejects_bad_details_with_readable_messages(client, space, fields, message):
    response = upload(client, space, "n.txt", LONG_TEXT.encode(), **fields)
    assert response.status_code == 422
    assert message in response.json()["detail"]


# ---------- Unknown ids ----------


def test_unknown_course_returns_404_everywhere(client, space):
    headers, _ = space
    for path in (
        "/api/courses/999",
        "/api/courses/999/quiz",
        "/api/courses/999/summary",
        "/api/courses/999/attempts",
        "/api/courses/999/recommendation",
        "/api/courses/999/sources/1",
        "/api/courses/999/learners",
        "/api/courses/999/activity",
    ):
        assert client.get(path, headers=headers).status_code == 404, path
    assert client.delete("/api/courses/999", headers=headers).status_code == 404
    assert client.patch("/api/courses/999", json={"title": "New"}, headers=headers).status_code == 404
    assert client.post("/api/courses/999/tutor", json={"message": "hello"}, headers=headers).status_code == 404
    assert client.post("/api/courses/999/duplicate", headers=headers).status_code == 404
    assert client.post("/api/courses/999/reset-progress", headers=headers).status_code == 404
    answer = {"question_id": "999:1", "concept_id": 1, "selected": 0}
    assert client.post("/api/courses/999/answers", json=answer, headers=headers).status_code == 404


def test_unknown_concept_and_source_return_404(client, space, course):
    headers, _ = space
    base = f"/api/courses/{course['id']}"
    assert client.patch(f"{base}/concepts/99999", json={"name": "Nope"}, headers=headers).status_code == 404
    assert client.delete(f"{base}/sources/99999", headers=headers).status_code == 404
    assert client.get(f"{base}/sources/99999", headers=headers).status_code == 404


def test_source_of_another_course_is_not_exposed(client, space, course):
    other = post_course(client, space, {"title": "Sorting 2", "text": LONG_TEXT}).json()
    headers, _ = space
    source_id = other["sources"][0]["id"]
    assert client.get(f"/api/courses/{course['id']}/sources/{source_id}", headers=headers).status_code == 404
    assert client.delete(f"/api/courses/{course['id']}/sources/{source_id}", headers=headers).status_code == 404


# ---------- Updating ----------


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"title": None},
        {"status": None},
        {"title": "A"},
        {"status": "deleted"},
        {"difficulty": "hard"},
        {"color": "#zzzzzz"},
        {"tags": None},
    ],
)
def test_course_update_rejects_empty_null_or_invalid_fields(client, space, course, payload):
    headers, _ = space
    response = client.patch(f"/api/courses/{course['id']}", json=payload, headers=headers)
    assert response.status_code == 422
    unchanged = client.get(f"/api/courses/{course['id']}", headers=headers).json()
    assert (unchanged["title"], unchanged["status"]) == ("Sorting", "active")


def test_empty_update_explains_itself(client, space, course):
    headers, _ = space
    response = client.patch(f"/api/courses/{course['id']}", json={}, headers=headers)
    assert "Send at least one field to change" in response.json()["detail"][0]["msg"]


def test_description_may_be_cleared(client, space, course):
    headers, _ = space
    response = client.patch(f"/api/courses/{course['id']}", json={"description": "   "}, headers=headers)
    assert response.status_code == 200
    assert response.json()["description"] == ""


@pytest.mark.parametrize("payload", [{}, {"name": "X"}, {"summary": "too short"}, {"name": None}, {"name": "y" * 121}])
def test_concept_update_is_validated(client, space, course, payload):
    headers, _ = space
    concept = course["concepts"][0]
    response = client.patch(f"/api/courses/{course['id']}/concepts/{concept['id']}", json=payload, headers=headers)
    assert response.status_code == 422


@pytest.mark.parametrize("mutate", ["missing", "repeated", "foreign", "empty"])
def test_concept_order_must_be_a_permutation(client, space, course, mutate):
    headers, _ = space
    ids = [c["id"] for c in course["concepts"]]
    order = {
        "missing": ids[1:],
        "repeated": ids + [ids[0]],
        "foreign": ids[:-1] + [99999],
        "empty": [],
    }[mutate]
    response = client.put(f"/api/courses/{course['id']}/concepts/order", json={"concept_ids": order}, headers=headers)
    assert response.status_code == 422
    after = client.get(f"/api/courses/{course['id']}", headers=headers).json()
    assert [c["id"] for c in after["concepts"]] == ids


def test_duplicate_title_is_validated(client, space, course):
    headers, _ = space
    response = client.post(f"/api/courses/{course['id']}/duplicate", json={"title": " "}, headers=headers)
    assert response.status_code == 422


def test_added_source_needs_enough_text(client, space, course):
    headers, _ = space
    response = client.post(f"/api/courses/{course['id']}/sources", json={"text": "too short"}, headers=headers)
    assert response.status_code == 422
    assert client.get(f"/api/courses/{course['id']}", headers=headers).json()["source_count"] == 1


# ---------- Practice ----------


@pytest.mark.parametrize("selected", [-1, 4, 10])
def test_answer_index_must_be_between_0_and_3(client, space, course, selected):
    headers, _ = space
    concept = course["concepts"][0]
    response = client.post(
        f"/api/courses/{course['id']}/answers",
        json={"question_id": f"{course['id']}:{concept['id']}", "concept_id": concept["id"], "selected": selected},
        headers=headers,
    )
    assert response.status_code == 422


