"""Request/response models for workspaces, members and invitations."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, StrictStr

from .auth import MeOut
from .common import Color, Page, Text

Role = Literal["learner", "instructor", "admin", "owner"]
InvitationStatus = Literal["pending", "accepted", "revoked", "expired"]


# ---------- Workspaces ----------


class WorkspaceCreate(BaseModel):
    name: Text(2, 80)
    description: Text(0, 500) = ""
    color: Color = "#1d6d45"


class WorkspaceUpdate(BaseModel):
    name: Text(2, 80) | None = None
    description: Text(0, 500) | None = None
    color: Color | None = None


class WorkspaceDelete(BaseModel):
    confirm_name: StrictStr = Field(max_length=200)


class PersonOut(BaseModel):
    id: int
    name: str
    email: str
    avatar_color: str

    class Config:
        orm_mode = True


class WorkspaceStats(BaseModel):
    members: int
    members_by_role: dict[str, int]
    courses: int
    active_courses: int
    active_learners_7d: int
    answers_7d: int
    reviews_7d: int
    pending_invitations: int


class WorkspaceOut(BaseModel):
    id: int
    name: str
    slug: str
    description: str
    color: str
    created_at: datetime
    owner: PersonOut | None
    your_role: Role
    stats: WorkspaceStats


# ---------- Members ----------


class MemberOut(BaseModel):
    user_id: int
    name: str
    email: str
    avatar_color: str
    headline: str
    role: Role
    is_active: bool
    is_you: bool
    joined_at: datetime
    last_active_at: datetime | None
    courses: int
    answers_30d: int


class MemberPage(Page[MemberOut]):
    counts: dict[str, int]


class RoleUpdate(BaseModel):
    role: Role


# ---------- Invitations ----------


class InvitationCreate(BaseModel):
    emails: list[StrictStr] = Field(min_items=1, max_items=50)
    role: Role = "learner"
    message: Text(0, 500) = ""


class InvitationOut(BaseModel):
    id: int
    email: str
    role: Role
    status: InvitationStatus
    message: str
    token: str
    invited_by: PersonOut | None
    created_at: datetime
    expires_at: datetime
    has_account: bool


class InvitationPage(Page[InvitationOut]):
    counts: dict[str, int]


class InviteResult(BaseModel):
    email: str
    outcome: Literal["invited", "skipped", "invalid"]
    reason: str = ""
    invitation: InvitationOut | None = None


