"""Study-board tasks, labels, checklists and comments.

Tasks are written out explicitly (no randomness) so the board tells a coherent story around
the anchor day: a few overdue items, something due today, a busy "In progress" column and a
recent trail of finished work.
"""

from dataclasses import dataclass, field

from ..models import ChecklistItem, Label, Task, TaskComment
from ..services.ordering import evenly_spaced
from .context import SeedContext

LABELS = (
    ("Reading", "#2563eb"),
    ("Practice", "#1d6d45"),
    ("Exam prep", "#c2410c"),
    ("Project", "#9333ea"),
    ("Blocked", "#be123c"),
    ("Group work", "#0f766e"),
)


@dataclass(frozen=True)
class SeedTask:
    status: str
    title: str
    priority: str
    assignee: str | None
    reporter: str
    due: int | None  # days from the anchor day; negative is in the past
    estimate: int | None
    course: str | None
    labels: tuple[str, ...]
    description: str = ""
    created: int = 10  # days ago
    completed: int | None = None  # days ago, for done tasks
    checklist: tuple[tuple[str, bool], ...] = ()
    # (author, days ago, hour, body)
    comments: tuple[tuple[str, int, int, str], ...] = field(default=())


NORTHWIND_TASKS = (
    SeedTask(
        "backlog",
        "Build a flashcard deck for window functions",
        "low",
        None,
        "jonas",
        None,
        3,
        "sql",
        ("Practice",),
        "ROW_NUMBER, RANK, LAG/LEAD and running totals. One card per pattern, with a tiny example table.",
        created=14,
    ),
    SeedTask(
        "backlog",
        "Summarise the bias-variance trade-off in one page",
        "medium",
        "priya",
        "maya",
        12,
        2,
        "ml",
        ("Reading",),
        "Use the overfitting section of the ML course as the starting point. Include one diagram.",
        created=9,
    ),
    SeedTask(
        "backlog",
        "Plan the capstone dataset for the ML track",
        "medium",
        None,
        "maya",
        20,
        5,
        "ml",
        ("Project", "Group work"),
        "Shortlist three public datasets with a clear prediction target and fewer than 100k rows.",
        created=6,
        checklist=(("Shortlist candidate datasets", False), ("Check licences", False), ("Pick one as a group", False)),
    ),
    SeedTask(
        "backlog",
        "Sketch a small-multiples dashboard for the survey results",
        "low",
        "jonas",
        "jonas",
        None,
        3,
        "viz",
        ("Project",),
        "Paper sketch first, then a rough version in the BI tool.",
        created=4,
    ),
    SeedTask(
        "todo",
        "Finish gradient descent exercises",
        "high",
        "alex",
        "maya",
        2,
        3,
        "ml",
        ("Practice",),
        "Exercises 3.1 to 3.4 from the ML track. Plot the loss curve for three learning rates.",
        created=8,
        checklist=(
            ("3.1 Derive the update rule", True),
            ("3.2 Implement batch gradient descent", False),
            ("3.3 Compare learning rates 0.001 / 0.01 / 0.1", False),
            ("3.4 Write up what overshooting looks like", False),
        ),
        comments=(
            ("maya", 5, 14, "Remember to scale the features first, otherwise 0.1 diverges immediately."),
            ("alex", 4, 19, "Thanks! Standardising fixed it. Plots coming tomorrow."),
        ),
    ),
    SeedTask(
        "todo",
        "Draft SQL join cheat sheet",
        "medium",
        "sam",
        "jonas",
        4,
        2,
        "sql",
        ("Reading", "Practice"),
        "Inner, left, full outer and anti-joins with a Venn-free explanation and one query each.",
        created=7,
    ),
    SeedTask(
        "todo",
        "Read chapter 4: confidence intervals",
        "medium",
        "priya",
        "maya",
        -1,
        2,
        "stats",
        ("Reading",),
        "Focus on what a 95% interval does and does not mean.",
        created=11,
    ),
    SeedTask(
        "todo",
        "Practice p-value interpretation quiz",
        "high",
        "alex",
        "alex",
        0,
        1,
        "stats",
        ("Exam prep",),
        "Two rounds of the hypothesis-testing quiz; aim for 80%+.",
        created=3,
    ),
    SeedTask(
        "todo",
        "Set up a shared notebook template for the guild",
        "low",
        "sam",
        "alex",
        9,
        2,
        None,
        ("Group work",),
        "Standard header, data loading cell and a results section so reviews are quicker.",
        created=5,
    ),
    SeedTask(
        "in_progress",
        "Implement backpropagation by hand for a 2-layer net",
        "urgent",
        "jonas",
        "maya",
        1,
        5,
        "nn",
        ("Practice",),
        "NumPy only. Verify gradients numerically before training on the toy dataset.",
        created=12,
        checklist=(
            ("Forward pass", True),
            ("Loss and its derivative", True),
            ("Backward pass for the hidden layer", False),
            ("Numerical gradient check", False),
            ("Train on the toy dataset", False),
        ),
        comments=(
            ("jonas", 3, 16, "Forward pass and loss are done. The hidden layer gradient is off by a factor of 2."),
            ("maya", 2, 10, "@Jonas check whether you average the loss over the batch in both places."),
            ("jonas", 1, 18, "That was it. Gradient check next."),
        ),
    ),
    SeedTask(
        "in_progress",
        "Normalise the Northwind orders schema to 3NF",
        "high",
        "sam",
        "jonas",
        -2,
        5,
        "sql",
        ("Project", "Blocked"),
        "Split the flat orders export into customers, orders, order_lines and products.",
        created=13,
        checklist=(("Identify repeating groups", True), ("Draw the ER diagram", True), ("Write the DDL", False)),
        comments=(
            ("sam", 3, 11, "Blocked: the export has two different customer ids for the same company."),
            ("jonas", 2, 15, "@Sam Okafor use the billing email as the natural key for now and note it."),
        ),
    ),
    SeedTask(
        "in_progress",
        "Review precision vs recall with worked examples",
        "medium",
        "alex",
        "alex",
        3,
        2,
        "ml",
        ("Exam prep",),
        "Spam filter and medical test examples; compute F1 by hand.",
        created=4,
        checklist=(("Spam filter example", True), ("Medical test example", False)),
    ),
    SeedTask(
        "in_progress",
        "Replicate the central limit theorem simulation",
        "medium",
        "priya",
        "maya",
        5,
        3,
        "stats",
        ("Practice",),
        "Sample means from an exponential population for n = 2, 10, 50.",
        created=6,
    ),
    SeedTask(
        "in_progress",
        "Collect examples of misleading bar charts",
        "low",
        "maya",
        "maya",
        6,
        1,
        "viz",
        ("Reading",),
        "Five real examples for Thursday's session, each with a corrected version.",
        created=2,
    ),
    SeedTask(
        "review",
        "Peer-review Priya's regression notebook",
        "high",
        "alex",
        "priya",
        0,
        2,
        "ml",
        ("Group work",),
        "Check the train/validation split and whether the residual plots support the conclusion.",
        created=5,
        checklist=(("Run the notebook top to bottom", True), ("Check the split", True), ("Leave comments", False)),
        comments=(
            (
                "priya",
                4,
                9,
                "Notebook is in the shared folder. The residuals section is the part I'm least sure about.",
            ),
            ("alex", 1, 20, "@Priya the split leaks: you scale before splitting. Otherwise it reads really well."),
            ("priya", 0, 8, "Good catch, fixing it this morning."),
        ),
    ),
    SeedTask(
        "review",
        "Check indexing exercise answers",
        "medium",
        "jonas",
        "sam",
        1,
        1,
        "sql",
        ("Practice",),
        "Answers for the composite index exercises; I'm unsure about question 4.",
        created=4,
        comments=(("sam", 2, 21, "Question 4 is the one with the range condition on the first column."),),
    ),
    SeedTask(
        "review",
        "Proofread the statistics glossary",
        "low",
        "maya",
        "priya",
        -3,
        1,
        "stats",
        ("Reading",),
        "About 40 terms; flag anything that contradicts the course material.",
        created=10,
    ),
    SeedTask(
        "review",
        "Dropout vs batch norm comparison write-up",
        "medium",
        "sam",
        "jonas",
        2,
        3,
        "nn",
        ("Exam prep",),
        "One page: what each does, when it helps, and how they interact.",
        created=7,
    ),
    SeedTask(
        "done",
        "Watch the linear regression walkthrough",
        "medium",
        "alex",
        "maya",
        -5,
        1,
        "ml",
        ("Reading",),
        created=12,
        completed=6,
    ),
    SeedTask(
        "done",
        "Solve 10 GROUP BY practice problems",
        "medium",
        "sam",
        "jonas",
        -3,
        2,
        "sql",
        ("Practice",),
        created=9,
        completed=3,
        checklist=(("Problems 1-5", True), ("Problems 6-10", True)),
    ),
    SeedTask(
        "done",
        "Mock exam: descriptive statistics",
        "high",
        "priya",
        "maya",
        -2,
        3,
        "stats",
        ("Exam prep",),
        created=8,
        completed=2,
        comments=(("priya", 2, 17, "Scored 17/20. Standard deviation questions still trip me up."),),
    ),
    SeedTask(
        "done",
        "Agree on the study group's weekly rhythm",
        "low",
        "maya",
        "maya",
        -8,
        1,
        None,
        ("Group work",),
        "Monday planning, Thursday review session, Friday demo of anything finished.",
        created=15,
        completed=9,
    ),
    SeedTask(
        "done",
        "Activation functions flashcards",
        "low",
        "jonas",
        "jonas",
        -1,
        1,
        "nn",
        ("Practice",),
        created=5,
        completed=1,
    ),
)

