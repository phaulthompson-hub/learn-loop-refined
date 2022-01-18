from dataclasses import dataclass, field

import pytest

from app.quiz import OPTION_COUNT, answer_key, build_question, parse_question_id, question_id, quiz_for, select_concepts


@dataclass
class FakeConcept:
    id: int
    name: str
    summary: str
    mastery: float = 35.0
    order_index: int = 0
    prerequisite_id: int | None = None


@dataclass
class FakeCourse:
    id: int
    concepts: list[FakeConcept] = field(default_factory=list)


def make_course(masteries: list[float], course_id: int = 7) -> FakeCourse:
    concepts = [
        FakeConcept(
            id=100 + i,
            name=f"Concept {i}",
            summary=f"Concept {i} is described by this distinct sentence number {i}.",
            mastery=m,
            order_index=i,
        )
        for i, m in enumerate(masteries)
    ]
    return FakeCourse(id=course_id, concepts=concepts)


def test_question_id_round_trip():
    assert question_id(3, 42) == "3:42"
    assert parse_question_id("3:42") == (3, 42)


@pytest.mark.parametrize("bad", ["", "3", "3:", ":4", "a:b", "1:2:3", "-1:2"])
def test_parse_question_id_rejects_malformed_values(bad):
    assert parse_question_id(bad) is None


def test_select_concepts_returns_all_when_course_is_small():
    course = make_course([50, 20, 80])
    assert [c.order_index for c in select_concepts(course.concepts, 4)] == [1, 0, 2]


def test_select_concepts_prioritises_weakest_and_adds_one_review_item():
    course = make_course([90, 10, 30, 20, 70, 40])
    selected = select_concepts(course.concepts, 4)
    # Three weakest (10, 20, 30) followed by the strongest remaining concept (90) as a review item.
    assert [c.mastery for c in selected] == [10, 20, 30, 90]


def test_select_concepts_breaks_mastery_ties_by_course_order():
    course = make_course([35] * 6)
    assert [c.order_index for c in select_concepts(course.concepts, 4)] == [0, 1, 2, 3]


def test_build_question_has_four_unique_options_and_correct_key():
    course = make_course([35, 35, 35, 35])
    for concept in course.concepts:
        question, key = build_question(course.id, concept, course.concepts)
        assert len(question["options"]) == OPTION_COUNT
        assert len(set(question["options"])) == OPTION_COUNT
        assert question["options"][key] == concept.summary[:130]
        assert question["id"] == f"{course.id}:{concept.id}"
        assert concept.name in question["prompt"]


def test_distractors_come_from_other_concepts_when_available():
    course = make_course([35, 35, 35, 35])
    question, key = build_question(course.id, course.concepts[0], course.concepts)
    distractors = [o for i, o in enumerate(question["options"]) if i != key]
    other_summaries = {c.summary for c in course.concepts[1:]}
    assert set(distractors) <= other_summaries


def test_single_concept_course_uses_generic_distractors():
    course = make_course([35])
    question, key = build_question(course.id, course.concepts[0], course.concepts)
    assert len(set(question["options"])) == OPTION_COUNT
    assert question["options"][key] == course.concepts[0].summary


def test_duplicate_summaries_do_not_produce_duplicate_options():
    course = make_course([35, 35, 35])
    for concept in course.concepts:
        concept.summary = "Every concept shares exactly the same summary sentence in this edge case."
    question, _ = build_question(course.id, course.concepts[0], course.concepts)
    assert len(set(question["options"])) == OPTION_COUNT


def test_correct_position_varies_between_concepts():
    course = make_course([35, 35, 35, 35])
    keys = {build_question(course.id, c, course.concepts)[1] for c in course.concepts}
    assert len(keys) > 1


def test_quiz_is_deterministic():
    course = make_course([35, 60, 20, 45, 10])
    assert quiz_for(course) == quiz_for(course)


def test_quiz_keys_match_answer_key():
    course = make_course([35, 60, 20, 45, 10])
    questions, keys = quiz_for(course)
    for question in questions:
        assert answer_key(course, question["id"], question["concept_id"]) == keys[question["id"]]


def test_answer_key_survives_mastery_changes_that_reorder_the_quiz():
    course = make_course([35, 35, 35, 35, 35, 35])
    questions, keys = quiz_for(course)
    last = questions[-1]
    # Three weaker concepts and one stronger review candidate now push this concept out of the quiz.
    others = [c for c in course.concepts if c.id != last["concept_id"]]
    for concept, mastery in zip(others, [10, 10, 10, 90, 90], strict=True):
        concept.mastery = mastery
    next(c for c in course.concepts if c.id == last["concept_id"]).mastery = 50
    # The question is no longer part of a freshly generated quiz but must still be gradable.
    assert last["id"] not in quiz_for(course)[1]
    assert answer_key(course, last["id"], last["concept_id"]) == keys[last["id"]]


def test_answer_key_rejects_questions_from_other_courses_or_concepts():
    course = make_course([35, 35])
    concept = course.concepts[0]
    assert answer_key(course, question_id(999, concept.id), concept.id) is None
    assert answer_key(course, question_id(course.id, concept.id), course.concepts[1].id) is None
    assert answer_key(course, question_id(course.id, 12345), 12345) is None
    assert answer_key(course, "garbage", concept.id) is None
