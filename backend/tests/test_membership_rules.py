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


def test_removal_matrix():
    for actor, target in product(ROLES, ROLES):
        denial = removal_denial(actor_role=actor, target_role=target, is_self=False)
        allowed = ROLE_RANK[actor] >= ROLE_RANK["admin"] and (target != "owner" or actor == "owner")
        assert (denial is None) == allowed, (actor, target)


def test_nobody_removes_themselves():
    for role in ("admin", "owner"):
        denial = removal_denial(actor_role=role, target_role=role, is_self=True)
        assert denial.status == 409 and "Leave" in denial.reason
    assert removal_denial(actor_role="learner", target_role="learner", is_self=True).status == 403


def test_last_owner_cannot_leave():
    assert leave_denial(role="owner", owner_count=1).status == 409
    assert leave_denial(role="owner", owner_count=2) is None
    for role in ("learner", "instructor", "admin"):
        assert leave_denial(role=role, owner_count=1) is None


def test_invite_roles():
    assert invite_role_denial(actor_role="learner", role="learner").status == 403
    assert invite_role_denial(actor_role="instructor", role="learner").status == 403
    assert invite_role_denial(actor_role="admin", role="owner").status == 403
    assert invite_role_denial(actor_role="admin", role="banana").status == 422
    for role in ("learner", "instructor", "admin"):
        assert invite_role_denial(actor_role="admin", role=role) is None
    assert invite_role_denial(actor_role="owner", role="owner") is None


# ---------- Deactivation ----------


def test_deactivation_is_blocked_only_by_shared_workspaces_without_another_owner():
    seats = [
        WorkspaceSeat("Solo space", "owner", owner_count=1, member_count=1),
        WorkspaceSeat("Zoo club", "owner", owner_count=1, member_count=4),
        WorkspaceSeat("Co-owned", "owner", owner_count=2, member_count=6),
        WorkspaceSeat("Art guild", "owner", owner_count=1, member_count=2),
        WorkspaceSeat("Book club", "admin", owner_count=1, member_count=9),
    ]
    assert deactivation_blockers(seats) == ["Art guild", "Zoo club"]
    assert deactivation_blockers([]) == []


# ---------- Invitation state and confirmation ----------


def test_invitation_state_marks_past_pending_invitations_expired():
    now = datetime(2022, 3, 14, 9)
    assert invitation_state("pending", now + timedelta(seconds=1), now) == "pending"
    assert invitation_state("pending", now, now) == "expired"
    assert invitation_state("pending", now - timedelta(days=3), now) == "expired"
    assert invitation_state("accepted", now - timedelta(days=3), now) == "accepted"
    assert invitation_state("revoked", now + timedelta(days=3), now) == "revoked"


def test_confirmation_requires_the_exact_name():
    assert confirmation_matches("  Northwind Data Academy ", "Northwind Data Academy")
    assert not confirmation_matches("northwind data academy", "Northwind Data Academy")
    assert not confirmation_matches("Northwind", "Northwind Data Academy")
    assert not confirmation_matches("", "Northwind Data Academy")


# ---------- Email list parsing ----------


def test_parse_email_list_splits_normalises_and_dedupes():
    parsed = parse_email_list(["Ada@Example.com, bob@example.org;carol@example.net\n\n ada@example.com", "dan@x.io"])
    assert parsed.valid == ["ada@example.com", "bob@example.org", "carol@example.net", "dan@x.io"]
    assert parsed.duplicates == ["ada@example.com"]
    assert parsed.invalid == []


def test_parse_email_list_understands_display_names():
    parsed = parse_email_list(['Ada Lovelace <ada@example.com>, "Bob" <BOB@example.org>'])
    assert parsed.valid == ["ada@example.com", "bob@example.org"]
    assert parsed.invalid == []


def test_parse_email_list_reports_invalid_entries_as_typed():
    parsed = parse_email_list(["not-an-email, x@y, ok@fine.dev, @nope.com"])
    assert parsed.valid == ["ok@fine.dev"]
    assert parsed.invalid == ["not-an-email", "x@y", "@nope.com"]


def test_parse_email_list_rejects_overlong_addresses():
    long_email = "a" * 250 + "@x.io"
    assert parse_email_list([long_email]).invalid == [long_email]


def test_split_addresses_ignores_blank_input():
    assert split_addresses("  ,, ;\n\t ") == []
    assert parse_email_list(["", "   "]).valid == []
