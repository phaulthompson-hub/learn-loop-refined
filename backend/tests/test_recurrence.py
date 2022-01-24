from dataclasses import dataclass
from datetime import date, datetime, timedelta

import pytest

from app.services.recurrence import MAX_OCCURRENCES, Occurrence, find_conflicts, occurrences, occurs_on, overlaps


@dataclass
class FakeEvent:
    starts_at: datetime
    ends_at: datetime
    recurrence: str = "none"
    recurrence_until: date | None = None
    all_day: bool = False


def block(day: int, hour: int, minutes: int = 60, month: int = 3, **kwargs) -> FakeEvent:
    """An event on `day` March 2022 (the 14th is a Monday), or in another month of 2022."""
    start = datetime(2022, month, day, hour)
    return FakeEvent(start, start + timedelta(minutes=minutes), **kwargs)


WEEK = (datetime(2022, 3, 14), datetime(2022, 3, 21))


def starts(found: list[Occurrence]) -> list[datetime]:
    return [o.starts_at for o in found]


class TestOccurrences:
    def test_single_event_inside_and_outside_the_window(self):
        assert starts(occurrences(block(16, 9), *WEEK)) == [datetime(2022, 3, 16, 9)]
        assert occurrences(block(23, 9), *WEEK) == []

    def test_window_is_half_open(self):
        event = block(21, 0)  # starts exactly at the window end
        assert occurrences(event, *WEEK) == []
        ending_at_start = FakeEvent(datetime(2022, 3, 13, 23), datetime(2022, 3, 14))
        assert occurrences(ending_at_start, *WEEK) == []

    def test_event_running_into_the_window_is_included(self):
        overnight = FakeEvent(datetime(2022, 3, 13, 22), datetime(2022, 3, 14, 1))
        assert starts(occurrences(overnight, *WEEK)) == [datetime(2022, 3, 13, 22)]

    def test_daily_series_keeps_duration_and_counts_indexes_from_first_occurrence(self):
        event = block(8, 7, 30, recurrence="daily")
        found = occurrences(event, *WEEK)
        assert len(found) == 7
        assert found[0].index == 6  # 8th..13th came before the window
        assert all(o.ends_at - o.starts_at == timedelta(minutes=30) for o in found)

    def test_weekdays_skip_the_weekend(self):
        found = occurrences(block(14, 7, recurrence="weekdays"), *WEEK)
        assert [o.starts_at.weekday() for o in found] == [0, 1, 2, 3, 4]
        assert [o.index for o in found] == [0, 1, 2, 3, 4]

    def test_weekly_series_repeats_on_the_same_weekday(self):
        found = occurrences(block(7, 18, recurrence="weekly"), datetime(2022, 3, 1), datetime(2022, 4, 1))
        assert [o.starts_at.day for o in found] == [7, 14, 21, 28]

    def test_until_is_inclusive(self):
        event = block(14, 18, recurrence="daily", recurrence_until=date(2022, 3, 16))
        assert [o.starts_at.day for o in occurrences(event, *WEEK)] == [14, 15, 16]

    def test_series_before_window_with_until_yields_nothing(self):
        event = block(28, 18, month=2, recurrence="weekly", recurrence_until=date(2022, 3, 8))
        assert occurrences(event, *WEEK) == []

    def test_occurrence_count_is_capped(self):
        event = FakeEvent(datetime(2020, 1, 1), datetime(2020, 1, 1, 1), recurrence="daily")
        found = occurrences(event, datetime(2020, 1, 1), datetime(2030, 1, 1))
        assert len(found) == MAX_OCCURRENCES

    @pytest.mark.parametrize(
        ("recurrence", "day", "expected"),
        [
            ("none", date(2022, 3, 14), True),
            ("weekdays", date(2022, 3, 19), False),
            ("weekly", date(2022, 3, 21), True),
        ],
    )
    def test_occurs_on(self, recurrence, day, expected):
        assert occurs_on(block(14, 9, recurrence=recurrence), day) is expected


class TestConflicts:
    def test_overlap_is_half_open(self):
        a = Occurrence(datetime(2022, 3, 14, 10), datetime(2022, 3, 14, 11), 0)
        b = Occurrence(datetime(2022, 3, 14, 11), datetime(2022, 3, 14, 12), 0)
        c = Occurrence(datetime(2022, 3, 14, 10, 30), datetime(2022, 3, 14, 10, 45), 0)
        assert not overlaps(a, b)
        assert overlaps(a, c) and overlaps(c, a)

    def test_single_events_that_overlap(self):
        found = find_conflicts(block(16, 15, 90), [("workshop", block(16, 15, 90)), ("later", block(16, 17))])
        assert [c.key for c in found] == ["workshop"]
        assert found[0].occurrence.starts_at == datetime(2022, 3, 16, 15)

    def test_recurring_other_event_clashes_on_a_later_occurrence(self):
        weekly = block(28, 18, 90, month=2, recurrence="weekly")  # Mondays 18:00-19:30
        found = find_conflicts(block(21, 19), [(1, weekly)])
        assert len(found) == 1
        assert found[0].occurrence.index == 3
        assert found[0].against.starts_at == datetime(2022, 3, 21, 19)

    def test_recurring_candidate_reports_every_clash_within_the_horizon(self):
        daily = block(14, 7, 30, recurrence="daily")
        found = find_conflicts(daily, [(1, block(14, 7, 30, recurrence="weekly"))], horizon=timedelta(days=21))
        assert [c.occurrence.starts_at.day for c in found] == [14, 21, 28]

    def test_all_day_entries_never_clash(self):
        deadline = FakeEvent(datetime(2022, 3, 18), datetime(2022, 3, 19), all_day=True)
        assert find_conflicts(block(18, 10), [(1, deadline)]) == []
        assert find_conflicts(deadline, [(1, block(18, 10))]) == []

    def test_results_are_chronological_and_limited(self):
        others = [(i, block(14 + i, 9, recurrence="none")) for i in range(5, -1, -1)]
        candidate = block(14, 9, recurrence="daily")
        found = find_conflicts(candidate, others, limit=3)
        assert [c.key for c in found] == [0, 1, 2]

    def test_clashes_beyond_the_horizon_are_ignored(self):
        far = block(14, 9)
        far.starts_at += timedelta(days=90)
        far.ends_at += timedelta(days=90)
        assert find_conflicts(block(14, 9, recurrence="daily"), [(1, far)], horizon=timedelta(days=60)) == []
