"""Which flashcards a learner should review now, and recording their answers.

A card is *due* when the learner has a `CardState` whose `due_at` is on or before the end of
today; a card is *new* when the learner has never reviewed it (no `CardState` row). New cards
are introduced gradually: at most `DAILY_NEW_LIMIT` per learner per day within the studied scope.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import clock
from ..models import CardState, Course, Deck, Flashcard, ReviewLog
from .scheduler import CardSchedule, due_after, next_schedule

DAILY_NEW_LIMIT = 20


def end_of_today() -> datetime:
    return clock.start_of_day(clock.now()) + timedelta(days=1)


def workspace_card_ids(db: Session, workspace_id: int, course_id: int | None = None) -> list[int]:
    query = (
        select(Flashcard.id)
        .join(Deck, Flashcard.deck_id == Deck.id)
        .join(Course, Deck.course_id == Course.id)
        .where(Course.workspace_id == workspace_id, Course.status != "archived")
    )
    if course_id is not None:
        query = query.where(Course.id == course_id)
    return list(db.scalars(query))


def due_summary(db: Session, user_id: int, workspace_id: int, course_id: int | None = None) -> dict:
    card_ids = workspace_card_ids(db, workspace_id, course_id)
    if not card_ids:
        return {"due": 0, "new": 0, "total": 0}
    states = db.scalars(select(CardState).where(CardState.user_id == user_id, CardState.card_id.in_(card_ids))).all()
    cutoff = end_of_today()
    due = sum(1 for s in states if s.due_at < cutoff)
    return {"due": due, "new": len(card_ids) - len(states), "total": len(card_ids)}


def schedule_of(state: CardState | None) -> CardSchedule | None:
    if state is None:
        return None
    return CardSchedule(
        ease=state.ease, interval_days=state.interval_days, repetitions=state.repetitions, lapses=state.lapses
    )


def state_map(db: Session, user_id: int, card_ids: Iterable[int]) -> dict[int, CardState]:
    ids = list(card_ids)
    if not ids:
        return {}
    rows = db.scalars(select(CardState).where(CardState.user_id == user_id, CardState.card_id.in_(ids)))
    return {state.card_id: state for state in rows}


def new_cards_started_today(db: Session, user_id: int, card_ids: Iterable[int]) -> int:
    """Cards whose very first review happened today (they used up part of today's new-card allowance)."""
    ids = list(card_ids)
    if not ids:
        return 0
    first_reviews = (
        select(ReviewLog.card_id)
        .where(ReviewLog.user_id == user_id, ReviewLog.card_id.in_(ids))
        .group_by(ReviewLog.card_id)
        .having(func.min(ReviewLog.reviewed_at) >= clock.start_of_day(clock.now()))
    )
    return len(db.scalars(first_reviews).all())


@dataclass
class ReviewQueue:
    due: list[tuple[Flashcard, CardState]]
    new: list[Flashcard]
    due_total: int
    new_total: int
    new_allowance: int
    next_due_at: datetime | None


def build_queue(
    db: Session, user_id: int, cards: Sequence[Flashcard], *, limit: int = 100, new_limit: int = DAILY_NEW_LIMIT
) -> ReviewQueue:
    """Due cards first (most overdue first), then new cards in deck order, within today's allowance.

    `cards` is the scope being studied (one deck, one course or a whole workspace); the daily
    new-card allowance is measured over the same scope.
    """
    states = state_map(db, user_id, (card.id for card in cards))
    cutoff = end_of_today()
    due = sorted(
        ((card, states[card.id]) for card in cards if card.id in states and states[card.id].due_at < cutoff),
        key=lambda pair: (pair[1].due_at, pair[0].id),
    )
    unseen = sorted((card for card in cards if card.id not in states), key=lambda c: (c.deck_id, c.position, c.id))
    allowance = max(0, DAILY_NEW_LIMIT - new_cards_started_today(db, user_id, (card.id for card in cards)))
    new_slots = max(0, min(allowance, new_limit, limit - len(due)))
    later = [state.due_at for state in states.values() if state.due_at >= cutoff]
    return ReviewQueue(
        due=due[:limit],
        new=unseen[:new_slots],
        due_total=len(due),
        new_total=len(unseen),
        new_allowance=allowance,
        next_due_at=min(later) if later else None,
    )


def apply_review(db: Session, user_id: int, card: Flashcard, course_id: int, grade: int) -> tuple[CardState, int]:
    """Reschedule `card` after an answer and log it. Returns the updated state and the previous interval."""
    now = clock.now()
    state = db.scalars(select(CardState).where(CardState.user_id == user_id, CardState.card_id == card.id)).first()
    before = schedule_of(state) or CardSchedule()
    after = next_schedule(before, grade)
    if state is None:
        state = CardState(user_id=user_id, card_id=card.id)
        db.add(state)
    state.ease = after.ease
    state.interval_days = after.interval_days
    state.repetitions = after.repetitions
    state.lapses = after.lapses
    state.due_at = due_after(now, after.interval_days)
    state.last_reviewed_at = now
    db.add(
        ReviewLog(
            user_id=user_id,
            card_id=card.id,
            course_id=course_id,
            grade=grade,
            interval_before=before.interval_days,
            interval_after=after.interval_days,
            ease_after=after.ease,
            reviewed_at=now,
        )
    )
    # Flush so a follow-up answer in the same transaction (seeding, relearning) finds this state.
    db.flush()
    return state, before.interval_days
