"""Notifications and extra activity-feed entries.

Runs after every other seeder, so it can point notifications at the tasks, goals and events
those seeders created. Anything another feature has not seeded (yet) falls back to a
generic link, which keeps this seeder independent of the others.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select

from .. import clock
from ..mastery import UNLOCK_THRESHOLD
from ..models import Attempt, ConceptProgress, Event, Goal, Membership, Task
from ..services.board import task_key, workspace_prefix
from ..services.events import notify, record
from ..services.review_queue import due_summary
from .context import SeedContext

# (workspace key, member key, days ago): recent arrivals, so the feed shows people joining.
RECENT_JOINS = (("biology", "priya", 3), ("northwind", "jonas", 10))


@dataclass(frozen=True)
class Planned:
    """One notification to create: when, for whom, and whether it has been read already."""

    days_ago: int
    hour: int
    user: str
    kind: str
    title: str
    body: str = ""
    link: str = ""
    workspace: str | None = None
    actor: str | None = None
    read: bool = False


def _open_tasks(ctx: SeedContext, workspace: str, assignee: str) -> list[Task]:
    return list(
        ctx.db.scalars(
            select(Task)
            .where(
                Task.workspace_id == ctx.workspaces[workspace].id,
                Task.assignee_id == ctx.users[assignee].id,
                Task.status != "done",
            )
            .order_by(Task.id)
        )
    )


def _task_ref(ctx: SeedContext, tasks: list[Task], index: int, fallback: str) -> tuple[str, str]:
    """(label, link) for the n-th task, or a generic board link when the board has not been seeded."""
    if index < len(tasks):
        task = tasks[index]
        workspace = next(w for w in ctx.workspaces.values() if w.id == task.workspace_id)
        key = task_key(workspace_prefix(workspace.name), task.number)
        return f"{key}: {task.title}", f"/board?task={task.number}"
    return fallback, "/board"


def _strongest(ctx: SeedContext, user: str, course: str) -> tuple[str, float] | None:
    """The user's best concept in a course, if it has reached the proficient level."""
    names = {c.id: c.name for c in ctx.courses[course].concepts}
    row = ctx.db.execute(
        select(ConceptProgress.concept_id, ConceptProgress.mastery)
        .where(ConceptProgress.user_id == ctx.users[user].id, ConceptProgress.concept_id.in_(names))
        .order_by(ConceptProgress.mastery.desc(), ConceptProgress.concept_id)
        .limit(1)
    ).first()
    if row is None or row.mastery < UNLOCK_THRESHOLD:
        return None
    return names[row.concept_id], row.mastery


def _first(ctx: SeedContext, query):
    return ctx.db.scalars(query.limit(1)).first()


