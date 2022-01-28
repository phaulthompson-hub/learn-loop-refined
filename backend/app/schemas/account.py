"""Request/response models for the signed-in user's own account (`/api/me/...`)."""

import re
from datetime import datetime
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel, Field, StrictStr

from .common import Color, Text, checked_str

BIO_MAX = 600


# Used only when the host has no time zone database (e.g. Windows without the `tzdata` package):
# then a name is accepted if it has the shape of an IANA zone in one of the IANA regions.
IANA_SHAPE = re.compile(
    r"^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)"
    r"(/[A-Za-z0-9][A-Za-z0-9_+-]*){1,2}$"
)


@lru_cache(maxsize=1)
def known_timezones() -> frozenset[str]:
    from zoneinfo import available_timezones

    return frozenset(available_timezones())


def is_timezone(value: str) -> bool:
    if value == "UTC":
        return True
    zones = known_timezones()
    return value in zones if zones else bool(IANA_SHAPE.match(value))


def _timezone(value: str) -> str:
    value = value.strip()
    if not is_timezone(value):
        raise ValueError("must be an IANA time zone such as Europe/Berlin")
    return value


Timezone = checked_str("Timezone", _timezone)


class ProfileUpdate(BaseModel):
    name: Text(2, 80) | None = None
    headline: Text(0, 120) | None = None
    bio: Text(0, BIO_MAX) | None = None
    timezone: Timezone | None = None
    avatar_color: Color | None = None


class PreferencesUpdate(BaseModel):
    theme: Literal["light", "dark", "system"] | None = None
    daily_goal_minutes: int | None = Field(default=None, ge=5, le=480)
    quiz_length: int | None = Field(default=None, ge=3, le=10)
    week_starts_on: Literal[0, 6] | None = None
    email_digest: bool | None = None
    reduced_motion: bool | None = None


class PasswordChange(BaseModel):
    current_password: StrictStr = Field(min_length=1, max_length=200)
    new_password: StrictStr = Field(min_length=1, max_length=200)


class PasswordChanged(BaseModel):
    signed_out_sessions: int


class SessionOut(BaseModel):
    id: int
    device: str
    user_agent: str
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    current: bool


class SessionsRevoked(BaseModel):
    revoked: int


class DeactivateIn(BaseModel):
    password: StrictStr = Field(min_length=1, max_length=200)
