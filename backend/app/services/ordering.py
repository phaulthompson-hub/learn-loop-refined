"""Fractional ordering for items in a column (board tasks, and anything else that is drag-sorted).

Each item stores a float `position`; the column is sorted by it. Moving an item only rewrites
that item's position (the midpoint between its new neighbours), so a drag is one UPDATE.
Repeated inserts into the same gap halve it every time, so once a gap falls below `MIN_GAP`
the whole column is renumbered to evenly spaced positions ("rebalanced").

Everything here is pure: callers pass positions in, get positions out.
"""

from collections.abc import Sequence
from dataclasses import dataclass

STEP = 1024.0
# Below this distance between neighbours a midpoint loses useful precision, so we renumber instead.
MIN_GAP = 1e-6


class UnknownNeighbour(ValueError):
    """A `before_id` / `after_id` that is not in the target column."""


@dataclass(frozen=True)
class MovePlan:
    """Where a moved item lands.

    `position` is the moved item's new position. When the gap was too small, `rebalanced`
    holds new positions for every item of the column *including* the moved one, in order;
    otherwise it is `None` and only the moved item changes.
    """

    index: int
    position: float
    rebalanced: tuple[float, ...] | None = None


def evenly_spaced(count: int, step: float = STEP) -> list[float]:
    """Positions `step, 2*step, ...` for `count` items."""
    return [step * (i + 1) for i in range(count)]


def append_position(positions: Sequence[float]) -> float:
    """Position for a new item at the end of a column."""
    return (max(positions) + STEP) if positions else STEP


def position_between(upper: float | None, lower: float | None) -> float:
    """Position strictly between the item above (`upper`) and the item below (`lower`).

    Either neighbour may be missing (moving to the top, the bottom, or into an empty column).
    """
    if upper is None and lower is None:
        return STEP
    if upper is None:
        return lower - STEP if lower > STEP else lower / 2
    if lower is None:
        return upper + STEP
    return (upper + lower) / 2


def gap_too_small(upper: float | None, lower: float | None) -> bool:
    if lower is None:
        return False  # appending always has room
    if upper is None:
        # Moving to the top halves an ever-smaller positive number; guard that edge too.
        return lower <= MIN_GAP
    return lower - upper <= MIN_GAP


def needs_normalising(positions: Sequence[float]) -> bool:
    """True when stored positions are unsorted, duplicated or too crowded to insert between safely."""
    return any(b - a <= MIN_GAP for a, b in zip(positions, positions[1:], strict=False))


def clamp_index(index: int, length: int) -> int:
    return max(0, min(index, length))


def plan_move(positions: Sequence[float], index: int) -> MovePlan:
    """Plan inserting an item at `index` into a column whose *other* items have `positions` (sorted).

    The column is renumbered when the target gap is too small, or when it already contains
    crowded/duplicate positions (e.g. from concurrent inserts), so order stays unambiguous.
    """
    index = clamp_index(index, len(positions))
    upper = positions[index - 1] if index > 0 else None
    lower = positions[index] if index < len(positions) else None
    if gap_too_small(upper, lower) or needs_normalising(positions):
        spaced = evenly_spaced(len(positions) + 1)
        return MovePlan(index=index, position=spaced[index], rebalanced=tuple(spaced))
    return MovePlan(index=index, position=position_between(upper, lower))


def resolve_index(
    ids: Sequence[int],
    *,
    before_id: int | None = None,
    after_id: int | None = None,
    index: int | None = None,
) -> int:
    """Turn a drop target into an index within `ids` (the column without the moved item).

    `after_id` is the item the moved one should follow (its new upper neighbour) and wins when
    both neighbours are given, because it is what the user saw directly above the drop line.
    `before_id` is the item it should precede. Without neighbours, `index` is used, and with
    nothing at all the item goes to the end.
    """
    if after_id is not None:
        if after_id not in ids:
            raise UnknownNeighbour(after_id)
        return ids.index(after_id) + 1
    if before_id is not None:
        if before_id not in ids:
            raise UnknownNeighbour(before_id)
        return ids.index(before_id)
    if index is not None:
        return clamp_index(index, len(ids))
    return len(ids)
