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


def course_rows(
    courses: Sequence[Course],
    concepts: dict[int, list[LearnerConcept]],
    attempts: Sequence[Attempt],
    reviews: Sequence[ReviewLog],
    logs: Sequence[StudyLog],
    period: stats.Period,
) -> list[dict]:
    start = stats.mastery_snapshot((c.id for views in concepts.values() for c in views), attempts, period.start_at)
    rows = []
    for course in courses:
        views = concepts[course.id]
        mine = [a for a in attempts if a.course_id == course.id and period.contains(a.created_at)]
        mastery = average_mastery(views)
        rows.append(
            {
                "id": course.id,
                "title": course.title,
                "color": course.color,
                "concepts": len(views),
                "mastered_concepts": stats.mastered_count(c.mastery for c in views),
                "mastery": mastery,
                "mastery_change": round(mastery - stats.average(start[c.id] for c in views), 1) if views else 0.0,
                "attempts": len(mine),
                "accuracy": stats.accuracy(sum(a.correct for a in mine), len(mine)),
                "reviews": sum(1 for r in reviews if r.course_id == course.id),
                "minutes": sum(log.minutes for log in logs if log.course_id == course.id),
            }
        )
    return rows


def time_breakdown(logs: Sequence[StudyLog], courses: Sequence[Course]) -> dict:
    by_id = {c.id: c for c in courses}
    per_course = stats.minutes_by(logs, lambda log: log.course_id, lambda log: log.minutes)
    per_activity = stats.minutes_by(logs, lambda log: log.activity, lambda log: log.minutes)
    return {
        "total": sum(log.minutes for log in logs),
        "by_course": [
            {
                "key": str(course_id) if course_id is not None else "none",
                "label": by_id[course_id].title if course_id in by_id else UNASSIGNED,
                "minutes": minutes,
                "color": by_id[course_id].color if course_id in by_id else None,
            }
            for course_id, minutes in per_course.items()
        ],
        "by_activity": [
            {"key": activity, "label": ACTIVITY_LABELS.get(activity, activity.title()), "minutes": minutes}
            for activity, minutes in per_activity.items()
        ],
    }


def leaderboard(db: Session, access: Access, course_ids: Sequence[int], period: stats.Period) -> list[dict]:
    """Answers and accuracy per member this period. Learners only see first names; staff see full names."""
    counts = {
        user_id: (answers, correct or 0)
        for user_id, answers, correct in db.execute(
            select(Attempt.user_id, func.count(), func.sum(cast(Attempt.correct, Integer)))
            .where(
                Attempt.course_id.in_(course_ids),
                Attempt.created_at >= period.start_at,
                Attempt.created_at < period.end_at,
            )
            .group_by(Attempt.user_id)
        )
    }
    members = db.scalars(
        select(User)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.workspace_id == access.workspace.id)
    )
    staff = access.can("instructor")
    rows = [
        {
            "user_id": member.id,
            "name": member.name if staff or member.id == access.user.id else stats.first_name(member.name),
            "avatar_color": member.avatar_color,
            "answers": counts.get(member.id, (0, 0))[0],
            "correct": counts.get(member.id, (0, 0))[1],
        }
        for member in members
        if member.id in counts or member.id == access.user.id
    ]
    return stats.rank_leaderboard(rows, access.user.id)


@router.get("/api/workspaces/{workspace_id}/analytics", response_model=AnalyticsOut)
def get_analytics(
    access: Access = Depends(workspace_access),
    db: Session = Depends(get_db),
    days: int = Query(30),
    course_id: int | None = Query(None, ge=1),
):
    check_days(days)
    courses = scope_courses(db, access, course_id)
    user_id = access.user.id
    period = stats.period_ending(clock.today(), days)
    previous = period.previous()
    course_ids = [c.id for c in courses]

    attempts = user_attempts(db, user_id, course_ids)
    reviews = reviews_since(db, user_id, course_ids, previous.start_at)
    logs = study_logs_since(db, user_id, course_ids, previous.start_at, include_unassigned=course_id is None)
    concepts = {c.id: learner_concepts(db, c, user_id) for c in courses}
    concept_ids = [c.id for views in concepts.values() for c in views]

    def split(rows, moment):
        return stats.in_period(rows, period, moment), stats.in_period(rows, previous, moment)

    now_attempts, before_attempts = split(attempts, lambda a: a.created_at)
    now_reviews, before_reviews = split(reviews, lambda r: r.reviewed_at)
    now_logs, before_logs = split(logs, lambda log: log.logged_at)
    start = stats.mastery_snapshot(concept_ids, attempts, period.start_at)
    end = stats.mastery_snapshot(concept_ids, attempts, period.end_at)
    timeline = stats.mastery_timeline(concept_ids, attempts, period.dates())
    now_retention = stats.retention(r.grade for r in now_reviews)
    before_retention = stats.retention(r.grade for r in before_reviews)

    def correct(rows):
        return sum(a.correct for a in rows)

    kpis = {
        "answers": stats.compare(len(now_attempts), len(before_attempts)),
        "accuracy": stats.compare(
            stats.accuracy(correct(now_attempts), len(now_attempts)),
            stats.accuracy(correct(before_attempts), len(before_attempts)),
        ),
        "reviews": stats.compare(len(now_reviews), len(before_reviews)),
        "retention": stats.compare(now_retention or 0.0, before_retention or 0.0),
        "minutes": stats.compare(sum(x.minutes for x in now_logs), sum(x.minutes for x in before_logs)),
        "mastery": stats.compare(stats.average(end.values()), stats.average(start.values())),
        "mastered_concepts": stats.compare(stats.mastered_count(end.values()), stats.mastered_count(start.values())),
        "active_days": stats.compare(
            stats.active_days(period, now_attempts, now_reviews, now_logs),
            stats.active_days(previous, before_attempts, before_reviews, before_logs),
        ),
    }
    daily = stats.daily_series(period.dates(), now_attempts, now_reviews, now_logs)
    for row, mastery in zip(daily, timeline, strict=True):
        row["mastery"] = mastery

    rows = concept_rows(courses, concepts, attempts, period)
    grades = [r.grade for r in now_reviews]
    due_dates = card_due_dates(db, user_id, course_ids)
    board_courses = course_ids if course_id is not None else [c.id for c in workspace_courses(db, access)]
    return {
        "range": {
            "days": days,
            "start": period.start,
            "end": period.end,
            "previous_start": previous.start,
            "previous_end": previous.end,
            "course_id": course_id,
        },
        "courses_in_scope": [brief(c) for c in courses],
        "kpis": kpis,
        "daily": daily,
        "courses": course_rows(courses, concepts, attempts, now_reviews, now_logs, period),
        "concepts": rows,
        "weakest": stats.weakest(rows),
        "flashcards": {
            "reviews": len(grades),
            "retention": now_retention,
            "grades": stats.grade_counts(grades),
            "due_now": sum(1 for due in due_dates if due < end_of_today()),
            "forecast": stats.forecast(due_dates, period.end),
        },
        "time": time_breakdown(now_logs, courses),
        "leaderboard": leaderboard(db, access, board_courses, period),
        "can_view_learners": access.can("instructor"),
    }


