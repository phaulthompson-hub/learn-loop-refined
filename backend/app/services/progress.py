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


def elapsed_fraction(start: datetime, end: datetime | None, now: datetime) -> float:
    """Share of [start, end) that has passed, clamped to 0..1 (0 for open-ended periods)."""
    if end is None or end <= start:
        return 0.0
    return min(1.0, max(0.0, (now - start) / (end - start)))


def goal_status(current: float, target: float, fraction: float, *, overdue: bool, baseline: float = 0.0) -> str:
    """done / overdue / on_track / at_risk.

    Expected progress grows linearly from `baseline` (where every learner starts, e.g. the
    initial 35% mastery) to `target` over the period; falling below PACE_TOLERANCE of the
    expected gain puts the goal at risk.
    """
    if current >= target:
        return "done"
    if overdue:
        return "overdue"
    expected_gain = (target - baseline) * fraction
    if expected_gain <= 0:
        return "on_track"
    return "on_track" if current - baseline >= expected_gain * PACE_TOLERANCE else "at_risk"


# ---------- Measuring goals against real activity ----------


def _workspace_courses(workspace_id: int):
    return select(Course.id).where(Course.workspace_id == workspace_id)


def study_log_scope(workspace_id: int):
    """StudyLog rows that belong to a workspace: general study time or time on one of its courses."""
    return or_(StudyLog.course_id.is_(None), StudyLog.course_id.in_(_workspace_courses(workspace_id)))


def _count_in_window(db: Session, goal: Goal, period: Period, model, column) -> int:
    query = select(func.count()).select_from(model).where(model.user_id == goal.user_id, column >= period.start)
    if period.end is not None:
        query = query.where(column < period.end)
    if goal.course_id is not None:
        query = query.where(model.course_id == goal.course_id)
    else:
        query = query.where(model.course_id.in_(_workspace_courses(goal.workspace_id)))
    return db.scalar(query) or 0


def _minutes_in_window(db: Session, goal: Goal, period: Period) -> int:
    query = select(func.coalesce(func.sum(StudyLog.minutes), 0)).where(
        StudyLog.user_id == goal.user_id, StudyLog.logged_at >= period.start
    )
    if period.end is not None:
        query = query.where(StudyLog.logged_at < period.end)
    if goal.course_id is not None:
        query = query.where(StudyLog.course_id == goal.course_id)
    else:
        query = query.where(study_log_scope(goal.workspace_id))
    return int(db.scalar(query) or 0)


def goal_current(db: Session, goal: Goal, period: Period) -> float:
    if goal.kind == "daily_answers":
        return _count_in_window(db, goal, period, Attempt, Attempt.created_at)
    if goal.kind == "weekly_reviews":
        return _count_in_window(db, goal, period, ReviewLog, ReviewLog.reviewed_at)
    if goal.kind == "study_minutes":
        return _minutes_in_window(db, goal, period)
    course = db.get(Course, goal.course_id) if goal.course_id else None
    return average_mastery(learner_concepts(db, course, goal.user_id)) if course else 0.0


def goal_progress(db: Session, goal: Goal) -> dict:
    """Progress of one goal right now: current value, pace status and a human period label."""
    now = clock.now()
    user = db.get(User, goal.user_id)
    period = goal_period(goal, now, user.week_starts_on if user else 0)
    current = goal_current(db, goal, period)
    target = goal.target
    overdue = goal.period == "once" and goal.due_date is not None and goal.due_date < now.date()
    baseline = min(INITIAL_MASTERY, target) if goal.kind == "course_mastery" else 0.0
    fraction = elapsed_fraction(period.start, period.end, now)
    days_left = None if period.end is None else max(0, (period.end.date() - now.date()).days - 1)
    return {
        "current": round(current, 1),
        "target": target,
        "percent": min(100, round(100 * current / target)) if target > 0 else 0,
        "remaining": round(max(0.0, target - current), 1),
        "expected": round(baseline + (target - baseline) * fraction, 1),
        "status": goal_status(current, target, fraction, overdue=overdue, baseline=baseline),
        "unit": GOAL_UNITS[goal.kind],
        "period_label": period.label,
        "period_start": period.start,
        "period_end": period.end,
        "days_left": days_left,
    }


# ---------- Activity heatmap and study-time summaries ----------


def activity_score(answers: int, reviews: int, minutes: int) -> float:
    return answers + reviews + minutes / MINUTES_PER_POINT


