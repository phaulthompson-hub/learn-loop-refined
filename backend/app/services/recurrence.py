"""Expanding recurring calendar events into concrete occurrences.

An event stores its first occurrence (`starts_at`/`ends_at`) plus a rule: `none`, `daily`,
`weekdays` (Mon–Fri) or `weekly`, optionally ending on `recurrence_until` (inclusive).
`occurrences()` returns every occurrence that overlaps a [start, end) window, and
`find_conflicts()` compares one event's occurrences with other events' occurrences.
"""

from collections.abc import Hashable, Iterator, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Protocol

MAX_OCCURRENCES = 1000
# How far ahead a new or edited event is checked for clashes with the rest of the calendar.
CONFLICT_HORIZON = timedelta(days=60)
MAX_CONFLICTS = 10


class EventLike(Protocol):
    starts_at: datetime
    ends_at: datetime
    recurrence: str
    recurrence_until: date | None


class TimedEventLike(EventLike, Protocol):
    all_day: bool


@dataclass(frozen=True)
class Occurrence:
    starts_at: datetime
    ends_at: datetime
    index: int  # 0 for the first occurrence of the series


@dataclass(frozen=True)
class Conflict:
    key: Hashable  # identifies the other event (the caller's id)
    occurrence: Occurrence  # the other event's clashing occurrence
    against: Occurrence  # the checked event's occurrence it overlaps


def _candidate_starts(event: EventLike) -> Iterator[datetime]:
    first = event.starts_at
    if event.recurrence == "none":
        yield first
        return
    step = timedelta(days=7 if event.recurrence == "weekly" else 1)
    current = first
    for _ in range(MAX_OCCURRENCES * 7):
        if event.recurrence_until is not None and current.date() > event.recurrence_until:
            return
        if event.recurrence != "weekdays" or current.weekday() < 5:
            yield current
        current += step


def occurrences(event: EventLike, start: datetime, end: datetime) -> list[Occurrence]:
    """Occurrences overlapping [start, end), in chronological order."""
    duration = event.ends_at - event.starts_at
    found: list[Occurrence] = []
    for index, begin in enumerate(_candidate_starts(event)):
        if begin >= end or len(found) >= MAX_OCCURRENCES:
            break
        finish = begin + duration
        if finish > start or (duration == timedelta(0) and begin >= start):
            found.append(Occurrence(begin, finish, index))
    return found


def occurs_on(event: EventLike, day: date) -> bool:
    start = datetime(day.year, day.month, day.day)
    return bool(occurrences(event, start, start + timedelta(days=1)))


def overlaps(a: Occurrence, b: Occurrence) -> bool:
    """Half-open interval overlap: back-to-back blocks (10–11 then 11–12) do not clash."""
    return a.starts_at < b.ends_at and b.starts_at < a.ends_at


def find_conflicts(
    event: TimedEventLike,
    others: Sequence[tuple[Hashable, TimedEventLike]],
    horizon: timedelta = CONFLICT_HORIZON,
    limit: int = MAX_CONFLICTS,
) -> list[Conflict]:
    """Timed occurrences of `others` that overlap `event` within `horizon` of its first start.

    All-day entries (deadlines, exam days) are markers rather than blocked time, so they never
    count as clashes. Results are chronological and capped at `limit`.
    """
    if event.all_day:
        return []
    window_start = event.starts_at
    window_end = event.starts_at + horizon
    mine = occurrences(event, window_start, window_end)
    found: list[Conflict] = []
    for key, other in others:
        if other.all_day:
            continue
        theirs = occurrences(other, window_start, window_end)
        found.extend(
            Conflict(key, occurrence, against)
            for occurrence in theirs
            for against in mine
            if overlaps(occurrence, against)
        )
    found.sort(key=lambda c: (c.occurrence.starts_at, str(c.key)))
    return found[:limit]
