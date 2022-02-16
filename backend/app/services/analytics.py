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


def daily_series(
    days: Sequence[date],
    attempts: Iterable[AttemptLike],
    reviews: Iterable[ReviewLike],
    logs: Iterable[StudyLike],
) -> list[dict]:
    """One row per day with correct/incorrect answers, flashcard reviews and study minutes."""
    rows = {day: {"date": day, "correct": 0, "incorrect": 0, "reviews": 0, "minutes": 0} for day in days}
    for attempt in attempts:
        row = rows.get(attempt.created_at.date())
        if row is not None:
            row["correct" if attempt.correct else "incorrect"] += 1
    for review in reviews:
        row = rows.get(review.reviewed_at.date())
        if row is not None:
            row["reviews"] += 1
    for log in logs:
        row = rows.get(log.logged_at.date())
        if row is not None:
            row["minutes"] += log.minutes
    return [rows[day] for day in days]


def active_days(
    period: Period, attempts: Iterable[AttemptLike], reviews: Iterable[ReviewLike], logs: Iterable[StudyLike]
) -> int:
    """Distinct days in the period with at least one answer, review or logged study session."""
    days = {a.created_at.date() for a in attempts}
    days |= {r.reviewed_at.date() for r in reviews}
    days |= {log.logged_at.date() for log in logs}
    return sum(1 for day in days if period.contains(day))


# ---------- Mastery reconstruction ----------


def _chronological(attempts: Iterable[AttemptLike]) -> list[AttemptLike]:
    return sorted(attempts, key=lambda a: a.created_at)


def mastery_snapshot(
    concept_ids: Iterable[int], attempts: Iterable[AttemptLike], before: datetime, initial: float = INITIAL_MASTERY
) -> dict[int, float]:
    """Each concept's mastery just before `before`, replayed from attempt history."""
    snapshot = dict.fromkeys(concept_ids, initial)
    for attempt in _chronological(attempts):
        if attempt.created_at >= before:
            break
        if attempt.concept_id in snapshot:
            snapshot[attempt.concept_id] = attempt.mastery_after
    return snapshot


def average(values: Iterable[float]) -> float:
    items = list(values)
    return round(sum(items) / len(items), 1) if items else 0.0


def mastery_timeline(
    concept_ids: Sequence[int], attempts: Iterable[AttemptLike], days: Sequence[date], initial: float = INITIAL_MASTERY
) -> list[float]:
    """Average mastery across `concept_ids` at the end of each day in `days` (days must be ascending)."""
    if not concept_ids:
        return [0.0 for _ in days]
    current = dict.fromkeys(concept_ids, initial)
    ordered = _chronological(a for a in attempts if a.concept_id in current)
    cursor = 0
    timeline: list[float] = []
    for day in days:
        day_end = datetime.combine(day + timedelta(days=1), time.min)
        while cursor < len(ordered) and ordered[cursor].created_at < day_end:
            current[ordered[cursor].concept_id] = ordered[cursor].mastery_after
            cursor += 1
        timeline.append(average(current.values()))
    return timeline


def mastered_count(masteries: Iterable[float]) -> int:
    return sum(1 for value in masteries if value >= MASTERED_THRESHOLD)


# ---------- Per-concept statistics ----------


@dataclass
class ConceptStats:
    attempts: int = 0
    correct: int = 0
    last_practiced: datetime | None = None

    @property
    def accuracy(self) -> float:
        return accuracy(self.correct, self.attempts)


def concept_stats(attempts: Iterable[AttemptLike], period: Period | None = None) -> dict[int, ConceptStats]:
    """Attempts and accuracy per concept inside `period`; `last_practiced` always spans all history."""
    stats: dict[int, ConceptStats] = defaultdict(ConceptStats)
    for attempt in attempts:
        entry = stats[attempt.concept_id]
        if entry.last_practiced is None or attempt.created_at > entry.last_practiced:
            entry.last_practiced = attempt.created_at
        if period is None or period.contains(attempt.created_at):
            entry.attempts += 1
            entry.correct += int(attempt.correct)
    return dict(stats)


def weakest(rows: Iterable[dict], limit: int = 5) -> list[dict]:
    """Unlocked, not-yet-mastered concepts from lowest to highest mastery."""
    open_rows = [r for r in rows if r["unlocked"] and r["mastery"] < MASTERED_THRESHOLD]
    return sorted(open_rows, key=lambda r: (r["mastery"], r["name"].lower()))[:limit]


# ---------- Flashcards ----------


def retention(grades: Iterable[int]) -> float | None:
    """Share of reviews graded good or easy, as a percentage; None when there were no reviews."""
    items = list(grades)
    if not items:
        return None
    return round(100 * sum(1 for g in items if g >= REMEMBERED_GRADE) / len(items), 1)


