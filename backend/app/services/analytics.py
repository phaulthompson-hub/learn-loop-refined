"""Pure aggregations behind the home dashboard and the analytics page.

Nothing here touches the database: routers load the rows (attempts, reviews, study logs,
card states) and these functions turn them into periods, daily series, reconstructed
mastery curves, forecasts and leaderboards. Keeping them pure makes every number on the
analytics screens unit-testable without a seeded database.

Mastery over time is *reconstructed* from quiz history: every `Attempt` stores the
concept's mastery after the answer, so a concept's mastery at any past moment is the
`mastery_after` of its latest attempt before that moment (or the initial mastery when it
had not been practised yet).
"""

from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Protocol, TypeVar

from ..mastery import INITIAL_MASTERY, MASTERED_THRESHOLD

T = TypeVar("T")

# A review graded "good" (2) or "easy" (3) counts as remembered.
REMEMBERED_GRADE = 2
GRADE_NAMES = ("again", "hard", "good", "easy")
FORECAST_DAYS = 14


class AttemptLike(Protocol):
    concept_id: int
    course_id: int
    correct: bool
    mastery_after: float
    created_at: datetime


class ReviewLike(Protocol):
    grade: int
    reviewed_at: datetime


class StudyLike(Protocol):
    minutes: int
    logged_at: datetime


# ---------- Periods ----------


@dataclass(frozen=True)
class Period:
    """An inclusive range of calendar days, e.g. the last 30 days ending today."""

    start: date
    end: date

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    @property
    def start_at(self) -> datetime:
        return datetime.combine(self.start, time.min)

    @property
    def end_at(self) -> datetime:
        """Exclusive upper bound: midnight after the last day."""
        return datetime.combine(self.end + timedelta(days=1), time.min)

    def previous(self) -> "Period":
        """The period of the same length immediately before this one."""
        return Period(self.start - timedelta(days=self.days), self.start - timedelta(days=1))

    def contains(self, moment: datetime | date) -> bool:
        day = moment.date() if isinstance(moment, datetime) else moment
        return self.start <= day <= self.end

    def dates(self) -> list[date]:
        return [self.start + timedelta(days=offset) for offset in range(self.days)]


def period_ending(today: date, days: int) -> Period:
    if days < 1:
        raise ValueError("A period needs at least one day")
    return Period(today - timedelta(days=days - 1), today)


def part_of_day(hour: int) -> str:
    """The greeting bucket for an hour of the day: morning, afternoon, evening or night."""
    if 5 <= hour < 12:
        return "morning"
    if 12 <= hour < 17:
        return "afternoon"
    if 17 <= hour < 22:
        return "evening"
    return "night"


# ---------- Ratios and comparisons ----------


def accuracy(correct: int, total: int) -> float:
    """Percentage of correct answers with one decimal; 0 when nothing was answered."""
    return round(100 * correct / total, 1) if total else 0.0


def compare(current: float, previous: float) -> dict:
    """A KPI value with its previous-period value, absolute change and relative change (None from zero)."""
    percent = None if previous == 0 else round(100 * (current - previous) / abs(previous), 1)
    return {
        "value": round(current, 1),
        "previous": round(previous, 1),
        "change": round(current - previous, 1),
        "percent": percent,
    }


def in_period(rows: Iterable[T], period: Period, moment: Callable[[T], datetime]) -> list[T]:
    return [row for row in rows if period.contains(moment(row))]


# ---------- Daily series ----------


