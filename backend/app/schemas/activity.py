from datetime import datetime

from pydantic import BaseModel


class PersonBrief(BaseModel):
    """A person as shown next to a feed entry: enough for an avatar and a name."""

    id: int
    name: str
    avatar_color: str

    class Config:
        orm_mode = True


class ActivityOut(BaseModel):
    id: int
    workspace_id: int
    actor: PersonBrief | None
    verb: str
    object_type: str
    object_id: int | None
    summary: str
    link: str
    detail: str
    created_at: datetime

    class Config:
        orm_mode = True


class ActivityFacets(BaseModel):
    actors: list[PersonBrief]
    object_types: list[str]


class ActivityPage(BaseModel):
    """A cursor page of the feed: pass `next_before_id` as `before_id` to load older entries."""

    items: list[ActivityOut]
    total: int
    has_more: bool
    next_before_id: int | None
    facets: ActivityFacets
