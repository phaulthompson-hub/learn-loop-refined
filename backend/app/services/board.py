"""Study-board rules: task keys, due states, filters, mentions and response payloads.

The functions at the top are pure (no database) and unit-tested directly; the ones below
them turn ORM rows into the dictionaries the board API returns.
"""

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import clock
from ..models import TASK_PRIORITIES, TASK_STATUSES, Course, Label, Membership, Task, TaskComment, User, task_labels
from .listing import matches

COLUMN_TITLES = {
    "backlog": "Backlog",
    "todo": "To do",
    "in_progress": "In progress",
    "review": "Review",
    "done": "Done",
}
# Work-in-progress limits: columns that should stay short so work actually finishes.
WIP_LIMITS = {"in_progress": 6, "review": 4}
STATUS_RANK = {status: rank for rank, status in enumerate(TASK_STATUSES)}
PRIORITY_RANK = {priority: rank for rank, priority in enumerate(TASK_PRIORITIES)}
# Due within this many days (and not overdue/today) counts as "soon".
SOON_DAYS = 3
STOP_WORDS = {"and", "of", "the", "for", "a", "an", "to", "in", "on"}


# ---------- Pure rules ----------


def workspace_prefix(name: str) -> str:
    """Short, stable prefix for task keys: initials of the name's words ("Northwind Data Academy" -> "NDA").

    Numbers and small words are skipped; a single-word name uses its first two letters ("Physics" -> "PH").
    """
    words = [w for w in re.findall(r"[A-Za-z]+", name) if w.lower() not in STOP_WORDS]
    if not words:
        return "LL"
    if len(words) == 1:
        return words[0][:2].upper()
    return "".join(w[0] for w in words[:3]).upper()


def task_key(prefix: str, number: int) -> str:
    return f"{prefix}-{number}"


def is_overdue(due: date | None, status: str, today: date) -> bool:
    return due is not None and status != "done" and due < today


def due_state(due: date | None, status: str, today: date) -> str:
    """Classify a due date: none | done | overdue | today | soon | later."""
    if due is None:
        return "none"
    if status == "done":
        return "done"
    if due < today:
        return "overdue"
    if due == today:
        return "today"
    if (due - today).days <= SOON_DAYS:
        return "soon"
    return "later"


def matches_due(due: date | None, status: str, wanted: str, today: date) -> bool:
    """The `due=` list filter: overdue, today, week (this Monday-to-Sunday week, still open) or none."""
    if wanted == "none":
        return due is None
    if due is None:
        return False
    if wanted == "overdue":
        return is_overdue(due, status, today)
    if wanted == "today":
        return due == today
    week_start = clock.start_of_week(today)
    return status != "done" and week_start <= due <= week_start + timedelta(days=6)


def mention_pattern(token: str) -> re.Pattern[str]:
    """`@token` not preceded by a word character and not followed by one (so "@Sam" misses "@Samira")."""
    return re.compile(rf"(?<![\w@])@{re.escape(token)}(?!\w)", re.IGNORECASE)


def mentioned_ids(body: str, people: Iterable[tuple[int, str]]) -> list[int]:
    """Ids of people mentioned in `body` as `@Full Name` or `@First`, in order of first mention.

    A first name only counts when it is unique among `people`; otherwise the full name is required.
    """
    people = list(people)
    first_names: dict[str, int] = {}
    for _, name in people:
        first = name.split()[0].lower() if name.split() else ""
        first_names[first] = first_names.get(first, 0) + 1
    found: list[tuple[int, int]] = []
    for person_id, name in people:
        tokens = [name.strip()]
        first = name.split()[0] if name.split() else ""
        if first and first_names[first.lower()] == 1 and first != name.strip():
            tokens.append(first)
        hits = [m.start() for token in tokens for m in mention_pattern(token).finditer(body)]
        if hits:
            found.append((min(hits), person_id))
    return [person_id for _, person_id in sorted(found)]


def column_points(estimates: Iterable[int | None]) -> int:
    return sum(e or 0 for e in estimates)


def over_wip_limit(status: str, count: int) -> bool:
    limit = WIP_LIMITS.get(status)
    return limit is not None and count > limit


