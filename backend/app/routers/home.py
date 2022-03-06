"""The home dashboard: today's plan and at-a-glance progress."""

from collections.abc import Sequence
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import clock
from ..database import get_db
from ..deps import Access, workspace_access
from ..mastery import mastery_level, recommend
from ..models import Attempt, Course, Deck, Enrollment, Event, Goal, Task
from ..schemas.home import HomeOut
from ..services import analytics as stats
from ..services.board import task_key, workspace_prefix
from ..services.learning import course_summary, learner_concepts, recommendation_payload, user_attempts
from ..services.progress import goal_progress, streak_summary
from ..services.recurrence import occurrences
from ..services.review_queue import due_summary
from .activity import recent_activity
from .analytics import brief, reviews_since, study_logs_since, workspace_courses

router = APIRouter(tags=["home"])

CONTINUE_LIMIT = 4
TASK_LIMIT = 5
GOAL_LIMIT = 4
ACTIVITY_LIMIT = 6
PRIORITY_RANK = {"urgent": 0, "high": 1, "medium": 2, "low": 3}


def occurrence_status(starts_at: datetime, ends_at: datetime, now: datetime) -> str:
    if ends_at <= now:
        return "past"
    return "now" if starts_at <= now else "upcoming"


def todays_agenda(db: Session, access: Access, courses: dict[int, Course], now: datetime) -> list[dict]:
    """My events and the workspace's shared events that occur today, with recurring series expanded."""
    day_start = clock.start_of_day(now)
    day_end = day_start + timedelta(days=1)
    events = db.scalars(
        select(Event).where(
            Event.workspace_id == access.workspace.id,
            or_(Event.user_id == access.user.id, Event.shared.is_(True)),
            Event.starts_at < day_end,
        )
    )
    items = []
    for event in events:
        course = courses.get(event.course_id) if event.course_id else None
        for occurrence in occurrences(event, day_start, day_end):
            items.append(
                {
                    "event_id": event.id,
                    "title": event.title,
                    "kind": event.kind,
                    "starts_at": occurrence.starts_at,
                    "ends_at": occurrence.ends_at,
                    "all_day": event.all_day,
                    "location": event.location,
                    "shared": event.shared,
                    "mine": event.user_id == access.user.id,
                    "recurring": event.recurrence != "none",
                    "status": occurrence_status(occurrence.starts_at, occurrence.ends_at, now),
                    "course": brief(course) if course else None,
                }
            )
    return sorted(items, key=lambda item: (not item["all_day"], item["starts_at"], item["title"].lower()))


def enrolled_courses(db: Session, access: Access, courses: dict[int, Course]) -> list[tuple[Enrollment, Course]]:
    """Active enrolled courses: pinned first, then most recently opened, then most recently joined."""
    enrollments = db.scalars(select(Enrollment).where(Enrollment.user_id == access.user.id))
    pairs = [
        (e, courses[e.course_id])
        for e in enrollments
        if e.course_id in courses and courses[e.course_id].status == "active"
    ]
    # Two stable sorts: newest first by recency, then grouped as pinned / opened / never opened.
    pairs.sort(key=lambda pair: pair[0].last_opened_at or pair[0].enrolled_at, reverse=True)
    pairs.sort(key=lambda pair: (not pair[0].pinned, pair[0].last_opened_at is None))
    return pairs


def continue_learning(db: Session, user_id: int, enrolled: Sequence[tuple[Enrollment, Course]]) -> list[dict]:
    chosen = [course for _, course in enrolled[:CONTINUE_LIMIT]]
    attempts = user_attempts(db, user_id, [c.id for c in chosen])
    cards = []
    for course in chosen:
        summary = course_summary(db, course, user_id, attempts)
        total = summary["concepts"]
        cards.append(
            {
                **{key: summary[key] for key in ("id", "title", "subject", "color", "mastery", "concepts")},
                **{key: summary[key] for key in ("mastered_concepts", "accuracy", "attempts", "pinned")},
                "last_opened_at": summary["last_opened_at"],
                "progress": round(100 * summary["mastered_concepts"] / total, 1) if total else 0.0,
                "next": recommendation_payload(learner_concepts(db, course, user_id)),
            }
        )
    return cards


def focus_recommendation(db: Session, user_id: int, enrolled: Sequence[tuple[Enrollment, Course]]) -> dict | None:
    """The weakest unlocked, unmastered concept across every active enrolled course."""
    best = None
    for _, course in enrolled:
        rec = recommend(learner_concepts(db, course, user_id))
        if rec.concept_id is not None and (best is None or rec.mastery < best[1].mastery):
            best = (course, rec)
    if best is None:
        return None
    course, rec = best
    return {
        "course": brief(course),
        "concept_id": rec.concept_id,
        "concept": rec.concept,
        "mastery": rec.mastery,
        "level": mastery_level(rec.mastery),
        "reason": rec.reason,
    }


