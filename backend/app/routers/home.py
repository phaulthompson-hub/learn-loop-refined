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


