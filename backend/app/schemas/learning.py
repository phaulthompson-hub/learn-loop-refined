from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, StrictStr, root_validator, validator

from ..services.listing import split_tags
from .common import Color, Text

Difficulty = Literal["intro", "intermediate", "advanced"]
CourseStatus = Literal["draft", "active", "archived"]


class CourseMeta(BaseModel):
    description: Text(0, 600) = ""
    subject: Text(1, 60) = "General"
    difficulty: Difficulty = "intro"
    tags: list[str] = Field(default_factory=list)
    # New courses start as a draft or go live straight away; archiving only happens later.
    status: Literal["draft", "active"] = "active"
    color: Color | None = None

    @validator("tags", pre=True)
    def normalise_tags(cls, value):
        return split_tags(value)


class CourseCreate(CourseMeta):
    title: Text(2, 160)
    text: Text(80, 200_000)


def _reject_explicit_nulls(model: type[BaseModel], values: dict, allowed: tuple[str, ...] = ()) -> None:
    """PATCH bodies may leave fields out, but an explicit `null` is almost always a client bug.

    Runs on the raw input (a `pre` root validator), because only there sent and omitted fields differ.
    """
    sent = [name for name in values if name in model.__fields__]
    if not sent:
        raise ValueError("Send at least one field to change")
    for name in sent:
        if name not in allowed and values[name] is None:
            raise ValueError(f"{name} cannot be null")


class CourseUpdate(BaseModel):
    title: Text(2, 160) | None = None
    description: Text(0, 600) | None = None
    subject: Text(1, 60) | None = None
    difficulty: Difficulty | None = None
    status: CourseStatus | None = None
    color: Color | None = None
    tags: list[str] | None = None

    @validator("tags", pre=True)
    def normalise_tags(cls, value):
        return None if value is None else split_tags(value)

    @root_validator(pre=True)
    def check_fields(cls, values: dict) -> dict:
        _reject_explicit_nulls(cls, values)
        return values


class SourceCreate(BaseModel):
    name: Text(1, 120) = "pasted-notes.txt"
    text: Text(80, 200_000)


class ConceptUpdate(BaseModel):
    name: Text(2, 120) | None = None
    summary: Text(10, 600) | None = None

    @root_validator(pre=True)
    def check_fields(cls, values: dict) -> dict:
        _reject_explicit_nulls(cls, values)
        return values


class ConceptOrder(BaseModel):
    concept_ids: list[int] = Field(min_items=1, max_items=200)

    @validator("concept_ids")
    def unique_ids(cls, value: list[int]) -> list[int]:
        if len(set(value)) != len(value):
            raise ValueError("must not repeat a concept")
        return value


class CourseDuplicate(BaseModel):
    title: Text(2, 160) | None = None


class ConceptOut(BaseModel):
    id: int
    name: str
    summary: str
    mastery: float
    order_index: int
    prerequisite_id: int | None
    level: str
    unlocked: bool


class SourceOut(BaseModel):
    id: int
    name: str
    characters: int
    words: int
    created_at: datetime


class SourceDetail(BaseModel):
    id: int
    course_id: int
    name: str
    content: str
    characters: int
    words: int
    created_at: datetime


class RecommendationOut(BaseModel):
    concept_id: int | None
    concept: str | None
    mastery: float | None
    reason: str


class CourseSummary(BaseModel):
    id: int
    workspace_id: int
    title: str
    description: str
    subject: str
    difficulty: str
    status: str
    color: str
    tags: list[str]
    owner_id: int | None
    created_at: datetime
    updated_at: datetime
    concepts: int
    mastered_concepts: int
    sources: int
    attempts: int
    accuracy: float
    mastery: float
    learners: int
    enrolled: bool
    pinned: bool
    last_opened_at: datetime | None


class CourseOut(BaseModel):
    id: int
    workspace_id: int
    title: str
    description: str
    subject: str
    difficulty: str
    status: str
    color: str
    tags: list[str]
    owner_id: int | None
    created_at: datetime
    updated_at: datetime
    mastery: float
    mastered_concepts: int
    attempts: int
    accuracy: float
    learners: int
    enrolled: bool
    pinned: bool
    concept_count: int
    source_count: int
    concepts: list[ConceptOut]
    sources: list[SourceOut]
    recommendation: RecommendationOut


class CourseFacets(BaseModel):
    subjects: list[str]
    tags: list[str]
    statuses: dict[str, int]
    difficulties: dict[str, int]


class CoursePage(BaseModel):
    items: list[CourseSummary]
    total: int
    page: int
    page_size: int
    facets: CourseFacets


class Question(BaseModel):
    id: str
    concept_id: int
    concept: str
    prompt: str
    options: list[str]


class AnswerIn(BaseModel):
    question_id: StrictStr = Field(min_length=3, max_length=40)
    concept_id: int
    selected: int = Field(ge=0, le=3)


class AnswerOut(BaseModel):
    correct: bool
    correct_index: int
    concept_id: int
    concept: str
    previous_mastery: float
    mastery: float
    recommendation: RecommendationOut


class AttemptOut(BaseModel):
    id: int
    concept_id: int
    concept_name: str
    correct: bool
    mastery_before: float
    mastery_after: float
    created_at: datetime

    class Config:
        orm_mode = True


class TutorIn(BaseModel):
    message: Text(2, 2000)


class TutorOut(BaseModel):
    answer: str
    citations: list[str]
    follow_up: str
    mode: str


