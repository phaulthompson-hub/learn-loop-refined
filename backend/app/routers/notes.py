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


def backlinks_for(note: Note, candidates: list[Note]) -> list[tuple[Note, wikilinks.WikiLink]]:
    """Other notes that link to `note`, each with its first link to it."""
    found = []
    for other in candidates:
        if other.id == note.id:
            continue
        links = wikilinks.links_to(other.body, note.title)
        if links:
            found.append((other, links[0]))
    return found


def detail_payload(db: Session, note: Note, user: User) -> dict:
    readable = visible_notes(db, note.workspace_id, user.id)
    index = link_index(readable, user.id)
    links = [
        {
            "target": link.target,
            "label": link.label,
            "heading": link.heading,
            "note_id": note_id,
            "resolved": note_id is not None,
        }
        for link, note_id in wikilinks.resolve_links(note.body, index)
    ]
    return {
        **summary_payload(note, Refs.load(db, [note]), user.id),
        "body": note.body,
        "links": links,
        "backlinks": len(backlinks_for(note, readable)),
        "can_edit": note.user_id == user.id,
    }


# ---------- Validation helpers ----------


def check_placement(
    db: Session, access: Access, course_id: int | None, concept_id: int | None
) -> tuple[int | None, int | None]:
    """Validate the course/concept a note is filed under. A concept on its own implies its course."""
    if concept_id is not None:
        concept = db.get(Concept, concept_id)
        if concept is None:
            raise HTTPException(422, "That concept does not exist")
        if course_id is None:
            course_id = concept.course_id
        elif concept.course_id != course_id:
            raise HTTPException(422, "The concept does not belong to the selected course")
    if course_id is not None:
        course = db.get(Course, course_id)
        hidden_draft = (
            course is not None
            and course.status == "draft"
            and not access.can("instructor")
            and course.owner_id != access.user.id
        )
        if course is None or course.workspace_id != access.workspace.id or hidden_draft:
            raise HTTPException(422, "The course is not part of this workspace")
    return course_id, concept_id


def ensure_unique_title(
    db: Session, workspace_id: int, user_id: int, title: str, exclude_id: int | None = None
) -> None:
    """Titles are unique per author and workspace, so `[[Title]]` links stay unambiguous."""
    key = wikilinks.normalise_title(title)
    own = db.scalars(select(Note).where(Note.workspace_id == workspace_id, Note.user_id == user_id))
    if any(n.id != exclude_id and wikilinks.normalise_title(n.title) == key for n in own):
        raise HTTPException(409, f"You already have a note called “{title}”")


def copy_title(title: str, taken: set[str]) -> str:
    """Pick "Joins (copy)", then "Joins (copy 2)"…, trimmed so the suffix always fits the title column."""
    for n in range(1, 1000):
        suffix = " (copy)" if n == 1 else f" (copy {n})"
        candidate = title[: TITLE_MAX - len(suffix)].rstrip() + suffix
        if wikilinks.normalise_title(candidate) not in taken:
            return candidate
    raise HTTPException(409, "Too many copies of this note")


def record_shared(db: Session, note: Note, user: User) -> None:
    record(
        db,
        workspace_id=note.workspace_id,
        actor_id=user.id,
        verb="note.shared",
        object_type="note",
        object_id=note.id,
        summary=f"shared the note {note.title}",
        link=f"/notes/{note.id}",
    )


def relink_own_notes(db: Session, note: Note, old_title: str) -> int:
    """After a rename, point the author's other `[[Old title]]` links at the new title."""
    changed = 0
    own = db.scalars(select(Note).where(Note.workspace_id == note.workspace_id, Note.user_id == note.user_id))
    for other in own:
        if other.id == note.id:
            continue
        body, count = wikilinks.rename_links(other.body, old_title, note.title)
        if count:
            # Rewriting links is bookkeeping rather than an edit, so `updated_at` is left alone.
            other.body = body
            changed += count
    return changed


# ---------- Collection routes ----------


@router.get("/api/workspaces/{workspace_id}/notes", response_model=NotePage)
def list_notes(
    access: Access = Depends(workspace_access),
    db: Session = Depends(get_db),
    q: str | None = Query(None, max_length=100),
    course_id: int | None = None,
    concept_id: int | None = None,
    tag: str | None = Query(None, max_length=40),
    pinned: bool | None = None,
    archived: bool = False,
    author: Literal["me", "others"] | None = None,
    sort: str | None = Query(None, max_length=30),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    user_id = access.user.id
    query = search.parse_query(q)
    field, descending = parse_sort(sort, SORTS, "-relevance" if query else "-updated_at")
    if field == "relevance" and not query:
        field, descending = "updated_at", True
    notes = visible_notes(db, access.workspace.id, user_id, archived=None)
    counts = {
        "mine": sum(1 for n in notes if n.user_id == user_id and not n.archived),
        "shared": sum(1 for n in notes if n.user_id != user_id),
        "archived": sum(1 for n in notes if n.user_id == user_id and n.archived),
    }
    wanted_tag = tag.strip().lower().lstrip("#") if tag else None
    filtered = [
        n
        for n in notes
        if n.archived == archived
        and (author is None or (n.user_id == user_id) == (author == "me"))
        and (course_id is None or n.course_id == course_id)
        and (concept_id is None or n.concept_id == concept_id)
        and (pinned is None or n.pinned == pinned)
        and (wanted_tag is None or wanted_tag in n.tag_list)
    ]
    if query:
        hits = search.rank(
            query,
            filtered,
            title=lambda n: n.title,
            fields=lambda n: (search.strip_markdown(n.body), " ".join(n.tag_list)),
            recency=lambda n: n.updated_at,
        )
        filtered = [hit.item for hit in hits]
    if field != "relevance":
        key = (lambda n: n.title.casefold()) if field == "title" else (lambda n: getattr(n, field))
        filtered = sort_items(filtered, key, descending)
        # Pinned notes lead the list, keeping the chosen order inside each group.
        filtered = [n for n in filtered if n.pinned] + [n for n in filtered if not n.pinned]
    result = paginate(filtered, page, page_size)
    refs = Refs.load(db, result["items"])
    result["items"] = [summary_payload(n, refs, user_id, query or None) for n in result["items"]]
    return {**result, "counts": counts}


