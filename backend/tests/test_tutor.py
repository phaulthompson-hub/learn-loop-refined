import asyncio
from dataclasses import dataclass, field

import httpx

from app.seeding.materials import ML_TEXT as DEMO_TEXT
from app.tutor import chunk_text, demo_answer, retrieve, tutor


@dataclass
class FakeSource:
    id: int
    name: str
    content: str


@dataclass
class FakeConcept:
    id: int
    name: str
    mastery: float = 35.0
    order_index: int = 0
    prerequisite_id: int | None = None
    summary: str = ""


@dataclass
class FakeCourse:
    id: int = 1
    sources: list[FakeSource] = field(default_factory=list)
    concepts: list[FakeConcept] = field(default_factory=list)


def course_with(*sources: FakeSource) -> FakeCourse:
    return FakeCourse(sources=list(sources), concepts=[FakeConcept(id=1, name="Gradient Descent")])


def test_chunks_overlap_and_cover_the_whole_text():
    text = "".join(str(i % 10) for i in range(2000))
    chunks = chunk_text(text, size=900, step=750)
    assert [len(c) for c in chunks] == [900, 900, 500]
    assert chunks[0][750:] == chunks[1][:150]
    assert chunk_text("") == [""]


def test_retrieve_ranks_the_most_relevant_source_first():
    course = course_with(
        FakeSource(1, "biology.txt", "Cells divide by mitosis. " * 20),
        FakeSource(2, "ml.txt", "Gradient descent lowers the loss by following the gradient. " * 5),
    )
    results = retrieve(course, "How does gradient descent work?")
    assert results[0][0] == "ml.txt"


def test_retrieve_is_deterministic_for_ties():
    course = course_with(FakeSource(2, "b.txt", "alpha " * 10), FakeSource(1, "a.txt", "alpha " * 10))
    assert retrieve(course, "unrelated words") == retrieve(course, "unrelated words")
    assert retrieve(course, "unrelated words")[0][0] == "a.txt"


def test_demo_answer_quotes_the_most_relevant_sentence():
    context = [("ml.txt", DEMO_TEXT)]
    answer = demo_answer(context, "Explain gradient descent", "Gradient Descent")
    assert "Gradient descent is an optimization method" in answer
    assert "Gradient Descent" in answer


def test_demo_answer_admits_missing_material():
    assert "does not contain enough information" in demo_answer([], "anything", "X")


def test_tutor_in_demo_mode_is_grounded_and_offline(settings):
    settings.ai_mode = "demo"
    course = course_with(FakeSource(1, "ml-foundations.txt", DEMO_TEXT))
    result = asyncio.run(tutor(course, "Explain gradient descent more simply"))
    assert result["mode"] == "demo"
    assert result["citations"] == ["ml-foundations.txt"]
    assert "gradient descent" in result["answer"].lower()
    assert result["follow_up"] == "Can you explain Gradient Descent in your own words?"


def test_openai_mode_without_key_stays_local(settings):
    settings.ai_mode = "openai"
    settings.openai_api_key = ""
    course = course_with(FakeSource(1, "ml.txt", DEMO_TEXT))
    assert asyncio.run(tutor(course, "What is a loss function?"))["mode"] == "demo"


def test_openai_mode_uses_remote_answer_with_retrieved_context(settings):
    settings.ai_mode = "openai"
    settings.openai_api_key = "test-key"
    settings.openai_base_url = "https://llm.invalid/v1/"
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["Authorization"]
        seen["body"] = request.content.decode()
        return httpx.Response(200, json={"choices": [{"message": {"content": "Remote explanation"}}]})

    course = course_with(FakeSource(1, "ml.txt", DEMO_TEXT))
    result = asyncio.run(tutor(course, "gradient descent", transport=httpx.MockTransport(handler)))
    assert result["mode"] == "openai"
    assert result["answer"] == "Remote explanation"
    assert seen["url"] == "https://llm.invalid/v1/chat/completions"
    assert seen["auth"] == "Bearer test-key"
    assert "SOURCE ml.txt" in seen["body"]


def test_openai_failure_falls_back_to_local_answer(settings):
    settings.ai_mode = "openai"
    settings.openai_api_key = "test-key"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"error": "unavailable"})

    course = course_with(FakeSource(1, "ml.txt", DEMO_TEXT))
    result = asyncio.run(tutor(course, "gradient descent", transport=httpx.MockTransport(handler)))
    assert result["mode"] == "fallback"
    assert result["answer"].startswith("Here is the simplest way to think about it")
    assert result["citations"] == ["ml.txt"]


def test_tutor_endpoint_cites_demo_source(client, alex, ml_course):
    response = client.post(
        f"/api/courses/{ml_course['id']}/tutor", json={"message": "What is the learning rate?"}, headers=alex
    )
    body = response.json()
    assert response.status_code == 200
    assert body["citations"] == ["ml-foundations.txt"]
    assert "learning rate" in body["answer"].lower()
    assert body["mode"] == "demo"
