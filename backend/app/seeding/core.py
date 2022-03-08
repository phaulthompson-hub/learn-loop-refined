"""Users, workspaces, memberships, courses, enrollments and quiz history."""

from .. import clock
from ..models import Enrollment
from ..quiz import answer_key, question_id
from ..services.accounts import add_member, create_user, create_workspace
from ..services.learning import create_course, grade_answer, learner_course
from .context import DEMO_PASSWORD, SeedContext
from .materials import BIOLOGY_MATERIALS, NORTHWIND_MATERIALS

# key, name, email, headline, avatar colour
USERS = (
    ("alex", "Alex Rivera", "demo@learnloop.dev", "Data analyst learning ML", "#1d6d45"),
    ("maya", "Maya Chen", "maya@learnloop.dev", "Lead instructor, Northwind Data Academy", "#9333ea"),
    ("sam", "Sam Okafor", "sam@learnloop.dev", "Backend engineer", "#2563eb"),
    ("priya", "Priya Nair", "priya@learnloop.dev", "Product analyst", "#c2410c"),
    ("jonas", "Jonas Weber", "jonas@learnloop.dev", "BI developer", "#0f766e"),
    ("lena", "Lena Kovacs", "lena@learnloop.dev", "Biology TA", "#be123c"),
)

# workspace key -> (name, description, colour, owner key, [(member key, role)])
WORKSPACES = {
    "northwind": (
        "Northwind Data Academy",
        "Team learning space for the analytics guild: ML, statistics and SQL tracks.",
        "#1d6d45",
        "maya",
        [("alex", "admin"), ("sam", "learner"), ("priya", "learner"), ("jonas", "instructor")],
    ),
    "biology": (
        "Biology 201 Study Group",
        "Shared notes, flashcards and exam prep for BIO 201.",
        "#be123c",
        "alex",
        [("lena", "instructor"), ("priya", "learner")],
    ),
}

# (user, course) -> list of (days_ago, hour, [(concept order index, correct?)])
# Written out explicitly so the demo tells a clear story and stays reproducible.
HISTORY: dict[tuple[str, str], list[tuple[int, int, list[tuple[int, bool]]]]] = {
    ("alex", "ml"): [
        (20, 18, [(0, True), (0, False), (1, False)]),
        (18, 19, [(0, True), (0, True), (1, True)]),
        (15, 8, [(0, True), (1, True), (2, False)]),
        (12, 18, [(1, True), (2, True), (2, False), (3, False)]),
        (9, 19, [(2, True), (2, True), (3, True)]),
        (6, 7, [(3, True), (3, False), (4, False)]),
        (4, 18, [(3, True), (4, True), (4, True)]),
        (3, 18, [(4, True), (5, False), (0, True)]),
        (2, 19, [(5, True), (5, False), (1, True)]),
        (1, 18, [(5, True), (4, True), (2, True)]),
    ],
    ("alex", "stats"): [
        (14, 12, [(0, True), (0, True), (1, False)]),
        (10, 12, [(1, True), (0, True), (1, True)]),
        (5, 12, [(1, True), (2, False), (2, True)]),
        (1, 12, [(2, True), (3, False)]),
    ],
    ("alex", "sql"): [
        (8, 20, [(0, True), (0, True), (1, True)]),
        (3, 20, [(1, True), (2, False), (2, True)]),
    ],
    ("alex", "cells"): [
        (11, 17, [(0, True), (1, True), (1, True)]),
        (7, 17, [(2, False), (2, True), (3, True)]),
        (2, 17, [(3, True), (4, False)]),
    ],
    ("sam", "ml"): [
        (16, 9, [(0, True), (0, True), (1, True)]),
        (9, 9, [(1, True), (2, True), (2, True)]),
        (2, 9, [(3, True), (3, True), (4, False)]),
    ],
    ("sam", "sql"): [
        (13, 21, [(0, True), (1, True), (1, True), (2, True)]),
        (6, 21, [(2, True), (3, True), (3, True), (4, True)]),
        (1, 21, [(4, True), (5, True), (5, True)]),
    ],
    ("priya", "stats"): [
        (12, 10, [(0, True), (1, False), (1, True)]),
        (4, 10, [(1, True), (2, True), (2, False)]),
    ],
    ("priya", "ml"): [(6, 16, [(0, False), (0, True)])],
    ("jonas", "sql"): [
        (17, 14, [(0, True), (0, True), (1, True)]),
        (8, 14, [(1, True), (2, True), (3, False)]),
    ],
    ("jonas", "nn"): [(5, 15, [(0, True), (1, False), (1, True)])],
    ("lena", "genetics"): [(9, 11, [(0, True), (1, True), (2, True)])],
    ("priya", "cells"): [(3, 13, [(0, True), (0, False), (1, True)])],
}

