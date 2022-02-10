"""Course creation, per-learner mastery, grading and course read models.

Concepts are shared by everyone in a workspace, but mastery is personal: it lives in
`ConceptProgress` rows keyed by (user, concept). The pure logic in `mastery.py`,
`quiz.py` and `tutor.py` works on anything shaped like a concept with a `mastery`
attribute, so this module builds lightweight `LearnerConcept` views that combine the
shared concept with one learner's progress.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .. import clock
from ..concepts import extract_concepts
from ..mastery import (
    INITIAL_MASTERY,
    MASTERED_THRESHOLD,
    average_mastery,
    mastery_level,
    next_mastery,
    recommend,
    unlocked_ids,
)
from ..models import Attempt, Concept, ConceptProgress, Course, Enrollment, Membership, Source, User
from ..quiz import answer_key
from .events import notify, record

COURSE_COLORS = ("#1d6d45", "#2563eb", "#9333ea", "#c2410c", "#0f766e", "#be123c", "#4d7c0f", "#a16207")


class InvalidQuestion(ValueError):
    pass


@dataclass
class LearnerConcept:
    id: int
    name: str
    summary: str
    mastery: float
    order_index: int
    prerequisite_id: int | None


@dataclass
class LearnerCourse:
    """A course as seen by one learner: shared content plus that learner's mastery."""

    id: int
    title: str
    concepts: list[LearnerConcept]
    sources: Sequence[Source] = field(default_factory=list)


def color_for(seed: int) -> str:
    return COURSE_COLORS[seed % len(COURSE_COLORS)]


def progress_map(db: Session, user_id: int, concept_ids: Iterable[int]) -> dict[int, float]:
    ids = list(concept_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(ConceptProgress.concept_id, ConceptProgress.mastery).where(
            ConceptProgress.user_id == user_id, ConceptProgress.concept_id.in_(ids)
        )
    ).all()
    return dict(rows)


def learner_concepts(db: Session, course: Course, user_id: int) -> list[LearnerConcept]:
    mastery = progress_map(db, user_id, (c.id for c in course.concepts))
    return [
        LearnerConcept(
            id=c.id,
            name=c.name,
            summary=c.summary,
            mastery=mastery.get(c.id, INITIAL_MASTERY),
            order_index=c.order_index,
            prerequisite_id=c.prerequisite_id,
        )
        for c in course.concepts
    ]


def learner_course(db: Session, course: Course, user_id: int) -> LearnerCourse:
    return LearnerCourse(course.id, course.title, learner_concepts(db, course, user_id), course.sources)


def create_course(
    db: Session,
    *,
    workspace_id: int,
    owner: User | None,
    title: str,
    text: str,
    source_name: str,
    description: str = "",
    subject: str = "General",
    difficulty: str = "intro",
    tags: Sequence[str] = (),
    status: str = "active",
    color: str | None = None,
    concept_limit: int = 6,
) -> Course:
    count = db.scalar(select(func.count()).select_from(Course).where(Course.workspace_id == workspace_id)) or 0
    course = Course(
        workspace_id=workspace_id,
        owner_id=owner.id if owner else None,
        title=title.strip(),
        description=description.strip() or f"Adaptive path generated from {source_name}",
        subject=subject.strip() or "General",
        difficulty=difficulty,
        tags=",".join(tags),
        status=status,
        color=color or color_for(count),
        created_at=clock.now(),
        updated_at=clock.now(),
    )
    db.add(course)
    db.flush()
    db.add(Source(course_id=course.id, name=source_name, content=text, created_at=clock.now()))
    previous = None
    for index, extracted in enumerate(extract_concepts(text, concept_limit)):
        concept = Concept(
            course_id=course.id,
            name=extracted.name,
            summary=extracted.summary,
            order_index=index,
            prerequisite_id=previous,
        )
        db.add(concept)
        db.flush()
        previous = concept.id
    if owner is not None:
        db.add(Enrollment(user_id=owner.id, course_id=course.id, enrolled_at=clock.now()))
        record(
            db,
            workspace_id=workspace_id,
            actor_id=owner.id,
            verb="course.created",
            object_type="course",
            object_id=course.id,
            summary=f"created the course {course.title}",
            link=f"/courses/{course.id}",
        )
    db.commit()
    db.refresh(course)
    return course


