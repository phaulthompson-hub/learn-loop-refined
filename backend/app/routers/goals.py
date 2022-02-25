"""Learning goals, study-time logging and streaks.

Goals and study logs are personal: every route works on the signed-in user's own rows, and
someone else's goal or log id answers 404. Progress is always computed from real activity
(answers, reviews, logged minutes, mastery) by `services.progress`.
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import clock
from ..database import get_db
from ..deps import Access, access_for, current_user, get_or_404, workspace_access
from ..models import Course, Goal, StudyLog, User
from ..schemas.goals import (
    LOG_HISTORY_DAYS,
    MAX_ACTIVE_GOALS,
    MINUTES_PER_DAY,
    GoalIn,
    GoalList,
    GoalOut,
    GoalPatch,
    StreakOut,
    StudyLogIn,
    StudyLogOut,
    StudyLogPage,
    StudyLogPatch,
    StudySummaryOut,
)
from ..services.listing import paginate
from ..services.progress import activity_heatmap, goal_progress, streak_summary, study_log_scope, study_summary
from .planner import validation_detail

router = APIRouter(tags=["goals"])

STATUSES = ("on_track", "at_risk", "done", "overdue")


# ---------- Goal helpers ----------


def course_ref(course: Course | None) -> dict | None:
    return {"id": course.id, "title": course.title, "color": course.color} if course else None


def goal_payload(db: Session, goal: Goal) -> dict:
    return {
        "id": goal.id,
        "workspace_id": goal.workspace_id,
        "title": goal.title,
        "kind": goal.kind,
        "period": goal.period,
        "target": goal.target,
        "course": course_ref(db.get(Course, goal.course_id) if goal.course_id else None),
        "due_date": goal.due_date,
        "archived": goal.archived,
        "created_at": goal.created_at,
        "progress": goal_progress(db, goal),
    }


def workspace_course(db: Session, course_id: int | None, workspace_id: int) -> Course | None:
    if course_id is None:
        return None
    course = db.get(Course, course_id)
    if course is None or course.workspace_id != workspace_id:
        raise HTTPException(422, "Choose a course from this workspace")
    return course


def check_due_date(data: GoalIn, previous: Goal | None = None) -> None:
    """New or moved due dates must not be in the past (an untouched past date may stay, e.g. when renaming)."""
    if data.due_date is None or (previous is not None and previous.due_date == data.due_date):
        return
    if data.due_date < clock.today():
        raise HTTPException(422, "The due date cannot be in the past")


def active_goal_count(db: Session, user_id: int, workspace_id: int) -> int:
    query = select(func.count()).select_from(Goal)
    query = query.where(Goal.user_id == user_id, Goal.workspace_id == workspace_id, Goal.archived.is_(False))
    return db.scalar(query) or 0


def ensure_goal_room(db: Session, user_id: int, workspace_id: int) -> None:
    if active_goal_count(db, user_id, workspace_id) >= MAX_ACTIVE_GOALS:
        raise HTTPException(409, f"You can have at most {MAX_ACTIVE_GOALS} active goals; archive one first")


def own_goal(db: Session, user: User, goal_id: int) -> Goal:
    goal = get_or_404(db, Goal, goal_id, "Goal")
    if goal.user_id != user.id:
        raise HTTPException(404, "Goal not found")
    access_for(db, user, goal.workspace_id)
    return goal


# ---------- Goals ----------


@router.get("/api/workspaces/{workspace_id}/goals", response_model=GoalList)
def list_goals(
    access: Access = Depends(workspace_access),
    db: Session = Depends(get_db),
    state: str = Query("active", regex="^(active|archived|all)$"),
    status: str | None = Query(None, regex="^(on_track|at_risk|done|overdue)$"),
):
    query = select(Goal).where(Goal.workspace_id == access.workspace.id, Goal.user_id == access.user.id)
    if state != "all":
        query = query.where(Goal.archived.is_(state == "archived"))
    goals = [goal_payload(db, goal) for goal in db.scalars(query.order_by(Goal.created_at, Goal.id))]
    counts = {key: sum(1 for g in goals if g["progress"]["status"] == key) for key in STATUSES}
    items = [g for g in goals if status is None or g["progress"]["status"] == status]
    return {"items": items, "total": len(items), "counts": counts}


