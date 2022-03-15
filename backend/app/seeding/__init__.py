"""Deterministic demo data for every feature.

`run_seed()` rebuilds the database from scratch and replays a fixed history relative
to one anchor instant (`FROZEN_NOW`, or the real clock when it is unset). Feature
seeders run in dependency order; each one receives the shared `SeedContext`.
"""

from random import Random

from sqlalchemy import func, select

from .. import clock
from ..database import Base, SessionLocal, engine, init_db
from ..models import User
from . import board, core, flashcards, notes, planner, social, workspaces
from .context import DEMO_PASSWORD, SeedContext

SEEDERS = (
    ("people, workspaces, courses and quiz history", core.seed),
    ("invitations", workspaces.seed),
    ("flashcards and reviews", flashcards.seed),
    ("calendar, goals and study time", planner.seed),
    ("study board", board.seed),
    ("notes", notes.seed),
    ("notifications and activity", social.seed),
)


def reset_database() -> None:
    Base.metadata.drop_all(engine)
    init_db()


def run_seed(verbose: bool = False) -> SeedContext:
    reset_database()
    anchor = clock.now()
    with SessionLocal() as db, clock.travel(anchor):
        ctx = SeedContext(db=db, now=anchor, rng=Random(2022))
        for label, seeder in SEEDERS:
            if verbose:
                print(f"  seeding {label}")
            seeder(ctx)
            db.commit()
        return ctx


def seed_if_empty() -> bool:
    init_db()
    with SessionLocal() as db:
        if (db.scalar(select(func.count()).select_from(User)) or 0) > 0:
            return False
    run_seed()
    return True


__all__ = ["DEMO_PASSWORD", "SeedContext", "reset_database", "run_seed", "seed_if_empty"]
