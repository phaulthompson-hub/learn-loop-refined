"""Calendar events, goals and logged study time.

Everything is placed around the anchor week (Monday 14 March 2022 in the frozen demo):
Alex's recurring study sessions and weekday review block, the shared Northwind SQL workshop
(which Alex's pair-study session overlaps, to show the week view's overlap layout), a
statistics deadline, the Biology midterm, and goals whose progress comes from the quiz history
in `core.py` plus the study logs below. The logs follow the quiz days in `core.HISTORY`, so Alex
has a current streak ending today and a longer best run five weeks ago.
"""

from datetime import date, timedelta

from .. import clock
from ..models import Event, Goal, StudyLog
from ..services.events import record
from .context import SeedContext

# (workspace, owner, title, kind, course, start (days_ago, hour, minute), minutes or None for all-day,
#  recurrence, repeat-until days ahead, shared, location, notes)
EVENTS = (
    (
        "northwind",
        "alex",
        "Evening ML study",
        "study",
        "ml",
        (21, 18, 0),
        90,
        "weekly",
        42,
        False,
        "Home desk",
        "One concept per session, then a 4-question quiz.",
    ),
    (
        "northwind",
        "alex",
        "Midweek statistics practice",
        "study",
        "stats",
        (19, 18, 30),
        90,
        "weekly",
        42,
        False,
        "",
        "Work through the problem set before looking at the solutions.",
    ),
    (
        "northwind",
        "alex",
        "Flashcard review block",
        "review",
        None,
        (14, 7, 30),
        30,
        "weekdays",
        None,
        False,
        "",
        "Clear the due queue before work.",
    ),
    ("northwind", "alex", "Mock quiz: ML basics", "review", "ml", (5, 17, 0), 45, "none", None, False, "", ""),
    (
        "northwind",
        "alex",
        "Pair study with Sam",
        "study",
        "sql",
        (-2, 15, 45),
        60,
        "none",
        None,
        False,
        "Library room 2",
        "Compare notes on joins and GROUP BY.",
    ),
    ("northwind", "alex", "Read: regularisation chapter", "study", "ml", (-5, 10, 0), 90, "none", None, False, "", ""),
    (
        "northwind",
        "maya",
        "SQL workshop: window functions",
        "live",
        "sql",
        (-2, 15, 0),
        90,
        "none",
        None,
        True,
        "Zoom",
        "Bring a laptop with the Northwind sample database loaded.\nRecording shared afterwards.",
    ),
    (
        "northwind",
        "maya",
        "Statistics quiz 1 closes",
        "deadline",
        "stats",
        (10, 0, 0),
        None,
        "none",
        None,
        True,
        "",
        "",
    ),
    (
        "northwind",
        "maya",
        "Statistics quiz 2 closes",
        "deadline",
        "stats",
        (-4, 0, 0),
        None,
        "none",
        None,
        True,
        "",
        "Covers confidence intervals and hypothesis testing.",
    ),
    (
        "northwind",
        "maya",
        "Office hours",
        "live",
        None,
        (11, 16, 0),
        60,
        "weekly",
        38,
        True,
        "Room 4.12",
        "Drop in with any course question.",
    ),
    ("northwind", "jonas", "Data modelling clinic", "live", "sql", (-8, 14, 0), 60, "none", None, True, "Zoom", ""),
    ("northwind", "sam", "SQL practice", "study", "sql", (-1, 19, 0), 60, "none", None, False, "", ""),
    ("northwind", "sam", "ML quiz practice", "study", "ml", (13, 9, 0), 45, "weekly", 28, False, "", ""),
    ("northwind", "priya", "Stats revision", "study", "stats", (-3, 12, 0), 60, "none", None, False, "", ""),
    (
        "biology",
        "alex",
        "Biology midterm",
        "exam",
        "cells",
        (-9, 10, 0),
        120,
        "none",
        None,
        True,
        "Hall B",
        "Chapters 1-4. Bring a pencil and your student card.",
    ),
    ("biology", "alex", "Cell membrane drill", "review", "cells", (6, 20, 0), 30, "weekly", 9, False, "", ""),
    (
        "biology",
        "lena",
        "Genetics review session",
        "live",
        "genetics",
        (-7, 17, 0),
        90,
        "none",
        None,
        True,
        "Lab 3",
        "Past-paper questions on inheritance.",
    ),
)

# (workspace, user, title, kind, period, target, course, due days ahead, archived, created days ago)
GOALS = (
    ("northwind", "alex", "Answer 8 questions a day", "daily_answers", "day", 8, None, None, False, 20),
    ("northwind", "alex", "40 flashcard reviews a week", "weekly_reviews", "week", 40, None, None, False, 20),
    ("northwind", "alex", "3 hours of focused study", "study_minutes", "week", 180, None, None, False, 18),
    ("northwind", "alex", "Reach 80% on Machine Learning", "course_mastery", "once", 80, "ml", 21, False, 14),
    ("northwind", "alex", "SQL foundations to 60%", "course_mastery", "once", 60, "sql", None, True, 30),
    ("biology", "alex", "Cells ready for the midterm", "course_mastery", "once", 70, "cells", 9, False, 10),
    ("northwind", "sam", "Answer 5 questions a day", "daily_answers", "day", 5, None, None, False, 12),
    ("northwind", "sam", "Master SQL", "course_mastery", "once", 85, "sql", 30, False, 12),
    ("northwind", "maya", "Two hours of course prep", "study_minutes", "week", 120, None, None, False, 25),
    ("northwind", "priya", "25 reviews a week", "weekly_reviews", "week", 25, None, None, False, 8),
)

