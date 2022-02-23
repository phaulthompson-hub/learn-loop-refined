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


def review_scope(
    db: Session, access: Access, deck_id: int | None, course_id: int | None
) -> tuple[list[Flashcard], dict[int, tuple[Deck, Course]]]:
    """Cards to study or measure: one deck, one course, or every visible deck in the workspace."""
    pairs = workspace_decks(db, access, course_id)
    if deck_id is not None:
        pairs = [pair for pair in pairs if pair[0].id == deck_id]
        if not pairs:
            raise HTTPException(404, "Deck not found")
    decks = {deck.id: (deck, course) for deck, course in pairs}
    if not decks:
        return [], decks
    cards = db.scalars(select(Flashcard).where(Flashcard.deck_id.in_(decks)).order_by(Flashcard.id)).all()
    return list(cards), decks


# ---------- Read models ----------


def key_values(db: Session, query: Select) -> dict:
    """Run a two-column query into a dict (a `Result` has `.keys()`, so it must be listed first)."""
    return dict(db.execute(query).all())


def recent_grades(db: Session, user_id: int, card_ids: Sequence[int], since: datetime) -> dict[int, list[int]]:
    grades: dict[int, list[int]] = defaultdict(list)
    if card_ids:
        rows = db.execute(
            select(ReviewLog.card_id, ReviewLog.grade).where(
                ReviewLog.user_id == user_id, ReviewLog.card_id.in_(card_ids), ReviewLog.reviewed_at >= since
            )
        )
        for card_id, grade in rows:
            grades[card_id].append(grade)
    return grades


def deck_summaries(db: Session, access: Access, pairs: Sequence[tuple[Deck, Course]]) -> list[dict]:
    """Per-learner counts and progress for several decks, loading cards, states and logs in bulk."""
    cards_by_deck: dict[int, list[int]] = defaultdict(list)
    if pairs:
        rows = db.execute(
            select(Flashcard.id, Flashcard.deck_id).where(Flashcard.deck_id.in_([d.id for d, _ in pairs]))
        )
        for card_id, deck_id in rows:
            cards_by_deck[deck_id].append(card_id)
    card_ids = [card_id for ids in cards_by_deck.values() for card_id in ids]
    states = state_map(db, access.user.id, card_ids)
    grades = recent_grades(db, access.user.id, card_ids, clock.now() - RETENTION_WINDOW)
    creator_ids = {deck.created_by_id for deck, _ in pairs if deck.created_by_id}
    creators = key_values(db, select(User.id, User.name).where(User.id.in_(creator_ids))) if creator_ids else {}
    return [
        deck_summary(deck, course, cards_by_deck[deck.id], states, grades, creators, course_editable(course, access))
        for deck, course in pairs
    ]


def deck_summary(
    deck: Deck,
    course: Course,
    card_ids: Sequence[int],
    states: dict[int, CardState],
    grades: dict[int, list[int]],
    creators: dict[int, str],
    can_edit: bool,
) -> dict:
    mine = [states[card_id] for card_id in card_ids if card_id in states]
    statuses = Counter(card_status(schedule_of(state)) for state in mine)
    cutoff = end_of_today()
    return {
        "id": deck.id,
        "workspace_id": course.workspace_id,
        "course_id": course.id,
        "course_title": course.title,
        "course_color": course.color,
        "name": deck.name,
        "description": deck.description,
        "created_by_id": deck.created_by_id,
        "created_by_name": creators.get(deck.created_by_id) if deck.created_by_id else None,
        "created_at": deck.created_at,
        "card_count": len(card_ids),
        "due": sum(1 for state in mine if state.due_at < cutoff),
        "new": len(card_ids) - len(mine),
        "learning": statuses["learning"],
        "young": statuses["young"],
        "mature": statuses["mature"],
        "mastery": mastery_percent((state.interval_days for state in mine), len(card_ids)),
        "retention": retention_rate(grade for card_id in card_ids for grade in grades.get(card_id, ())),
        "last_reviewed_at": max((s.last_reviewed_at for s in mine if s.last_reviewed_at), default=None),
        "next_due_at": min((s.due_at for s in mine if s.due_at >= cutoff), default=None),
        "can_edit": can_edit,
    }


def deck_detail(db: Session, ctx: DeckContext) -> dict:
    summary = deck_summaries(db, ctx.access, [(ctx.deck, ctx.course)])[0]
    linked = Counter(card.concept_id for card in ctx.deck.cards if card.concept_id)
    concepts = db.scalars(select(Concept).where(Concept.course_id == ctx.course.id).order_by(Concept.order_index))
    return {
        **summary,
        "concepts": [{"id": c.id, "name": c.name, "summary": c.summary, "card_count": linked[c.id]} for c in concepts],
    }


def concept_names(db: Session, concept_ids: Iterable[int | None]) -> dict[int, str]:
    ids = {concept_id for concept_id in concept_ids if concept_id}
    if not ids:
        return {}
    return key_values(db, select(Concept.id, Concept.name).where(Concept.id.in_(ids)))


def review_counts(db: Session, user_id: int, card_ids: Sequence[int]) -> dict[int, int]:
    if not card_ids:
        return {}
    return key_values(
        db,
        select(ReviewLog.card_id, func.count())
        .where(ReviewLog.user_id == user_id, ReviewLog.card_id.in_(card_ids))
        .group_by(ReviewLog.card_id),
    )


