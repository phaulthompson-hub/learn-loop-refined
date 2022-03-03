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


def task_candidates(scope: Scope) -> list[Candidate]:
    tasks = scope.db.scalars(select(Task).where(Task.workspace_id == scope.access.workspace.id).order_by(Task.id))
    prefix = workspace_prefix(scope.access.workspace.name)
    return [
        Candidate(
            type="task",
            id=t.id,
            title=t.title,
            fields=(t.description,),
            subtitle=f"{task_key(prefix, t.number)} · {t.status.replace('_', ' ').capitalize()}",
            link=f"/board?task={t.number}",
            updated_at=t.updated_at,
        )
        for t in tasks
    ]


def card_candidates(scope: Scope) -> list[Candidate]:
    if not scope.courses:
        return []
    rows = scope.db.execute(
        select(Flashcard, Deck).join(Deck, Flashcard.deck_id == Deck.id).where(Deck.course_id.in_(scope.courses))
    ).all()
    return [
        Candidate(
            type="card",
            id=card.id,
            title=card.front,
            fields=(card.back, card.hint),
            subtitle=f"{deck.name} · {scope.courses[deck.course_id].title}",
            link=f"/decks/{deck.id}",
            updated_at=card.created_at,
        )
        for card, deck in rows
    ]


def event_candidates(scope: Scope) -> list[Candidate]:
    access = scope.access
    events = scope.db.scalars(
        select(Event)
        .where(Event.workspace_id == access.workspace.id, or_(Event.user_id == access.user.id, Event.shared.is_(True)))
        .order_by(Event.starts_at)
    )
    return [
        Candidate(
            type="event",
            id=e.id,
            title=e.title,
            fields=(e.location,),
            subtitle=f"{e.kind.capitalize()} · {e.starts_at:%a %d %b}"
            + ("" if e.all_day else f", {e.starts_at:%H:%M}"),
            link=f"/planner?date={e.starts_at:%Y-%m-%d}",
            updated_at=e.starts_at,
        )
        for e in events
    ]


PRODUCERS: dict[str, Callable[[Scope], list[Candidate]]] = {
    "course": course_candidates,
    "concept": concept_candidates,
    "note": note_candidates,
    "task": task_candidates,
    "card": card_candidates,
    "event": event_candidates,
}


def hit_payload(candidate: Candidate, score: float, query: search.Query) -> dict:
    """The first secondary field with a match becomes the snippet; title-only matches have none."""
    snippet = None
    for text in candidate.fields:
        ranges = search.highlight_ranges(text, query)
        if ranges:
            snippet = search.excerpt(text, ranges, SNIPPET_WIDTH)
            break
    return {
        "type": candidate.type,
        "id": candidate.id,
        "title": candidate.title,
        "title_highlights": search.highlight_ranges(candidate.title, query),
        "subtitle": candidate.subtitle,
        "snippet": snippet,
        "link": candidate.link,
        "score": round(score, 2),
        "updated_at": candidate.updated_at,
    }


@router.get("/api/workspaces/{workspace_id}/search", response_model=SearchOut)
def search_workspace(
    access: Access = Depends(workspace_access),
    db: Session = Depends(get_db),
    q: str = Query("", max_length=100),
    types: str | None = Query(None, max_length=80),
    limit: int = Query(5, ge=1, le=50),
):
    """Ranked matches grouped by type. `counts` covers every requested type; `limit` applies per group."""
    kinds = parse_types(types)
    query = search.parse_query(q)
    counts = dict.fromkeys(kinds, 0)
    if not query:
        return {"query": q.strip(), "terms": [], "total": 0, "counts": counts, "groups": []}
    scope = Scope(db=db, access=access, courses=visible_courses(db, access))
    groups = []
    for kind in kinds:
        hits = search.rank(
            query,
            PRODUCERS[kind](scope),
            title=lambda c: c.title,
            fields=lambda c: c.fields,
            recency=lambda c: c.updated_at,
        )
        counts[kind] = len(hits)
        if hits:
            items = [hit_payload(hit.item, hit.score, query) for hit in hits[:limit]]
            groups.append({"type": kind, "label": TYPE_LABELS[kind], "count": len(hits), "items": items})
    # The group holding the single best match comes first; the order inside groups is by relevance.
    groups.sort(key=lambda g: -g["items"][0]["score"])
    return {
        "query": query.raw,
        "terms": list(query.terms),
        "total": sum(counts.values()),
        "counts": counts,
        "groups": groups,
    }
