"""Calendar events (with recurrence) for the planner.

Visibility: a member sees their own events plus every shared event of the workspace. Only the
owner edits an event; admins may also edit or delete shared ones. Shared exams and live sessions
announce themselves to the workspace, so creating them needs the instructor role.
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import ValidationError
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import clock
from ..database import get_db
from ..deps import Access, access_for, current_user, get_or_404, workspace_access
from ..models import Course, Event, Membership, User
from ..schemas.common import error_loc
from ..schemas.planner import (
    AgendaOut,
    ConflictOut,
    EventIn,
    EventOut,
    EventPatch,
    EventSaved,
    OccurrencePage,
    naive_utc,
)
from ..services.events import notify, record
from ..services.ics import IcsEvent, build_calendar, event_uid
from ..services.recurrence import find_conflicts, occurrences

router = APIRouter(tags=["planner"])

MAX_RANGE = timedelta(days=124)  # a 6-week month grid with room to spare
ANNOUNCED_KINDS = ("exam", "live")
KIND_LABELS = {
    "study": "study session",
    "review": "review block",
    "exam": "exam",
    "deadline": "deadline",
    "live": "live session",
}


# ---------- Helpers ----------


def validation_detail(exc: ValidationError) -> list[dict]:
    """JSON-safe version of a pydantic error list, shaped like FastAPI's own 422 responses."""
    return [{"loc": error_loc(error["loc"]), "msg": error["msg"]} for error in exc.errors()]


def can_edit(event: Event, access: Access) -> bool:
    return event.user_id == access.user.id or (event.shared and access.can("admin"))


def visible_events(db: Session, access: Access) -> list[Event]:
    query = (
        select(Event)
        .where(Event.workspace_id == access.workspace.id, or_(Event.user_id == access.user.id, Event.shared.is_(True)))
        .order_by(Event.starts_at, Event.id)
    )
    return list(db.scalars(query))


def event_payload(event: Event, access: Access, people: dict[int, User], courses: dict[int, Course]) -> dict:
    owner = people.get(event.user_id)
    course = courses.get(event.course_id) if event.course_id else None
    return {
        "id": event.id,
        "workspace_id": event.workspace_id,
        "title": event.title,
        "kind": event.kind,
        "course": {"id": course.id, "title": course.title, "color": course.color} if course else None,
        "owner": {"id": owner.id, "name": owner.name, "avatar_color": owner.avatar_color}
        if owner
        else {"id": event.user_id, "name": "Former member", "avatar_color": "#9aa59f"},
        "starts_at": event.starts_at,
        "ends_at": event.ends_at,
        "all_day": event.all_day,
        "location": event.location,
        "notes": event.notes,
        "recurrence": event.recurrence,
        "recurrence_until": event.recurrence_until,
        "shared": event.shared,
        "created_at": event.created_at,
        "can_edit": can_edit(event, access),
    }


class Payloads:
    """Builds event payloads with owners and courses loaded once per request."""

    def __init__(self, db: Session, access: Access, events: list[Event]):
        self.access = access
        user_ids = {e.user_id for e in events}
        course_ids = {e.course_id for e in events if e.course_id}
        self.people = {u.id: u for u in db.scalars(select(User).where(User.id.in_(user_ids)))}
        self.courses = {c.id: c for c in db.scalars(select(Course).where(Course.id.in_(course_ids)))}
        self.cache: dict[int, dict] = {}

    def event(self, event: Event) -> dict:
        if event.id not in self.cache:
            self.cache[event.id] = event_payload(event, self.access, self.people, self.courses)
        return self.cache[event.id]


def parse_kinds(kind: str | None) -> set[str] | None:
    if not kind:
        return None
    kinds = {k.strip() for k in kind.split(",") if k.strip()}
    unknown = kinds - set(KIND_LABELS)
    if unknown:
        raise HTTPException(422, f"Unknown event kind: {', '.join(sorted(unknown))}")
    return kinds


def filter_events(
    events: list[Event],
    user_id: int,
    kinds: set[str] | None,
    course_id: int | None,
    mine: bool | None,
    shared: bool | None,
) -> list[Event]:
    return [
        e
        for e in events
        if (kinds is None or e.kind in kinds)
        and (course_id is None or e.course_id == course_id)
        and (mine is None or (e.user_id == user_id) == mine)
        and (shared is None or e.shared == shared)
    ]


