"""Flashcard decks, cards and the spaced-repetition review queue.

Decks belong to a course, so visibility follows the course: draft courses (and their decks) are
only visible to instructors and the course owner, and only they may edit decks and cards.
Scheduling state is personal: every member reviews the same cards on their own timetable.
"""

from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session
from sqlalchemy.sql import Select

from .. import clock
from ..database import get_db
from ..deps import Access, access_for, current_user, get_or_404, workspace_access
from ..models import CardState, Concept, Course, Deck, Flashcard, ReviewLog, StudyLog, User
from ..schemas.flashcards import (
    IMPORT_MAX_LINES,
    CardCreate,
    CardOut,
    CardPage,
    CardStatus,
    CardUpdate,
    DeckCreate,
    DeckDetail,
    DeckPage,
    DeckUpdate,
    GenerateOut,
    ImportIn,
    ImportOut,
    ReviewIn,
    ReviewOut,
    ReviewQueueOut,
    ReviewStats,
    SessionIn,
    SessionOut,
    normalise_front,
    parse_import,
)
from ..services.events import record
from ..services.listing import matches, paginate, parse_sort, sort_items
from ..services.progress import streak_summary
from ..services.review_queue import DAILY_NEW_LIMIT, apply_review, build_queue, end_of_today, schedule_of, state_map
from ..services.scheduler import (
    AGAIN,
    CardSchedule,
    card_status,
    forecast,
    format_interval,
    mastery_percent,
    preview_intervals,
    retention_rate,
    round_half_up,
)

router = APIRouter(tags=["flashcards"])

DECK_SORTS = ("course", "name", "due", "new", "mastery", "card_count", "created_at")
CARD_SORTS = ("position", "front", "due_at", "interval_days", "lapses", "created_at")
CARD_STATUSES = ("new", "learning", "young", "mature")
RETENTION_WINDOW = timedelta(days=30)
HISTORY_DAYS = 14
MAX_SESSION_MINUTES = 240


def plural(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


# ---------- Access ----------


def course_visible(course: Course, access: Access) -> bool:
    return course.status != "draft" or access.can("instructor") or course.owner_id == access.user.id


def course_editable(course: Course, access: Access) -> bool:
    return course.owner_id == access.user.id or access.can("instructor")


@dataclass
class DeckContext:
    deck: Deck
    course: Course
    access: Access

    @property
    def can_edit(self) -> bool:
        return course_editable(self.course, self.access)

    def require_edit(self) -> None:
        if not self.can_edit:
            raise HTTPException(403, "Only instructors and the course owner can change this deck")


def deck_context(db: Session, user: User, deck_id: int) -> DeckContext:
    deck = get_or_404(db, Deck, deck_id, "Deck")
    course = db.get(Course, deck.course_id)
    access = access_for(db, user, course.workspace_id)
    if not course_visible(course, access):
        raise HTTPException(404, "Deck not found")
    return DeckContext(deck, course, access)


def card_context(db: Session, user: User, card_id: int) -> tuple[Flashcard, DeckContext]:
    card = get_or_404(db, Flashcard, card_id, "Card")
    return card, deck_context(db, user, card.deck_id)


def workspace_decks(db: Session, access: Access, course_id: int | None = None) -> list[tuple[Deck, Course]]:
    """Decks the member can see in their workspace (archived courses are left out)."""
    query = (
        select(Deck, Course)
        .join(Course, Deck.course_id == Course.id)
        .where(Course.workspace_id == access.workspace.id, Course.status != "archived")
        .order_by(Course.title, Deck.name, Deck.id)
    )
    if course_id is not None:
        query = query.where(Course.id == course_id)
    return [(deck, course) for deck, course in db.execute(query) if course_visible(course, access)]


