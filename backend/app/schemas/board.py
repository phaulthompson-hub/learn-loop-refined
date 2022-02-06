"""Request and response models for the study board (tasks, labels, checklists, comments)."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, conlist, validator

from .auth import MemberBrief
from .common import Color, Text

TaskStatus = Literal["backlog", "todo", "in_progress", "review", "done"]
TaskPriority = Literal["low", "medium", "high", "urgent"]
DueFilter = Literal["overdue", "today", "week", "none"]

MAX_ESTIMATE = 100
MAX_LABELS_PER_TASK = 10
MAX_CHECKLIST_ON_CREATE = 30


def _unique_ids(value: list[int] | None) -> list[int] | None:
    """Label ids in the order given, without duplicates."""
    return None if value is None else list(dict.fromkeys(value))


LabelIds = conlist(int, max_items=MAX_LABELS_PER_TASK)


# ---------- Labels ----------


class LabelCreate(BaseModel):
    name: Text(1, 40)
    color: Color = "#64748b"


class LabelUpdate(BaseModel):
    name: Text(1, 40) | None = None
    color: Color | None = None


class LabelOut(BaseModel):
    id: int
    workspace_id: int
    name: str
    color: str
    task_count: int = 0


# ---------- Tasks ----------


class CourseBrief(BaseModel):
    id: int
    title: str
    color: str


class MemberOut(MemberBrief):
    role: str


class TaskCreate(BaseModel):
    title: Text(2, 200)
    description: Text(0, 5000) = ""
    status: TaskStatus = "todo"
    priority: TaskPriority = "medium"
    assignee_id: int | None = None
    course_id: int | None = None
    due_date: date | None = None
    estimate: int | None = Field(default=None, ge=0, le=MAX_ESTIMATE)
    label_ids: LabelIds = Field(default_factory=list)
    checklist: list[Text(1, 200)] = Field(default_factory=list, max_items=MAX_CHECKLIST_ON_CREATE)

    _unique_label_ids = validator("label_ids", allow_reuse=True)(_unique_ids)


class TaskUpdate(BaseModel):
    """Every field is optional; `null` clears the nullable ones (assignee, course, due date, estimate)."""

    title: Text(2, 200) | None = None
    description: Text(0, 5000) | None = None
    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    assignee_id: int | None = None
    course_id: int | None = None
    due_date: date | None = None
    estimate: int | None = Field(default=None, ge=0, le=MAX_ESTIMATE)
    label_ids: LabelIds | None = None

    _unique_label_ids = validator("label_ids", allow_reuse=True)(_unique_ids)


class TaskMove(BaseModel):
    """Drop a task into `status`.

    `after_id` is the task it should follow (the card above the drop line), `before_id` the task it
    should precede (the card below). Without neighbours `index` is used; with nothing it goes last.
    """

    status: TaskStatus
    before_id: int | None = None
    after_id: int | None = None
    index: int | None = Field(default=None, ge=0)


class TaskOut(BaseModel):
    id: int
    workspace_id: int
    number: int
    key: str
    title: str
    description: str
    status: str
    priority: str
    assignee: MemberBrief | None
    reporter: MemberBrief | None
    course: CourseBrief | None
    due_date: date | None
    estimate: int | None
    position: float
    labels: list[LabelOut]
    checklist_done: int
    checklist_total: int
    comment_count: int
    overdue: bool
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


