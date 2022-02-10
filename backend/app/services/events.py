"""Shared side effects: the workspace activity feed and per-user notifications.

Feature code calls `record(...)` / `notify(...)` instead of creating rows directly so
feed entries stay consistent (same verbs, same link format) across the app.
"""

from sqlalchemy.orm import Session

from .. import clock
from ..models import Activity, Notification


def record(
    db: Session,
    *,
    workspace_id: int,
    actor_id: int | None,
    verb: str,
    object_type: str,
    object_id: int | None,
    summary: str,
    link: str = "",
    detail: str = "",
) -> Activity:
    activity = Activity(
        workspace_id=workspace_id,
        actor_id=actor_id,
        verb=verb,
        object_type=object_type,
        object_id=object_id,
        summary=summary[:255],
        link=link,
        detail=detail,
        created_at=clock.now(),
    )
    db.add(activity)
    return activity


def notify(
    db: Session,
    *,
    user_id: int,
    title: str,
    kind: str = "system",
    body: str = "",
    link: str = "",
    workspace_id: int | None = None,
    actor_id: int | None = None,
) -> Notification | None:
    """Create a notification unless the recipient caused it themselves."""
    if actor_id is not None and actor_id == user_id:
        return None
    notification = Notification(
        user_id=user_id,
        workspace_id=workspace_id,
        actor_id=actor_id,
        kind=kind,
        title=title[:160],
        body=body,
        link=link,
        created_at=clock.now(),
    )
    db.add(notification)
    return notification
