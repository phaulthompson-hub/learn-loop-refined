"""Load the deterministic demo data set.

Usage:
    python -m app.seed            # rebuild the database with the demo workspaces
    python -m app.seed --if-empty # only seed when there are no users yet (safe on restart)
    python -m app.seed --quiet    # no progress output

Set FROZEN_NOW (e.g. 2022-03-14T09:00:00Z) to make every timestamp and "due today" screen
identical between runs; docker-compose.yml does this by default.
"""

import argparse
import sys

from sqlalchemy import func, select

from . import clock
from .database import SessionLocal
from .models import Attempt, Course, Deck, Event, Flashcard, Note, Task, User, Workspace
from .seeding import DEMO_PASSWORD, run_seed, seed_if_empty
from .seeding.core import USERS, WORKSPACES


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.seed", description="Load the LearnLoop demo data.")
    parser.add_argument("--if-empty", action="store_true", help="only seed when the database has no users")
    parser.add_argument("--quiet", action="store_true", help="print only the final summary")
    return parser


def summary() -> str:
    counts = []
    with SessionLocal() as db:
        for label, model in (
            ("workspaces", Workspace),
            ("users", User),
            ("courses", Course),
            ("quiz answers", Attempt),
            ("decks", Deck),
            ("flashcards", Flashcard),
            ("events", Event),
            ("tasks", Task),
            ("notes", Note),
        ):
            counts.append(f"{db.scalar(select(func.count()).select_from(model))} {label}")
    lines = [
        f"LearnLoop demo data (anchor {clock.now().isoformat(timespec='minutes')}"
        f"{', frozen' if clock.is_frozen() else ''})",
        "  " + ", ".join(counts),
        "",
        f"  Sign in with any of these accounts (password: {DEMO_PASSWORD}):",
    ]
    roles = {owner: f"owner of {WORKSPACES[k][0]}" for k, (_, _, _, owner, _) in WORKSPACES.items()}
    for key, name, email, _, _ in USERS:
        role = roles.get(key, "member")
        lines.append(f"    {email:<24} {name:<13} {role}")
    return "\n".join(lines)


def run(argv: list[str] | None = None) -> str:
    args = build_parser().parse_args(argv)
    if args.if_empty:
        if not seed_if_empty():
            return "Database already has users; nothing to do (run without --if-empty to rebuild)."
    else:
        if not args.quiet:
            print("Rebuilding the database with demo data...")
        run_seed(verbose=not args.quiet)
    return summary()


def main(argv: list[str] | None = None) -> int:
    print(run(argv))
    return 0


if __name__ == "__main__":
    sys.exit(main())
