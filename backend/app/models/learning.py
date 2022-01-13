"""Courses, their sources and concepts, and each learner's progress through them."""

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from ..database import Base
from ..mastery import INITIAL_MASTERY
from .base import utcnow

COURSE_STATUSES = ("draft", "active", "archived")
DIFFICULTIES = ("intro", "intermediate", "advanced")


class Course(Base):
    __tablename__ = "courses"
    id = Column(Integer, primary_key=True)
    workspace_id = Column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False)
    owner_id = Column(ForeignKey("users.id"), nullable=True)
    title = Column(String(160), nullable=False)
    description = Column(Text, default="", nullable=False)
    subject = Column(String(60), default="General", nullable=False)
    color = Column(String(16), default="#1d6d45", nullable=False)
    status = Column(String(12), default="active", nullable=False)
    difficulty = Column(String(16), default="intro", nullable=False)
    tags = Column(String(255), default="", nullable=False)  # comma separated, lower case
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
    sources = relationship("Source", cascade="all, delete-orphan", order_by="Source.id")
    concepts = relationship("Concept", cascade="all, delete-orphan", order_by="Concept.order_index")
    attempts = relationship("Attempt", cascade="all, delete-orphan", order_by="Attempt.id")
    enrollments = relationship("Enrollment", cascade="all, delete-orphan", order_by="Enrollment.id")

    @property
    def tag_list(self) -> list[str]:
        return [t for t in (part.strip() for part in self.tags.split(",")) if t]


class Source(Base):
    __tablename__ = "sources"
    id = Column(Integer, primary_key=True)
    course_id = Column(ForeignKey("courses.id", ondelete="CASCADE"), index=True, nullable=False)
    name = Column(String(255), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class Concept(Base):
    __tablename__ = "concepts"
    id = Column(Integer, primary_key=True)
    course_id = Column(ForeignKey("courses.id", ondelete="CASCADE"), index=True, nullable=False)
    name = Column(String(120), nullable=False)
    summary = Column(Text, nullable=False)
    order_index = Column(Integer, default=0, nullable=False)
    prerequisite_id = Column(ForeignKey("concepts.id"), nullable=True)


class ConceptProgress(Base):
    """One learner's mastery of one concept. Missing rows mean the learner is at INITIAL_MASTERY."""

    __tablename__ = "concept_progress"
    __table_args__ = (UniqueConstraint("user_id", "concept_id"),)
    id = Column(Integer, primary_key=True)
    user_id = Column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    concept_id = Column(ForeignKey("concepts.id", ondelete="CASCADE"), index=True, nullable=False)
    mastery = Column(Float, default=INITIAL_MASTERY, nullable=False)
    updated_at = Column(DateTime, default=utcnow, nullable=False)


class Attempt(Base):
    """One graded quiz answer, kept so learners can review how their mastery changed."""

    __tablename__ = "attempts"
    id = Column(Integer, primary_key=True)
    user_id = Column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    course_id = Column(ForeignKey("courses.id", ondelete="CASCADE"), index=True, nullable=False)
    concept_id = Column(ForeignKey("concepts.id", ondelete="CASCADE"), nullable=False)
    concept_name = Column(String(120), nullable=False)
    selected = Column(Integer, nullable=False)
    correct = Column(Boolean, nullable=False)
    mastery_before = Column(Float, nullable=False)
    mastery_after = Column(Float, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class Enrollment(Base):
    """A learner following a course; drives "My courses", pinning and last-opened ordering."""

    __tablename__ = "enrollments"
    __table_args__ = (UniqueConstraint("user_id", "course_id"),)
    id = Column(Integer, primary_key=True)
    user_id = Column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    course_id = Column(ForeignKey("courses.id", ondelete="CASCADE"), index=True, nullable=False)
    pinned = Column(Boolean, default=False, nullable=False)
    enrolled_at = Column(DateTime, default=utcnow, nullable=False)
    last_opened_at = Column(DateTime, nullable=True)
