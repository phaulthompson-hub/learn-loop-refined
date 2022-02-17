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


def test_active_days_counts_distinct_days_across_sources():
    period = stats.period_ending(date(2022, 3, 14), 7)
    attempts = [A(1, True, 50, at(8)), A(1, True, 50, at(8, 18))]
    reviews = [R(2, at(10))]
    logs = [L(10, at(10)), L(10, at(1))]  # 1 March is outside the period
    assert stats.active_days(period, attempts, reviews, logs) == 2


# ---------- Mastery reconstruction ----------


def test_mastery_snapshot_uses_the_latest_attempt_before_the_moment():
    attempts = [A(1, True, 55, at(8)), A(1, True, 68, at(10)), A(2, False, 25, at(9)), A(9, True, 90, at(9))]
    snapshot = stats.mastery_snapshot([1, 2, 3], attempts, datetime(2022, 3, 10))
    assert snapshot == {1: 55, 2: 25, 3: 35.0}  # concept 9 is out of scope, concept 3 never practised


def test_mastery_snapshot_ignores_insertion_order():
    attempts = [A(1, True, 68, at(10)), A(1, True, 55, at(8))]
    assert stats.mastery_snapshot([1], attempts, datetime(2022, 3, 11))[1] == 68


def test_mastery_timeline_steps_through_days_and_averages_concepts():
    days = [date(2022, 3, 8), date(2022, 3, 9), date(2022, 3, 10)]
    attempts = [A(1, True, 55, at(8, 20)), A(2, True, 45, at(10, 8)), A(1, False, 40, at(10, 9))]
    # Day 1: (55 + 35) / 2; day 2 unchanged; day 3: (40 + 45) / 2.
    assert stats.mastery_timeline([1, 2], attempts, days) == [45.0, 45.0, 42.5]


def test_mastery_timeline_includes_history_before_the_first_day():
    attempts = [A(1, True, 80, at(1))]
    assert stats.mastery_timeline([1], attempts, [date(2022, 3, 8)]) == [80.0]


def test_mastery_timeline_without_concepts_is_flat_zero():
    assert stats.mastery_timeline([], [], [date(2022, 3, 8), date(2022, 3, 9)]) == [0.0, 0.0]


def test_mastered_count_uses_the_mastery_threshold():
    assert stats.mastered_count([84.9, 85.0, 99, 20]) == 2


def test_average_rounds_and_handles_empty_input():
    assert stats.average([10, 20, 25]) == 18.3
    assert stats.average([]) == 0.0


# ---------- Concepts ----------


def test_concept_stats_counts_period_attempts_but_tracks_last_practice_overall():
    period = stats.period_ending(date(2022, 3, 14), 7)
    attempts = [A(1, True, 50, at(1)), A(1, True, 60, at(10)), A(1, False, 45, at(12)), A(2, True, 50, at(2))]
    result = stats.concept_stats(attempts, period)
    assert result[1].attempts == 2
    assert result[1].correct == 1
    assert result[1].accuracy == 50.0
    assert result[1].last_practiced == at(12)
    assert result[2].attempts == 0
    assert result[2].last_practiced == at(2)


def test_weakest_skips_locked_and_mastered_concepts_and_sorts_by_mastery():
    rows = [
        {"name": "Joins", "mastery": 40, "unlocked": True},
        {"name": "Indexes", "mastery": 20, "unlocked": False},
        {"name": "Keys", "mastery": 90, "unlocked": True},
        {"name": "Aggregates", "mastery": 40, "unlocked": True},
        {"name": "Tables", "mastery": 30, "unlocked": True},
    ]
    assert [r["name"] for r in stats.weakest(rows)] == ["Tables", "Aggregates", "Joins"]
    assert len(stats.weakest(rows, limit=1)) == 1


# ---------- Flashcards ----------


def test_retention_is_the_share_of_good_or_easy_grades():
    assert stats.retention([0, 1, 2, 3]) == 50.0
    assert stats.retention([2, 2, 3]) == 100.0
    assert stats.retention([]) is None


def test_grade_counts_names_every_grade():
    assert stats.grade_counts([0, 2, 2, 3]) == {"again": 1, "hard": 0, "good": 2, "easy": 1}


def test_forecast_folds_overdue_cards_into_today_and_drops_far_future():
    today = date(2022, 3, 14)
    due = [at(1), at(14, 8), at(15), at(27), at(28), datetime(2022, 4, 29)]
    result = stats.forecast(due, today)
    assert len(result) == 14
    assert result[0] == {"date": today, "count": 2}
    assert result[1]["count"] == 1
    assert result[-1] == {"date": date(2022, 3, 27), "count": 1}
    assert sum(day["count"] for day in result) == 4


# ---------- Study time ----------


def test_minutes_by_groups_and_orders_largest_first():
    logs = [L(10, at(1), 1, "quiz"), L(30, at(1), 2, "reading"), L(15, at(2), 1, "reading"), L(5, at(2), None)]
    by_course = stats.minutes_by(logs, lambda log: log.course_id, lambda log: log.minutes)
    assert list(by_course.items()) == [(2, 30), (1, 25), (None, 5)]
    by_activity = stats.minutes_by(logs, lambda log: log.activity, lambda log: log.minutes)
    assert by_activity == {"reading": 45, "quiz": 15}


# ---------- Leaderboard ----------


def test_first_name():
    assert stats.first_name("Alex Rivera") == "Alex"
    assert stats.first_name("Cher") == "Cher"


def test_rank_leaderboard_orders_by_answers_then_accuracy_with_shared_ranks():
    rows = [
        {"user_id": 1, "name": "Alex", "answers": 10, "correct": 7},
        {"user_id": 2, "name": "Sam", "answers": 10, "correct": 9},
        {"user_id": 3, "name": "Priya", "answers": 4, "correct": 2},
        {"user_id": 4, "name": "Jonas", "answers": 4, "correct": 2},
        {"user_id": 5, "name": "Lena", "answers": 0, "correct": 0},
    ]
    ranked = stats.rank_leaderboard(rows, viewer_id=1)
    expected = [("Sam", 1), ("Alex", 2), ("Jonas", 3), ("Priya", 3), ("Lena", 5)]
    assert [(r["name"], r["rank"]) for r in ranked] == expected
    assert [r["is_me"] for r in ranked] == [False, True, False, False, False]
    assert ranked[0]["accuracy"] == 90.0
    assert ranked[-1]["accuracy"] == 0.0
