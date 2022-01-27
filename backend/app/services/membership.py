"""Pure rules for workspace membership: who may change whose role, removals, leaving,
account deactivation, invitation state and parsing a pasted list of email addresses.

Nothing here touches the database, so every rule can be tested exhaustively and the
frontend can mirror it (see `frontend/src/features/admin/validation.ts`).
"""

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from ..models.identity import ROLES
from ..schemas.common import EMAIL

ROLE_RANK = {role: rank for rank, role in enumerate(ROLES)}
INVITATION_TTL = timedelta(days=14)
MAX_INVITES_PER_REQUEST = 50
# Commas, semicolons and line breaks separate entries; inside an entry, spaces separate plain addresses.
ENTRY_SEPARATORS = re.compile(r"[,;\r\n]+")
# "Ada Lovelace <ada@example.com>" -> "ada@example.com"
NAMED_ADDRESS = re.compile(r"<([^<>]+)>")


@dataclass(frozen=True)
class Denial:
    """Why an action is refused, with the HTTP status the API should answer with."""

    status: int
    reason: str


def rank(role: str) -> int:
    return ROLE_RANK.get(role, -1)


def role_change_denial(
    *, actor_role: str, target_role: str, new_role: str, is_self: bool, owner_count: int
) -> Denial | None:
    """Decide whether `actor` may move a member from `target_role` to `new_role`.

    Rules, in order:
    * only admins and owners manage roles;
    * nobody changes their own role, except an owner stepping down while another owner remains;
    * owners are the only ones who can grant ownership or touch another owner;
    * a workspace always keeps at least one owner.
    """
    if new_role not in ROLE_RANK:
        return Denial(422, f"Unknown role '{new_role}'")
    if rank(actor_role) < ROLE_RANK["admin"]:
        return Denial(403, "Only admins and owners can change roles")
    if new_role == target_role:
        return Denial(409, f"This member is already {article(new_role)} {new_role}")
    if is_self:
        if actor_role != "owner":
            return Denial(403, "You cannot change your own role")
        if owner_count <= 1:
            return Denial(409, "You are the only owner. Make someone else an owner before stepping down")
        return None
    if target_role == "owner" and actor_role != "owner":
        return Denial(403, "Only owners can change another owner's role")
    if new_role == "owner" and actor_role != "owner":
        return Denial(403, "Only owners can grant the owner role")
    if target_role == "owner" and owner_count <= 1:
        return Denial(409, "A workspace needs at least one owner")
    return None


def assignable_roles(*, actor_role: str, target_role: str, is_self: bool, owner_count: int) -> list[str]:
    """Roles the actor could move this member to (empty when the role is locked for them)."""
    return [
        role
        for role in ROLES
        if role != target_role
        and role_change_denial(
            actor_role=actor_role, target_role=target_role, new_role=role, is_self=is_self, owner_count=owner_count
        )
        is None
    ]


def removal_denial(*, actor_role: str, target_role: str, is_self: bool) -> Denial | None:
    """Admins remove non-owners; only owners remove other owners; nobody removes themselves (they leave)."""
    if rank(actor_role) < ROLE_RANK["admin"]:
        return Denial(403, "Only admins and owners can remove members")
    if is_self:
        return Denial(409, "Use 'Leave workspace' to remove yourself")
    if target_role == "owner" and actor_role != "owner":
        return Denial(403, "Only owners can remove another owner")
    return None


def leave_denial(*, role: str, owner_count: int) -> Denial | None:
    if role == "owner" and owner_count <= 1:
        return Denial(409, "You are the only owner. Transfer ownership or delete the workspace instead")
    return None


def invite_role_denial(*, actor_role: str, role: str) -> Denial | None:
    """Admins invite learners, instructors and admins; only owners can invite another owner."""
    if role not in ROLE_RANK:
        return Denial(422, f"Unknown role '{role}'")
    if rank(actor_role) < ROLE_RANK["admin"]:
        return Denial(403, "Only admins and owners can invite people")
    if role == "owner" and actor_role != "owner":
        return Denial(403, "Only owners can invite someone as an owner")
    return None


@dataclass(frozen=True)
class WorkspaceSeat:
    """One of the user's memberships, with the head counts needed to judge deactivation."""

    workspace_name: str
    role: str
    owner_count: int
    member_count: int


def deactivation_blockers(seats: Iterable[WorkspaceSeat]) -> list[str]:
    """Names of workspaces that would be left without an owner if this user deactivated."""
    return sorted(
        seat.workspace_name
        for seat in seats
        if seat.role == "owner" and seat.owner_count <= 1 and seat.member_count > 1
    )