def plan_notifications(ctx: SeedContext) -> list[Planned]:
    alex_tasks = _open_tasks(ctx, "northwind", "alex")
    sam_tasks = _open_tasks(ctx, "northwind", "sam")
    assigned, assigned_link = _task_ref(ctx, alex_tasks, 0, "Review the churn model notebook")
    older, older_link = _task_ref(ctx, alex_tasks, 1, "Draft the SQL practice set")
    sam_task, sam_link = _task_ref(ctx, sam_tasks, 0, "Clean up the evaluation metrics notes")
    due = due_summary(ctx.db, ctx.users["alex"].id, ctx.workspaces["northwind"].id)["due"]
    strongest = _strongest(ctx, "alex", "ml")
    goal = _first(
        ctx, select(Goal).where(Goal.user_id == ctx.users["alex"].id, Goal.archived.is_(False)).order_by(Goal.id)
    )
    exam = _first(
        ctx,
        select(Event)
        .where(Event.kind == "exam", Event.starts_at >= ctx.now, Event.workspace_id == ctx.workspaces["biology"].id)
        .order_by(Event.starts_at),
    )
    exam_title = exam.title if exam else "Cell Biology midterm"
    exam_day = (exam.starts_at if exam else ctx.ahead(4, 10)).strftime("%A %d %B")
    nn = ctx.courses["nn"]

    plans = [
        Planned(
            0,
            7,
            "alex",
            "review_due",
            f"{due} flashcards are due today" if due else "Keep your review streak going",
            "A short session now keeps them from piling up." if due else "Review a few cards to stay on track.",
            "/review",
            "northwind",
        ),
        Planned(
            0, 8, "alex", "event", f"{exam_title} on {exam_day}", "Plan a revision session.", "/planner", "biology"
        ),
        Planned(
            1, 16, "alex", "task_assigned", f"Maya assigned you {assigned}", "", assigned_link, "northwind", "maya"
        ),
        Planned(
            1,
            18,
            "alex",
            "comment",
            "Sam mentioned you in a comment",
            "@Alex could you double-check the join query before Friday?",
            assigned_link,
            "northwind",
            "sam",
        ),
        Planned(
            2,
            10,
            "alex",
            "system",
            f"Maya published {nn.title}",
            "A new advanced course is available in Northwind Data Academy.",
            f"/courses/{nn.id}",
            "northwind",
            "maya",
            read=True,
        ),
        Planned(
            2,
            20,
            "alex",
            "goal",
            f"Goal reached: {goal.title}" if goal else "Goal reached: weekly flashcard reviews",
            "Nice work. Set a slightly higher target to keep momentum.",
            "/goals",
            "northwind",
            read=True,
        ),
        Planned(
            3,
            9,
            "alex",
            "invite",
            "Priya accepted your invitation",
            "Priya Nair joined Biology 201 Study Group as a learner.",
            "/members",
            "biology",
            "priya",
            read=True,
        ),
        Planned(
            4,
            14,
            "alex",
            "comment",
            f"Jonas replied on {older}",
            "Added the index notes.",
            older_link,
            "northwind",
            "jonas",
            read=True,
        ),
        Planned(
            5, 11, "alex", "task_assigned", f"Maya assigned you {older}", "", older_link, "northwind", "maya", read=True
        ),
        Planned(
            6,
            18,
            "alex",
            "review_due",
            "Your review queue grew over the weekend",
            "Catch up on overdue cards to protect your retention.",
            "/review",
            "northwind",
            read=True,
        ),
        Planned(
            7,
            12,
            "alex",
            "event",
            "Live session: model evaluation Q&A starts in 1 hour",
            "Hosted by Maya in the Northwind study room.",
            "/planner",
            "northwind",
            "maya",
            read=True,
        ),
        Planned(
            8,
            9,
            "alex",
            "system",
            "Welcome to the new LearnLoop",
            "Plan study sessions, track tasks on the board and keep notes next to your courses.",
            "/",
            read=True,
        ),
        Planned(
            9,
            15,
            "alex",
            "goal",
            "You are behind on your study-time goal",
            "Two focused sessions this week would get you back on pace.",
            "/goals",
            "northwind",
            read=True,
        ),
        Planned(
            10,
            10,
            "alex",
            "invite",
            "Jonas joined Northwind Data Academy",
            "Jonas Weber accepted an invitation as an instructor.",
            "/members",
            "northwind",
            "jonas",
            read=True,
        ),
        Planned(0, 6, "sam", "review_due", "Flashcards are waiting for you", "", "/review", "northwind"),
        Planned(1, 15, "sam", "task_assigned", f"Maya assigned you {sam_task}", "", sam_link, "northwind", "maya"),
        Planned(
            3,
            17,
            "sam",
            "comment",
            "Alex commented on your task",
            "Looks good, merged!",
            sam_link,
            "northwind",
            "alex",
            read=True,
        ),
        Planned(
            1,
            18,
            "maya",
            "comment",
            "Sam mentioned you in a comment",
            "@Maya is this due Friday?",
            assigned_link,
            "northwind",
            "sam",
        ),
        Planned(
            10, 10, "maya", "invite", "Jonas accepted your invitation", "", "/members", "northwind", "jonas", read=True
        ),
    ]
    if strongest:
        concept, mastery = strongest
        plans.append(
            Planned(
                1,
                19,
                "alex",
                "mastery",
                f"Milestone: {concept} is now proficient",
                f"{concept} reached {round(mastery)}% in {ctx.courses['ml'].title}. Mastery starts at 85%.",
                f"/courses/{ctx.courses['ml'].id}",
                "northwind",
            )
        )
    return plans