@router.get("/api/workspaces/{workspace_id}/analytics/learners", response_model=LearnersOut)
def get_learners(access: Access = Depends(workspace_access), db: Session = Depends(get_db), days: int = Query(30)):
    """Instructor view: every member's mastery in every course, plus recent answering activity."""
    access.require("instructor")
    check_days(days)
    period = stats.period_ending(clock.today(), days)
    courses = [c for c in workspace_courses(db, access) if c.status != "archived"]
    course_ids = [c.id for c in courses]
    concepts_by_course: dict[int, list[int]] = {c.id: [] for c in courses}
    for concept_id, concept_course in db.execute(
        select(Concept.id, Concept.course_id).where(Concept.course_id.in_(course_ids))
    ):
        concepts_by_course[concept_course].append(concept_id)
    all_concepts = [cid for ids in concepts_by_course.values() for cid in ids]
    progress: dict[tuple[int, int], float] = {
        (user_id, concept_id): mastery
        for user_id, concept_id, mastery in db.execute(
            select(ConceptProgress.user_id, ConceptProgress.concept_id, ConceptProgress.mastery).where(
                ConceptProgress.concept_id.in_(all_concepts)
            )
        )
    }
    enrolled = set(
        db.execute(select(Enrollment.user_id, Enrollment.course_id).where(Enrollment.course_id.in_(course_ids))).all()
    )
    answered: dict[int, tuple[int, int]] = {
        user_id: (answers, correct or 0)
        for user_id, answers, correct in db.execute(
            select(Attempt.user_id, func.count(), func.sum(cast(Attempt.correct, Integer)))
            .where(Attempt.course_id.in_(course_ids), Attempt.created_at >= period.start_at)
            .group_by(Attempt.user_id)
        )
    }
    last_active: dict[int, datetime] = dict(
        db.execute(
            select(Attempt.user_id, func.max(Attempt.created_at))
            .where(Attempt.course_id.in_(course_ids))
            .group_by(Attempt.user_id)
        ).all()
    )

    members = db.scalars(select(Membership).where(Membership.workspace_id == access.workspace.id))
    learners = []
    for membership in members:
        user = membership.user
        cells = []
        for course in courses:
            ids = concepts_by_course[course.id]
            touched = any((user.id, cid) in progress for cid in ids)
            is_enrolled = (user.id, course.id) in enrolled
            values = [progress.get((user.id, cid), INITIAL_MASTERY) for cid in ids]
            cells.append(
                {
                    "course_id": course.id,
                    "enrolled": is_enrolled,
                    "mastery": stats.average(values) if ids and (is_enrolled or touched) else None,
                    "mastered_concepts": stats.mastered_count(values),
                }
            )
        known = [cell["mastery"] for cell in cells if cell["mastery"] is not None]
        answers, correct = answered.get(user.id, (0, 0))
        learners.append(
            {
                "user_id": user.id,
                "name": user.name,
                "avatar_color": user.avatar_color,
                "role": membership.role,
                "answers": answers,
                "accuracy": stats.accuracy(correct, answers),
                "last_active": last_active.get(user.id),
                "average_mastery": stats.average(known) if known else None,
                "cells": cells,
            }
        )
    learners.sort(key=lambda row: (row["average_mastery"] is None, -(row["average_mastery"] or 0), row["name"]))
    return {"days": days, "courses": [brief(c) for c in courses], "learners": learners}
