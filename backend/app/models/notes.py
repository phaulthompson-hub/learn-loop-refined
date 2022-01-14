"""Markdown study notes attached to a course and optionally a concept."""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text

from ..database import Base
from .base import utcnow


class Note(Base):
    __tablename__ = "notes"
    id = Column(Integer, primary_key=True)
    workspace_id = Column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id = Column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    course_id = Column(ForeignKey("courses.id", ondelete="SET NULL"), nullable=True)
    concept_id = Column(ForeignKey("concepts.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(160), nullable=False)
    body = Column(Text, default="", nullable=False)
    tags = Column(String(255), default="", nullable=False)  # comma separated, lower case
    pinned = Column(Boolean, default=False, nullable=False)
    archived = Column(Boolean, default=False, nullable=False)
    shared = Column(Boolean, default=False, nullable=False)  # visible to other workspace members
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, nullable=False)

    @property
    def tag_list(self) -> list[str]:
        return [t for t in (part.strip() for part in self.tags.split(",")) if t]