BIOLOGY_TASKS = (
    SeedTask(
        "backlog",
        "Collect past exam questions on meiosis",
        "medium",
        None,
        "lena",
        14,
        2,
        "cells",
        ("Exam prep",),
        "The last three years of BIO 201 finals are in the library archive.",
        created=6,
    ),
    SeedTask(
        "todo",
        "Draw the cellular respiration pathway from memory",
        "high",
        "alex",
        "lena",
        2,
        2,
        "cells",
        ("Practice",),
        "Glycolysis, Krebs cycle and the electron transport chain, with ATP counts.",
        created=5,
        checklist=(("Glycolysis", True), ("Krebs cycle", False), ("Electron transport chain", False)),
    ),
    SeedTask(
        "todo",
        "Punnett square drills: dihybrid crosses",
        "medium",
        "priya",
        "alex",
        5,
        3,
        "genetics",
        ("Practice",),
        "Twenty crosses; check the 9:3:3:1 ratio appears where it should.",
        created=3,
    ),
    SeedTask(
        "in_progress",
        "Annotated diagram of the eukaryotic cell",
        "medium",
        "priya",
        "lena",
        -1,
        3,
        "cells",
        ("Project",),
        "Label every organelle with its function in one line.",
        created=8,
        comments=(
            ("lena", 2, 12, "Don't forget the smooth vs rough ER distinction."),
            ("priya", 1, 21, "Added. Golgi and lysosomes still to do."),
        ),
    ),
    SeedTask(
        "in_progress",
        "Summarise Mendel's laws with examples",
        "medium",
        "alex",
        "alex",
        3,
        2,
        "genetics",
        ("Reading",),
        created=4,
    ),
    SeedTask(
        "review",
        "Lab report: osmosis in potato cells",
        "high",
        "lena",
        "alex",
        0,
        5,
        "cells",
        ("Project", "Group work"),
        "Method, results table, graph of mass change against concentration, discussion.",
        created=9,
        checklist=(("Method", True), ("Results table", True), ("Graph", True), ("Discussion", False)),
        comments=(("alex", 1, 19, "@Lena Kovacs draft is ready for your review; the discussion is still thin."),),
    ),
    SeedTask(
        "done",
        "Glossary of genetics terms",
        "low",
        "lena",
        "lena",
        -4,
        1,
        "genetics",
        ("Reading",),
        created=10,
        completed=4,
    ),
    SeedTask(
        "done",
        "Mitosis vs meiosis comparison table",
        "medium",
        "alex",
        "lena",
        -6,
        2,
        "cells",
        ("Exam prep",),
        created=11,
        completed=5,
    ),
)


