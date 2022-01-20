from datetime import date, datetime, timedelta

import pytest

from app.services.scheduler import (
    AGAIN,
    EASY,
    GOOD,
    GRADES,
    HARD,
    MAX_INTERVAL_DAYS,
    MIN_EASE,
    CardSchedule,
    card_status,
    due_after,
    forecast,
    format_interval,
    mastery_percent,
    next_ease,
    next_interval,
    next_schedule,
    preview_intervals,
    retention_rate,
    round_half_up,
)

NEW = CardSchedule()


def learned(interval: int, ease: float = 2.5, repetitions: int = 3, lapses: int = 0) -> CardSchedule:
    return CardSchedule(ease=ease, interval_days=interval, repetitions=repetitions, lapses=lapses)


def answer_all(*grades: int, state: CardSchedule = NEW) -> CardSchedule:
    for grade in grades:
        state = next_schedule(state, grade)
    return state


# ---------- Ease ----------


@pytest.mark.parametrize(
    ("grade", "expected"),
    [(AGAIN, 2.3), (HARD, 2.35), (GOOD, 2.5), (EASY, 2.65)],
)
def test_ease_changes_by_grade(grade, expected):
    assert next_ease(2.5, grade) == expected


def test_ease_never_drops_below_minimum():
    state = answer_all(*[AGAIN] * 12)
    assert state.ease == MIN_EASE
    assert next_ease(1.35, HARD) == MIN_EASE


def test_ease_is_rounded_to_two_decimals():
    assert next_ease(2.15, EASY) == 2.3
    assert next_ease(1.45, HARD) == MIN_EASE


def test_easy_answers_keep_raising_ease():
    assert answer_all(EASY, EASY, EASY).ease == pytest.approx(2.95)


# ---------- Interval ladder ----------


@pytest.mark.parametrize(("grade", "days"), [(AGAIN, 0), (HARD, 1), (GOOD, 1), (EASY, 4)])
def test_first_answer_intervals(grade, days):
    assert next_interval(NEW, grade) == days


@pytest.mark.parametrize(("grade", "days"), [(AGAIN, 0), (HARD, 3), (GOOD, 6), (EASY, 8)])
def test_second_answer_intervals(grade, days):
    after_first = next_schedule(NEW, GOOD)
    assert after_first.repetitions == 1
    assert next_interval(after_first, grade) == days


def test_consecutive_good_answers_follow_sm2():
    intervals = []
    state = NEW
    for _ in range(5):
        state = next_schedule(state, GOOD)
        intervals.append(state.interval_days)
    # 1, 6, then interval * 2.5 rounded half up: 15, 37.5 -> 38, 95.
    assert intervals == [1, 6, 15, 38, 95]


def test_mature_intervals_apply_hard_and_easy_modifiers():
    state = learned(10)
    assert next_interval(state, HARD) == 12  # 10 * 1.2
    assert next_interval(state, GOOD) == 25  # 10 * 2.5
    assert next_interval(state, EASY) == 33  # 10 * 2.5 * 1.3 = 32.5 -> 33


def test_rounding_is_half_up_like_javascript():
    # Python's round(12.5) is 12; the scheduler must agree with the browser's Math.round (13).
    assert next_interval(learned(5), GOOD) == 13
    assert round_half_up(2.5) == 3
    assert round_half_up(0.125, 2) == 0.13


def test_low_ease_still_grows_every_better_grade_by_a_day():
    state = learned(1, ease=MIN_EASE)
    hard, good, easy = (next_interval(state, g) for g in (HARD, GOOD, EASY))
    assert (hard, good, easy) == (2, 3, 4)


@pytest.mark.parametrize("interval", [1, 2, 3, 7, 19, 40, 120])
@pytest.mark.parametrize("ease", [1.3, 1.7, 2.5, 3.1])
def test_better_grades_always_schedule_further_out(interval, ease):
    state = learned(interval, ease=ease)
    hard, good, easy = (next_interval(state, g) for g in (HARD, GOOD, EASY))
    assert interval < hard < good < easy or easy == MAX_INTERVAL_DAYS


def test_intervals_are_capped_at_a_year():
    state = learned(300, ease=2.8)
    assert next_interval(state, GOOD) == MAX_INTERVAL_DAYS
    assert next_interval(state, EASY) == MAX_INTERVAL_DAYS


