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


def card_payload(card: Flashcard, state: CardState | None, names: dict[int, str], reviews: int) -> dict:
    return {
        "id": card.id,
        "deck_id": card.deck_id,
        "concept_id": card.concept_id,
        "concept_name": names.get(card.concept_id) if card.concept_id else None,
        "front": card.front,
        "back": card.back,
        "hint": card.hint,
        "position": card.position,
        "created_at": card.created_at,
        "status": card_status(schedule_of(state)),
        "due_at": state.due_at if state else None,
        "interval_days": state.interval_days if state else 0,
        "ease": state.ease if state else None,
        "repetitions": state.repetitions if state else 0,
        "lapses": state.lapses if state else 0,
        "reviews": reviews,
        "last_reviewed_at": state.last_reviewed_at if state else None,
    }


def cards_payload(db: Session, user_id: int, cards: Sequence[Flashcard]) -> list[dict]:
    ids = [card.id for card in cards]
    states = state_map(db, user_id, ids)
    names = concept_names(db, (card.concept_id for card in cards))
    counts = review_counts(db, user_id, ids)
    return [card_payload(card, states.get(card.id), names, counts.get(card.id, 0)) for card in cards]


# ---------- Writes ----------


def check_deck_name(db: Session, course_id: int, name: str, exclude_id: int | None = None) -> None:
    for deck in db.scalars(select(Deck).where(Deck.course_id == course_id)):
        if deck.id != exclude_id and deck.name.casefold() == name.casefold():
            raise HTTPException(409, f"This course already has a deck called {deck.name}")


def check_concept(db: Session, concept_id: int | None, course: Course) -> None:
    if concept_id is None:
        return
    concept = db.get(Concept, concept_id)
    if concept is None or concept.course_id != course.id:
        raise HTTPException(422, "The linked concept must belong to this deck's course")


def check_front(deck: Deck, front: str, exclude_id: int | None = None) -> None:
    key = normalise_front(front)
    if any(card.id != exclude_id and normalise_front(card.front) == key for card in deck.cards):
        raise HTTPException(409, "This deck already has a card with the same front")


def add_card(deck: Deck, front: str, back: str, hint: str = "", concept_id: int | None = None) -> Flashcard:
    position = max((card.position for card in deck.cards), default=-1) + 1
    card = Flashcard(
        front=front, back=back, hint=hint, concept_id=concept_id, position=position, created_at=clock.now()
    )
    deck.cards.append(card)
    return card


def purge_history(db: Session, card_ids: Sequence[int]) -> None:
    """Remove every learner's schedule and review log for cards that are being deleted.

    SQLite does not enforce the ON DELETE CASCADE foreign keys here, and a reused card id must
    never inherit someone else's history.
    """
    if card_ids:
        db.execute(delete(CardState).where(CardState.card_id.in_(card_ids)))
        db.execute(delete(ReviewLog).where(ReviewLog.card_id.in_(card_ids)))


# ---------- Decks ----------


@router.get("/api/workspaces/{workspace_id}/decks", response_model=DeckPage)
def list_decks(
    access: Access = Depends(workspace_access),
    db: Session = Depends(get_db),
    course_id: int | None = None,
    q: str | None = Query(None, max_length=100),
    sort: str | None = Query(None, max_length=30),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
):
    field, descending = parse_sort(sort, DECK_SORTS, "course")
    pairs = workspace_decks(db, access)
    summaries = deck_summaries(db, access, [p for p in pairs if course_id is None or p[1].id == course_id])
    deck_counts = Counter(course.id for _, course in pairs)
    courses = db.scalars(
        select(Course)
        .where(Course.workspace_id == access.workspace.id, Course.status != "archived")
        .order_by(Course.title)
    )
    course_facets = [
        {
            "id": c.id,
            "title": c.title,
            "color": c.color,
            "decks": deck_counts[c.id],
            "can_edit": course_editable(c, access),
        }
        for c in courses
        if course_visible(c, access)
    ]
    totals = {
        "due": sum(s["due"] for s in summaries),
        "new": sum(s["new"] for s in summaries),
        "total": sum(s["card_count"] for s in summaries),
    }
    filtered = [s for s in summaries if matches(q, s["name"], s["description"], s["course_title"])]
    if field == "course":
        ordered = sort_items(filtered, lambda s: (s["course_title"].lower(), s["name"].lower()), descending)
    elif field == "name":
        ordered = sort_items(filtered, lambda s: s["name"].lower(), descending)
    else:
        ordered = sort_items(filtered, lambda s: s[field], descending)
    return {**paginate(ordered, page, page_size), "courses": course_facets, "totals": totals}


