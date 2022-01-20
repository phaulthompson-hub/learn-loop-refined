"""Spaced-repetition scheduling: an SM-2 variant with four answer grades.

Everything here is pure (no database, no clock) so the API, the seed and the tests all
schedule cards identically. The frontend mirrors these rules in
`features/flashcards/scheduler.ts`; keep the two in sync.

Grades: 0 again (forgot), 1 hard, 2 good, 3 easy.

* Ease starts at 2.5, changes by -0.20 / -0.15 / 0 / +0.15 per grade and never drops below 1.3.
* The first successful answer schedules 1 day (4 days when easy); the second 3 / 6 / 8 days.
* After that the interval grows by the ease factor; hard grows it by only 20% and easy adds a
  30% bonus. Each better grade is always at least one day longer than the one below it.
* "Again" is a lapse: repetitions reset, the card returns in 10 minutes and has to climb the
  1-day / 6-day ladder again.
"""

import math
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta

AGAIN, HARD, GOOD, EASY = 0, 1, 2, 3
GRADES = (AGAIN, HARD, GOOD, EASY)
GRADE_LABELS = {AGAIN: "again", HARD: "hard", GOOD: "good", EASY: "easy"}

DEFAULT_EASE = 2.5
MIN_EASE = 1.3
EASE_CHANGE = {AGAIN: -0.20, HARD: -0.15, GOOD: 0.0, EASY: 0.15}
FIRST_INTERVALS = {HARD: 1, GOOD: 1, EASY: 4}
SECOND_INTERVALS = {HARD: 3, GOOD: 6, EASY: 8}
HARD_FACTOR = 1.2
EASY_BONUS = 1.3
MAX_INTERVAL_DAYS = 365
RELEARN_MINUTES = 10
# A card whose interval reached three weeks counts as "mature" (long-term memory).
MATURE_DAYS = 21


@dataclass(frozen=True)
class CardSchedule:
    """The scheduling fields of a `CardState`, detached from the database row."""

    ease: float = DEFAULT_EASE
    interval_days: int = 0
    repetitions: int = 0
    lapses: int = 0


def round_half_up(value: float, digits: int = 0) -> float:
    """Round like JavaScript's `Math.round` (Python's `round` uses banker's rounding)."""
    factor = 10**digits
    return math.floor(value * factor + 0.5) / factor


def validate_grade(grade: int) -> int:
    if grade not in GRADES:
        raise ValueError(f"grade must be one of {GRADES}")
    return grade


def next_ease(ease: float, grade: int) -> float:
    return max(MIN_EASE, round_half_up(ease + EASE_CHANGE[validate_grade(grade)], 2))


def next_interval(state: CardSchedule, grade: int) -> int:
    """Days until the next review after answering `grade` (0 means "again in a few minutes")."""
    validate_grade(grade)
    if grade == AGAIN:
        return 0
    if state.repetitions == 0:
        days = FIRST_INTERVALS[grade]
    elif state.repetitions == 1:
        days = SECOND_INTERVALS[grade]
    else:
        current = max(state.interval_days, 1)
        hard = max(current + 1, int(round_half_up(current * HARD_FACTOR)))
        good = max(hard + 1, int(round_half_up(current * state.ease)))
        easy = max(good + 1, int(round_half_up(current * state.ease * EASY_BONUS)))
        days = {HARD: hard, GOOD: good, EASY: easy}[grade]
    return min(days, MAX_INTERVAL_DAYS)


def next_schedule(state: CardSchedule, grade: int) -> CardSchedule:
    """The card's scheduling state after one answer."""
    ease = next_ease(state.ease, grade)
    if grade == AGAIN:
        # Forgetting a card that had been learned is a lapse; failing a brand-new card is not.
        lapses = state.lapses + (1 if state.repetitions > 0 else 0)
        return CardSchedule(ease=ease, interval_days=0, repetitions=0, lapses=lapses)
    return CardSchedule(
        ease=ease,
        interval_days=next_interval(state, grade),
        repetitions=state.repetitions + 1,
        lapses=state.lapses,
    )


def due_after(reviewed_at: datetime, interval_days: int) -> datetime:
    if interval_days <= 0:
        return reviewed_at + timedelta(minutes=RELEARN_MINUTES)
    return reviewed_at + timedelta(days=interval_days)


def format_interval(days: int) -> str:
    """Short label for a grade button: "10m", "1d", "6d", "1.5mo", "1y"."""
    if days <= 0:
        return f"{RELEARN_MINUTES}m"
    if days < 30:
        return f"{days}d"
    if days < 365:
        return f"{round_half_up(days / 30, 1):g}mo"
    return f"{round_half_up(days / 365, 1):g}y"


def preview_intervals(state: CardSchedule) -> list[dict]:
    """What each of the four buttons would schedule, for labelling them before the learner answers."""
    previews = []
    for grade in GRADES:
        days = next_interval(state, grade)
        previews.append(
            {"grade": grade, "label": GRADE_LABELS[grade], "interval_days": days, "display": format_interval(days)}
        )
    return previews


def card_status(state: CardSchedule | None) -> str:
    """new (never reviewed), learning (not yet recalled after a lapse), young, or mature."""
    if state is None:
        return "new"
    if state.repetitions == 0 or state.interval_days < 1:
        return "learning"
    return "mature" if state.interval_days >= MATURE_DAYS else "young"


def retention_rate(grades: Iterable[int]) -> float | None:
    """Share of answers that were recalled (anything but "again"), as a percentage."""
    answers = list(grades)
    if not answers:
        return None
    recalled = sum(1 for grade in answers if grade != AGAIN)
    return round_half_up(100 * recalled / len(answers), 1)


def mastery_percent(intervals: Iterable[int], card_count: int) -> float:
    """How settled a deck is: each card contributes up to 1 as its interval approaches `MATURE_DAYS`."""
    if card_count <= 0:
        return 0.0
    progress = sum(min(max(days, 0), MATURE_DAYS) / MATURE_DAYS for days in intervals)
    return round_half_up(100 * progress / card_count, 1)


def forecast(due_dates: Iterable[datetime], today: date, days: int = 14) -> list[tuple[date, int]]:
    """Cards due on each of the next `days` days. Overdue cards count towards today."""
    counts = [0] * days
    for due in due_dates:
        offset = max(0, (due.date() - today).days)
        if offset < days:
            counts[offset] += 1
    return [(today + timedelta(days=offset), count) for offset, count in enumerate(counts)]