# (days_ago, hour, minutes, activity, course, note) - quiz-day logs mirror core.HISTORY sessions.
ALEX_LOGS = (
    (0, 8, 20, "flashcards", None, "Morning review block"),
    (1, 18, 35, "quiz", "ml", "Precision and recall drills"),
    (1, 12, 20, "quiz", "stats", ""),
    (2, 19, 30, "quiz", "ml", ""),
    (2, 17, 25, "reading", "cells", "Membrane transport notes"),
    (3, 20, 40, "quiz", "sql", "Joins practice"),
    (3, 18, 20, "quiz", "ml", ""),
    (4, 18, 45, "reading", "ml", "Regularisation chapter"),
    (5, 12, 30, "quiz", "stats", ""),
    (6, 7, 25, "quiz", "ml", "Early session before work"),
    (7, 17, 35, "flashcards", "cells", ""),
    (8, 20, 50, "quiz", "sql", "Window functions preview"),
    (9, 19, 40, "quiz", "ml", ""),
    (10, 12, 30, "reading", "stats", "Central limit theorem examples"),
    (11, 17, 30, "quiz", "cells", ""),
    (12, 18, 45, "quiz", "ml", ""),
    (14, 12, 25, "quiz", "stats", ""),
    (15, 8, 30, "quiz", "ml", ""),
    (18, 19, 35, "quiz", "ml", ""),
    (20, 18, 40, "reading", "ml", "Started the ML course"),
)
# Alex's best run: every day from 46 to 21 days ago (joining the quiz day 20 days ago), so the
# historical best (27 days) stays longer than the current streak.
BEST_RUN_DAYS = range(21, 47)
BEST_RUN_PATTERN = (("reading", "ml"), ("manual", None), ("reading", "stats"), ("manual", "sql"))

OTHER_LOGS = (
    ("sam", 1, 21, 40, "quiz", "sql", ""),
    ("sam", 2, 9, 30, "quiz", "ml", ""),
    ("sam", 6, 21, 45, "quiz", "sql", "Aggregates"),
    ("sam", 9, 9, 30, "reading", "ml", ""),
    ("sam", 13, 21, 50, "quiz", "sql", ""),
    ("maya", 1, 16, 60, "manual", "sql", "Workshop slides"),
    ("maya", 3, 15, 45, "manual", "stats", "Quiz 2 questions"),
    ("maya", 8, 10, 30, "manual", None, "Course planning"),
    ("priya", 4, 10, 25, "quiz", "stats", ""),
    ("priya", 12, 10, 20, "reading", "stats", ""),
)


def _until(ctx: SeedContext, days_ahead: int | None) -> date | None:
    return None if days_ahead is None else ctx.ahead(days_ahead).date()


def seed_events(ctx: SeedContext) -> None:
    for (
        ws,
        owner,
        title,
        kind,
        course,
        (days_ago, hour, minute),
        minutes,
        recurrence,
        until,
        shared,
        location,
        notes,
    ) in EVENTS:
        start = ctx.at(days_ago, hour, minute)
        end = start + (timedelta(days=1) if minutes is None else timedelta(minutes=minutes))
        created = min(ctx.now, start) - timedelta(days=7)
        event = Event(
            workspace_id=ctx.workspaces[ws].id,
            user_id=ctx.users[owner].id,
            course_id=ctx.courses[course].id if course else None,
            title=title,
            kind=kind,
            starts_at=start,
            ends_at=end,
            all_day=minutes is None,
            location=location,
            notes=notes,
            recurrence=recurrence,
            recurrence_until=_until(ctx, until) if recurrence != "none" else None,
            shared=shared,
            created_at=created,
        )
        ctx.db.add(event)
        ctx.db.flush()
        if shared:
            with clock.travel(created):
                record(
                    ctx.db,
                    workspace_id=event.workspace_id,
                    actor_id=event.user_id,
                    verb="event.created",
                    object_type="event",
                    object_id=event.id,
                    summary=f"scheduled {title}",
                    link=f"/planner?date={start.date().isoformat()}&event={event.id}",
                )


def seed_goals(ctx: SeedContext) -> None:
    for ws, user, title, kind, period, target, course, due, archived, created in GOALS:
        ctx.db.add(
            Goal(
                workspace_id=ctx.workspaces[ws].id,
                user_id=ctx.users[user].id,
                course_id=ctx.courses[course].id if course else None,
                title=title,
                kind=kind,
                period=period,
                target=target,
                due_date=ctx.ahead(due).date() if due is not None else None,
                archived=archived,
                created_at=ctx.at(created, 9),
            )
        )


def _log(
    ctx: SeedContext, user: str, days_ago: int, hour: int, minutes: int, activity: str, course: str | None, note: str
) -> None:
    ctx.db.add(
        StudyLog(
            user_id=ctx.users[user].id,
            course_id=ctx.courses[course].id if course else None,
            minutes=minutes,
            activity=activity,
            note=note,
            logged_at=ctx.at(days_ago, hour),
        )
    )


def seed_study_logs(ctx: SeedContext) -> None:
    for days_ago, hour, minutes, activity, course, note in ALEX_LOGS:
        _log(ctx, "alex", days_ago, hour, minutes, activity, course, note)
    for index, days_ago in enumerate(BEST_RUN_DAYS):
        activity, course = BEST_RUN_PATTERN[index % len(BEST_RUN_PATTERN)]
        _log(ctx, "alex", days_ago, 19, 20 + (index * 7) % 5 * 10, activity, course, "")
    for user, days_ago, hour, minutes, activity, course, note in OTHER_LOGS:
        _log(ctx, user, days_ago, hour, minutes, activity, course, note)


def seed(ctx: SeedContext) -> None:
    seed_events(ctx)
    seed_goals(ctx)
    seed_study_logs(ctx)