def intensity_level(score: float, max_score: float) -> int:
    """0 for no activity, otherwise 1..4 relative to the busiest day in view."""
    if score <= 0 or max_score <= 0:
        return 0
    return min(HEATMAP_LEVELS, max(1, math.ceil(HEATMAP_LEVELS * score / max_score)))


def daily_activity(db: Session, user_id: int, start: date, end: date) -> dict[date, dict[str, int]]:
    """Answers, reviews and logged minutes per day in [start, end)."""
    begin = datetime.combine(start, datetime.min.time())
    finish = datetime.combine(end, datetime.min.time())
    counts: dict[date, dict[str, int]] = defaultdict(lambda: {"answers": 0, "reviews": 0, "minutes": 0})
    for key, column, model in (
        ("answers", Attempt.created_at, Attempt),
        ("reviews", ReviewLog.reviewed_at, ReviewLog),
    ):
        for moment in db.scalars(select(column).where(model.user_id == user_id, column >= begin, column < finish)):
            counts[moment.date()][key] += 1
    minutes = db.execute(
        select(StudyLog.logged_at, StudyLog.minutes).where(
            StudyLog.user_id == user_id, StudyLog.logged_at >= begin, StudyLog.logged_at < finish
        )
    )
    for moment, amount in minutes:
        counts[moment.date()]["minutes"] += amount
    return counts


def activity_heatmap(db: Session, user_id: int, today: date, weeks: int = 12, week_starts_on: int = 0) -> dict:
    """`weeks` full columns ending with the current week; days after today are flagged `future`."""
    start = clock.start_of_week(today, week_starts_on) - timedelta(weeks=weeks - 1)
    end = start + timedelta(weeks=weeks)
    counts = daily_activity(db, user_id, start, end)
    days = []
    for offset in range((end - start).days):
        day = start + timedelta(days=offset)
        entry = counts.get(day, {"answers": 0, "reviews": 0, "minutes": 0})
        days.append({"date": day, **entry, "score": activity_score(**entry), "future": day > today})
    max_score = max((d["score"] for d in days), default=0)
    for entry in days:
        entry["level"] = intensity_level(entry["score"], max_score)
        entry["score"] = round(entry["score"], 1)
    active = [d for d in days if d["score"] > 0]
    return {
        "start": start,
        "end": end - timedelta(days=1),
        "weeks": weeks,
        "days": days,
        "max_score": round(max_score, 1),
        "active_days": len(active),
        "totals": {key: sum(d[key] for d in days) for key in ("answers", "reviews", "minutes")},
    }


def study_summary(
    db: Session, user_id: int, workspace_id: int, today: date, weeks: int = 4, week_starts_on: int = 0
) -> dict:
    """Minutes per day and per week over the last `weeks` weeks, plus a per-course split."""
    start = clock.start_of_week(today, week_starts_on) - timedelta(weeks=weeks - 1)
    begin = datetime.combine(start, datetime.min.time())
    rows = db.execute(
        select(StudyLog.logged_at, StudyLog.minutes, StudyLog.course_id).where(
            StudyLog.user_id == user_id, StudyLog.logged_at >= begin, study_log_scope(workspace_id)
        )
    ).all()
    per_day: dict[date, int] = defaultdict(int)
    per_course: dict[int | None, int] = defaultdict(int)
    for moment, minutes, course_id in rows:
        per_day[moment.date()] += minutes
        per_course[course_id] += minutes
    week_rows = []
    for week in range(weeks):
        first = start + timedelta(weeks=week)
        days = [
            {"date": first + timedelta(days=i), "minutes": per_day.get(first + timedelta(days=i), 0)} for i in range(7)
        ]
        week_rows.append({"start": first, "minutes": sum(d["minutes"] for d in days), "days": days})
    courses = {c.id: c for c in db.scalars(select(Course).where(Course.id.in_([k for k in per_course if k])))}
    by_course = [
        {
            "course_id": course_id,
            "title": courses[course_id].title if course_id in courses else "General study",
            "color": courses[course_id].color if course_id in courses else None,
            "minutes": minutes,
        }
        for course_id, minutes in per_course.items()
    ]
    by_course.sort(key=lambda row: (-row["minutes"], row["title"]))
    total = sum(per_course.values())
    active_days = sum(1 for minutes in per_day.values() if minutes > 0)
    return {
        "start": start,
        "weeks": week_rows,
        "by_course": by_course,
        "total_minutes": total,
        "active_days": active_days,
        "average_per_active_day": round(total / active_days) if active_days else 0,
        "today_minutes": per_day.get(today, 0),
    }