@router.post("/api/workspaces/{workspace_id}/decks", response_model=DeckDetail, status_code=201)
def create_deck(data: DeckCreate, access: Access = Depends(workspace_access), db: Session = Depends(get_db)):
    course = db.get(Course, data.course_id)
    if course is None or course.workspace_id != access.workspace.id or not course_visible(course, access):
        raise HTTPException(404, "Course not found")
    if not course_editable(course, access):
        raise HTTPException(403, "Only instructors and the course owner can add decks to this course")
    if course.status == "archived":
        raise HTTPException(400, "Archived courses cannot get new decks")
    check_deck_name(db, course.id, data.name)
    deck = Deck(
        course_id=course.id,
        name=data.name,
        description=data.description,
        created_by_id=access.user.id,
        created_at=clock.now(),
    )
    db.add(deck)
    db.flush()
    record(
        db,
        workspace_id=course.workspace_id,
        actor_id=access.user.id,
        verb="deck.created",
        object_type="deck",
        object_id=deck.id,
        summary=f"created the deck {deck.name} in {course.title}",
        link=f"/decks/{deck.id}",
    )
    db.commit()
    return deck_detail(db, DeckContext(deck, course, access))


@router.get("/api/decks/{deck_id}", response_model=DeckDetail)
def get_deck(deck_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return deck_detail(db, deck_context(db, user, deck_id))


@router.patch("/api/decks/{deck_id}", response_model=DeckDetail)
def update_deck(deck_id: int, data: DeckUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ctx = deck_context(db, user, deck_id)
    ctx.require_edit()
    if data.name is not None:
        check_deck_name(db, ctx.course.id, data.name, exclude_id=ctx.deck.id)
        ctx.deck.name = data.name
    if data.description is not None:
        ctx.deck.description = data.description
    db.commit()
    return deck_detail(db, ctx)


@router.delete("/api/decks/{deck_id}", status_code=204)
def delete_deck(deck_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ctx = deck_context(db, user, deck_id)
    ctx.require_edit()
    record(
        db,
        workspace_id=ctx.course.workspace_id,
        actor_id=user.id,
        verb="deck.deleted",
        object_type="deck",
        object_id=None,
        summary=f"deleted the deck {ctx.deck.name} from {ctx.course.title}",
        link=f"/courses/{ctx.course.id}",
    )
    purge_history(db, [card.id for card in ctx.deck.cards])
    db.delete(ctx.deck)
    db.commit()
    return Response(status_code=204)


# ---------- Cards ----------


@router.get("/api/decks/{deck_id}/cards", response_model=CardPage)
def list_cards(
    deck_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    q: str | None = Query(None, max_length=100),
    status: CardStatus | None = None,
    sort: str | None = Query(None, max_length=30),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=100),
):
    field, descending = parse_sort(sort, CARD_SORTS, "position")
    ctx = deck_context(db, user, deck_id)
    cards = cards_payload(db, user.id, ctx.deck.cards)
    counts = Counter(card["status"] for card in cards)
    filtered = [
        card
        for card in cards
        if (status is None or card["status"] == status)
        and matches(q, card["front"], card["back"], card["hint"], card["concept_name"])
    ]
    key = (lambda c: c["front"].lower()) if field == "front" else (lambda c: c[field])
    return {
        **paginate(sort_items(filtered, key, descending), page, page_size),
        "counts": {name: counts[name] for name in CARD_STATUSES},
    }


@router.post("/api/decks/{deck_id}/cards", response_model=CardOut, status_code=201)
def create_card(deck_id: int, data: CardCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ctx = deck_context(db, user, deck_id)
    ctx.require_edit()
    check_concept(db, data.concept_id, ctx.course)
    check_front(ctx.deck, data.front)
    card = add_card(ctx.deck, data.front, data.back, data.hint, data.concept_id)
    db.commit()
    return cards_payload(db, user.id, [card])[0]


@router.patch("/api/cards/{card_id}", response_model=CardOut)
def update_card(card_id: int, data: CardUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    card, ctx = card_context(db, user, card_id)
    ctx.require_edit()
    changes = data.dict(exclude_unset=True)
    if "concept_id" in changes:
        check_concept(db, changes["concept_id"], ctx.course)
        card.concept_id = changes["concept_id"]
    if changes.get("front") is not None:
        check_front(ctx.deck, changes["front"], exclude_id=card.id)
    for key in ("front", "back", "hint"):
        if changes.get(key) is not None:
            setattr(card, key, changes[key])
    db.commit()
    return cards_payload(db, user.id, [card])[0]


@router.delete("/api/cards/{card_id}", status_code=204)
def delete_card(card_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    card, ctx = card_context(db, user, card_id)
    ctx.require_edit()
    purge_history(db, [card.id])
    ctx.deck.cards.remove(card)
    db.commit()
    return Response(status_code=204)


@router.post("/api/decks/{deck_id}/cards/import", response_model=ImportOut)
def import_cards(deck_id: int, data: ImportIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Create cards from `front :: back [:: hint]` lines; `dry_run` only reports what would happen."""
    ctx = deck_context(db, user, deck_id)
    ctx.require_edit()
    lines = [line for line in data.text.splitlines() if line.strip() and not line.strip().startswith("#")]
    if not lines:
        raise HTTPException(422, "Paste at least one line in the form: front :: back")
    if len(lines) > IMPORT_MAX_LINES:
        raise HTTPException(422, f"Import at most {IMPORT_MAX_LINES} cards at a time")
    accepted, rejected = parse_import(data.text, (card.front for card in ctx.deck.cards))
    created = 0
    if accepted and not data.dry_run:
        for line in accepted:
            add_card(ctx.deck, line["front"], line["back"], line["hint"])
        created = len(accepted)
        record(
            db,
            workspace_id=ctx.course.workspace_id,
            actor_id=user.id,
            verb="deck.imported",
            object_type="deck",
            object_id=ctx.deck.id,
            summary=f"imported {plural(created, 'card')} into {ctx.deck.name}",
            link=f"/decks/{ctx.deck.id}",
        )
        db.commit()
    return {"accepted": accepted, "rejected": rejected, "created": created}


@router.post("/api/decks/{deck_id}/cards/generate", response_model=GenerateOut)
def generate_cards(deck_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """One card per course concept: the question names the concept, the answer is its summary.

    Concepts that already have a linked card in this deck (or whose question already exists) are skipped.
    """
    ctx = deck_context(db, user, deck_id)
    ctx.require_edit()
    concepts = db.scalars(select(Concept).where(Concept.course_id == ctx.course.id).order_by(Concept.order_index))
    linked = {card.concept_id for card in ctx.deck.cards if card.concept_id}
    fronts = {normalise_front(card.front) for card in ctx.deck.cards}
    created: list[Flashcard] = []
    skipped = 0
    for concept in concepts:
        front = f"What should you remember about {concept.name}?"
        if concept.id in linked or normalise_front(front) in fronts:
            skipped += 1
            continue
        created.append(add_card(ctx.deck, front, concept.summary, concept_id=concept.id))
        fronts.add(normalise_front(front))
    db.commit()
    return {"created": cards_payload(db, user.id, created), "skipped": skipped}


# ---------- Reviewing ----------


@router.get("/api/workspaces/{workspace_id}/review/queue", response_model=ReviewQueueOut)
def review_queue(
    access: Access = Depends(workspace_access),
    db: Session = Depends(get_db),
    deck_id: int | None = None,
    course_id: int | None = None,
    limit: int = Query(100, ge=1, le=200),
    new: int = Query(DAILY_NEW_LIMIT, ge=0, le=DAILY_NEW_LIMIT),
):
    cards, decks = review_scope(db, access, deck_id, course_id)
    queue = build_queue(db, access.user.id, cards, limit=limit, new_limit=new)
    names = concept_names(db, (card.concept_id for card in cards))
    entries: list[tuple[Flashcard, CardState | None]] = [*queue.due, *((card, None) for card in queue.new)]
    items = []
    for card, state in entries:
        deck, course = decks[card.deck_id]
        schedule = schedule_of(state) or CardSchedule()
        items.append(
            {
                "id": card.id,
                "deck_id": deck.id,
                "deck_name": deck.name,
                "course_id": course.id,
                "course_title": course.title,
                "course_color": course.color,
                "front": card.front,
                "back": card.back,
                "hint": card.hint,
                "concept_name": names.get(card.concept_id) if card.concept_id else None,
                "status": card_status(schedule_of(state)),
                "due_at": state.due_at if state else None,
                "ease": schedule.ease,
                "interval_days": schedule.interval_days,
                "repetitions": schedule.repetitions,
                "lapses": schedule.lapses,
                "previews": preview_intervals(schedule),
            }
        )
    return {
        "cards": items,
        "due": queue.due_total,
        "new": queue.new_total,
        "new_limit": DAILY_NEW_LIMIT,
        "new_allowance": queue.new_allowance,
        "next_due_at": queue.next_due_at,
    }


@router.post("/api/cards/{card_id}/review", response_model=ReviewOut)
def review_card(card_id: int, data: ReviewIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    card, ctx = card_context(db, user, card_id)
    if ctx.course.status == "archived":
        raise HTTPException(400, "Cards in archived courses cannot be reviewed")
    state, interval_before = apply_review(db, user.id, card, ctx.course.id, data.grade)
    db.commit()
    return {
        "card_id": card.id,
        "grade": data.grade,
        "status": card_status(schedule_of(state)),
        "ease": state.ease,
        "interval_before": interval_before,
        "interval_days": state.interval_days,
        "repetitions": state.repetitions,
        "lapses": state.lapses,
        "due_at": state.due_at,
        "display": format_interval(state.interval_days),
    }


@router.post("/api/workspaces/{workspace_id}/review/sessions", response_model=SessionOut, status_code=201)
def finish_session(data: SessionIn, access: Access = Depends(workspace_access), db: Session = Depends(get_db)):
    """Log a finished review session as study time and announce it in the workspace feed.

    The reported count is checked against the reviews actually recorded today in this workspace.
    """
    deck: Deck | None = None
    if data.deck_id is not None:
        _, decks = review_scope(db, access, data.deck_id, None)
        deck = decks[data.deck_id][0]
    reviewed_courses = db.scalars(
        select(ReviewLog.course_id)
        .join(Course, ReviewLog.course_id == Course.id)
        .where(ReviewLog.user_id == access.user.id, Course.workspace_id == access.workspace.id)
        .where(ReviewLog.reviewed_at >= clock.start_of_day(clock.now()))
    ).all()
    if data.reviewed > len(reviewed_courses):
        raise HTTPException(422, f"Only {plural(len(reviewed_courses), 'review')} were recorded today")
    course_id = deck.course_id if deck else Counter(reviewed_courses).most_common(1)[0][0]
    minutes = int(min(MAX_SESSION_MINUTES, max(1, round_half_up(data.duration_seconds / 60))))
    accuracy = round_half_up(100 * (data.reviewed - data.again) / data.reviewed, 1)
    where = f" in {deck.name}" if deck else ""
    log = StudyLog(
        user_id=access.user.id,
        course_id=course_id,
        minutes=minutes,
        activity="flashcards",
        note=f"Reviewed {plural(data.reviewed, 'flashcard')}{where}",
        logged_at=clock.now(),
    )
    db.add(log)
    record(
        db,
        workspace_id=access.workspace.id,
        actor_id=access.user.id,
        verb="flashcards.reviewed",
        object_type="deck" if deck else "workspace",
        object_id=deck.id if deck else None,
        summary=f"reviewed {plural(data.reviewed, 'flashcard')}{where}",
        link=f"/decks/{deck.id}" if deck else "/review",
        detail=f"{accuracy:g}% recalled in {minutes} min",
    )
    db.commit()
    return {
        "study_log_id": log.id,
        "course_id": course_id,
        "minutes": minutes,
        "reviewed": data.reviewed,
        "accuracy": accuracy,
    }


@router.get("/api/workspaces/{workspace_id}/review/stats", response_model=ReviewStats)
def review_stats(
    access: Access = Depends(workspace_access),
    db: Session = Depends(get_db),
    deck_id: int | None = None,
    course_id: int | None = None,
):
    """Today's workload, recent recall and the two-week outlook for a workspace, course or deck."""
    cards, _ = review_scope(db, access, deck_id, course_id)
    user_id = access.user.id
    card_ids = [card.id for card in cards]
    states = state_map(db, user_id, card_ids)
    queue = build_queue(db, user_id, cards)
    now = clock.now()
    today = now.date()
    logs = []
    if card_ids:
        logs = db.execute(
            select(ReviewLog.grade, ReviewLog.reviewed_at).where(
                ReviewLog.user_id == user_id,
                ReviewLog.card_id.in_(card_ids),
                ReviewLog.reviewed_at >= now - RETENTION_WINDOW,
            )
        ).all()
    by_day: dict = defaultdict(list)
    for grade, reviewed_at in logs:
        by_day[reviewed_at.date()].append(grade)
    history = []
    for offset in range(HISTORY_DAYS - 1, -1, -1):
        day = today - timedelta(days=offset)
        history.append({"date": day, "reviews": len(by_day[day]), "again": by_day[day].count(AGAIN)})
    statuses = Counter(card_status(schedule_of(state)) for state in states.values())
    return {
        "total_cards": len(cards),
        "due_today": queue.due_total,
        "new_available": queue.new_total,
        "new_allowance": queue.new_allowance,
        "reviewed_today": len(by_day[today]),
        "again_today": by_day[today].count(AGAIN),
        "retention_30d": retention_rate(grade for grade, _ in logs),
        "reviews_30d": len(logs),
        "learning": statuses["learning"],
        "young": statuses["young"],
        "mature": statuses["mature"],
        "streak": streak_summary(db, user_id)["current"],
        "next_due_at": queue.next_due_at,
        "forecast": [{"date": day, "due": n} for day, n in forecast((s.due_at for s in states.values()), today)],
        "history": history,
    }
