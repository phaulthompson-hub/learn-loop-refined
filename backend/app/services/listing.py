"""Pagination, sorting and text-filter helpers shared by list endpoints.

List endpoints return `{"items": [...], "total": n, "page": p, "page_size": s}` so the
frontend's DataTable can render pagination without knowing which resource it shows.
"""

from collections.abc import Callable, Sequence
from typing import Any, TypeVar

from fastapi import HTTPException

T = TypeVar("T")

MAX_PAGE_SIZE = 100


def paginate(items: Sequence[T], page: int = 1, page_size: int = 20) -> dict[str, Any]:
    page_size = max(1, min(page_size, MAX_PAGE_SIZE))
    total = len(items)
    last_page = max(1, -(-total // page_size))
    page = max(1, min(page, last_page))
    start = (page - 1) * page_size
    return {"items": list(items[start : start + page_size]), "total": total, "page": page, "page_size": page_size}


def parse_sort(value: str | None, allowed: Sequence[str], default: str) -> tuple[str, bool]:
    """Parse `"-created_at"` into `("created_at", True)`; reject unknown fields with 422."""
    raw = (value or default).strip()
    descending = raw.startswith("-")
    field = raw.lstrip("-+")
    if field not in allowed:
        raise HTTPException(422, f"Cannot sort by '{field}'. Use one of: {', '.join(allowed)}")
    return field, descending


def sort_items(items: Sequence[T], key: Callable[[T], Any], descending: bool) -> list[T]:
    """Stable sort that keeps `None` values last regardless of direction."""
    present = [item for item in items if key(item) is not None]
    missing = [item for item in items if key(item) is None]
    return sorted(present, key=key, reverse=descending) + missing


def matches(query: str | None, *fields: str | None) -> bool:
    """Case-insensitive "all words appear somewhere" match used by list filters and search."""
    if not query or not query.strip():
        return True
    haystack = " ".join(f for f in fields if f).lower()
    return all(word in haystack for word in query.lower().split())


def split_tags(value: str | Sequence[str] | None) -> list[str]:
    if value is None:
        return []
    parts = value.split(",") if isinstance(value, str) else value
    seen: list[str] = []
    for part in parts:
        tag = part.strip().lower()
        if tag and tag not in seen:
            seen.append(tag[:30])
    return seen[:10]
