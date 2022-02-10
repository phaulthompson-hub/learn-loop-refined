"""Creating users, workspaces and login sessions (shared by the auth API and the seed command)."""

import re
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import clock
from ..config import get_settings
from ..models import AuthSession, Invitation, Membership, Notification, User, Workspace
from ..security import hash_password, new_token, token_digest

AVATAR_COLORS = ("#1d6d45", "#2563eb", "#9333ea", "#c2410c", "#0f766e", "#be123c", "#4d7c0f", "#a16207")


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:60] or "workspace"


def unique_slug(db: Session, name: str) -> str:
    base = slugify(name)
    slug, n = base, 2
    while db.scalars(select(Workspace.id).where(Workspace.slug == slug)).first() is not None:
        slug = f"{base}-{n}"
        n += 1
    return slug


def find_user_by_email(db: Session, email: str) -> User | None:
    return db.scalars(select(User).where(User.email == email.strip().lower())).first()


def create_user(db: Session, *, name: str, email: str, password: str, **extra) -> User:
    if find_user_by_email(db, email):
        raise HTTPException(409, "An account with this email already exists")
    count = db.scalar(select(func.count()).select_from(User)) or 0
    user = User(
        name=name.strip(),
        email=email.strip().lower(),
        password_hash=hash_password(password),
        avatar_color=extra.pop("avatar_color", AVATAR_COLORS[count % len(AVATAR_COLORS)]),
        created_at=clock.now(),
        **extra,
    )
    db.add(user)
    db.flush()
    return user


def create_workspace(
    db: Session, *, owner: User, name: str, description: str = "", color: str = "#1d6d45"
) -> Workspace:
    workspace = Workspace(
        name=name.strip(),
        slug=unique_slug(db, name),
        description=description,
        color=color,
        owner_id=owner.id,
        created_at=clock.now(),
    )
    db.add(workspace)
    db.flush()
    db.add(Membership(workspace_id=workspace.id, user_id=owner.id, role="owner", joined_at=clock.now()))
    owner.last_workspace_id = owner.last_workspace_id or workspace.id
    db.flush()
    return workspace


def add_member(db: Session, workspace: Workspace, user: User, role: str = "learner") -> Membership:
    existing = db.scalars(
        select(Membership).where(Membership.workspace_id == workspace.id, Membership.user_id == user.id)
    ).first()
    if existing:
        return existing
    membership = Membership(workspace_id=workspace.id, user_id=user.id, role=role, joined_at=clock.now())
    db.add(membership)
    if user.last_workspace_id is None:
        user.last_workspace_id = workspace.id
    db.flush()
    return membership


def accept_invitation(db: Session, user: User, token: str) -> Membership:
    invitation = db.scalars(select(Invitation).where(Invitation.token == token)).first()
    if invitation is None or invitation.status != "pending":
        raise HTTPException(404, "This invitation is no longer valid")
    if invitation.expires_at <= clock.now():
        raise HTTPException(410, "This invitation has expired")
    if invitation.email != user.email:
        raise HTTPException(403, "This invitation was sent to a different email address")
    workspace = db.get(Workspace, invitation.workspace_id)
    membership = add_member(db, workspace, user, invitation.role)
    invitation.status = "accepted"
    user.last_workspace_id = workspace.id
    return membership


def start_session(db: Session, user: User, user_agent: str = "") -> str:
    token = new_token()
    now = clock.now()
    db.add(
        AuthSession(
            user_id=user.id,
            token_hash=token_digest(token),
            user_agent=user_agent[:255],
            created_at=now,
            last_seen_at=now,
            expires_at=now + timedelta(days=get_settings().session_days),
        )
    )
    db.commit()
    return token


def me_payload(db: Session, user: User) -> dict:
    memberships = sorted(user.memberships, key=lambda m: m.workspace.name.lower())
    workspaces = [
        {
            "id": m.workspace.id,
            "name": m.workspace.name,
            "slug": m.workspace.slug,
            "color": m.workspace.color,
            "role": m.role,
        }
        for m in memberships
    ]
    ids = [w["id"] for w in workspaces]
    current = user.last_workspace_id if user.last_workspace_id in ids else (ids[0] if ids else None)
    unread = db.scalar(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
    )
    return {"user": user, "workspaces": workspaces, "current_workspace_id": current, "unread_notifications": unread}
