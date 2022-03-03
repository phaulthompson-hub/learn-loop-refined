"""Global search across courses, concepts, notes, tasks, flashcards and events.

Each result type turns the rows the caller may see into `Candidate`s; `services.search` does the
ranking and snippet work, so this module only decides visibility, wording and links.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Access, workspace_access
from ..models import Concept, Course, Deck, Event, Flashcard, Task, User
from ..schemas.search import SearchOut
from ..services import search
from ..services.board import task_key, workspace_prefix
from .notes import visible_notes

router = APIRouter(tags=["search"])

TYPE_LABELS = {
    "course": "Courses",
    "concept": "Concepts",
    "note": "Notes",
    "task": "Tasks",
    "card": "Flashcards",
    "event": "Events",
}
SNIPPET_WIDTH = 140


@dataclass(frozen=True)
class Candidate:
    type: str
    id: int
    title: str
    fields: tuple[str, ...]
    subtitle: str
    link: str
    updated_at: datetime | None


@dataclass(frozen=True)
class Scope:
    """What the caller can see, loaded once and shared by every result type."""

    db: Session
    access: Access
    courses: dict[int, Course]


def visible_courses(db: Session, access: Access) -> dict[int, Course]:
    """Draft courses are only visible to instructors and to their owner (same rule as the catalogue)."""
    courses = db.scalars(select(Course).where(Course.workspace_id == access.workspace.id).order_by(Course.id))
    return {c.id: c for c in courses if c.status != "draft" or access.can("instructor") or c.owner_id == access.user.id}


def parse_types(raw: str | None) -> list[str]:
    if not raw or not raw.strip():
        return list(TYPE_LABELS)
    wanted = []
    for part in raw.split(","):
        kind = part.strip().lower()
        if kind not in TYPE_LABELS:
            raise HTTPException(422, f"Unknown result type '{kind}'. Use any of: {', '.join(TYPE_LABELS)}")
        if kind not in wanted:
            wanted.append(kind)
    return wanted


# ---------- Candidates per type ----------


def course_candidates(scope: Scope) -> list[Candidate]:
    return [
        Candidate(
            type="course",
            id=c.id,
            title=c.title,
            fields=(c.description, c.subject, " ".join(c.tag_list)),
            subtitle=" · ".join([c.subject, c.difficulty.capitalize()] + (["Draft"] if c.status == "draft" else [])),
            link=f"/courses/{c.id}",
            updated_at=c.updated_at,
        )
        for c in scope.courses.values()
    ]


def concept_candidates(scope: Scope) -> list[Candidate]:
    if not scope.courses:
        return []
    concepts = scope.db.scalars(select(Concept).where(Concept.course_id.in_(scope.courses)).order_by(Concept.id))
    return [
        Candidate(
            type="concept",
            id=c.id,
            title=c.name,
            fields=(c.summary,),
            subtitle=scope.courses[c.course_id].title,
            link=f"/courses/{c.course_id}",
            updated_at=scope.courses[c.course_id].updated_at,
        )
        for c in concepts
    ]


def note_candidates(scope: Scope) -> list[Candidate]:
    user_id = scope.access.user.id
    notes = visible_notes(scope.db, scope.access.workspace.id, user_id)
    authors = {u.id: u.name for u in scope.db.scalars(select(User).where(User.id.in_({n.user_id for n in notes})))}
    candidates = []
    for note in notes:
        course = scope.courses.get(note.course_id) if note.course_id else None
        parts = [course.title if course else "Note"]
        if note.user_id != user_id:
            parts.append(f"by {authors.get(note.user_id, 'a teammate')}")
        candidates.append(
            Candidate(
                type="note",
                id=note.id,
                title=note.title,
                fields=(search.strip_markdown(note.body), " ".join(note.tag_list)),
                subtitle=" · ".join(parts),
                link=f"/notes/{note.id}",
                updated_at=note.updated_at,
            )
        )
    return candidates


