"""Workspace settings, members, roles and invitations.

Permission rules live in `services.membership` (pure and exhaustively tested); this module
loads the rows, applies a rule's `Denial` as an HTTP error, and records the side effects
(activity feed entries and notifications for the people affected).
"""

import secrets
from collections.abc import Iterable
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from sqlalchemy import Table, delete, func, select, update
from sqlalchemy.orm import Session
from sqlalchemy.sql import ColumnElement, Select

from .. import clock
from ..database import Base, get_db
from ..deps import ROLE_RANK, Access, bearer_token, current_user, membership_for, session_for_token, workspace_access
from ..models import Attempt, Course, Enrollment, Invitation, Membership, ReviewLog, StudyLog, User, Workspace
from ..schemas.auth import MeOut
from ..schemas.workspaces import (
    InvitationAccepted,
    InvitationCreate,
    InvitationOut,
    InvitationPage,
    InvitationPreview,
    InviteSummary,
    MemberOut,
    MemberPage,
    RoleUpdate,
    WorkspaceCreate,
    WorkspaceDelete,
    WorkspaceOut,
    WorkspaceUpdate,
)
from ..services.accounts import accept_invitation, create_workspace, find_user_by_email, me_payload
from ..services.events import notify, record
from ..services.listing import matches, paginate, parse_sort, sort_items
from ..services.membership import (
    INVITATION_TTL,
    MAX_INVITES_PER_REQUEST,
    Denial,
    article,
    confirmation_matches,
    invitation_state,
    invite_role_denial,
    leave_denial,
    parse_email_list,
    removal_denial,
    role_change_denial,
)

router = APIRouter(tags=["workspaces"])

MEMBER_SORTS = ("name", "role", "joined_at", "last_active_at", "courses", "answers_30d")
INVITATION_FILTERS = ("pending", "expired", "accepted", "revoked", "all")


def enforce(denial: Denial | None) -> None:
    if denial is not None:
        raise HTTPException(denial.status, denial.reason)


def optional_user(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> User | None:
    """The signed-in user when a valid token is sent, otherwise None (for pages that also work signed out)."""
    token = bearer_token(authorization)
    session = session_for_token(db, token) if token else None
    return session.user if session else None


# ---------- Queries ----------


def workspace_course_ids(workspace_id: int):
    return select(Course.id).where(Course.workspace_id == workspace_id).scalar_subquery()


def count_rows(db: Session, query: Select) -> int:
    return db.scalar(select(func.count()).select_from(query.subquery())) or 0


def active_owner_count(db: Session, workspace_id: int) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Membership)
            .join(User, User.id == Membership.user_id)
            .where(Membership.workspace_id == workspace_id, Membership.role == "owner", User.is_active.is_(True))
        )
        or 0
    )


def latest_by_user(db: Session, column, user_column, course_column, workspace_id: int) -> dict[int, datetime]:
    rows = db.execute(
        select(user_column, func.max(column))
        .where(course_column.in_(workspace_course_ids(workspace_id)))
        .group_by(user_column)
    ).all()
    return {user_id: moment for user_id, moment in rows if moment is not None}


def member_activity(db: Session, workspace_id: int) -> dict[str, dict[int, object]]:
    """Per-user activity inside one workspace: last active time, enrolled courses and recent answers."""
    since = clock.now() - timedelta(days=30)
    courses = workspace_course_ids(workspace_id)
    last_seen: dict[int, datetime] = {}
    for column, user_column, course_column in (
        (Attempt.created_at, Attempt.user_id, Attempt.course_id),
        (ReviewLog.reviewed_at, ReviewLog.user_id, ReviewLog.course_id),
        (StudyLog.logged_at, StudyLog.user_id, StudyLog.course_id),
    ):
        for user_id, moment in latest_by_user(db, column, user_column, course_column, workspace_id).items():
            last_seen[user_id] = max(moment, last_seen.get(user_id, moment))
    enrolled = db.execute(
        select(Enrollment.user_id, func.count()).where(Enrollment.course_id.in_(courses)).group_by(Enrollment.user_id)
    ).all()
    answers = db.execute(
        select(Attempt.user_id, func.count())
        .where(Attempt.course_id.in_(courses), Attempt.created_at >= since)
        .group_by(Attempt.user_id)
    ).all()
    return {"last_active": last_seen, "courses": dict(enrolled), "answers": dict(answers)}


