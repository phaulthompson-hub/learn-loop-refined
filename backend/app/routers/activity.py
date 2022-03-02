"""Workspace activity feed."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Access, workspace_access
from ..models import Activity, Membership, User
from ..schemas.activity import ActivityPage

router = APIRouter(tags=["activity"])


def newest_first(model):
    """Feed order: newest timestamp first, id as the tie-breaker (seeded history is not inserted in time order)."""
    return (model.created_at.desc(), model.id.desc())


def older_than(model, anchor):
    """Keyset condition for rows that sort after `anchor` in `newest_first` order."""
    return or_(
        model.created_at < anchor.created_at,
        and_(model.created_at == anchor.created_at, model.id < anchor.id),
    )


def recent_activity(db: Session, workspace_id: int, limit: int) -> list[Activity]:
    query = select(Activity).where(Activity.workspace_id == workspace_id).order_by(*newest_first(Activity))
    return list(db.scalars(query.limit(limit)))


@router.get("/api/workspaces/{workspace_id}/activity", response_model=ActivityPage)
def list_activity(
    access: Access = Depends(workspace_access),
    db: Session = Depends(get_db),
    actor_id: int | None = Query(None, ge=1),
    object_type: str | None = Query(None, regex=r"^[a-z_]{1,20}$"),
    before_id: int | None = Query(None, ge=1),
    limit: int = Query(20, ge=1, le=50),
):
    workspace_id = access.workspace.id
    filters = [Activity.workspace_id == workspace_id]
    if actor_id is not None:
        filters.append(Activity.actor_id == actor_id)
    if object_type is not None:
        filters.append(Activity.object_type == object_type)
    total = db.scalar(select(func.count()).select_from(Activity).where(*filters)) or 0

    page_filters = list(filters)
    if before_id is not None:
        anchor = db.get(Activity, before_id)
        if anchor is not None and anchor.workspace_id == workspace_id:
            page_filters.append(older_than(Activity, anchor))
    rows = list(db.scalars(select(Activity).where(*page_filters).order_by(*newest_first(Activity)).limit(limit + 1)))
    has_more = len(rows) > limit
    rows = rows[:limit]

    members = db.scalars(
        select(User).join(Membership, Membership.user_id == User.id).where(Membership.workspace_id == workspace_id)
    ).all()
    object_types = db.scalars(
        select(Activity.object_type)
        .where(Activity.workspace_id == workspace_id)
        .distinct()
        .order_by(Activity.object_type)
    ).all()
    return {
        "items": rows,
        "total": total,
        "has_more": has_more,
        "next_before_id": rows[-1].id if has_more else None,
        "facets": {"actors": sorted(members, key=lambda u: u.name.lower()), "object_types": list(object_types)},
    }
