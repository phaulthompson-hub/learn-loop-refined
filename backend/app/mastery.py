"""Explainable mastery model and next-concept recommendation.

Mastery starts at 35%. A correct answer closes 28% of the remaining gap to 100
(`new = old + (100 - old) * 0.28`); an incorrect answer keeps 72% of the current
value (`new = old * 0.72`). A concept is unlocked once its prerequisite reaches
UNLOCK_THRESHOLD, and it counts as mastered at MASTERED_THRESHOLD.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

INITIAL_MASTERY = 35.0
GAIN = 0.28
DECAY = 0.72
UNLOCK_THRESHOLD = 60.0
MASTERED_THRESHOLD = 85.0


class ConceptLike(Protocol):
    id: int
    name: str
    summary: str
    mastery: float
    order_index: int
    prerequisite_id: int | None


def next_mastery(old: float, correct: bool) -> float:
    value = old + (100 - old) * GAIN if correct else old * DECAY
    return min(100.0, max(0.0, value))


def update_mastery(concept: ConceptLike, correct: bool) -> float:
    concept.mastery = next_mastery(concept.mastery, correct)
    return round(concept.mastery, 1)


def mastery_level(value: float) -> str:
    if value >= MASTERED_THRESHOLD:
        return "mastered"
    if value >= UNLOCK_THRESHOLD:
        return "proficient"
    if value >= INITIAL_MASTERY:
        return "learning"
    return "needs review"


def average_mastery(concepts: Sequence[ConceptLike]) -> float:
    if not concepts:
        return 0.0
    return round(sum(c.mastery for c in concepts) / len(concepts), 1)


def is_unlocked(concept: ConceptLike, by_id: dict[int, ConceptLike]) -> bool:
    if concept.prerequisite_id is None:
        return True
    prerequisite = by_id.get(concept.prerequisite_id)
    return prerequisite is None or prerequisite.mastery >= UNLOCK_THRESHOLD


def unlocked_ids(concepts: Sequence[ConceptLike]) -> set[int]:
    by_id = {c.id: c for c in concepts}
    return {c.id for c in concepts if is_unlocked(c, by_id)}


@dataclass(frozen=True)
class Recommendation:
    concept_id: int | None
    concept: str | None
    mastery: float | None
    reason: str


def recommend(concepts: Sequence[ConceptLike]) -> Recommendation:
    """Pick the weakest unlocked concept that is not yet mastered."""
    if not concepts:
        return Recommendation(None, None, None, "Add learning material to get a recommendation.")
    unlocked = unlocked_ids(concepts)
    open_concepts = [c for c in concepts if c.id in unlocked and c.mastery < MASTERED_THRESHOLD]
    if not open_concepts:
        return Recommendation(None, None, None, "Every concept is mastered. Take a quiz to keep it fresh.")
    target = min(open_concepts, key=lambda c: (c.mastery, c.order_index))
    if target.prerequisite_id is None:
        reason = f"{target.name} is a foundation concept with {round(target.mastery)}% mastery."
    else:
        reason = f"{target.name} is unlocked and is your weakest open concept at {round(target.mastery)}%."
    return Recommendation(target.id, target.name, round(target.mastery, 1), reason)
