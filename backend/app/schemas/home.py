from datetime import date, datetime

from pydantic import BaseModel

from .activity import ActivityOut


class Greeting(BaseModel):
    first_name: str
    part_of_day: str
    today: date
    now: datetime


class StreakOut(BaseModel):
    current: int
    longest: int
    active_today: bool
    active_days_last_30: int


class DueCards(BaseModel):
    due: int
    new: int
    total: int


class CourseBrief(BaseModel):
    id: int
    title: str
    color: str


class AgendaItem(BaseModel):
    event_id: int
    title: str
    kind: str
    starts_at: datetime
    ends_at: datetime
    all_day: bool
    location: str
    shared: bool
    mine: bool
    recurring: bool
    status: str  # past | now | upcoming
    course: CourseBrief | None


class NextConcept(BaseModel):
    concept_id: int | None
    concept: str | None
    mastery: float | None
    reason: str


class ContinueCourse(BaseModel):
    id: int
    title: str
    subject: str
    color: str
    mastery: float
    concepts: int
    mastered_concepts: int
    progress: float
    accuracy: float
    attempts: int
    pinned: bool
    last_opened_at: datetime | None
    next: NextConcept


class FocusOut(BaseModel):
    course: CourseBrief
    concept_id: int
    concept: str
    mastery: float
    level: str
    reason: str


class TaskItem(BaseModel):
    id: int
    number: int
    key: str
    title: str
    status: str
    priority: str
    due_date: date | None
    overdue: bool
    due_in_days: int | None
    course: CourseBrief | None


class TaskSummary(BaseModel):
    items: list[TaskItem]
    total_open: int
    overdue: int


class GoalItem(BaseModel):
    id: int
    title: str
    kind: str
    period: str
    target: float
    current: float
    percent: float
    status: str
    unit: str
    period_label: str
    course: CourseBrief | None


class Comparison(BaseModel):
    value: float
    previous: float
    change: float
    percent: float | None


class WeekDay(BaseModel):
    date: date
    answers: int
    reviews: int
    minutes: int


class WeekSummary(BaseModel):
    answers: Comparison
    accuracy: Comparison
    reviews: Comparison
    minutes: Comparison
    days: list[WeekDay]


class Onboarding(BaseModel):
    """What exists yet, so a brand-new workspace can show its first steps instead of empty panels."""

    courses: int
    enrolled: int
    decks: int
    events: int
    goals: int
    can_create_courses: bool


class HomeOut(BaseModel):
    greeting: Greeting
    streak: StreakOut
    flashcards: DueCards
    agenda: list[AgendaItem]
    continue_learning: list[ContinueCourse]
    focus: FocusOut | None
    tasks: TaskSummary
    goals: list[GoalItem]
    week: WeekSummary
    activity: list[ActivityOut]
    onboarding: Onboarding
