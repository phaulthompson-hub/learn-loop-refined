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


def test_remove_source_refuses_to_leave_a_course_empty(session):
    ml = course(session, "Introduction to Machine Learning")
    with pytest.raises(ValueError, match="at least one source"):
        remove_source(session, ml, ml.sources[0])
    extra = add_source(session, ml, "extra.txt", TEXT)
    session.refresh(ml)
    remove_source(session, ml, extra)
    assert [s.name for s in ml.sources] == ["ml-foundations.txt"]
    assert session.get(Source, extra.id) is None


def test_rename_concept_detects_case_insensitive_clashes(session):
    ml = course(session, "Introduction to Machine Learning")
    first, second = ml.concepts[0], ml.concepts[1]
    with pytest.raises(ValueError, match="already called"):
        rename_concept(session, ml, first, second.name.lower(), None)
    rename_concept(session, ml, first, first.name.upper(), "A new summary for the first concept.")
    assert (first.name, first.summary) == ("MACHINE LEARNING", "A new summary for the first concept.")


def test_reorder_concepts_validates_and_rechains(session):
    ml = course(session, "Introduction to Machine Learning")
    ids = [c.id for c in ml.concepts]
    with pytest.raises(ValueError):
        reorder_concepts(session, ml, ids[:-1])
    with pytest.raises(ValueError):
        reorder_concepts(session, ml, ids[:-1] + [ids[0]])
    new_order = ids[3:] + ids[:3]
    reorder_concepts(session, ml, new_order)
    assert [c.id for c in ml.concepts] == new_order
    assert [c.prerequisite_id for c in ml.concepts] == [None, *new_order[:-1]]


def test_duplicate_course_copies_content_but_no_progress(session):
    ml = course(session, "Introduction to Machine Learning")
    jonas = user(session, "jonas@learnloop.dev")
    alex = user(session, "demo@learnloop.dev")
    copy = duplicate_course(session, ml, jonas)
    assert (copy.title, copy.status, copy.owner_id) == ("Copy of Introduction to Machine Learning", "draft", jonas.id)
    assert [c.name for c in copy.concepts] == [c.name for c in ml.concepts]
    assert [s.content for s in copy.sources] == [s.content for s in ml.sources]
    assert [e.user_id for e in copy.enrollments] == [jonas.id]
    assert copy.attempts == []
    assert {c.mastery for c in learner_concepts(session, copy, alex.id)} == {35.0}
    assert duplicate_course(session, ml, jonas, "x" * 200).title == "x" * 160


# ---------- Progress ----------


def test_grade_answer_updates_mastery_attempts_and_last_opened(session):
    sam = user(session, "sam@learnloop.dev")
    stats = course(session, "Statistics Fundamentals")
    concept = stats.concepts[0]
    result = answer(session, stats, sam, concept.id, True)
    assert (result["previous_mastery"], result["mastery"], result["correct"]) == (35.0, 53.2, True)
    assert result["recommendation"]["concept_id"] is not None
    enrollment = session.scalars(
        select(Enrollment).where(Enrollment.user_id == sam.id, Enrollment.course_id == stats.id)
    ).one()
    assert enrollment.last_opened_at.isoformat() == "2022-03-14T09:00:00"
    assert user_attempts(session, sam.id, [stats.id])[-1].concept_name == concept.name


def test_grade_answer_rejects_foreign_questions(session):
    sam = user(session, "sam@learnloop.dev")
    stats, ml = course(session, "Statistics Fundamentals"), course(session, "Introduction to Machine Learning")
    with pytest.raises(InvalidQuestion):
        grade_answer(session, stats, sam, question_id(ml.id, ml.concepts[0].id), ml.concepts[0].id, 0)


def test_ensure_enrollment_is_idempotent(session):
    sam = user(session, "sam@learnloop.dev")
    ml = course(session, "Introduction to Machine Learning")
    assert ensure_enrollment(session, sam.id, ml.id).id == ensure_enrollment(session, sam.id, ml.id).id


def test_course_summary_is_computed_per_learner(session):
    ml = course(session, "Introduction to Machine Learning")
    alex, sam = user(session, "demo@learnloop.dev"), user(session, "sam@learnloop.dev")
    mine, theirs = course_summary(session, ml, alex.id), course_summary(session, ml, sam.id)
    assert (mine["attempts"], theirs["attempts"]) == (31, 9)
    assert theirs["accuracy"] == round(100 * 8 / 9, 1)
    assert mine["learners"] == theirs["learners"] == 4
    assert (mine["pinned"], theirs["pinned"]) == (True, False)
    assert mine["mastered_concepts"] == sum(1 for c in learner_concepts(session, ml, alex.id) if c.mastery >= 85)


def test_recommendation_payload_names_the_weakest_unlocked_concept(session):
    ml = course(session, "Introduction to Machine Learning")
    sam = user(session, "sam@learnloop.dev")
    concepts = learner_concepts(session, ml, sam.id)
    payload = recommendation_payload(concepts)
    assert payload["concept_id"] in {c.id for c in concepts}
    assert payload["reason"].startswith(payload["concept"])


def test_reset_progress_only_touches_one_learner_and_course(session):
    alex, sam = user(session, "demo@learnloop.dev"), user(session, "sam@learnloop.dev")
    ml, stats = course(session, "Introduction to Machine Learning"), course(session, "Statistics Fundamentals")
    sams_before = [c.mastery for c in learner_concepts(session, ml, sam.id)]
    assert reset_progress(session, ml, alex) == (31, 6)
    assert {c.mastery for c in learner_concepts(session, ml, alex.id)} == {35.0}
    assert [c.mastery for c in learner_concepts(session, ml, sam.id)] == sams_before
    assert len(user_attempts(session, alex.id, [stats.id])) == 11
    assert reset_progress(session, ml, alex) == (0, 0)


def test_course_activity_summarises_the_window(session):
    alex = user(session, "demo@learnloop.dev")
    stats = course(session, "Statistics Fundamentals")
    body = course_activity(session, stats, alex.id)
    # Sessions 14 days ago fall just outside the window; 10, 5 and 1 days ago are inside.
    assert (body["answers"], body["active_days"]) == (8, 3)
    assert body["correct"] == 6
    assert body["accuracy"] == 75.0


def test_course_learners_skips_people_who_left_the_workspace(session):
    ml = course(session, "Introduction to Machine Learning")
    priya = user(session, "priya@learnloop.dev")
    names = {item["name"] for item in course_learners(session, ml)["items"]}
    assert "Priya Nair" in names
    membership = session.scalars(
        select(Membership).where(Membership.user_id == priya.id, Membership.workspace_id == ml.workspace_id)
    ).one()
    session.delete(membership)
    session.commit()
    names = {item["name"] for item in course_learners(session, ml)["items"]}
    assert "Priya Nair" not in names


def test_delete_course_removes_everyones_progress(session):
    ml = course(session, "Introduction to Machine Learning")
    concept_ids = [c.id for c in ml.concepts]
    delete_course(session, ml, user(session, "maya@learnloop.dev"))
    assert session.scalars(select(ConceptProgress).where(ConceptProgress.concept_id.in_(concept_ids))).all() == []
    assert session.scalars(select(Attempt).where(Attempt.concept_id.in_(concept_ids))).all() == []
