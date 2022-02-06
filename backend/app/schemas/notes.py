import re
from collections.abc import Sequence
from datetime import datetime

from pydantic import BaseModel, Field, StrictStr, validator

from .common import Text
from .search import Snippet

BODY_MAX = 50_000
TAG_MAX = 24
MAX_TAGS = 10  # 10 tags of 24 characters plus commas fit the 255-character column

_TAG_JUNK = re.compile(r"[^\w-]+")


def normalise_tag(raw: str) -> str:
    """Turn "#Machine Learning " into "machine-learning": lower case, spaces become dashes, punctuation dropped."""
    tag = "-".join(str(raw).strip().lstrip("#").lower().split())
    return re.sub(r"-{2,}", "-", _TAG_JUNK.sub("", tag)).strip("-_")


def normalise_tags(value: str | Sequence[str] | None) -> list[str]:
    """Split, normalise and de-duplicate tags, rejecting (not truncating) ones that are too long or too many."""
    if value is None:
        return []
    parts = value.split(",") if isinstance(value, str) else value
    tags: list[str] = []
    for part in parts:
        tag = normalise_tag(part)
        if not tag or tag in tags:
            continue
        if len(tag) > TAG_MAX:
            raise ValueError(f"tag '{tag[:TAG_MAX]}…' is longer than {TAG_MAX} characters")
        tags.append(tag)
    if len(tags) > MAX_TAGS:
        raise ValueError(f"a note can have at most {MAX_TAGS} tags")
    return tags


class NoteCreate(BaseModel):
    title: Text(1, 160)
    body: StrictStr = Field("", max_length=BODY_MAX)
    tags: list[str] = Field(default_factory=list)
    course_id: int | None = None
    concept_id: int | None = None
    shared: bool = False
    pinned: bool = False

    @validator("tags", pre=True)
    def check_tags(cls, value):
        return normalise_tags(value)


class NoteUpdate(BaseModel):
    """Partial update. Sending `course_id: null` detaches the note from its course (and concept)."""

    title: Text(1, 160) | None = None
    body: StrictStr | None = Field(None, max_length=BODY_MAX)
    tags: list[str] | None = None
    course_id: int | None = None
    concept_id: int | None = None
    shared: bool | None = None

    @validator("tags", pre=True)
    def check_tags(cls, value):
        return None if value is None else normalise_tags(value)


class Person(BaseModel):
    id: int
    name: str
    email: str
    avatar_color: str

    class Config:
        orm_mode = True


class CourseRef(BaseModel):
    id: int
    title: str
    color: str


class ConceptRef(BaseModel):
    id: int
    name: str


class NoteSummary(BaseModel):
    id: int
    workspace_id: int
    title: str
    excerpt: Snippet
    tags: list[str]
    pinned: bool
    archived: bool
    shared: bool
    mine: bool
    author: Person
    course: CourseRef | None
    concept: ConceptRef | None
    words: int
    created_at: datetime
    updated_at: datetime


class NoteCounts(BaseModel):
    mine: int
    shared: int
    archived: int


class NotePage(BaseModel):
    items: list[NoteSummary]
    total: int
    page: int
    page_size: int
    counts: NoteCounts


class NoteLink(BaseModel):
    target: str
    label: str
    heading: str | None
    note_id: int | None
    resolved: bool


class NoteOut(NoteSummary):
    body: str
    links: list[NoteLink]
    backlinks: int
    can_edit: bool


class Backlink(BaseModel):
    id: int
    title: str
    mine: bool
    author: Person
    updated_at: datetime
    context: Snippet


class TagCount(BaseModel):
    tag: str
    count: int


class NoteTitle(BaseModel):
    id: int
    title: str
    mine: bool
    updated_at: datetime
