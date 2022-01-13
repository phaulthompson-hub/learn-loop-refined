"""Flashcard decks and per-learner spaced-repetition state."""

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from ..database import Base
from .base import utcnow


class Deck(Base):
    __tablename__ = "decks"
    id = Column(Integer, primary_key=True)
    course_id = Column(ForeignKey("courses.id", ondelete="CASCADE"), index=True, nullable=False)
    name = Column(String(120), nullable=False)
    description = Column(Text, default="", nullable=False)
    created_by_id = Column(ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    cards = relationship(
        "Flashcard", back_populates="deck", cascade="all, delete-orphan", order_by="Flashcard.position"
    )


class Flashcard(Base):
    __tablename__ = "flashcards"
    id = Column(Integer, primary_key=True)
    deck_id = Column(ForeignKey("decks.id", ondelete="CASCADE"), index=True, nullable=False)
    concept_id = Column(ForeignKey("concepts.id", ondelete="SET NULL"), nullable=True)
    front = Column(Text, nullable=False)
    back = Column(Text, nullable=False)
    hint = Column(String(255), default="", nullable=False)
    position = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    deck = relationship("Deck", back_populates="cards")


class CardState(Base):
    """SM-2 scheduling state for one learner and one card. Missing rows mean the card is new."""

    __tablename__ = "card_states"
    __table_args__ = (UniqueConstraint("user_id", "card_id"),)
    id = Column(Integer, primary_key=True)
    user_id = Column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    card_id = Column(ForeignKey("flashcards.id", ondelete="CASCADE"), index=True, nullable=False)
    ease = Column(Float, default=2.5, nullable=False)
    interval_days = Column(Integer, default=0, nullable=False)
    repetitions = Column(Integer, default=0, nullable=False)
    lapses = Column(Integer, default=0, nullable=False)
    due_at = Column(DateTime, default=utcnow, index=True, nullable=False)
    last_reviewed_at = Column(DateTime, nullable=True)


class ReviewLog(Base):
    __tablename__ = "review_logs"
    id = Column(Integer, primary_key=True)
    user_id = Column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    card_id = Column(ForeignKey("flashcards.id", ondelete="CASCADE"), index=True, nullable=False)
    course_id = Column(ForeignKey("courses.id", ondelete="CASCADE"), index=True, nullable=False)
    grade = Column(Integer, nullable=False)  # 0 again, 1 hard, 2 good, 3 easy
    interval_before = Column(Integer, default=0, nullable=False)
    interval_after = Column(Integer, default=0, nullable=False)
    ease_after = Column(Float, default=2.5, nullable=False)
    reviewed_at = Column(DateTime, default=utcnow, nullable=False)
