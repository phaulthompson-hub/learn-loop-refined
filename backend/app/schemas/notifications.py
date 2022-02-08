from datetime import datetime

from pydantic import BaseModel

from .activity import PersonBrief


class NotificationWorkspace(BaseModel):
    id: int
    name: str
    color: str

    class Config:
        orm_mode = True


class NotificationOut(BaseModel):
    id: int
    kind: str
    title: str
    body: str
    link: str
    created_at: datetime
    read_at: datetime | None
    read: bool
    actor: PersonBrief | None
    workspace: NotificationWorkspace | None


class NotificationPage(BaseModel):
    """A cursor page of the user's notifications (newest first) plus live counters for badges."""

    items: list[NotificationOut]
    total: int
    unread: int
    has_more: bool
    next_before_id: int | None
    kinds: dict[str, int]


class NotificationUpdate(BaseModel):
    read: bool


class UnreadCount(BaseModel):
    unread: int


class BulkResult(BaseModel):
    """How many notifications a bulk action changed, and the user's unread count afterwards."""

    changed: int
    unread: int
