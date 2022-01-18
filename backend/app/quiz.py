"""Adaptive multiple-choice quiz generation.

Questions are derived deterministically from the stored concepts, so a question id
(`"<course_id>:<concept_id>"`) can always be re-graded later even if the learner's
mastery, and therefore the quiz ordering, has changed in the meantime.
"""

from collections.abc import Sequence

from .mastery import ConceptLike

OPTION_COUNT = 4
OPTION_LENGTH = 130
GENERIC_DISTRACTORS = (
    "A concept unrelated to {name}",
    "A tool used only for storing files",
    "A rule that prevents all model learning",
)


def question_id(course_id: int, concept_id: int) -> str:
    return f"{course_id}:{concept_id}"


def parse_question_id(value: str) -> tuple[int, int] | None:
    parts = value.split(":")
    if len(parts) != 2 or not all(p.isdigit() for p in parts):
        return None
    return int(parts[0]), int(parts[1])


def select_concepts(concepts: Sequence[ConceptLike], count: int = 4) -> list[ConceptLike]:
    """Weakest concepts first, plus one review item from the strongest remaining concept."""
    ordered = sorted(concepts, key=lambda c: (c.mastery, c.order_index))
    if len(ordered) <= count:
        return ordered
    weakest = ordered[: count - 1]
    rest = ordered[count - 1 :]
    review = max(rest, key=lambda c: (c.mastery, -c.order_index))
    return [*weakest, review]


def _distractors(concept: ConceptLike, correct: str, others: Sequence[ConceptLike]) -> list[str]:
    options: list[str] = []
    for other in sorted(others, key=lambda c: c.order_index):
        text = other.summary[:OPTION_LENGTH]
        if other.id != concept.id and text != correct and text not in options:
            options.append(text)
    # Rotate by concept id so each question draws a different, but stable, set of sibling summaries.
    if options:
        shift = concept.id % len(options)
        options = options[shift:] + options[:shift]
    # Generic statements only fill the gaps when the course has too few other concepts.
    for template in GENERIC_DISTRACTORS:
        text = template.format(name=concept.name)
        if text not in options and text != correct:
            options.append(text)
    return options[: OPTION_COUNT - 1]


def build_question(course_id: int, concept: ConceptLike, all_concepts: Sequence[ConceptLike]) -> tuple[dict, int]:
    correct = concept.summary[:OPTION_LENGTH]
    options = [correct, *_distractors(concept, correct, all_concepts)]
    shift = concept.id % OPTION_COUNT
    options = options[shift:] + options[:shift]
    key = options.index(correct)
    question = {
        "id": question_id(course_id, concept.id),
        "concept_id": concept.id,
        "concept": concept.name,
        "prompt": f"Which statement best explains {concept.name}?",
        "options": options,
    }
    return question, key


def quiz_for(course, count: int = 4) -> tuple[list[dict], dict[str, int]]:
    questions, keys = [], {}
    for concept in select_concepts(course.concepts, count):
        question, key = build_question(course.id, concept, course.concepts)
        questions.append(question)
        keys[question["id"]] = key
    return questions, keys


def answer_key(course, qid: str, concept_id: int) -> int | None:
    """Return the correct option index, or None if the question does not belong to this course/concept."""
    parsed = parse_question_id(qid)
    if parsed != (course.id, concept_id):
        return None
    concept = next((c for c in course.concepts if c.id == concept_id), None)
    if concept is None:
        return None
    return build_question(course.id, concept, course.concepts)[1]