def seed_notifications(ctx: SeedContext) -> None:
    for plan in plan_notifications(ctx):
        with clock.travel(ctx.at(plan.days_ago, plan.hour)):
            notification = notify(
                ctx.db,
                user_id=ctx.users[plan.user].id,
                kind=plan.kind,
                title=plan.title,
                body=plan.body,
                link=plan.link,
                workspace_id=ctx.workspaces[plan.workspace].id if plan.workspace else None,
                actor_id=ctx.users[plan.actor].id if plan.actor else None,
            )
        if notification is not None and plan.read:
            notification.read_at = min(notification.created_at + timedelta(hours=3), ctx.now)


def seed_member_activity(ctx: SeedContext) -> None:
    """A "joined the workspace" entry per member; a few arrivals are moved to recent days."""
    recent = {(ws, user): days for ws, user, days in RECENT_JOINS}
    for ws_key, workspace in ctx.workspaces.items():
        memberships = ctx.db.scalars(
            select(Membership).where(Membership.workspace_id == workspace.id).order_by(Membership.id)
        )
        keys = {user.id: key for key, user in ctx.users.items()}
        for membership in memberships:
            if membership.role == "owner":
                continue
            days = recent.get((ws_key, keys.get(membership.user_id)))
            if days is not None:
                membership.joined_at = ctx.at(days, 9, 30)
            with clock.travel(membership.joined_at):
                record(
                    ctx.db,
                    workspace_id=workspace.id,
                    actor_id=membership.user_id,
                    verb="member.joined",
                    object_type="member",
                    object_id=membership.user_id,
                    summary=f"joined {workspace.name} as {membership.role}",
                    link="/members",
                )


def seed_course_activity(ctx: SeedContext) -> None:
    nn = ctx.courses["nn"]
    with clock.travel(ctx.at(2, 10)):
        record(
            ctx.db,
            workspace_id=nn.workspace_id,
            actor_id=nn.owner_id,
            verb="course.published",
            object_type="course",
            object_id=nn.id,
            summary=f"published {nn.title}",
            link=f"/courses/{nn.id}",
            detail=nn.description,
        )


def seed_quiz_sessions(ctx: SeedContext) -> None:
    """One feed entry per practice session (a learner's answers in one course on one day)."""
    sessions: dict[tuple[int, int, str], list[Attempt]] = defaultdict(list)
    for attempt in ctx.db.scalars(select(Attempt).order_by(Attempt.created_at, Attempt.id)):
        sessions[(attempt.user_id, attempt.course_id, attempt.created_at.date().isoformat())].append(attempt)
    courses = {course.id: course for course in ctx.courses.values()}
    for (user_id, course_id, _), attempts in sessions.items():
        course = courses[course_id]
        correct = sum(a.correct for a in attempts)
        finished: datetime = attempts[-1].created_at
        with clock.travel(finished + timedelta(minutes=1)):
            record(
                ctx.db,
                workspace_id=course.workspace_id,
                actor_id=user_id,
                verb="quiz.completed",
                object_type="course",
                object_id=course.id,
                summary=f"practised {course.title}: {correct} of {len(attempts)} correct",
                link=f"/courses/{course.id}",
            )


def seed(ctx: SeedContext) -> None:
    seed_member_activity(ctx)
    seed_course_activity(ctx)
    seed_quiz_sessions(ctx)
    seed_notifications(ctx)
