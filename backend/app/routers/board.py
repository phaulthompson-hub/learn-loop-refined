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


def record_completed(db: Session, task: Task, ctx: BoardContext, actor: User) -> None:
    record(
        db,
        workspace_id=task.workspace_id,
        actor_id=actor.id,
        verb="task.completed",
        object_type="task",
        object_id=task.id,
        summary=f"completed {ctx.key(task)} {task.title}",
        link=task_link(task),
    )


def announce_assignment(db: Session, task: Task, ctx: BoardContext, actor: User, assignee: User) -> None:
    """Record the assignment in the feed and tell the new assignee (unless they assigned themselves)."""
    key = ctx.key(task)
    record(
        db,
        workspace_id=task.workspace_id,
        actor_id=actor.id,
        verb="task.assigned",
        object_type="task",
        object_id=task.id,
        summary=f"assigned {key} to {assignee.name}",
        link=task_link(task),
    )
    notify(
        db,
        user_id=assignee.id,
        kind="task_assigned",
        title=f"{actor.name} assigned you {key}: {task.title}",
        body=excerpt(task.description),
        link=task_link(task),
        workspace_id=task.workspace_id,
        actor_id=actor.id,
    )


def member_names(ctx: BoardContext) -> list[tuple[int, str]]:
    return [(uid, ctx.people[uid].name) for uid in sorted(ctx.member_ids) if uid in ctx.people]


def notify_comment(
    db: Session, task: Task, ctx: BoardContext, actor: User, body: str, already_mentioned: set[int] | None = None
) -> None:
    """Mentioned members hear about the mention; the assignee and reporter hear about the comment.

    Nobody is notified twice for one comment and the author never notifies themselves. For an edit
    (`already_mentioned` given) only people mentioned for the first time are told.
    """
    key = ctx.key(task)
    previous = already_mentioned or set()
    mentioned = [uid for uid in mentioned_ids(body, member_names(ctx)) if uid not in previous]
    for user_id in mentioned:
        notify(
            db,
            user_id=user_id,
            kind="comment",
            title=f"{actor.name} mentioned you on {key}",
            body=excerpt(body),
            link=task_link(task),
            workspace_id=task.workspace_id,
            actor_id=actor.id,
        )
    if already_mentioned is not None:
        return
    followers = dict.fromkeys(uid for uid in (task.assignee_id, task.reporter_id) if uid is not None)
    for user_id in followers:
        if user_id in mentioned or user_id not in ctx.member_ids:
            continue
        notify(
            db,
            user_id=user_id,
            kind="comment",
            title=f"{actor.name} commented on {key}: {task.title}",
            body=excerpt(body),
            link=task_link(task),
            workspace_id=task.workspace_id,
            actor_id=actor.id,
        )


def parse_statuses(value: str | None) -> list[str]:
    statuses = [s.strip() for s in value.split(",") if s.strip()] if value else []
    invalid = sorted(set(statuses) - set(TASK_STATUSES))
    if invalid:
        raise HTTPException(422, f"Unknown status: {', '.join(invalid)}. Use {', '.join(TASK_STATUSES)}")
    return statuses


# ---------- Board and task list ----------


@router.get("/api/workspaces/{workspace_id}/board", response_model=BoardOut)
def get_board(access: Access = Depends(workspace_access), db: Session = Depends(get_db)):
    members = db.scalars(select(Membership).where(Membership.workspace_id == access.workspace.id)).all()
    return board_payload(db, context_for(db, access), members)


@router.get("/api/workspaces/{workspace_id}/tasks", response_model=TaskPage)
def list_tasks(
    access: Access = Depends(workspace_access),
    db: Session = Depends(get_db),
    status: str | None = Query(None, max_length=80, description="One status or a comma-separated list"),
    assignee_id: str | None = Query(None, regex=r"^(me|\d+)$"),
    unassigned: bool = False,
    label_id: int | None = None,
    course_id: int | None = None,
    priority: str | None = Query(None, regex="^(low|medium|high|urgent)$"),
    q: str | None = Query(None, max_length=100),
    due: str | None = Query(None, regex="^(overdue|today|week|none)$"),
    sort: str | None = Query(None, max_length=30),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
):
    field, descending = parse_sort(sort, tuple(SORT_KEYS), "status")
    filters = TaskFilters(
        statuses=parse_statuses(status),
        assignee_id=access.user.id if assignee_id == "me" else (int(assignee_id) if assignee_id else None),
        unassigned=unassigned,
        label_id=label_id,
        course_id=course_id,
        priority=priority,
        q=q,
        due=due,
    )
    ctx = context_for(db, access)
    tasks = board_order(db.scalars(select(Task).where(Task.workspace_id == access.workspace.id)).all())
    found = [t for t in tasks if task_matches(t, filters, ctx.key(t), ctx.today)]
    result = paginate(sort_items(found, SORT_KEYS[field], descending), page, page_size)
    return {**result, "items": [task_summary(t, ctx) for t in result["items"]]}


# ---------- One task ----------


