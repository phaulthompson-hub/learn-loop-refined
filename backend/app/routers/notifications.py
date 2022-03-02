"""The signed-in user's notification feed."""

from collections.abc import Sequence

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from .. import clock
from ..database import get_db
from ..deps import current_user
from ..models import NOTIFICATION_KINDS, Notification, User, Workspace
from ..schemas.notifications import BulkResult, NotificationOut, NotificationPage, NotificationUpdate, UnreadCount
from .activity import newest_first, older_than

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

KIND_PATTERN = "^(" + "|".join(NOTIFICATION_KINDS) + ")$"


def unread_count(db: Session, user_id: int) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        )
        or 0
    )


def payloads(db: Session, notifications: Sequence[Notification]) -> list[dict]:
    workspace_ids = {n.workspace_id for n in notifications if n.workspace_id is not None}
    workspaces = (
        {w.id: w for w in db.scalars(select(Workspace).where(Workspace.id.in_(workspace_ids)))} if workspace_ids else {}
    )
    return [
        {
            "id": n.id,
            "kind": n.kind,
            "title": n.title,
            "body": n.body,
            "link": n.link,
            "created_at": n.created_at,
            "read_at": n.read_at,
            "read": n.read_at is not None,
            "actor": n.actor,
            "workspace": workspaces.get(n.workspace_id),
        }
        for n in notifications
    ]


def own_notification(db: Session, user: User, notification_id: int) -> Notification:
    """The user's notification, or 404 (other people's notifications are indistinguishable from missing ones)."""
    notification = db.get(Notification, notification_id)
    if notification is None or notification.user_id != user.id:
        raise HTTPException(404, "Notification not found")
    return notification


@router.get("", response_model=NotificationPage)
def list_notifications(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    unread: bool = False,
    kind: str | None = Query(None, regex=KIND_PATTERN),
    workspace_id: int | None = Query(None, ge=1),
    before_id: int | None = Query(None, ge=1),
    limit: int = Query(20, ge=1, le=50),
):
    scope = [Notification.user_id == user.id]
    if unread:
        scope.append(Notification.read_at.is_(None))
    if workspace_id is not None:
        scope.append(Notification.workspace_id == workspace_id)
    # Kind counts ignore the kind filter itself, so the filter chips can show what each choice would return.
    kinds = dict(db.execute(select(Notification.kind, func.count()).where(*scope).group_by(Notification.kind)).all())
    filters = [*scope, Notification.kind == kind] if kind else scope
    total = db.scalar(select(func.count()).select_from(Notification).where(*filters)) or 0

    page_filters = list(filters)
    if before_id is not None:
        anchor = db.get(Notification, before_id)
        if anchor is not None and anchor.user_id == user.id:
            page_filters.append(older_than(Notification, anchor))
    query = select(Notification).where(*page_filters).order_by(*newest_first(Notification)).limit(limit + 1)
    rows = list(db.scalars(query))
    has_more = len(rows) > limit
    rows = rows[:limit]
    return {
        "items": payloads(db, rows),
        "total": total,
        "unread": unread_count(db, user.id),
        "has_more": has_more,
        "next_before_id": rows[-1].id if has_more else None,
        "kinds": {k: kinds.get(k, 0) for k in NOTIFICATION_KINDS},
    }


@router.get("/unread-count", response_model=UnreadCount)
def get_unread_count(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"unread": unread_count(db, user.id)}


@router.post("/read-all", response_model=BulkResult)
def mark_all_read(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    workspace_id: int | None = Query(None, ge=1),
):
    filters = [Notification.user_id == user.id, Notification.read_at.is_(None)]
    if workspace_id is not None:
        filters.append(Notification.workspace_id == workspace_id)
    result = db.execute(update(Notification).where(*filters).values(read_at=clock.now()))
    db.commit()
    return {"changed": result.rowcount, "unread": unread_count(db, user.id)}


@router.delete("/read", response_model=BulkResult)
def clear_read(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    workspace_id: int | None = Query(None, ge=1),
):
    """Delete every notification the user has already read (unread ones are never cleared in bulk)."""
    filters = [Notification.user_id == user.id, Notification.read_at.is_not(None)]
    if workspace_id is not None:
        filters.append(Notification.workspace_id == workspace_id)
    result = db.execute(delete(Notification).where(*filters))
    db.commit()
    return {"changed": result.rowcount, "unread": unread_count(db, user.id)}


@router.patch("/{notification_id}", response_model=NotificationOut)
def set_read(
    notification_id: int,
    data: NotificationUpdate,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    notification = own_notification(db, user, notification_id)
    if data.read and notification.read_at is None:
        notification.read_at = clock.now()
    elif not data.read:
        notification.read_at = None
    db.commit()
    return payloads(db, [notification])[0]


@router.delete("/{notification_id}", status_code=204)
def delete_notification(notification_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(own_notification(db, user, notification_id))
    db.commit()
    return Response(status_code=204)
