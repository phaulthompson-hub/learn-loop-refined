"""Study streaks, activity days, goal progress and study-time summaries.

A learner is "active" on a day when they answered a quiz question, reviewed a flashcard or
logged study time. Streaks count consecutive active days ending today (or yesterday, so a
streak is not shown as broken before the learner has had a chance to study today).

Goals measure real activity inside the goal's workspace: answers (Attempt rows), flashcard
reviews (ReviewLog rows), logged minutes (StudyLog rows without a course, or for one of the
workspace's courses) and course mastery. Pace compares progress with the elapsed share of the
goal's period, so a weekly goal half-done by Thursday is on track while one untouched is not.
"""

import math
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import clock
from ..mastery import INITIAL_MASTERY, average_mastery
from ..models import Attempt, Course, Goal, ReviewLog, StudyLog, User
from .learning import learner_concepts

# A goal counts as on track while progress is at least this share of the expected pace.
PACE_TOLERANCE = 0.8
# Ten minutes of logged study weigh the same as one answer or review in the activity heatmap.
MINUTES_PER_POINT = 10
HEATMAP_LEVELS = 4

GOAL_UNITS = {
    "daily_answers": "answers",
    "weekly_reviews": "reviews",
    "study_minutes": "minutes",
    "course_mastery": "% mastery",
}


def activity_days(db: Session, user_id: int, since: date | None = None) -> set[date]:
    days: set[date] = set()
    for column, model in (
        (Attempt.created_at, Attempt),
        (ReviewLog.reviewed_at, ReviewLog),
        (StudyLog.logged_at, StudyLog),
    ):
        query = select(column).where(model.user_id == user_id)
        if since is not None:
            query = query.where(column >= since)
        days.update(value.date() for value in db.scalars(query))
    return days


def current_streak(days: Iterable[date], today: date) -> int:
    active = set(days)
    cursor = today if today in active else today - timedelta(days=1)
    streak = 0
    while cursor in active:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def longest_streak(days: Iterable[date]) -> int:
    ordered = sorted(set(days))
    best = run = 0
    previous: date | None = None
    for day in ordered:
        run = run + 1 if previous is not None and day - previous == timedelta(days=1) else 1
        best = max(best, run)
        previous = day
    return best


def streak_summary(db: Session, user_id: int) -> dict:
    today = clock.today()
    days = activity_days(db, user_id)
    return {
        "current": current_streak(days, today),
        "longest": longest_streak(days),
        "active_today": today in days,
        "active_days_last_30": sum(1 for d in days if 0 <= (today - d).days < 30),
    }


# ---------- Goal periods and pace (pure) ----------


@dataclass(frozen=True)
class Period:
    start: datetime
    end: datetime | None  # exclusive; None for a one-off goal without a due date
    label: str


def _day_label(value: date) -> str:
    return f"{value.day} {value:%b}"


def goal_period(goal: Goal, now: datetime, week_starts_on: int = 0) -> Period:
    """The window a goal is measured over at `now`."""
    today = now.date()
    midnight = datetime.combine(today, datetime.min.time())
    if goal.period == "day":
        return Period(midnight, midnight + timedelta(days=1), f"Today · {today:%a} {_day_label(today)}")
    if goal.period == "week":
        first = clock.start_of_week(today, week_starts_on)
        last = first + timedelta(days=6)
        start = datetime.combine(first, datetime.min.time())
        span = (
            f"{first.day}–{_day_label(last)}"
            if first.month == last.month
            else f"{_day_label(first)} – {_day_label(last)}"
        )
        return Period(start, start + timedelta(days=7), f"This week · {span}")
    start = min(goal.created_at, now)
    if goal.due_date is None:
        return Period(start, None, "No deadline")
    end = datetime.combine(goal.due_date, datetime.min.time()) + timedelta(days=1)
    return Period(start, end, f"Due {_day_label(goal.due_date)} {goal.due_date.year}")


