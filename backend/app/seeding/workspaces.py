"""Invitations for the demo workspaces.

Tokens are fixed strings so invite links in the demo (e.g. `/invite/demo-invite-northwind-nora`)
are the same on every run. Northwind shows every state an admin can meet: two pending invitations,
one close to expiry, one expired and one revoked; the biology group has a pending invitation and
the accepted invitation Priya joined with.
"""

from ..models import Invitation
from .context import SeedContext

# workspace, email, role, status, inviter, created (days ago), expires (days from now), token suffix, message
INVITATIONS = (
    (
        "northwind",
        "nora@learnloop.dev",
        "learner",
        "pending",
        "alex",
        2,
        12,
        "northwind-nora",
        "Welcome aboard! Start with the Machine Learning track, the stats course follows naturally.",
    ),
    (
        "northwind",
        "diego@learnloop.dev",
        "instructor",
        "pending",
        "maya",
        12,
        2,
        "northwind-diego",
        "Would love your help running the SQL track this term.",
    ),
    ("northwind", "tomas@learnloop.dev", "learner", "pending", "alex", 20, -6, "northwind-tomas", ""),
    ("northwind", "ravi@learnloop.dev", "admin", "revoked", "maya", 9, 5, "northwind-ravi", ""),
    (
        "biology",
        "kai@learnloop.dev",
        "learner",
        "pending",
        "alex",
        1,
        13,
        "biology-kai",
        "Midterm prep starts Thursday. The flashcards are already in!",
    ),
    ("biology", "priya@learnloop.dev", "learner", "accepted", "alex", 61, -47, "biology-priya", ""),
)


def seed(ctx: SeedContext) -> None:
    for ws_key, email, role, status, inviter, created, expires, token, message in INVITATIONS:
        ctx.db.add(
            Invitation(
                workspace_id=ctx.workspaces[ws_key].id,
                email=email,
                role=role,
                status=status,
                token=f"demo-invite-{token}",
                message=message,
                invited_by_id=ctx.users[inviter].id,
                created_at=ctx.at(created, 10, 30),
                expires_at=ctx.ahead(expires, 10, 30),
            )
        )
    ctx.db.flush()
