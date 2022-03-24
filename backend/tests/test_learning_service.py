"""The learning service functions that other features build on (course read models, grading, progress)."""

from dataclasses import dataclass
from datetime import date, datetime

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.models import Attempt, ConceptProgress, Course, Enrollment, Membership, Source, User, Workspace
from app.quiz import answer_key, question_id
from app.services.learning import (
    COURSE_COLORS,
    InvalidQuestion,
    add_source,
    course_activity,
    course_learners,
    course_summary,
    create_course,
    daily_activity,
    delete_course,
    duplicate_course,
    ensure_enrollment,
    grade_answer,
    learner_concepts,
    learner_course,
    recommendation_payload,
    remove_source,
    rename_concept,
    reorder_concepts,
    reset_progress,
    user_attempts,
)

TEXT = (
    "Photosynthesis converts light energy into chemical energy inside the chloroplast. "
    "The chloroplast contains chlorophyll, a pigment that absorbs light energy. "
    "Cellular respiration releases chemical energy from glucose in the mitochondria. "
    "Light energy drives the production of glucose, and cellular respiration consumes glucose again."
)


@dataclass
class FakeAttempt:
    created_at: datetime
    correct: bool


@pytest.fixture
def session(seeded):
    with SessionLocal() as db:
        yield db


def user(db, email: str) -> User:
    return db.scalars(select(User).where(User.email == email)).one()


def course(db, title: str) -> Course:
    return db.scalars(select(Course).where(Course.title == title)).one()


def answer(db, target: Course, who: User, concept_id: int, correct: bool) -> dict:
    qid = question_id(target.id, concept_id)
    key = answer_key(learner_course(db, target, who.id), qid, concept_id)
    return grade_answer(db, target, who, qid, concept_id, key if correct else (key + 1) % 4)


# ---------- Pure helpers ----------


def test_daily_activity_buckets_answers_by_day_and_keeps_empty_days():
    today = date(2022, 3, 14)
    attempts = [
        FakeAttempt(datetime(2022, 3, 14, 8), True),
        FakeAttempt(datetime(2022, 3, 14, 9), False),
        FakeAttempt(datetime(2022, 3, 12, 23, 59), True),
        FakeAttempt(datetime(2022, 3, 7, 12), True),  # outside a 7-day window
    ]
    series = daily_activity(attempts, today, days=7)
    assert [d["date"] for d in series] == [date(2022, 3, d) for d in range(8, 15)]
    assert {d["date"].day: (d["answers"], d["correct"]) for d in series if d["answers"]} == {14: (2, 1), 12: (1, 1)}


def test_daily_activity_ignores_future_answers():
    series = daily_activity([FakeAttempt(datetime(2022, 3, 15, 1), True)], date(2022, 3, 14), days=7)
    assert sum(d["answers"] for d in series) == 0


# ---------- Creating and editing ----------


def test_create_course_builds_a_chain_enrols_the_owner_and_rotates_colours(session):
    workspace = session.scalars(select(Workspace).where(Workspace.slug == "biology-201-study-group")).one()
    lena = user(session, "lena@learnloop.dev")
    created = create_course(
        session, workspace_id=workspace.id, owner=lena, title=" Plants ", text=TEXT, source_name="p.txt"
    )
    assert created.title == "Plants"
    assert created.color == COURSE_COLORS[2]  # the workspace already had two courses
    assert [s.name for s in created.sources] == ["p.txt"]
    chain = created.concepts
    assert chain[0].prerequisite_id is None
    assert all(c.prerequisite_id == p.id for p, c in zip(chain, chain[1:], strict=False))
    assert [e.user_id for e in created.enrollments] == [lena.id]


def test_add_source_skips_known_concepts_and_extends_the_chain(session):
    ml = course(session, "Introduction to Machine Learning")
    last = ml.concepts[-1]
    add_source(
        session,
        ml,
        "extra.txt",
        "Gradient descent is repeated until the loss stops falling. "
        "Feature scaling puts every feature on a similar range. Feature scaling speeds up gradient descent a lot.",
    )
    session.refresh(ml)
    names = [c.name for c in ml.concepts]
    assert names.count("Gradient Descent") == 1
    assert "Feature Scaling" in names
    new = ml.concepts[6]
    assert (new.order_index, new.prerequisite_id) == (6, last.id)


