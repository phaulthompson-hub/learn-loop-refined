"""The single source of "now" for the whole backend.

Every timestamp the app writes or compares goes through `now()`. Setting `FROZEN_NOW`
pins it to one instant, which is what makes the seeded demo (due cards, calendar,
"3 days ago" labels, streaks) render identically on every run.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta

from .config import get_settings


def parse_instant(value: str) -> datetime:
    """Parse an ISO timestamp into a naive UTC datetime (SQLite stores datetimes without a timezone)."""
    parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(UTC).replace(tzinfo=None)
    return parsed


_travel: list[datetime] = []


@contextmanager
def travel(moment: datetime) -> Iterator[None]:
    """Temporarily move "now" to `moment` (used by the seed to replay history on past days, and by tests)."""
    _travel.append(moment)
    try:
        yield
    finally:
        _travel.pop()


def now() -> datetime:
    if _travel:
        return _travel[-1]
    frozen = get_settings().frozen_now
    if frozen:
        return parse_instant(frozen)
    return datetime.now(UTC).replace(tzinfo=None)


def today() -> date:
    return now().date()


def is_frozen() -> bool:
    return bool(get_settings().frozen_now)


def start_of_day(value: datetime) -> datetime:
    return value.replace(hour=0, minute=0, second=0, microsecond=0)


def start_of_week(value: date, week_starts_on: int = 0) -> date:
    """Monday is 0, Sunday is 6 (same numbering as `date.weekday()`)."""
    return value - timedelta(days=(value.weekday() - week_starts_on) % 7)


def days_between(earlier: date, later: date) -> int:
    return (later - earlier).days