def my_tasks(db: Session, access: Access, courses: dict[int, Course], today: date) -> dict:
    tasks = db.scalars(
        select(Task).where(
            Task.workspace_id == access.workspace.id, Task.assignee_id == access.user.id, Task.status != "done"
        )
    ).all()
    ordered = sorted(
        tasks,
        key=lambda t: (t.due_date is None, t.due_date or date.max, PRIORITY_RANK.get(t.priority, 9), t.number),
    )
    items = [
        {
            "id": task.id,
            "number": task.number,
            "key": task_key(workspace_prefix(access.workspace.name), task.number),
            "title": task.title,
            "status": task.status,
            "priority": task.priority,
            "due_date": task.due_date,
            "overdue": task.due_date is not None and task.due_date < today,
            "due_in_days": (task.due_date - today).days if task.due_date else None,
            "course": brief(courses[task.course_id]) if task.course_id in courses else None,
        }
        for task in ordered
    ]
    return {"items": items[:TASK_LIMIT], "total_open": len(items), "overdue": sum(1 for i in items if i["overdue"])}


def active_goals(db: Session, access: Access, courses: dict[int, Course]) -> list[dict]:
    goals = db.scalars(
        select(Goal)
        .where(Goal.workspace_id == access.workspace.id, Goal.user_id == access.user.id, Goal.archived.is_(False))
        .order_by(Goal.id)
    ).all()
    items = []
    for goal in goals:
        progress = goal_progress(db, goal)
        items.append(
            {
                "id": goal.id,
                "title": goal.title,
                "kind": goal.kind,
                "period": goal.period,
                "target": progress["target"],
                "current": progress["current"],
                "percent": progress["percent"],
                "status": progress["status"],
                "unit": progress.get("unit", ""),
                "period_label": progress["period_label"],
                "course": brief(courses[goal.course_id]) if goal.course_id in courses else None,
            }
        )
    # Unfinished goals first, so the dashboard shows what still needs attention.
    items.sort(key=lambda g: g["status"] == "done")
    return items[:GOAL_LIMIT]


def week_summary(db: Session, user_id: int, course_ids: Sequence[int], today: date) -> dict:
    """The last 7 days against the 7 days before them (rolling, so Monday mornings are not empty)."""
    week = stats.period_ending(today, 7)
    previous = week.previous()
    attempts = (
        list(
            db.scalars(
                select(Attempt).where(
                    Attempt.user_id == user_id,
                    Attempt.course_id.in_(course_ids),
                    Attempt.created_at >= previous.start_at,
                )
            )
        )
        if course_ids
        else []
    )
    reviews = reviews_since(db, user_id, course_ids, previous.start_at)
    logs = study_logs_since(db, user_id, course_ids, previous.start_at, include_unassigned=True)

    def totals(period: stats.Period) -> tuple[list, list, list]:
        return (
            stats.in_period(attempts, period, lambda a: a.created_at),
            stats.in_period(reviews, period, lambda r: r.reviewed_at),
            stats.in_period(logs, period, lambda log: log.logged_at),
        )

    now_a, now_r, now_l = totals(week)
    before_a, before_r, before_l = totals(previous)
    series = stats.daily_series(week.dates(), now_a, now_r, now_l)
    return {
        "answers": stats.compare(len(now_a), len(before_a)),
        "accuracy": stats.compare(
            stats.accuracy(sum(a.correct for a in now_a), len(now_a)),
            stats.accuracy(sum(a.correct for a in before_a), len(before_a)),
        ),
        "reviews": stats.compare(len(now_r), len(before_r)),
        "minutes": stats.compare(sum(x.minutes for x in now_l), sum(x.minutes for x in before_l)),
        "days": [
            {
                "date": row["date"],
                "answers": row["correct"] + row["incorrect"],
                "reviews": row["reviews"],
                "minutes": row["minutes"],
            }
            for row in series
        ],
    }


def onboarding(db: Session, access: Access, courses: dict[int, Course], enrolled: int) -> dict:
    workspace_id, user_id = access.workspace.id, access.user.id

    def count(query) -> int:
        return db.scalar(select(func.count()).select_from(query.subquery())) or 0

    return {
        "courses": sum(1 for c in courses.values() if c.status != "archived"),
        "enrolled": enrolled,
        "decks": count(
            select(Deck.id).join(Course, Deck.course_id == Course.id).where(Course.workspace_id == workspace_id)
        ),
        "events": count(
            select(Event.id).where(
                Event.workspace_id == workspace_id, or_(Event.user_id == user_id, Event.shared.is_(True))
            )
        ),
        "goals": count(
            select(Goal.id).where(Goal.workspace_id == workspace_id, Goal.user_id == user_id, Goal.archived.is_(False))
        ),
        "can_create_courses": access.can("instructor"),
    }


@router.get("/api/workspaces/{workspace_id}/home", response_model=HomeOut)
def get_home(access: Access = Depends(workspace_access), db: Session = Depends(get_db)):
    now = clock.now()
    today = now.date()
    user = access.user
    courses = {c.id: c for c in workspace_courses(db, access)}
    enrolled = enrolled_courses(db, access, courses)
    return {
        "greeting": {
            "first_name": stats.first_name(user.name),
            "part_of_day": stats.part_of_day(now.hour),
            "today": today,
            "now": now,
        },
        "streak": streak_summary(db, user.id),
        "flashcards": due_summary(db, user.id, access.workspace.id),
        "agenda": todays_agenda(db, access, courses, now),
        "continue_learning": continue_learning(db, user.id, enrolled),
        "focus": focus_recommendation(db, user.id, enrolled),
        "tasks": my_tasks(db, access, courses, today),
        "goals": active_goals(db, access, courses),
        "week": week_summary(db, user.id, list(courses), today),
        "activity": recent_activity(db, access.workspace.id, ACTIVITY_LIMIT),
        "onboarding": onboarding(db, access, courses, len(enrolled)),
    }
