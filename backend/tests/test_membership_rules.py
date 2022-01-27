"""Exhaustive checks of the pure membership rules in app/services/membership.py."""

from datetime import datetime, timedelta
from itertools import product

import pytest

from app.services.membership import (
    ROLE_RANK,
    WorkspaceSeat,
    assignable_roles,
    confirmation_matches,
    deactivation_blockers,
    invitation_state,
    invite_role_denial,
    leave_denial,
    parse_email_list,
    removal_denial,
    role_change_denial,
    split_addresses,
)

ROLES = list(ROLE_RANK)
OWNER_COUNTS = (1, 2, 3)


def all_role_changes():
    for actor, target, new, is_self, owners in product(ROLES, ROLES, ROLES, (False, True), OWNER_COUNTS):
        if is_self and actor != target:
            continue  # changing your own role means the target role is your role
        if not is_self and actor == target == "owner" and owners < 2:
            continue  # two different owners cannot exist when there is only one
        yield actor, target, new, is_self, owners


def decide(actor, target, new, is_self, owners):
    return role_change_denial(actor_role=actor, target_role=target, new_role=new, is_self=is_self, owner_count=owners)


# ---------- Role changes: invariants over every combination ----------


def test_every_allowed_change_keeps_an_owner_and_respects_rank():
    # One test looping over every combination (rather than ~200 parametrized cases) keeps the suite fast.
    allowed = 0
    for case in all_role_changes():
        actor, target, new, is_self, owners = case
        denial = decide(*case)
        if denial is not None:
            assert denial.status in (403, 409) and denial.reason, case
            continue
        allowed += 1
        assert owners - (target == "owner") + (new == "owner") >= 1, case
        assert ROLE_RANK[actor] >= ROLE_RANK["admin"], case
        assert new != target, case
        if actor != "owner":
            assert "owner" not in (target, new), case
        if is_self:
            assert actor == "owner" and owners >= 2, case
    assert allowed > 0


def test_learners_and_instructors_never_change_roles():
    for actor in ("learner", "instructor"):
        for target, new in product(ROLES, ROLES):
            denial = decide(actor, target, new, False, 2)
            assert denial is not None and denial.status == 403


def test_admins_move_non_owners_between_non_owner_roles():
    for target, new in product(("learner", "instructor", "admin"), ("learner", "instructor", "admin")):
        if target != new:
            assert decide("admin", target, new, False, 1) is None


def test_owners_can_change_anyone_else_when_another_owner_remains():
    for target, new in product(ROLES, ROLES):
        if target != new:
            assert decide("owner", target, new, False, 2) is None


@pytest.mark.parametrize(
    ("actor", "target", "new", "is_self", "owners", "status", "reason"),
    [
        ("admin", "learner", "owner", False, 1, 403, "grant the owner role"),
        ("admin", "owner", "admin", False, 2, 403, "another owner"),
        ("admin", "admin", "learner", True, 1, 403, "your own role"),
        ("instructor", "learner", "instructor", False, 1, 403, "Only admins"),
        ("owner", "owner", "admin", True, 1, 409, "only owner"),
        ("owner", "learner", "learner", False, 1, 409, "already a learner"),
        ("owner", "learner", "admin", False, 1, None, None),
        ("owner", "owner", "admin", True, 2, None, None),
        ("owner", "learner", "owner", False, 1, None, None),
        ("owner", "admin", "superuser", False, 1, 422, "Unknown role"),
    ],
)
def test_role_change_examples(actor, target, new, is_self, owners, status, reason):
    denial = decide(actor, target, new, is_self, owners)
    if status is None:
        assert denial is None
    else:
        assert denial.status == status
        assert reason in denial.reason


def test_assignable_roles_lists_exactly_the_allowed_moves():
    assert assignable_roles(actor_role="admin", target_role="learner", is_self=False, owner_count=1) == [
        "instructor",
        "admin",
    ]
    assert assignable_roles(actor_role="owner", target_role="learner", is_self=False, owner_count=1) == [
        "instructor",
        "admin",
        "owner",
    ]
    assert assignable_roles(actor_role="admin", target_role="owner", is_self=False, owner_count=2) == []
    assert assignable_roles(actor_role="owner", target_role="owner", is_self=True, owner_count=1) == []
    assert assignable_roles(actor_role="owner", target_role="owner", is_self=True, owner_count=2) == [
        "learner",
        "instructor",
        "admin",
    ]
    assert assignable_roles(actor_role="learner", target_role="learner", is_self=False, owner_count=1) == []


# ---------- Removal, leaving and inviting ----------


