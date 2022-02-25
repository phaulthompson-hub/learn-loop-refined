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


@router.post("/api/workspaces/{workspace_id}/goals", response_model=GoalOut, status_code=201)
def create_goal(data: GoalIn, access: Access = Depends(workspace_access), db: Session = Depends(get_db)):
    workspace_course(db, data.course_id, access.workspace.id)
    check_due_date(data)
    ensure_goal_room(db, access.user.id, access.workspace.id)
    goal = Goal(workspace_id=access.workspace.id, user_id=access.user.id, created_at=clock.now(), **data.dict())
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal_payload(db, goal)


@router.get("/api/goals/{goal_id}", response_model=GoalOut)
def get_goal(goal_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return goal_payload(db, own_goal(db, user, goal_id))


@router.patch("/api/goals/{goal_id}", response_model=GoalOut)
def update_goal(goal_id: int, patch: GoalPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    goal = own_goal(db, user, goal_id)
    changes = patch.dict(exclude_unset=True)
    current = {field: getattr(goal, field) for field in GoalIn.__fields__}
    if "kind" in changes and "period" not in changes:
        current["period"] = None  # switching kind picks that kind's natural period
    try:
        data = GoalIn.parse_obj({**current, **changes})
    except ValidationError as exc:
        raise HTTPException(422, validation_detail(exc)) from exc
    workspace_course(db, data.course_id, goal.workspace_id)
    check_due_date(data, goal)
    for field, value in data.dict().items():
        setattr(goal, field, value)
    db.commit()
    db.refresh(goal)
    return goal_payload(db, goal)


@router.post("/api/goals/{goal_id}/archive", response_model=GoalOut)
def archive_goal(goal_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    goal = own_goal(db, user, goal_id)
    goal.archived = True
    db.commit()
    return goal_payload(db, goal)


@router.post("/api/goals/{goal_id}/restore", response_model=GoalOut)
def restore_goal(goal_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    goal = own_goal(db, user, goal_id)
    if goal.archived:
        ensure_goal_room(db, user.id, goal.workspace_id)
        goal.archived = False
        db.commit()
    return goal_payload(db, goal)


@router.delete("/api/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(own_goal(db, user, goal_id))
    db.commit()
    return Response(status_code=204)


# ---------- Study time ----------


def log_payload(log: StudyLog, courses: dict[int, Course]) -> dict:
    return {
        "id": log.id,
        "minutes": log.minutes,
        "activity": log.activity,
        "note": log.note,
        "course": course_ref(courses.get(log.course_id) if log.course_id else None),
        "logged_at": log.logged_at,
    }


def courses_by_id(db: Session, logs: list[StudyLog]) -> dict[int, Course]:
    ids = {log.course_id for log in logs if log.course_id}
    return {c.id: c for c in db.scalars(select(Course).where(Course.id.in_(ids)))} if ids else {}


def check_log(db: Session, user: User, data: StudyLogIn, exclude_id: int | None = None) -> datetime:
    """Validate timing and the per-day total; returns the effective `logged_at`."""
    now = clock.now()
    moment = data.logged_at or now
    if moment > now:
        raise HTTPException(422, "Study time cannot be logged in the future")
    if moment < now - timedelta(days=LOG_HISTORY_DAYS):
        raise HTTPException(422, f"Study time can only be logged for the last {LOG_HISTORY_DAYS} days")
    day_start = datetime.combine(moment.date(), datetime.min.time())
    query = select(func.coalesce(func.sum(StudyLog.minutes), 0)).where(
        StudyLog.user_id == user.id, StudyLog.logged_at >= day_start, StudyLog.logged_at < day_start + timedelta(days=1)
    )
    if exclude_id is not None:
        query = query.where(StudyLog.id != exclude_id)
    already = int(db.scalar(query) or 0)
    if already + data.minutes > MINUTES_PER_DAY:
        left = max(0, MINUTES_PER_DAY - already)
        raise HTTPException(422, f"That day already has {already} minutes logged; at most {left} more fit")
    return moment


def own_log(db: Session, user: User, log_id: int) -> StudyLog:
    log = get_or_404(db, StudyLog, log_id, "Study log")
    if log.user_id != user.id:
        raise HTTPException(404, "Study log not found")
    return log


@router.get("/api/workspaces/{workspace_id}/study-logs", response_model=StudyLogPage)
def list_study_logs(
    access: Access = Depends(workspace_access),
    db: Session = Depends(get_db),
    course_id: int | None = None,
    activity: str | None = Query(None, regex="^(quiz|flashcards|reading|manual)$"),
    days: int | None = Query(None, ge=1, le=366),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    query = select(StudyLog).where(StudyLog.user_id == access.user.id, study_log_scope(access.workspace.id))
    if course_id is not None:
        query = query.where(StudyLog.course_id == course_id)
    if activity is not None:
        query = query.where(StudyLog.activity == activity)
    if days is not None:
        query = query.where(
            StudyLog.logged_at >= datetime.combine(clock.today(), datetime.min.time()) - timedelta(days=days - 1)
        )
    logs = list(db.scalars(query.order_by(StudyLog.logged_at.desc(), StudyLog.id.desc())))
    result = paginate(logs, page, page_size)
    courses = courses_by_id(db, result["items"])
    result["items"] = [log_payload(log, courses) for log in result["items"]]
    return {**result, "total_minutes": sum(log.minutes for log in logs)}


