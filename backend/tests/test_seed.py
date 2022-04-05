"""The demo data set is deterministic, internally consistent and usable straight away."""

import pytest
from conftest import login
from sqlalchemy import func, select

from app.database import SessionLocal, engine
from app.mastery import INITIAL_MASTERY, next_mastery
from app.models import Attempt, Concept, ConceptProgress, Course, Enrollment, User
from app.seed import main, run
from app.seeding import DEMO_PASSWORD, run_seed
from app.seeding.core import ENROLLMENTS, HISTORY, PINNED, USERS
from app.seeding.materials import BIOLOGY_MATERIALS, NORTHWIND_MATERIALS


def snapshot() -> dict:
    """Everything the course feature shows, keyed by stable names rather than database ids."""
    with SessionLocal() as db:
        emails = {u.id: u.email for u in db.scalars(select(User))}
        courses = db.scalars(select(Course).order_by(Course.id)).all()
        titles = {c.id: c.title for c in courses}
        concepts = {c.id: c for c in db.scalars(select(Concept))}
        return {
            "courses": [
                (c.title, c.status, c.subject, c.difficulty, c.tags, c.color, emails[c.owner_id], c.created_at)
                for c in courses
            ],
            "concepts": [
                (
                    titles[c.course_id],
                    c.order_index,
                    c.name,
                    c.summary,
                    concepts[c.prerequisite_id].name if c.prerequisite_id else None,
                )
                for c in sorted(concepts.values(), key=lambda c: (c.course_id, c.order_index))
            ],
            "attempts": [
                (emails[a.user_id], titles[a.course_id], a.concept_name, a.correct, a.mastery_before, a.mastery_after)
                + (a.created_at,)
                for a in db.scalars(select(Attempt).order_by(Attempt.id))
            ],
            "progress": sorted(
                (emails[p.user_id], concepts[p.concept_id].name, round(p.mastery, 4))
                for p in db.scalars(select(ConceptProgress))
            ),
            "enrollments": sorted(
                (emails[e.user_id], titles[e.course_id], e.pinned, e.last_opened_at)
                for e in db.scalars(select(Enrollment))
            ),
        }


@pytest.fixture(scope="module")
def seeded_twice():
    engine.dispose()
    run_seed()
    first = snapshot()
    engine.dispose()
    run_seed()
    second = snapshot()
    return first, second


def test_running_the_seed_twice_yields_identical_data(seeded_twice):
    first, second = seeded_twice
    assert first == second


def test_every_material_becomes_a_course_with_six_concepts(seeded_twice):
    data, _ = seeded_twice
    materials = NORTHWIND_MATERIALS + BIOLOGY_MATERIALS
    assert [c[0] for c in data["courses"]] == [m.title for m in materials]
    for material in materials:
        names = [c[2] for c in data["concepts"] if c[0] == material.title]
        assert len(names) == 6, material.key
    assert [c[1] for c in data["courses"]].count("draft") == 1


def test_concepts_form_one_prerequisite_chain_per_course(seeded_twice):
    data, _ = seeded_twice
    by_course: dict[str, list] = {}
    for row in data["concepts"]:
        by_course.setdefault(row[0], []).append(row)
    for rows in by_course.values():
        assert rows[0][4] is None
        for previous, current in zip(rows, rows[1:], strict=False):
            assert current[4] == previous[2]


def test_ml_course_keeps_its_signature_concepts(seeded_twice):
    data, _ = seeded_twice
    names = [c[2] for c in data["concepts"] if c[0] == "Introduction to Machine Learning"]
    assert {"Gradient Descent", "Loss Function", "Machine Learning"} <= set(names)


def test_history_is_replayed_answer_by_answer(seeded_twice):
    data, _ = seeded_twice
    expected = sum(len(answers) for sessions in HISTORY.values() for _, _, answers in sessions)
    assert len(data["attempts"]) == expected
    alex_ml = [
        a for a in data["attempts"] if a[0] == "demo@learnloop.dev" and a[1] == "Introduction to Machine Learning"
    ]
    assert [a[3] for a in alex_ml] == [c for _, _, answers in HISTORY[("alex", "ml")] for _, c in answers]
    # Each answer continues from the previous mastery of the same concept, following the mastery model.
    last: dict[str, float] = {}
    for _, _, concept, correct, before, after, _ in alex_ml:
        assert before == round(last.get(concept, INITIAL_MASTERY), 1)
        last[concept] = next_mastery(last.get(concept, INITIAL_MASTERY), correct)
        assert after == round(last[concept], 1)


def test_attempt_timestamps_lie_in_the_past(seeded_twice):
    data, _ = seeded_twice
    times = [a[6] for a in data["attempts"]]
    assert max(times).isoformat() < "2022-03-14T00:00:00"
    assert min(times).isoformat() >= "2022-02-22T00:00:00"


def test_enrollments_pins_and_last_opened_match_the_script(seeded_twice):
    data, _ = seeded_twice
    emails = {key: email for key, _, email, _, _ in USERS}
    titles = {m.key: m.title for m in NORTHWIND_MATERIALS + BIOLOGY_MATERIALS}
    rows = {(email, title): (pinned, opened) for email, title, pinned, opened in data["enrollments"]}
    for user_key, course_keys in ENROLLMENTS.items():
        for course_key in course_keys:
            assert (emails[user_key], titles[course_key]) in rows
    pinned = {(e, t) for (e, t), (p, _) in rows.items() if p}
    assert pinned == {(emails[u], titles[c]) for u, c in PINNED}
    opened = rows[(emails["alex"], titles["ml"])][1]
    assert opened.isoformat() == "2022-03-13T19:00:00"


