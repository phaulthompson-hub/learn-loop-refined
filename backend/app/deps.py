"""FastAPI dependencies for authentication and workspace-scoped authorisation.

Every feature router uses the same three building blocks:

* `current_user`            – resolves the bearer token to a `User` (401 otherwise)
* `workspace_access`        – for routes with a `{workspace_id}` path parameter (404 if not a member)
* `access_for(db, user, id)`– for item routes (`/api/tasks/{id}`), given the item's workspace id

Roles are ordered learner < instructor < admin < owner; `Access.require("instructor")`
raises 403 when the member's role is lower.
"""

from dataclasses import dataclass
from datetime import timedelta

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import clock
from .database import get_db
from .models import ROLES, AuthSession, Membership, User, Workspace
from .security import token_digest

ROLE_RANK = {role: rank for rank, role in enumerate(ROLES)}
# Refresh `last_seen_at` at most this often, so read-heavy pages do not write on every request.
SEEN_RESOLUTION = timedelta(minutes=5)


def role_at_least(role: str, minimum: str) -> bool:
    return ROLE_RANK.get(role, -1) >= ROLE_RANK[minimum]


def bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def session_for_token(db: Session, token: str) -> AuthSession | None:
    session = db.scalars(select(AuthSession).where(AuthSession.token_hash == token_digest(token))).first()
    if session is None or session.expires_at <= clock.now() or not session.user.is_active:
        return None
    return session


def current_session(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> AuthSession:
    token = bearer_token(authorization)
    session = session_for_token(db, token) if token else None
    if session is None:
        raise HTTPException(401, "Sign in to continue", headers={"WWW-Authenticate": "Bearer"})
    if clock.now() - session.last_seen_at > SEEN_RESOLUTION:
        session.last_seen_at = clock.now()
        db.commit()
    return session


def current_user(session: AuthSession = Depends(current_session)) -> User:
    return session.user


@dataclass
class Access:
    user: User
    workspace: Workspace
    membership: Membership

    @property
    def role(self) -> str:
        return self.membership.role

    def can(self, minimum: str) -> bool:
        return role_at_least(self.membership.role, minimum)

    def require(self, minimum: str) -> "Access":
        if not self.can(minimum):
            raise HTTPException(403, f"This action needs the {minimum} role or higher")
        return self


def membership_for(db: Session, user_id: int, workspace_id: int) -> Membership | None:
    return db.scalars(
        select(Membership).where(Membership.user_id == user_id, Membership.workspace_id == workspace_id)
    ).first()


def access_for(db: Session, user: User, workspace_id: int) -> Access:
    """Resolve a user's access to a workspace. Non-members get 404 so ids of other workspaces are not revealed."""
    membership = membership_for(db, user.id, workspace_id)
    if membership is None:
        raise HTTPException(404, "Workspace not found")
    return Access(user=user, workspace=membership.workspace, membership=membership)


def workspace_access(workspace_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Access:
    return access_for(db, user, workspace_id)


def get_or_404(db: Session, model, object_id: int, label: str):
    obj = db.get(model, object_id)
    if obj is None:
        raise HTTPException(404, f"{label} not found")
    return obj
