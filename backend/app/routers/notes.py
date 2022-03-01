"""Markdown study notes: a personal knowledge base with sharing, tags and `[[wiki links]]`.

Visibility: a member sees their own notes (archived included) plus other members' notes that are
shared and not archived. Only the author may change, pin, archive or delete a note; anyone who can
see a note may duplicate it into their own collection.
"""

from dataclasses import dataclass
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from .. import clock
from ..database import get_db
from ..deps import Access, access_for, current_user, get_or_404, workspace_access
from ..models import Concept, Course, Note, User
from ..schemas.notes import Backlink, NoteCreate, NoteOut, NotePage, NoteTitle, NoteUpdate, TagCount
from ..services import search, wikilinks
from ..services.events import record
from ..services.listing import paginate, parse_sort, sort_items

router = APIRouter(tags=["notes"])

SORTS = ("relevance", "updated_at", "created_at", "title")
EXCERPT_WIDTH = 180
TITLE_MAX = 160


# ---------- Visibility and loading ----------


def can_view(note: Note, user_id: int) -> bool:
    return note.user_id == user_id or (note.shared and not note.archived)


def visible_notes(db: Session, workspace_id: int, user_id: int, *, archived: bool | None = False) -> list[Note]:
    """Notes `user_id` may read in a workspace. `archived=None` returns archived and active notes."""
    statement = select(Note).where(
        Note.workspace_id == workspace_id,
        or_(Note.user_id == user_id, and_(Note.shared.is_(True), Note.archived.is_(False))),
    )
    if archived is not None:
        statement = statement.where(Note.archived.is_(archived))
    return list(db.scalars(statement.order_by(Note.id)).all())


def note_access(db: Session, user: User, note_id: int) -> tuple[Note, Access]:
    note = get_or_404(db, Note, note_id, "Note")
    access = access_for(db, user, note.workspace_id)
    if not can_view(note, user.id):
        raise HTTPException(404, "Note not found")
    return note, access


def require_author(note: Note, user: User) -> None:
    if note.user_id != user.id:
        raise HTTPException(403, "Only the author can change this note")


def link_index(notes: list[Note], user_id: int) -> dict[str, int]:
    targets = (wikilinks.LinkTarget(n.id, n.title, n.user_id == user_id, n.updated_at) for n in notes)
    return wikilinks.title_index(targets)


@dataclass
class Refs:
    """Authors, courses and concepts referenced by a batch of notes, loaded with one query each."""

    users: dict[int, User]
    courses: dict[int, Course]
    concepts: dict[int, Concept]

    @classmethod
    def load(cls, db: Session, notes: list[Note]) -> "Refs":
        def by_id(model, ids):
            wanted = {i for i in ids if i is not None}
            if not wanted:
                return {}
            return {row.id: row for row in db.scalars(select(model).where(model.id.in_(wanted)))}

        return cls(
            users=by_id(User, (n.user_id for n in notes)),
            courses=by_id(Course, (n.course_id for n in notes)),
            concepts=by_id(Concept, (n.concept_id for n in notes)),
        )


# ---------- Payloads ----------


def body_without_title(title: str, body: str) -> str:
    """Drop a leading `# Heading` that just repeats the note title, so excerpts start with real content."""
    first, _, rest = body.lstrip().partition("\n")
    if first.startswith("#") and first.lstrip("#").strip().lower() == title.strip().lower():
        return rest
    return body


def summary_payload(note: Note, refs: Refs, user_id: int, query: search.Query | None = None) -> dict:
    plain = search.strip_markdown(body_without_title(note.title, note.body))
    course = refs.courses.get(note.course_id) if note.course_id else None
    concept = refs.concepts.get(note.concept_id) if note.concept_id else None
    return {
        "id": note.id,
        "workspace_id": note.workspace_id,
        "title": note.title,
        "excerpt": search.snippet(plain, query, EXCERPT_WIDTH),
        "tags": note.tag_list,
        "pinned": note.pinned,
        "archived": note.archived,
        "shared": note.shared,
        "mine": note.user_id == user_id,
        "author": refs.users[note.user_id],
        "course": {"id": course.id, "title": course.title, "color": course.color} if course else None,
        "concept": {"id": concept.id, "name": concept.name} if concept else None,
        "words": len(plain.split()),
        "created_at": note.created_at,
        "updated_at": note.updated_at,
    }


