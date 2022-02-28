"""Study board: kanban tasks, labels, checklists and comments."""

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import clock
from ..database import get_db
from ..deps import Access, access_for, current_user, get_or_404, membership_for, workspace_access
from ..models import TASK_STATUSES, ChecklistItem, Course, Label, Membership, Task, TaskComment, User, task_labels
from ..schemas.board import (
    BoardOut,
    ChecklistCreate,
    ChecklistItemOut,
    ChecklistOrder,
    ChecklistUpdate,
    CommentIn,
    CommentOut,
    LabelCreate,
    LabelOut,
    LabelUpdate,
    MoveOut,
    TaskCreate,
    TaskDetail,
    TaskMove,
    TaskPage,
    TaskUpdate,
)
from ..services.board import (
    SORT_KEYS,
    BoardContext,
    TaskFilters,
    board_context,
    board_order,
    board_payload,
    can_delete_task,
    column_tasks,
    comment_payload,
    label_payload,
    label_usage,
    mentioned_ids,
    next_number,
    task_detail,
    task_matches,
    task_summary,
    workspace_labels,
)
from ..services.events import notify, record
from ..services.listing import paginate, parse_sort, sort_items
from ..services.ordering import UnknownNeighbour, append_position, plan_move, resolve_index

router = APIRouter(tags=["board"])

EXCERPT_CHARS = 140


# ---------- Access and validation helpers ----------


def context_for(db: Session, access: Access) -> BoardContext:
    return board_context(db, access.workspace.id, access.workspace.name)


def task_access(db: Session, user: User, task_id: int) -> tuple[Task, Access]:
    task = get_or_404(db, Task, task_id, "Task")
    return task, access_for(db, user, task.workspace_id)


def detail_response(db: Session, task: Task, access: Access) -> dict:
    db.refresh(task)
    return task_detail(task, context_for(db, access), access.user.id, access.can("admin"))


def check_assignee(db: Session, workspace_id: int, user_id: int | None) -> User | None:
    if user_id is None:
        return None
    membership = membership_for(db, user_id, workspace_id)
    if membership is None:
        raise HTTPException(422, "The assignee must be a member of this workspace")
    return membership.user


def check_course(db: Session, workspace_id: int, course_id: int | None) -> None:
    if course_id is None:
        return
    course = db.get(Course, course_id)
    if course is None or course.workspace_id != workspace_id:
        raise HTTPException(422, "The course must belong to this workspace")


def workspace_label_set(db: Session, workspace_id: int, label_ids: list[int]) -> list[Label]:
    if not label_ids:
        return []
    labels = db.scalars(select(Label).where(Label.id.in_(label_ids), Label.workspace_id == workspace_id)).all()
    if len(labels) != len(label_ids):
        raise HTTPException(422, "Labels must belong to this workspace")
    return list(labels)


def apply_status(task: Task, status: str) -> bool:
    """Set the status and keep `completed_at` in step. Returns True when the task has just been completed."""
    completed = status == "done" and task.status != "done"
    task.status = status
    if status != "done":
        task.completed_at = None
    elif completed:
        task.completed_at = clock.now()
    return completed


def task_link(task: Task) -> str:
    return f"/board?task={task.number}"


def excerpt(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= EXCERPT_CHARS else text[: EXCERPT_CHARS - 1].rstrip() + "…"


def touch(task: Task) -> None:
    task.updated_at = clock.now()


