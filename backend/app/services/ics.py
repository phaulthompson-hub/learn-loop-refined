"""iCalendar (RFC 5545) export for planner events.

Pure functions only: the router turns ORM events into `IcsEvent`s and this module renders
text that Google Calendar, Outlook and Apple Calendar import. The rules that matter:

* lines end with CRLF and are folded at 75 octets (UTF-8 aware), continuation lines start
  with a single space;
* TEXT values escape backslash, semicolon, comma and newlines;
* timed events use UTC (`...Z`) datetimes, all-day events use DATE values with an exclusive
  DTEND;
* recurrence becomes an RRULE; `UNTIL` must have the same value type as DTSTART.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta

PRODUCT_ID = "-//LearnLoop//Planner 2.0//EN"
UID_DOMAIN = "learnloop.app"
MAX_OCTETS = 75

RRULES = {
    "daily": "FREQ=DAILY",
    "weekdays": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    "weekly": "FREQ=WEEKLY",
}


@dataclass(frozen=True)
class IcsEvent:
    uid: str
    title: str
    starts_at: datetime
    ends_at: datetime
    all_day: bool = False
    location: str = ""
    description: str = ""
    category: str = ""
    recurrence: str = "none"
    recurrence_until: date | None = None
    created_at: datetime | None = None


def event_uid(event_id: int, workspace_id: int) -> str:
    """Stable across exports, so re-importing updates events instead of duplicating them."""
    return f"event-{event_id}-ws{workspace_id}@{UID_DOMAIN}"


def escape_text(value: str) -> str:
    """Escape a TEXT property value (RFC 5545 §3.3.11)."""
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\r", "\\n")
        .replace("\n", "\\n")
    )


def fold_line(line: str) -> str:
    """Split a content line into chunks of at most 75 octets without breaking a UTF-8 character."""
    chunks: list[str] = []
    current = ""
    size = 0
    limit = MAX_OCTETS
    for char in line:
        width = len(char.encode("utf-8"))
        if size + width > limit:
            chunks.append(current)
            current, size = "", 0
            limit = MAX_OCTETS - 1  # continuation lines spend one octet on the leading space
        current += char
        size += width
    chunks.append(current)
    return "\r\n ".join(chunks)


def format_datetime(value: datetime) -> str:
    return value.strftime("%Y%m%dT%H%M%SZ")


def format_date(value: date) -> str:
    return value.strftime("%Y%m%d")


def rrule(recurrence: str, until: date | None, all_day: bool) -> str | None:
    base = RRULES.get(recurrence)
    if base is None:
        return None
    if until is None:
        return base
    # UNTIL is inclusive; for timed series the last moment of that UTC day keeps its occurrence.
    limit = format_date(until) if all_day else format_datetime(datetime.combine(until, datetime.max.time()))
    return f"{base};UNTIL={limit}"


def _timing(event: IcsEvent) -> list[str]:
    if event.all_day:
        end = event.ends_at.date()
        if end <= event.starts_at.date():
            end = event.starts_at.date() + timedelta(days=1)
        return [f"DTSTART;VALUE=DATE:{format_date(event.starts_at.date())}", f"DTEND;VALUE=DATE:{format_date(end)}"]
    return [f"DTSTART:{format_datetime(event.starts_at)}", f"DTEND:{format_datetime(event.ends_at)}"]


def event_lines(event: IcsEvent, stamp: datetime) -> list[str]:
    lines = ["BEGIN:VEVENT", f"UID:{event.uid}", f"DTSTAMP:{format_datetime(stamp)}"]
    if event.created_at is not None:
        lines.append(f"CREATED:{format_datetime(event.created_at)}")
    lines += _timing(event)
    rule = rrule(event.recurrence, event.recurrence_until, event.all_day)
    if rule:
        lines.append(f"RRULE:{rule}")
    lines.append(f"SUMMARY:{escape_text(event.title)}")
    if event.location:
        lines.append(f"LOCATION:{escape_text(event.location)}")
    if event.description:
        lines.append(f"DESCRIPTION:{escape_text(event.description)}")
    if event.category:
        lines.append(f"CATEGORIES:{escape_text(event.category.upper())}")
    lines.append("END:VEVENT")
    return lines


def build_calendar(events: Sequence[IcsEvent], *, name: str, stamp: datetime) -> str:
    """A complete VCALENDAR document; `stamp` becomes every DTSTAMP so output is reproducible."""
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{PRODUCT_ID}",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{escape_text(name)}",
        "X-WR-TIMEZONE:UTC",
    ]
    for event in sorted(events, key=lambda e: (e.starts_at, e.uid)):
        lines += event_lines(event, stamp)
    lines.append("END:VCALENDAR")
    return "".join(fold_line(line) + "\r\n" for line in lines)
