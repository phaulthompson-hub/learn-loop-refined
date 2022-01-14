"""Study board: tasks on a kanban, with labels, checklists and comments."""

from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, Table, Text
from sqlalchemy.orm import relationship

from ..database import Base
from .base import utcnow

TASK_STATUSES = ("backlog", "todo", "in_progress", "review", "done")
TASK_PRIORITIES = ("low", "medium", "high", "urgent")

task_labels = Table(
    "task_labels",
    Base.metadata,
    Column("task_id", ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
    Column("label_id", ForeignKey("labels.id", ondelete="CASCADE"), primary_key=True),
)


class Label(Base):
    __tablename__ = "labels"
    id = Column(Integer, primary_key=True)
    workspace_id = Column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False)
    name = Column(String(40), nullable=False)
    color = Column(String(16), default="#64748b", nullable=False)


class Task(Base):
    __tablename__ = "tasks"
    id = Column(Integer, primary_key=True)
    workspace_id = Column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False)
    course_id = Column(ForeignKey("courses.id", ondelete="SET NULL"), nullable=True)
    number = Column(Integer, nullable=False)  # per-workspace sequence shown as e.g. NDA-12
    title = Column(String(200), nullable=False)
    description = Column(Text, default="", nullable=False)
    status = Column(String(16), default="todo", index=True, nullable=False)
    priority = Column(String(8), default="medium", nullable=False)
    assignee_id = Column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reporter_id = Column(ForeignKey("users.id"), nullable=False)
    due_date = Column(Date, nullable=True)
    estimate = Column(Integer, nullable=True)  # story points
    position = Column(Float, default=0.0, nullable=False)  # order inside its column
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)
    labels = relationship("Label", secondary=task_labels, order_by="Label.name")
    checklist = relationship("ChecklistItem", cascade="all, delete-orphan", order_by="ChecklistItem.position")
    comments = relationship("TaskComment", cascade="all, delete-orphan", order_by="TaskComment.id")


class ChecklistItem(Base):
    __tablename__ = "checklist_items"
    id = Column(Integer, primary_key=True)
    task_id = Column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True, nullable=False)
    text = Column(String(200), nullable=False)
    done = Column(Boolean, default=False, nullable=False)
    position = Column(Integer, default=0, nullable=False)


class TaskComment(Base):
    __tablename__ = "task_comments"
    id = Column(Integer, primary_key=True)
    task_id = Column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True, nullable=False)
    author_id = Column(ForeignKey("users.id"), nullable=False)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    edited_at = Column(DateTime, nullable=True)
