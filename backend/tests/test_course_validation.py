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


