from datetime import date, datetime

from pydantic import BaseModel

from .home import Comparison, CourseBrief


class RangeOut(BaseModel):
    days: int
    start: date
    end: date
    previous_start: date
    previous_end: date
    course_id: int | None


class Kpis(BaseModel):
    answers: Comparison
    accuracy: Comparison
    reviews: Comparison
    retention: Comparison
    minutes: Comparison
    mastery: Comparison
    mastered_concepts: Comparison
    active_days: Comparison


class DailyPoint(BaseModel):
    date: date
    correct: int
    incorrect: int
    reviews: int
    minutes: int
    mastery: float


class CourseBreakdown(BaseModel):
    id: int
    title: str
    color: str
    concepts: int
    mastered_concepts: int
    mastery: float
    mastery_change: float
    attempts: int
    accuracy: float
    reviews: int
    minutes: int


class ConceptRow(BaseModel):
    id: int
    name: str
    course: CourseBrief
    attempts: int
    correct: int
    accuracy: float
    mastery: float
    level: str
    unlocked: bool
    last_practiced: datetime | None


class ForecastDay(BaseModel):
    date: date
    count: int


class FlashcardStats(BaseModel):
    reviews: int
    retention: float | None
    grades: dict[str, int]
    due_now: int
    forecast: list[ForecastDay]


class TimeSlice(BaseModel):
    key: str
    label: str
    minutes: int
    color: str | None = None


class TimeBreakdown(BaseModel):
    total: int
    by_course: list[TimeSlice]
    by_activity: list[TimeSlice]


class LeaderboardRow(BaseModel):
    rank: int
    user_id: int
    name: str
    avatar_color: str
    answers: int
    correct: int
    accuracy: float
    is_me: bool


class AnalyticsOut(BaseModel):
    range: RangeOut
    courses_in_scope: list[CourseBrief]
    kpis: Kpis
    daily: list[DailyPoint]
    courses: list[CourseBreakdown]
    concepts: list[ConceptRow]
    weakest: list[ConceptRow]
    flashcards: FlashcardStats
    time: TimeBreakdown
    leaderboard: list[LeaderboardRow]
    can_view_learners: bool


class LearnerCell(BaseModel):
    course_id: int
    enrolled: bool
    mastery: float | None
    mastered_concepts: int


class LearnerRow(BaseModel):
    user_id: int
    name: str
    avatar_color: str
    role: str
    answers: int
    accuracy: float
    last_active: datetime | None
    average_mastery: float | None
    cells: list[LearnerCell]


class LearnersOut(BaseModel):
    days: int
    courses: list[CourseBrief]
    learners: list[LearnerRow]
