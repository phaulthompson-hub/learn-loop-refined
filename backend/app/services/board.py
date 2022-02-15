"""Study-board rules: task keys, due states, filters, mentions and response payloads.

The functions at the top are pure (no database) and unit-tested directly; the ones below
them turn ORM rows into the dictionaries the board API returns.
"""

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import clock
from ..models import TASK_PRIORITIES, TASK_STATUSES, Course, Label, Membership, Task, TaskComment, User, task_labels
from .listing import matches

COLUMN_TITLES = {
    "backlog": "Backlog",
    "todo": "To do",
    "in_progress": "In progress",
    "review": "Review",
    "done": "Done",
}
# Work-in-progress limits: columns that should stay short so work actually finishes.
WIP_LIMITS = {"in_progress": 6, "review": 4}
STATUS_RANK = {status: rank for rank, status in enumerate(TASK_STATUSES)}
PRIORITY_RANK = {priority: rank for rank, priority in enumerate(TASK_PRIORITIES)}
# Due within this many days (and not overdue/today) counts as "soon".
SOON_DAYS = 3
STOP_WORDS = {"and", "of", "the", "for", "a", "an", "to", "in", "on"}


# ---------- Pure rules ----------


def workspace_prefix(name: str) -> str:
    """Short, stable prefix for task keys: initials of the name's words ("Northwind Data Academy" -> "NDA").

    Numbers and small words are skipped; a single-word name uses its first two letters ("Physics" -> "PH").
    """
    words = [w for w in re.findall(r"[A-Za-z]+", name) if w.lower() not in STOP_WORDS]
    if not words:
        return "LL"
    if len(words) == 1:
        return words[0][:2].upper()
    return "".join(w[0] for w in words[:3]).upper()


def task_key(prefix: str, number: int) -> str:
    return f"{prefix}-{number}"


def is_overdue(due: date | None, status: str, today: date) -> bool:
    return due is not None and status != "done" and due < today


def due_state(due: date | None, status: str, today: date) -> str:
    """Classify a due date: none | done | overdue | today | soon | later."""
    if due is None:
        return "none"
    if status == "done":
        return "done"
    if due < today:
        return "overdue"
    if due == today:
        return "today"
    if (due - today).days <= SOON_DAYS:
        return "soon"
    return "later"


def matches_due(due: date | None, status: str, wanted: str, today: date) -> bool:
    """The `due=` list filter: overdue, today, week (this Monday-to-Sunday week, still open) or none."""
    if wanted == "none":
        return due is None
    if due is None:
        return False
    if wanted == "overdue":
        return is_overdue(due, status, today)
    if wanted == "today":
        return due == today
    week_start = clock.start_of_week(today)
    return status != "done" and week_start <= due <= week_start + timedelta(days=6)


def mention_pattern(token: str) -> re.Pattern[str]:
    """`@token` not preceded by a word character and not followed by one (so "@Sam" misses "@Samira")."""
    return re.compile(rf"(?<![\w@])@{re.escape(token)}(?!\w)", re.IGNORECASE)


def mentioned_ids(body: str, people: Iterable[tuple[int, str]]) -> list[int]:
    """Ids of people mentioned in `body` as `@Full Name` or `@First`, in order of first mention.

    A first name only counts when it is unique among `people`; otherwise the full name is required.
    """
    people = list(people)
    first_names: dict[str, int] = {}
    for _, name in people:
        first = name.split()[0].lower() if name.split() else ""
        first_names[first] = first_names.get(first, 0) + 1
    found: list[tuple[int, int]] = []
    for person_id, name in people:
        tokens = [name.strip()]
        first = name.split()[0] if name.split() else ""
        if first and first_names[first.lower()] == 1 and first != name.strip():
            tokens.append(first)
        hits = [m.start() for token in tokens for m in mention_pattern(token).finditer(body)]
        if hits:
            found.append((min(hits), person_id))
    return [person_id for _, person_id in sorted(found)]


def column_points(estimates: Iterable[int | None]) -> int:
    return sum(e or 0 for e in estimates)


def over_wip_limit(status: str, count: int) -> bool:
    limit = WIP_LIMITS.get(status)
    return limit is not None and count > limit


@dataclass
class TaskFilters:
    """Filters shared by the task list endpoint (all optional, combined with AND)."""

    statuses: list[str] = field(default_factory=list)
    assignee_id: int | None = None
    unassigned: bool = False
    label_id: int | None = None
    course_id: int | None = None
    priority: str | None = None
    q: str | None = None
    due: str | None = None


