from datetime import datetime

from pydantic import BaseModel, Field, StrictStr

from .common import Email, Text


class LoginIn(BaseModel):
    email: Email
    password: StrictStr = Field(min_length=1, max_length=200)


class RegisterIn(BaseModel):
    name: Text(2, 80)
    email: Email
    password: StrictStr = Field(min_length=1, max_length=200)
    workspace_name: Text(2, 80) | None = None
    invitation_token: StrictStr | None = Field(default=None, max_length=64)


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    avatar_color: str
    headline: str
    bio: str
    timezone: str
    theme: str
    daily_goal_minutes: int
    quiz_length: int
    week_starts_on: int
    email_digest: bool
    reduced_motion: bool
    created_at: datetime

    class Config:
        orm_mode = True


class MemberBrief(BaseModel):
    id: int
    name: str
    email: str
    avatar_color: str

    class Config:
        orm_mode = True


class WorkspaceBrief(BaseModel):
    id: int
    name: str
    slug: str
    color: str
    role: str


class MeOut(BaseModel):
    user: UserOut
    workspaces: list[WorkspaceBrief]
    current_workspace_id: int | None
    unread_notifications: int


class TokenOut(MeOut):
    token: str


class MetaOut(BaseModel):
    now: datetime
    frozen: bool
    ai_mode: str
    version: str
