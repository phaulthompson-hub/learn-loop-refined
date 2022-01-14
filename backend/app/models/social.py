"""Notifications for one user and the workspace-wide activity feed."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from ..database import Base
from .base import utcnow

NOTIFICATION_KINDS = ("review_due", "task_assigned", "comment", "invite", "goal", "mastery", "event", "system")


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True)
    user_id = Column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    workspace_id = Column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True)
    actor_id = Column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    kind = Column(String(20), default="system", nullable=False)
    title = Column(String(160), nullable=False)
    body = Column(Text, default="", nullable=False)
    link = Column(String(255), default="", nullable=False)
    created_at = Column(DateTime, default=utcnow, index=True, nullable=False)
    read_at = Column(DateTime, nullable=True)
    actor = relationship("User", foreign_keys=[actor_id])


class Activity(Base):
    __tablename__ = "activities"
    id = Column(Integer, primary_key=True)
    workspace_id = Column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False)
    actor_id = Column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verb = Column(String(40), nullable=False)  # e.g. course.created, task.moved, quiz.answered
    object_type = Column(String(20), nullable=False)
    object_id = Column(Integer, nullable=True)
    summary = Column(String(255), nullable=False)
    link = Column(String(255), default="", nullable=False)
    detail = Column(Text, default="", nullable=False)
    created_at = Column(DateTime, default=utcnow, index=True, nullable=False)
    actor = relationship("User")