def task_matches(task: Task, filters: TaskFilters, key: str, today: date) -> bool:
    label_ids = {label.id for label in task.labels}
    return (
        (not filters.statuses or task.status in filters.statuses)
        and (filters.assignee_id is None or task.assignee_id == filters.assignee_id)
        and (not filters.unassigned or task.assignee_id is None)
        and (filters.label_id is None or filters.label_id in label_ids)
        and (filters.course_id is None or task.course_id == filters.course_id)
        and (filters.priority is None or task.priority == filters.priority)
        and (filters.due is None or matches_due(task.due_date, task.status, filters.due, today))
        and matches(filters.q, key, task.title, task.description, " ".join(label.name for label in task.labels))
    )


SORT_KEYS = {
    "status": lambda t: (STATUS_RANK[t.status], t.position),
    "number": lambda t: t.number,
    "title": lambda t: t.title.lower(),
    "priority": lambda t: PRIORITY_RANK[t.priority],
    "due_date": lambda t: t.due_date,
    "estimate": lambda t: t.estimate,
    "created_at": lambda t: t.created_at,
    "updated_at": lambda t: t.updated_at,
}


def board_order(tasks: Sequence[Task]) -> list[Task]:
    return sorted(tasks, key=lambda t: (STATUS_RANK.get(t.status, 99), t.position, t.id))


# ---------- Database-backed helpers ----------


@dataclass
class BoardContext:
    """Lookups needed to render tasks of one workspace without a query per task."""

    workspace_id: int
    prefix: str
    today: date
    people: dict[int, User]
    courses: dict[int, Course]
    member_ids: set[int]

    def key(self, task: Task) -> str:
        return task_key(self.prefix, task.number)


def board_context(db: Session, workspace_id: int, workspace_name: str) -> BoardContext:
    memberships = db.scalars(select(Membership).where(Membership.workspace_id == workspace_id)).all()
    member_ids = {m.user_id for m in memberships}
    # Former members can still be a reporter, assignee or comment author, so load everyone referenced too.
    task_people = db.execute(select(Task.assignee_id, Task.reporter_id).where(Task.workspace_id == workspace_id)).all()
    authors = db.scalars(
        select(TaskComment.author_id)
        .join(Task, Task.id == TaskComment.task_id)
        .where(Task.workspace_id == workspace_id)
    ).all()
    people_ids = member_ids | set(authors) | {pid for row in task_people for pid in row if pid is not None}
    people = {u.id: u for u in db.scalars(select(User).where(User.id.in_(people_ids)))} if people_ids else {}
    courses = {c.id: c for c in db.scalars(select(Course).where(Course.workspace_id == workspace_id))}
    return BoardContext(
        workspace_id=workspace_id,
        prefix=workspace_prefix(workspace_name),
        today=clock.today(),
        people=people,
        courses=courses,
        member_ids=member_ids,
    )


def person(user: User | None) -> dict | None:
    if user is None:
        return None
    return {"id": user.id, "name": user.name, "email": user.email, "avatar_color": user.avatar_color}


def label_payload(label: Label, task_count: int = 0) -> dict:
    return {
        "id": label.id,
        "workspace_id": label.workspace_id,
        "name": label.name,
        "color": label.color,
        "task_count": task_count,
    }


def label_usage(db: Session, workspace_id: int) -> dict[int, int]:
    rows = db.execute(
        select(task_labels.c.label_id, func.count())
        .join(Task, Task.id == task_labels.c.task_id)
        .where(Task.workspace_id == workspace_id)
        .group_by(task_labels.c.label_id)
    ).all()
    return dict(rows)


def workspace_labels(db: Session, workspace_id: int) -> list[dict]:
    usage = label_usage(db, workspace_id)
    labels = db.scalars(select(Label).where(Label.workspace_id == workspace_id).order_by(func.lower(Label.name)))
    return [label_payload(label, usage.get(label.id, 0)) for label in labels]


def task_summary(task: Task, ctx: BoardContext) -> dict:
    course = ctx.courses.get(task.course_id) if task.course_id else None
    return {
        "id": task.id,
        "workspace_id": task.workspace_id,
        "number": task.number,
        "key": ctx.key(task),
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "priority": task.priority,
        "assignee": person(ctx.people.get(task.assignee_id)) if task.assignee_id else None,
        "reporter": person(ctx.people.get(task.reporter_id)),
        "course": {"id": course.id, "title": course.title, "color": course.color} if course else None,
        "due_date": task.due_date,
        "estimate": task.estimate,
        "position": task.position,
        "labels": [label_payload(label) for label in task.labels],
        "checklist_done": sum(1 for item in task.checklist if item.done),
        "checklist_total": len(task.checklist),
        "comment_count": len(task.comments),
        "overdue": is_overdue(task.due_date, task.status, ctx.today),
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "completed_at": task.completed_at,
    }


