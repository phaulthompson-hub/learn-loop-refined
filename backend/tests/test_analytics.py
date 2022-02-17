"""Unit tests for the pure aggregations in app.services.analytics."""

from dataclasses import dataclass
from datetime import date, datetime

import pytest

from app.services import analytics as stats


@dataclass
class A:
    """A minimal attempt: concept, correctness, mastery after the answer and when it happened."""

    concept_id: int
    correct: bool
    mastery_after: float
    created_at: datetime
    course_id: int = 1


@dataclass
class R:
    grade: int
    reviewed_at: datetime
    course_id: int = 1


@dataclass
class L:
    minutes: int
    logged_at: datetime
    course_id: int | None = 1
    activity: str = "quiz"


def at(day: int, hour: int = 12, month: int = 3) -> datetime:
    return datetime(2022, month, day, hour)


# ---------- Periods ----------


def test_period_ending_counts_today_as_the_last_day():
    period = stats.period_ending(date(2022, 3, 14), 7)
    assert period.start == date(2022, 3, 8)
    assert period.end == date(2022, 3, 14)
    assert period.days == 7
    assert len(period.dates()) == 7
    assert period.dates()[0] == period.start and period.dates()[-1] == period.end


def test_previous_period_has_the_same_length_and_ends_the_day_before():
    period = stats.period_ending(date(2022, 3, 14), 30)
    previous = period.previous()
    assert previous.days == 30
    assert previous.end == date(2022, 2, 12)
    assert previous.start == date(2022, 1, 14)


def test_period_bounds_are_midnight_and_the_end_is_exclusive():
    period = stats.period_ending(date(2022, 3, 14), 7)
    assert period.start_at == datetime(2022, 3, 8)
    assert period.end_at == datetime(2022, 3, 15)
    assert period.contains(datetime(2022, 3, 14, 23, 59))
    assert not period.contains(datetime(2022, 3, 15, 0, 0))
    assert not period.contains(date(2022, 3, 7))


def test_period_needs_at_least_one_day():
    with pytest.raises(ValueError):
        stats.period_ending(date(2022, 3, 14), 0)


@pytest.mark.parametrize(
    ("hour", "expected"),
    [(5, "morning"), (11, "morning"), (12, "afternoon"), (16, "afternoon"), (17, "evening"), (21, "evening"),
     (22, "night"), (0, "night"), (4, "night")],
)  # fmt: skip
def test_part_of_day_buckets(hour, expected):
    assert stats.part_of_day(hour) == expected


# ---------- Ratios ----------


def test_accuracy_rounds_to_one_decimal_and_handles_zero():
    assert stats.accuracy(2, 3) == 66.7
    assert stats.accuracy(0, 0) == 0.0
    assert stats.accuracy(5, 5) == 100.0


def test_compare_reports_absolute_and_relative_change():
    result = stats.compare(15, 10)
    assert result == {"value": 15, "previous": 10, "change": 5, "percent": 50.0}
    assert stats.compare(5, 10)["percent"] == -50.0


def test_compare_has_no_relative_change_from_zero():
    assert stats.compare(4, 0) == {"value": 4, "previous": 0, "change": 4, "percent": None}


def test_in_period_filters_by_timestamp():
    period = stats.period_ending(date(2022, 3, 14), 2)
    rows = [L(10, at(12)), L(20, at(13)), L(30, at(14, 23))]
    assert [r.minutes for r in stats.in_period(rows, period, lambda r: r.logged_at)] == [20, 30]


# ---------- Daily series ----------


def test_daily_series_buckets_every_source_by_day_and_ignores_other_days():
    days = stats.period_ending(date(2022, 3, 14), 3).dates()
    attempts = [A(1, True, 50, at(12, 9)), A(1, False, 40, at(12, 10)), A(2, True, 60, at(14)), A(2, True, 70, at(1))]
    reviews = [R(2, at(13)), R(0, at(13)), R(3, at(18))]
    logs = [L(25, at(14)), L(5, at(14, 20))]
    series = stats.daily_series(days, attempts, reviews, logs)
    assert [row["date"] for row in series] == days
    assert series[0] == {"date": date(2022, 3, 12), "correct": 1, "incorrect": 1, "reviews": 0, "minutes": 0}
    assert series[1]["reviews"] == 2
    assert series[2] == {"date": date(2022, 3, 14), "correct": 1, "incorrect": 0, "reviews": 0, "minutes": 30}


