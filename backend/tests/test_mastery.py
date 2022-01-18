from dataclasses import dataclass

import pytest

from app.mastery import (
    INITIAL_MASTERY,
    MASTERED_THRESHOLD,
    UNLOCK_THRESHOLD,
    average_mastery,
    mastery_level,
    next_mastery,
    recommend,
    unlocked_ids,
    update_mastery,
)


@dataclass
class FakeConcept:
    id: int
    name: str
    mastery: float = INITIAL_MASTERY
    order_index: int = 0
    prerequisite_id: int | None = None
    summary: str = ""


def chain(*masteries: float) -> list[FakeConcept]:
    """Concepts 1..n where each one requires the previous concept."""
    return [
        FakeConcept(id=i + 1, name=f"C{i + 1}", mastery=m, order_index=i, prerequisite_id=i if i else None)
        for i, m in enumerate(masteries)
    ]


@pytest.mark.parametrize(
    ("old", "correct", "expected"),
    [
        (35.0, True, 53.2),
        (35.0, False, 25.2),
        (53.2, True, 66.304),
        (0.0, True, 28.0),
        (100.0, True, 100.0),
        (0.0, False, 0.0),
        (50.0, False, 36.0),
    ],
)
def test_next_mastery_follows_documented_formula(old, correct, expected):
    assert next_mastery(old, correct) == pytest.approx(expected)


def test_repeated_correct_answers_increase_monotonically_and_stay_below_100():
    value = INITIAL_MASTERY
    history = []
    for _ in range(25):
        value = next_mastery(value, True)
        history.append(value)
    assert history == sorted(history)
    assert history[-1] < 100
    assert history[-1] > 99.9


def test_repeated_wrong_answers_decay_towards_zero_without_going_negative():
    value = 90.0
    for _ in range(40):
        value = next_mastery(value, False)
        assert value >= 0
    assert value < 0.01


def test_mastery_is_clamped_for_out_of_range_inputs():
    assert next_mastery(130.0, True) == 100.0
    assert next_mastery(-10.0, False) == 0.0


def test_update_mastery_mutates_concept_and_returns_rounded_value():
    concept = FakeConcept(id=1, name="Loss")
    assert update_mastery(concept, True) == 53.2
    assert concept.mastery == pytest.approx(53.2)
    assert update_mastery(concept, False) == 38.3
    assert concept.mastery == pytest.approx(38.304)


@pytest.mark.parametrize(
    ("value", "level"),
    [
        (0, "needs review"),
        (34.9, "needs review"),
        (35, "learning"),
        (59.9, "learning"),
        (60, "proficient"),
        (84.9, "proficient"),
        (85, "mastered"),
        (100, "mastered"),
    ],
)
def test_mastery_level_thresholds(value, level):
    assert mastery_level(value) == level


def test_average_mastery_handles_empty_and_rounds():
    assert average_mastery([]) == 0.0
    assert average_mastery(chain(35, 53.2, 25.2)) == 37.8


def test_only_first_concept_is_unlocked_initially():
    assert unlocked_ids(chain(35, 35, 35)) == {1}


def test_concept_unlocks_when_prerequisite_reaches_threshold():
    concepts = chain(UNLOCK_THRESHOLD, 35, 35)
    assert unlocked_ids(concepts) == {1, 2}
    concepts[0].mastery = UNLOCK_THRESHOLD - 0.1
    assert unlocked_ids(concepts) == {1}


def test_recommendation_starts_with_foundation_concept():
    rec = recommend(chain(35, 35, 35))
    assert rec.concept_id == 1
    assert "foundation" in rec.reason


def test_recommendation_moves_to_weakest_unlocked_concept():
    rec = recommend(chain(66.3, 35, 20))
    # Concept 3 is weaker but still locked behind concept 2.
    assert rec.concept == "C2"
    assert rec.mastery == 35
    assert "unlocked" in rec.reason


def test_recommendation_breaks_ties_by_course_order():
    concepts = [
        FakeConcept(id=10, name="B", mastery=40, order_index=1),
        FakeConcept(id=11, name="A", mastery=40, order_index=0),
    ]
    assert recommend(concepts).concept == "A"


def test_recommendation_skips_mastered_foundation_and_respects_locks():
    # C1 is mastered, C2 is unlocked but below the unlock threshold, so C3 stays locked.
    rec = recommend(chain(MASTERED_THRESHOLD, 50, 20))
    assert rec.concept == "C2"


def test_recommendation_when_everything_is_mastered():
    rec = recommend(chain(90, 95, 99))
    assert rec.concept_id is None
    assert "mastered" in rec.reason


def test_recommendation_for_empty_course():
    rec = recommend([])
    assert rec.concept is None
    assert rec.mastery is None
