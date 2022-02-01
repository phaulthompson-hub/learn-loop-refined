"""Request/response models for decks, cards, reviews and flashcard statistics.

Also holds `parse_import`, the line-by-line parser behind bulk import, because it enforces the
same length limits as `CardCreate` (the frontend mirrors it in `features/flashcards/importParser.ts`).
"""

from collections.abc import Iterable
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, StrictStr, root_validator

from .common import Text

FRONT_MAX = 500
BACK_MAX = 2000
HINT_MAX = 255
IMPORT_MAX_LINES = 500
IMPORT_SEPARATOR = "::"

CardStatus = Literal["new", "learning", "young", "mature"]


# ---------- Decks ----------


class DeckCreate(BaseModel):
    course_id: int
    name: Text(2, 120)
    description: Text(0, 500) = ""


class DeckUpdate(BaseModel):
    name: Text(2, 120) | None = None
    description: Text(0, 500) | None = None


class DeckSummary(BaseModel):
    id: int
    workspace_id: int
    course_id: int
    course_title: str
    course_color: str
    name: str
    description: str
    created_by_id: int | None
    created_by_name: str | None
    created_at: datetime
    card_count: int
    due: int
    new: int
    learning: int
    young: int
    mature: int
    mastery: float
    retention: float | None
    last_reviewed_at: datetime | None
    next_due_at: datetime | None
    can_edit: bool


class DeckCourse(BaseModel):
    id: int
    title: str
    color: str
    decks: int
    can_edit: bool


class DueTotals(BaseModel):
    due: int
    new: int
    total: int


class DeckPage(BaseModel):
    items: list[DeckSummary]
    total: int
    page: int
    page_size: int
    courses: list[DeckCourse]
    totals: DueTotals


class ConceptBrief(BaseModel):
    id: int
    name: str
    summary: str
    card_count: int


class DeckDetail(DeckSummary):
    concepts: list[ConceptBrief]


# ---------- Cards ----------


class CardCreate(BaseModel):
    front: Text(1, FRONT_MAX)
    back: Text(1, BACK_MAX)
    hint: Text(0, HINT_MAX) = ""
    concept_id: int | None = None


class CardUpdate(BaseModel):
    """Partial update; sending `"concept_id": null` explicitly unlinks the concept."""

    front: Text(1, FRONT_MAX) | None = None
    back: Text(1, BACK_MAX) | None = None
    hint: Text(0, HINT_MAX) | None = None
    concept_id: int | None = None


class CardOut(BaseModel):
    id: int
    deck_id: int
    concept_id: int | None
    concept_name: str | None
    front: str
    back: str
    hint: str
    position: int
    created_at: datetime
    status: CardStatus
    due_at: datetime | None
    interval_days: int
    ease: float | None
    repetitions: int
    lapses: int
    reviews: int
    last_reviewed_at: datetime | None


