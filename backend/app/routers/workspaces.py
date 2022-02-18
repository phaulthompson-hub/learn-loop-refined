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


def member_row(membership: Membership, activity: dict, viewer_id: int) -> dict:
    user = membership.user
    return {
        "user_id": user.id,
        "name": user.name,
        "email": user.email,
        "avatar_color": user.avatar_color,
        "headline": user.headline,
        "role": membership.role,
        "is_active": user.is_active,
        "is_you": user.id == viewer_id,
        "joined_at": membership.joined_at,
        "last_active_at": activity["last_active"].get(user.id),
        "courses": activity["courses"].get(user.id, 0),
        "answers_30d": activity["answers"].get(user.id, 0),
    }


def workspace_stats(db: Session, workspace: Workspace) -> dict:
    now = clock.now()
    week_ago = now - timedelta(days=7)
    courses = workspace_course_ids(workspace.id)
    member_ids = {m.user_id for m in workspace.memberships}
    by_role = dict.fromkeys(ROLE_RANK, 0)
    for membership in workspace.memberships:
        by_role[membership.role] += 1
    answered = set(
        db.scalars(select(Attempt.user_id).where(Attempt.course_id.in_(courses), Attempt.created_at >= week_ago))
    )
    reviewed = set(
        db.scalars(select(ReviewLog.user_id).where(ReviewLog.course_id.in_(courses), ReviewLog.reviewed_at >= week_ago))
    )
    statuses = db.execute(
        select(Course.status, func.count()).where(Course.workspace_id == workspace.id).group_by(Course.status)
    ).all()
    return {
        "members": len(member_ids),
        "members_by_role": by_role,
        "courses": sum(n for _, n in statuses),
        "active_courses": dict(statuses).get("active", 0),
        "active_learners_7d": len((answered | reviewed) & member_ids),
        "answers_7d": count_rows(
            db, select(Attempt.id).where(Attempt.course_id.in_(courses), Attempt.created_at >= week_ago)
        ),
        "reviews_7d": count_rows(
            db, select(ReviewLog.id).where(ReviewLog.course_id.in_(courses), ReviewLog.reviewed_at >= week_ago)
        ),
        "pending_invitations": count_rows(
            db,
            select(Invitation.id).where(
                Invitation.workspace_id == workspace.id, Invitation.status == "pending", Invitation.expires_at > now
            ),
        ),
    }


def workspace_payload(db: Session, access: Access) -> dict:
    workspace = access.workspace
    owner = db.get(User, workspace.owner_id)
    return {
        "id": workspace.id,
        "name": workspace.name,
        "slug": workspace.slug,
        "description": workspace.description,
        "color": workspace.color,
        "created_at": workspace.created_at,
        "owner": owner,
        "your_role": access.role,
        "stats": workspace_stats(db, workspace),
    }


def invitation_payload(invitation: Invitation, has_account: bool) -> dict:
    return {
        "id": invitation.id,
        "email": invitation.email,
        "role": invitation.role,
        "status": invitation_state(invitation.status, invitation.expires_at, clock.now()),
        "message": invitation.message,
        "token": invitation.token,
        "invited_by": invitation.invited_by,
        "created_at": invitation.created_at,
        "expires_at": invitation.expires_at,
        "has_account": has_account,
    }


def registered_emails(db: Session, emails: Iterable[str]) -> set[str]:
    wanted = list(set(emails))
    if not wanted:
        return set()
    return set(db.scalars(select(User.email).where(User.email.in_(wanted))))


def member_or_404(db: Session, workspace_id: int, user_id: int) -> Membership:
    membership = membership_for(db, user_id, workspace_id)
    if membership is None:
        raise HTTPException(404, "Member not found")
    return membership


def invitation_or_404(db: Session, access: Access, invitation_id: int) -> Invitation:
    invitation = db.get(Invitation, invitation_id)
    if invitation is None or invitation.workspace_id != access.workspace.id:
        raise HTTPException(404, "Invitation not found")
    return invitation


# ---------- Side effects ----------


def sync_primary_owner(db: Session, workspace: Workspace) -> None:
    """Keep `Workspace.owner_id` pointing at a current owner after roles change or owners leave."""
    db.flush()
    owners = db.scalars(
        select(Membership)
        .where(Membership.workspace_id == workspace.id, Membership.role == "owner")
        .order_by(Membership.joined_at, Membership.id)
    ).all()
    if owners and workspace.owner_id not in {m.user_id for m in owners}:
        workspace.owner_id = owners[0].user_id