@router.post("/api/workspaces/{workspace_id}/tasks", response_model=TaskDetail, status_code=201)
def create_task(data: TaskCreate, access: Access = Depends(workspace_access), db: Session = Depends(get_db)):
    workspace_id = access.workspace.id
    assignee = check_assignee(db, workspace_id, data.assignee_id)
    check_course(db, workspace_id, data.course_id)
    labels = workspace_label_set(db, workspace_id, data.label_ids)
    now = clock.now()
    task = Task(
        workspace_id=workspace_id,
        number=next_number(db, workspace_id),
        title=data.title,
        description=data.description,
        status=data.status,
        priority=data.priority,
        assignee_id=data.assignee_id,
        reporter_id=access.user.id,
        course_id=data.course_id,
        due_date=data.due_date,
        estimate=data.estimate,
        position=append_position([t.position for t in column_tasks(db, workspace_id, data.status)]),
        labels=labels,
        checklist=[ChecklistItem(text=text, position=i) for i, text in enumerate(data.checklist)],
        created_at=now,
        updated_at=now,
        completed_at=now if data.status == "done" else None,
    )
    db.add(task)
    db.flush()
    ctx = context_for(db, access)
    record(
        db,
        workspace_id=workspace_id,
        actor_id=access.user.id,
        verb="task.created",
        object_type="task",
        object_id=task.id,
        summary=f"created {ctx.key(task)} {task.title}",
        link=task_link(task),
    )
    if assignee is not None and assignee.id != access.user.id:
        announce_assignment(db, task, ctx, access.user, assignee)
    db.commit()
    return detail_response(db, task, access)


@router.get("/api/tasks/{task_id}", response_model=TaskDetail)
def get_task(task_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    task, access = task_access(db, user, task_id)
    return task_detail(task, context_for(db, access), user.id, access.can("admin"))


@router.get("/api/workspaces/{workspace_id}/tasks/by-number/{number}", response_model=TaskDetail)
def get_task_by_number(number: int, access: Access = Depends(workspace_access), db: Session = Depends(get_db)):
    task = db.scalars(select(Task).where(Task.workspace_id == access.workspace.id, Task.number == number)).first()
    if task is None:
        raise HTTPException(404, "Task not found")
    return task_detail(task, context_for(db, access), access.user.id, access.can("admin"))


@router.patch("/api/tasks/{task_id}", response_model=TaskDetail)
def update_task(task_id: int, data: TaskUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    task, access = task_access(db, user, task_id)
    changes = data.dict(exclude_unset=True)
    new_assignee = None
    if "assignee_id" in changes:
        new_assignee = check_assignee(db, task.workspace_id, changes["assignee_id"])
    if "course_id" in changes:
        check_course(db, task.workspace_id, changes["course_id"])
    if changes.get("label_ids") is not None:
        task.labels = workspace_label_set(db, task.workspace_id, changes["label_ids"])

    for key in ("title", "description", "priority"):
        if changes.get(key) is not None:
            setattr(task, key, changes[key])
    for key in ("course_id", "due_date", "estimate"):
        if key in changes:
            setattr(task, key, changes[key])

    completed = False
    if changes.get("status") is not None and changes["status"] != task.status:
        # A status change through the form lands at the bottom of the new column.
        task.position = append_position([t.position for t in column_tasks(db, task.workspace_id, changes["status"])])
        completed = apply_status(task, changes["status"])

    assigned = "assignee_id" in changes and changes["assignee_id"] != task.assignee_id
    if assigned:
        task.assignee_id = changes["assignee_id"]
    touch(task)

    ctx = context_for(db, access)
    if completed:
        record_completed(db, task, ctx, user)
    if assigned and new_assignee is not None:
        announce_assignment(db, task, ctx, user, new_assignee)
    db.commit()
    return detail_response(db, task, access)


@router.post("/api/tasks/{task_id}/move", response_model=MoveOut)
def move_task(task_id: int, data: TaskMove, user: User = Depends(current_user), db: Session = Depends(get_db)):
    task, access = task_access(db, user, task_id)
    column = column_tasks(db, task.workspace_id, data.status, exclude_id=task.id)
    try:
        index = resolve_index(
            [t.id for t in column], before_id=data.before_id, after_id=data.after_id, index=data.index
        )
    except UnknownNeighbour as exc:
        raise HTTPException(422, f"Task {exc.args[0]} is not in the {data.status} column") from exc

    plan = plan_move([t.position for t in column], index)
    ordered = [*column[: plan.index], task, *column[plan.index :]]
    if plan.rebalanced is not None:
        for item, position in zip(ordered, plan.rebalanced, strict=True):
            item.position = position
    else:
        task.position = plan.position
    completed = apply_status(task, data.status)
    touch(task)
    ctx = context_for(db, access)
    if completed:
        record_completed(db, task, ctx, user)
    db.commit()
    db.refresh(task)
    return {
        "task": task_summary(task, ctx),
        "column": [{"id": item.id, "position": item.position} for item in ordered],
        "rebalanced": plan.rebalanced is not None,
    }