def seed_labels(ctx: SeedContext, workspace_key: str) -> dict[str, Label]:
    workspace = ctx.workspaces[workspace_key]
    labels = {name: Label(workspace_id=workspace.id, name=name, color=color) for name, color in LABELS}
    ctx.db.add_all(labels.values())
    ctx.db.flush()
    return labels


def seed_tasks(ctx: SeedContext, workspace_key: str, specs: tuple[SeedTask, ...], labels: dict[str, Label]) -> None:
    workspace = ctx.workspaces[workspace_key]
    positions = {
        status: iter(evenly_spaced(sum(1 for s in specs if s.status == status))) for status in {s.status for s in specs}
    }
    for number, spec in enumerate(specs, start=1):
        created_at = ctx.at(spec.created, 10)
        comments = [
            TaskComment(author_id=ctx.users[author].id, body=body, created_at=ctx.at(days, hour))
            for author, days, hour, body in spec.comments
        ]
        completed_at = ctx.at(spec.completed, 17) if spec.completed is not None else None
        updated_at = max([created_at, *(c.created_at for c in comments), *([completed_at] if completed_at else [])])
        ctx.db.add(
            Task(
                workspace_id=workspace.id,
                course_id=ctx.courses[spec.course].id if spec.course else None,
                number=number,
                title=spec.title,
                description=spec.description,
                status=spec.status,
                priority=spec.priority,
                assignee_id=ctx.users[spec.assignee].id if spec.assignee else None,
                reporter_id=ctx.users[spec.reporter].id,
                due_date=ctx.ahead(spec.due).date() if spec.due is not None else None,
                estimate=spec.estimate,
                position=next(positions[spec.status]),
                created_at=created_at,
                updated_at=updated_at,
                completed_at=completed_at,
                labels=[labels[name] for name in spec.labels],
                checklist=[
                    ChecklistItem(text=text, done=done, position=i) for i, (text, done) in enumerate(spec.checklist)
                ],
                comments=comments,
            )
        )
    ctx.db.flush()


def seed(ctx: SeedContext) -> None:
    for workspace_key, specs in (("northwind", NORTHWIND_TASKS), ("biology", BIOLOGY_TASKS)):
        seed_tasks(ctx, workspace_key, specs, seed_labels(ctx, workspace_key))
    ctx.db.commit()