def expand(events: list[Event], payloads: Payloads, start: datetime, end: datetime) -> list[dict]:
    items = [
        {
            "key": f"{event.id}:{occurrence.index}",
            "index": occurrence.index,
            "starts_at": occurrence.starts_at,
            "ends_at": occurrence.ends_at,
            "event": payloads.event(event),
        }
        for event in events
        for occurrence in occurrences(event, start, end)
    ]
    # All-day items lead each day, then chronological, then by title for stable output.
    items.sort(key=lambda o: (o["starts_at"], not o["event"]["all_day"], o["event"]["title"].lower(), o["key"]))
    return items


def check_course(db: Session, course_id: int | None, workspace_id: int) -> None:
    if course_id is None:
        return
    course = db.get(Course, course_id)
    if course is None or course.workspace_id != workspace_id:
        raise HTTPException(422, "Choose a course from this workspace")


def check_sharing(data: EventIn, access: Access) -> None:
    if data.shared and data.kind in ANNOUNCED_KINDS and not access.can("instructor"):
        raise HTTPException(403, f"Only instructors can share a {KIND_LABELS[data.kind]} with the workspace")


def conflicts_for(db: Session, candidate: Event, access: Access) -> list[dict]:
    others = [(e.id, e) for e in visible_events(db, access) if e.id != candidate.id]
    by_id = dict(others)
    return [
        {
            "event_id": c.key,
            "title": by_id[c.key].title,
            "kind": by_id[c.key].kind,
            "starts_at": c.occurrence.starts_at,
            "ends_at": c.occurrence.ends_at,
            "index": c.occurrence.index,
        }
        for c in find_conflicts(candidate, others)
    ]


def when_text(event: Event) -> str:
    if event.all_day:
        return f"{event.starts_at:%a} {event.starts_at.day} {event.starts_at:%b} (all day)"
    return f"{event.starts_at:%a} {event.starts_at.day} {event.starts_at:%b}, {event.starts_at:%H:%M} UTC"


def planner_link(event: Event) -> str:
    return f"/planner?date={event.starts_at.date().isoformat()}&event={event.id}"


def announce(db: Session, event: Event, actor: User, headline: str) -> None:
    """Notify every other workspace member about a shared exam or live session."""
    member_ids = db.scalars(select(Membership.user_id).where(Membership.workspace_id == event.workspace_id))
    for member_id in member_ids:
        notify(
            db,
            user_id=member_id,
            workspace_id=event.workspace_id,
            actor_id=actor.id,
            kind="event",
            title=f"{headline}: {event.title}",
            body=f"{actor.name} scheduled it for {when_text(event)}."
            + (f" Location: {event.location}." if event.location else ""),
            link=planner_link(event),
        )


def publish(db: Session, event: Event, actor: User) -> None:
    """Side effects of an event becoming visible to the workspace (created shared, or shared later)."""
    record(
        db,
        workspace_id=event.workspace_id,
        actor_id=actor.id,
        verb="event.created",
        object_type="event",
        object_id=event.id,
        summary=f"scheduled the {KIND_LABELS[event.kind]} {event.title}",
        link=planner_link(event),
        detail=when_text(event),
    )
    if event.kind in ANNOUNCED_KINDS:
        announce(db, event, actor, f"New {KIND_LABELS[event.kind]}")


def saved_payload(db: Session, event: Event, access: Access) -> dict:
    return {"event": Payloads(db, access, [event]).event(event), "conflicts": conflicts_for(db, event, access)}


def event_access(db: Session, user: User, event_id: int) -> tuple[Event, Access]:
    event = get_or_404(db, Event, event_id, "Event")
    access = access_for(db, user, event.workspace_id)
    if event.user_id != user.id and not event.shared:
        raise HTTPException(404, "Event not found")
    return event, access


def require_editor(event: Event, access: Access) -> None:
    if not can_edit(event, access):
        raise HTTPException(403, "Only the organiser or a workspace admin can change this event")


def parse_window(start: datetime | None, end: datetime | None) -> tuple[datetime, datetime]:
    begin = naive_utc(start) if start is not None else datetime.combine(clock.today(), datetime.min.time())
    finish = naive_utc(end) if end is not None else begin + timedelta(days=7)
    if finish <= begin:
        raise HTTPException(422, "The end of the range must be after its start")
    if finish - begin > MAX_RANGE:
        raise HTTPException(422, "Ask for at most 124 days of events at a time")
    return begin, finish


# ---------- Collection routes ----------


