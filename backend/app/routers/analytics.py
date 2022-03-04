"""Learning analytics: mastery trends, accuracy, retention and workload."""

from collections.abc import Sequence
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Integer, cast, func, or_, select
from sqlalchemy.orm import Session

from .. import clock
from ..database import get_db
from ..deps import Access, workspace_access
from ..mastery import INITIAL_MASTERY, average_mastery, mastery_level, unlocked_ids
from ..models import (
    Attempt,
    CardState,
    Concept,
    ConceptProgress,
    Course,
    Deck,
    Enrollment,
    Flashcard,
    Membership,
    ReviewLog,
    StudyLog,
    User,
)
from ..schemas.analytics import AnalyticsOut, LearnersOut
from ..services import analytics as stats
from ..services.learning import LearnerConcept, learner_concepts, user_attempts
from ..services.review_queue import end_of_today

router = APIRouter(tags=["analytics"])

ALLOWED_DAYS = (7, 30, 90)
ACTIVITY_LABELS = {"quiz": "Quizzes", "flashcards": "Flashcards", "reading": "Reading", "manual": "Other study"}
UNASSIGNED = "Not linked to a course"


def check_days(days: int) -> int:
    if days not in ALLOWED_DAYS:
        raise HTTPException(422, "days must be one of 7, 30 or 90")
    return days


def visible(course: Course, access: Access) -> bool:
    """Drafts are only visible to instructors and to their owner (same rule as the course catalogue)."""
    return course.status != "draft" or access.can("instructor") or course.owner_id == access.user.id


def brief(course: Course) -> dict:
    return {"id": course.id, "title": course.title, "color": course.color}


def workspace_courses(db: Session, access: Access) -> list[Course]:
    courses = db.scalars(select(Course).where(Course.workspace_id == access.workspace.id).order_by(Course.id))
    return [c for c in courses if visible(c, access)]


def scope_courses(db: Session, access: Access, course_id: int | None) -> list[Course]:
    """One course when filtered (404 outside this workspace), else every course the learner is engaged with."""
    if course_id is not None:
        course = db.get(Course, course_id)
        if course is None or course.workspace_id != access.workspace.id or not visible(course, access):
            raise HTTPException(404, "Course not found")
        return [course]
    user_id = access.user.id
    engaged = set(db.scalars(select(Enrollment.course_id).where(Enrollment.user_id == user_id)))
    engaged |= set(db.scalars(select(Attempt.course_id).where(Attempt.user_id == user_id).distinct()))
    engaged |= set(db.scalars(select(ReviewLog.course_id).where(ReviewLog.user_id == user_id).distinct()))
    return [c for c in workspace_courses(db, access) if c.id in engaged and c.status != "archived"]


def reviews_since(db: Session, user_id: int, course_ids: Sequence[int], since: datetime) -> list[ReviewLog]:
    if not course_ids:
        return []
    query = select(ReviewLog).where(
        ReviewLog.user_id == user_id, ReviewLog.course_id.in_(course_ids), ReviewLog.reviewed_at >= since
    )
    return list(db.scalars(query))


def study_logs_since(
    db: Session, user_id: int, course_ids: Sequence[int], since: datetime, include_unassigned: bool
) -> list[StudyLog]:
    """Study time for these courses; logs without a course count too unless the view is filtered to one course."""
    in_scope = StudyLog.course_id.in_(course_ids) if course_ids else None
    if include_unassigned:
        in_scope = StudyLog.course_id.is_(None) if in_scope is None else or_(in_scope, StudyLog.course_id.is_(None))
    if in_scope is None:
        return []
    return list(db.scalars(select(StudyLog).where(StudyLog.user_id == user_id, StudyLog.logged_at >= since, in_scope)))


def card_due_dates(db: Session, user_id: int, course_ids: Sequence[int]) -> list[datetime]:
    if not course_ids:
        return []
    query = (
        select(CardState.due_at)
        .join(Flashcard, CardState.card_id == Flashcard.id)
        .join(Deck, Flashcard.deck_id == Deck.id)
        .where(CardState.user_id == user_id, Deck.course_id.in_(course_ids))
    )
    return list(db.scalars(query))


def concept_rows(
    courses: Sequence[Course],
    concepts: dict[int, list[LearnerConcept]],
    attempts: Sequence[Attempt],
    period: stats.Period,
) -> list[dict]:
    per_concept = stats.concept_stats(attempts, period)
    rows = []
    for course in courses:
        views = concepts[course.id]
        unlocked = unlocked_ids(views)
        for concept in views:
            entry = per_concept.get(concept.id, stats.ConceptStats())
            rows.append(
                {
                    "id": concept.id,
                    "name": concept.name,
                    "course": brief(course),
                    "attempts": entry.attempts,
                    "correct": entry.correct,
                    "accuracy": entry.accuracy,
                    "mastery": round(concept.mastery, 1),
                    "level": mastery_level(concept.mastery),
                    "unlocked": concept.id in unlocked,
                    "last_practiced": entry.last_practiced,
                }
            )
    return rows


