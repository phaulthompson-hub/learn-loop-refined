from datetime import datetime
from typing import Literal

from pydantic import BaseModel

SearchType = Literal["course", "concept", "note", "task", "card", "event"]

# Highlight ranges are [start, end) character offsets into the string they accompany.
Range = tuple[int, int]


class Snippet(BaseModel):
    text: str
    highlights: list[Range]

    class Config:
        orm_mode = True


class SearchHit(BaseModel):
    type: SearchType
    id: int
    title: str
    title_highlights: list[Range]
    subtitle: str
    snippet: Snippet | None
    link: str
    score: float
    updated_at: datetime | None


class SearchGroup(BaseModel):
    type: SearchType
    label: str
    count: int
    items: list[SearchHit]


class SearchOut(BaseModel):
    query: str
    terms: list[str]
    total: int
    counts: dict[str, int]
    groups: list[SearchGroup]
