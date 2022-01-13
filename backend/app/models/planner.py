"""Calendar events, learning goals and logged study time."""

from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, Text

from ..database import Base
from .base import utcnow

EVENT_KINDS = ("study", "review", "exam", "deadline", "live")
RECURRENCES = ("none", "daily", "weekdays", "weekly")
GOAL_KINDS = ("daily_answers", "weekly_reviews", "study_minutes", "course_mastery")
GOAL_PERIODS = ("day", "week", "once")


class Event(Base):
    __tablename__ = "events"
    id = Column(Integer, primary_key=True)
    workspace_id = Column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id = Column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    course_id = Column(ForeignKey("courses.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(160), nullable=False)
    kind = Column(String(16), default="study", nullable=False)
    starts_at = Column(DateTime, index=True, nullable=False)
    ends_at = Column(DateTime, nullable=False)
    all_day = Column(Boolean, default=False, nullable=False)
    location = Column(String(160), default="", nullable=False)
    notes = Column(Text, default="", nullable=False)
    recurrence = Column(String(12), default="none", nullable=False)
    recurrence_until = Column(Date, nullable=True)
    shared = Column(Boolean, default=False, nullable=False)  # visible to the whole workspace
    created_at = Column(DateTime, default=utcnow, nullable=False)


class Goal(Base):
    __tablename__ = "goals"
    id = Column(Integer, primary_key=True)
    workspace_id = Column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id = Column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    course_id = Column(ForeignKey("courses.id", ondelete="CASCADE"), nullable=True)
    title = Column(String(120), nullable=False)
    kind = Column(String(20), nullable=False)
    period = Column(String(8), default="week", nullable=False)
    target = Column(Float, nullable=False)
    due_date = Column(Date, nullable=True)
    archived = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class StudyLog(Base):
    __tablename__ = "study_logs"
    id = Column(Integer, primary_key=True)
    user_id = Column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    course_id = Column(ForeignKey("courses.id", ondelete="SET NULL"), nullable=True)
    minutes = Column(Integer, nullable=False)
    activity = Column(String(16), default="manual", nullable=False)  # quiz | flashcards | reading | manual
    note = Column(String(255), default="", nullable=False)
    logged_at = Column(DateTime, default=utcnow, index=True, nullable=False)
