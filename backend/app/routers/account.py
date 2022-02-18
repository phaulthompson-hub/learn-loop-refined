"""Profile, preferences, password and active sessions for the signed-in user."""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import clock
from ..database import get_db
from ..deps import current_session, current_user
from ..models import AuthSession, Membership, User
from ..schemas.account import (
    DeactivateIn,
    PasswordChange,
    PasswordChanged,
    PreferencesUpdate,
    ProfileUpdate,
    SessionOut,
    SessionsRevoked,
)
from ..schemas.auth import UserOut
from ..security import hash_password, password_problems, verify_password
from ..services.membership import WorkspaceSeat, deactivation_blockers

router = APIRouter(prefix="/api/me", tags=["account"])

# (marker in the user agent, label), checked in order so Edge and Opera win over Chrome, and Chrome over Safari.
BROWSERS = (("Edg/", "Edge"), ("OPR/", "Opera"), ("Firefox/", "Firefox"), ("Chrome/", "Chrome"), ("Safari/", "Safari"))
SYSTEMS = (
    ("iPhone", "iPhone"),
    ("iPad", "iPad"),
    ("Android", "Android"),
    ("CrOS", "ChromeOS"),
    ("Windows", "Windows"),
    ("Mac OS X", "macOS"),
    ("Linux", "Linux"),
)


def describe_user_agent(user_agent: str) -> str:
    """A short, human label for the session list: "Firefox on Windows", "Safari on iPhone"..."""
    if not user_agent.strip():
        return "Unknown device"
    browser = next((label for marker, label in BROWSERS if marker in user_agent), None)
    system = next((label for marker, label in SYSTEMS if marker in user_agent), None)
    if browser and system:
        return f"{browser} on {system}"
    if browser or system:
        return browser or system
    # Scripts and API clients ("python-httpx/0.28", "curl/8.4") keep their product name.
    return user_agent.split("/", 1)[0].strip()[:40] or "Unknown device"


def require_password(user: User, password: str) -> None:
    # 400 rather than 401: a mistyped confirmation password must not sign the user out of the app.
    if not verify_password(password, user.password_hash):
        raise HTTPException(400, "Your current password is incorrect")


def user_sessions(db: Session, user: User, *, except_session: AuthSession | None = None) -> list[AuthSession]:
    query = select(AuthSession).where(AuthSession.user_id == user.id)
    if except_session is not None:
        query = query.where(AuthSession.id != except_session.id)
    return list(db.scalars(query))


def revoke(db: Session, sessions: list[AuthSession]) -> int:
    for session in sessions:
        db.delete(session)
    return len(sessions)


def seats_for(db: Session, user: User) -> list[WorkspaceSeat]:
    """The user's memberships with the number of active owners and active members in each workspace."""
    seats = []
    for membership in user.memberships:
        active = (
            select(func.count())
            .select_from(Membership)
            .join(User, User.id == Membership.user_id)
            .where(Membership.workspace_id == membership.workspace_id, User.is_active.is_(True))
        )
        seats.append(
            WorkspaceSeat(
                workspace_name=membership.workspace.name,
                role=membership.role,
                owner_count=db.scalar(active.where(Membership.role == "owner")) or 0,
                member_count=db.scalar(active) or 0,
            )
        )
    return seats


# ---------- Profile and preferences ----------


@router.get("/profile", response_model=UserOut)
def get_profile(user: User = Depends(current_user)):
    return user


@router.patch("/profile", response_model=UserOut)
def update_profile(data: ProfileUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    for key, value in data.dict(exclude_none=True).items():
        setattr(user, key, value)
    db.commit()
    return user


@router.patch("/preferences", response_model=UserOut)
def update_preferences(data: PreferencesUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    for key, value in data.dict(exclude_none=True).items():
        setattr(user, key, value)
    db.commit()
    return user


# ---------- Password ----------


@router.post("/password", response_model=PasswordChanged)
def change_password(
    data: PasswordChange, session: AuthSession = Depends(current_session), db: Session = Depends(get_db)
):
    """Change the password and sign out every other device; the current session stays signed in."""
    user = session.user
    require_password(user, data.current_password)
    problems = password_problems(data.new_password)
    if problems:
        raise HTTPException(422, f"New password {' and '.join(problems)}")
    if verify_password(data.new_password, user.password_hash):
        raise HTTPException(422, "New password must be different from the current one")
    user.password_hash = hash_password(data.new_password)
    signed_out = revoke(db, user_sessions(db, user, except_session=session))
    db.commit()
    return {"signed_out_sessions": signed_out}


# ---------- Sessions ----------


