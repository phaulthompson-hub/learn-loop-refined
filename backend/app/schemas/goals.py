"""Goals, study-time logs and streak payloads, with the per-kind goal rules.

The frontend mirrors these rules in `features/planner/goalForm.ts`; keep the limits in sync.
"""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, StrictStr, root_validator, validator

from .common import Text
from .planner import CourseRef, naive_utc

GoalKind = Literal["daily_answers", "weekly_reviews", "study_minutes", "course_mastery"]
GoalPeriod = Literal["day", "week", "once"]
GoalStatus = Literal["on_track", "at_risk", "done", "overdue"]
StudyActivity = Literal["quiz", "flashcards", "reading", "manual"]

# kind -> periods it may use
ALLOWED_PERIODS: dict[str, tuple[str, ...]] = {
    "daily_answers": ("day",),
    "weekly_reviews": ("week",),
    "study_minutes": ("day", "week"),
    "course_mastery": ("once",),
}
# (kind, period) -> inclusive target range
TARGET_LIMITS: dict[tuple[str, str], tuple[int, int]] = {
    ("daily_answers", "day"): (1, 200),
    ("weekly_reviews", "week"): (1, 2000),
    ("study_minutes", "day"): (5, 600),
    ("study_minutes", "week"): (15, 4200),
    ("course_mastery", "once"): (1, 100),
}
MAX_ACTIVE_GOALS = 12
MAX_LOG_MINUTES = 600
MINUTES_PER_DAY = 24 * 60
LOG_HISTORY_DAYS = 90


class GoalIn(BaseModel):
    title: Text(2, 120)
    kind: GoalKind
    period: GoalPeriod | None = None  # defaults to the kind's natural period
    target: float
    course_id: int | None = None
    due_date: date | None = None

    @root_validator(skip_on_failure=True)
    def check_rules(cls, values: dict) -> dict:
        kind, period, target = values["kind"], values["period"], values["target"]
        allowed = ALLOWED_PERIODS[kind]
        if period is None:
            period = values["period"] = allowed[0]
        if period not in allowed:
            raise ValueError(f"A {kind.replace('_', ' ')} goal must use the period: {' or '.join(allowed)}")
        low, high = TARGET_LIMITS[(kind, period)]
        if not low <= target <= high:
            raise ValueError(f"The target must be between {low} and {high}")
        if kind != "course_mastery" and target != int(target):
            raise ValueError("The target must be a whole number")
        if kind == "course_mastery" and values["course_id"] is None:
            raise ValueError("Choose the course this mastery goal is for")
        if period != "once" and values["due_date"] is not None:
            raise ValueError("Only one-off goals have a due date")
        return values


class GoalPatch(BaseModel):
    title: StrictStr | None = None
    kind: GoalKind | None = None
    period: GoalPeriod | None = None
    target: float | None = None
    course_id: int | None = None
    due_date: date | None = None


class GoalProgressOut(BaseModel):
    current: float
    target: float
    percent: int
    remaining: float
    expected: float
    status: GoalStatus
    unit: str
    period_label: str
    period_start: datetime
    period_end: datetime | None
    days_left: int | None


class GoalOut(BaseModel):
    id: int
    workspace_id: int
    title: str
    kind: str
    period: str
    target: float
    course: CourseRef | None
    due_date: date | None
    archived: bool
    created_at: datetime
    progress: GoalProgressOut


class GoalList(BaseModel):
    items: list[GoalOut]
    total: int
    counts: dict[str, int]


class StudyLogIn(BaseModel):
    minutes: int = Field(ge=1, le=MAX_LOG_MINUTES)
    activity: StudyActivity = "manual"
    note: Text(0, 255) = ""
    course_id: int | None = None
    logged_at: datetime | None = None  # defaults to now

    @validator("logged_at")
    def to_naive_utc(cls, value: datetime | None) -> datetime | None:
        return None if value is None else naive_utc(value)


