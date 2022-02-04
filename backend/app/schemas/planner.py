"""Planner request/response models and the calendar validation rules.

The frontend mirrors these rules in `features/planner/eventForm.ts`; keep the limits in sync.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, StrictStr, root_validator, validator

from .common import Text

EventKind = Literal["study", "review", "exam", "deadline", "live"]
Recurrence = Literal["none", "daily", "weekdays", "weekly"]

MAX_TIMED_DURATION = timedelta(hours=12)
MAX_ALL_DAY_SPAN = timedelta(days=14)
MAX_SERIES_LENGTH = timedelta(days=366)
DAY = timedelta(days=1)


def naive_utc(value: datetime) -> datetime:
    """Store datetimes as naive UTC with whole minutes (the calendar's resolution)."""
    if value.tzinfo is not None:
        value = value.astimezone(UTC).replace(tzinfo=None)
    return value.replace(second=0, microsecond=0)


def midnight(value: datetime) -> datetime:
    return value.replace(hour=0, minute=0, second=0, microsecond=0)


def ceil_to_midnight(value: datetime) -> datetime:
    """Round up to the next midnight, leaving exact midnights alone (so the rule is idempotent)."""
    floor = midnight(value)
    return floor if floor == value else floor + DAY


class EventIn(BaseModel):
    """A complete event. Updates merge the stored event with the patch and re-validate this model."""

    title: Text(2, 160)
    kind: EventKind = "study"
    course_id: int | None = None
    starts_at: datetime
    ends_at: datetime | None = None
    all_day: bool = False
    location: Text(0, 160) = ""
    notes: Text(0, 2000) = ""
    recurrence: Recurrence = "none"
    recurrence_until: date | None = None
    shared: bool = False

    @validator("starts_at", "ends_at")
    def to_naive_utc(cls, value: datetime | None) -> datetime | None:
        return None if value is None else naive_utc(value)

    @root_validator(skip_on_failure=True)
    def check_timing(cls, values: dict) -> dict:
        if values["all_day"]:
            _normalise_all_day(values)
        else:
            _check_timed(values)
        _check_recurrence(values)
        return values


def _normalise_all_day(values: dict) -> None:
    # All-day events run from midnight to the midnight after their last day (exclusive end).
    starts_at = values["starts_at"] = midnight(values["starts_at"])
    end = ceil_to_midnight(values["ends_at"]) if values["ends_at"] is not None else starts_at + DAY
    if end < starts_at:
        raise ValueError("The last day cannot be before the first day")
    ends_at = values["ends_at"] = max(end, starts_at + DAY)
    if ends_at - starts_at > MAX_ALL_DAY_SPAN:
        raise ValueError("All-day events can span at most 14 days")


def _check_timed(values: dict) -> None:
    starts_at, ends_at = values["starts_at"], values["ends_at"]
    if ends_at is None:
        raise ValueError("Choose an end time")
    if ends_at <= starts_at:
        raise ValueError("The end time must be after the start time")
    if ends_at - starts_at > MAX_TIMED_DURATION:
        raise ValueError("Events can last at most 12 hours; use an all-day event for longer blocks")


def _check_recurrence(values: dict) -> None:
    if values["recurrence"] == "none":
        values["recurrence_until"] = None
        return
    starts_at, ends_at, until = values["starts_at"], values["ends_at"], values["recurrence_until"]
    if values["all_day"] and ends_at - starts_at > DAY:
        raise ValueError("Only single-day all-day events can repeat")
    if values["recurrence"] == "weekdays" and starts_at.weekday() >= 5:
        raise ValueError("A weekday series must start on a weekday (Monday to Friday)")
    if until is not None:
        first_day = starts_at.date()
        if until < first_day:
            raise ValueError("The repeat end date must be on or after the first day")
        if until - first_day > MAX_SERIES_LENGTH:
            raise ValueError("A series can repeat for at most one year")


class EventPatch(BaseModel):
    """Partial update; omitted fields keep their stored value."""

    title: StrictStr | None = None
    kind: EventKind | None = None
    course_id: int | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    all_day: bool | None = None
    location: StrictStr | None = None
    notes: StrictStr | None = None
    recurrence: Recurrence | None = None
    recurrence_until: date | None = None
    shared: bool | None = None


class PersonOut(BaseModel):
    id: int
    name: str
    avatar_color: str


class CourseRef(BaseModel):
    id: int
    title: str
    color: str


class EventOut(BaseModel):
    id: int
    workspace_id: int
    title: str
    kind: str
    course: CourseRef | None
    owner: PersonOut
    starts_at: datetime
    ends_at: datetime
    all_day: bool
    location: str
    notes: str
    recurrence: str
    recurrence_until: date | None
    shared: bool
    created_at: datetime
    can_edit: bool


class OccurrenceOut(BaseModel):
    key: str  # "<event id>:<occurrence index>", unique within a response
    index: int
    starts_at: datetime
    ends_at: datetime
    event: EventOut


class ConflictOut(BaseModel):
    event_id: int
    title: str
    kind: str
    starts_at: datetime
    ends_at: datetime
    index: int


class EventSaved(BaseModel):
    event: EventOut
    conflicts: list[ConflictOut]


class OccurrencePage(BaseModel):
    items: list[OccurrenceOut]
    total: int
    start: datetime
    end: datetime


class AgendaDay(BaseModel):
    date: date
    items: list[OccurrenceOut]


class AgendaOut(BaseModel):
    start: date
    days: list[AgendaDay]
    total: int