ENROLLMENTS = {
    "alex": ["ml", "stats", "sql", "cells", "genetics"],
    "sam": ["ml", "sql"],
    "priya": ["stats", "ml", "cells"],
    "jonas": ["sql", "nn"],
    "maya": ["ml", "stats", "sql", "nn", "viz"],
    "lena": ["cells", "genetics"],
}
PINNED = {("alex", "ml"), ("alex", "cells")}
# How recently each learner opened a course (days ago); drives "continue where you left off".
LAST_OPENED = {("alex", "ml"): 1, ("alex", "stats"): 1, ("alex", "sql"): 3, ("alex", "cells"): 2, ("sam", "sql"): 1}


def seed_people(ctx: SeedContext) -> None:
    with clock.travel(ctx.at(60)):
        for key, name, email, headline, color in USERS:
            ctx.users[key] = create_user(
                ctx.db, name=name, email=email, password=DEMO_PASSWORD, headline=headline, avatar_color=color
            )
        for key, (name, description, color, owner_key, members) in WORKSPACES.items():
            workspace = create_workspace(
                ctx.db, owner=ctx.users[owner_key], name=name, description=description, color=color
            )
            ctx.workspaces[key] = workspace
            ctx.members[key] = [owner_key]
            for member_key, role in members:
                add_member(ctx.db, workspace, ctx.users[member_key], role)
                ctx.members[key].append(member_key)
    ctx.users["alex"].last_workspace_id = ctx.workspaces["northwind"].id
    ctx.db.commit()


def seed_courses(ctx: SeedContext) -> None:
    owners = {"northwind": ["maya", "maya", "jonas", "maya", "maya"], "biology": ["lena", "lena"]}
    for ws_key, materials in (("northwind", NORTHWIND_MATERIALS), ("biology", BIOLOGY_MATERIALS)):
        for index, material in enumerate(materials):
            with clock.travel(ctx.at(45 - index * 3, 10)):
                course = create_course(
                    ctx.db,
                    workspace_id=ctx.workspaces[ws_key].id,
                    owner=ctx.users[owners[ws_key][index]],
                    title=material.title,
                    text=material.text,
                    source_name=material.source_name,
                    description=material.description,
                    subject=material.subject,
                    difficulty=material.difficulty,
                    tags=material.tags,
                    status=material.status,
                )
            ctx.courses[material.key] = course
            ctx.course_workspace[material.key] = ws_key


def seed_enrollments(ctx: SeedContext) -> None:
    for user_key, course_keys in ENROLLMENTS.items():
        user = ctx.users[user_key]
        for index, course_key in enumerate(course_keys):
            course = ctx.courses[course_key]
            enrollment = next((e for e in course.enrollments if e.user_id == user.id), None)
            if enrollment is None:
                enrollment = Enrollment(user_id=user.id, course_id=course.id, enrolled_at=ctx.at(40 - index, 11))
                ctx.db.add(enrollment)
            enrollment.pinned = (user_key, course_key) in PINNED
            days = LAST_OPENED.get((user_key, course_key))
            enrollment.last_opened_at = ctx.at(days, 19) if days is not None else None
    ctx.db.commit()


def seed_history(ctx: SeedContext) -> None:
    for (user_key, course_key), sessions in HISTORY.items():
        user, course = ctx.users[user_key], ctx.courses[course_key]
        for days_ago, hour, answers in sessions:
            for minute, (order_index, correct) in enumerate(answers):
                view = learner_course(ctx.db, course, user.id)
                concept = next((c for c in view.concepts if c.order_index == order_index), None)
                if concept is None:
                    continue
                qid = question_id(course.id, concept.id)
                key = answer_key(view, qid, concept.id)
                with clock.travel(ctx.at(days_ago, hour, minute * 2)):
                    grade_answer(ctx.db, course, user, qid, concept.id, key if correct else (key + 1) % 4)
    # Keep the "last opened" timestamps from seed_enrollments rather than the grading side effect.
    seed_enrollments(ctx)


def seed(ctx: SeedContext) -> None:
    seed_people(ctx)
    seed_courses(ctx)
    seed_enrollments(ctx)
    seed_history(ctx)
