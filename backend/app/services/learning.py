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


def add_source(db: Session, course: Course, name: str, text: str, concept_limit: int = 4) -> Source:
    """Attach more material and append any new concepts it introduces to the end of the chain."""
    source = Source(course_id=course.id, name=name, content=text, created_at=clock.now())
    db.add(source)
    existing = {c.name.lower() for c in course.concepts}
    previous = course.concepts[-1].id if course.concepts else None
    next_index = len(course.concepts)
    for extracted in extract_concepts(text, concept_limit):
        if extracted.name.lower() in existing:
            continue
        concept = Concept(
            course_id=course.id,
            name=extracted.name,
            summary=extracted.summary,
            order_index=next_index,
            prerequisite_id=previous,
        )
        db.add(concept)
        db.flush()
        previous = concept.id
        next_index += 1
        existing.add(extracted.name.lower())
    course.updated_at = clock.now()
    db.commit()
    db.refresh(source)
    return source


def set_mastery(db: Session, user_id: int, concept_id: int, value: float) -> None:
    row = db.scalars(
        select(ConceptProgress).where(ConceptProgress.user_id == user_id, ConceptProgress.concept_id == concept_id)
    ).first()
    if row is None:
        row = ConceptProgress(user_id=user_id, concept_id=concept_id)
        db.add(row)
    row.mastery = value
    row.updated_at = clock.now()


def grade_answer(db: Session, course: Course, user: User, question_id: str, concept_id: int, selected: int) -> dict:
    view = learner_course(db, course, user.id)
    key = answer_key(view, question_id, concept_id)
    if key is None:
        raise InvalidQuestion("Invalid question")
    concept = next(c for c in view.concepts if c.id == concept_id)
    before = round(concept.mastery, 1)
    correct = key == selected
    concept.mastery = next_mastery(concept.mastery, correct)
    after = round(concept.mastery, 1)
    set_mastery(db, user.id, concept.id, concept.mastery)
    db.add(
        Attempt(
            user_id=user.id,
            course_id=course.id,
            concept_id=concept.id,
            concept_name=concept.name,
            selected=selected,
            correct=correct,
            mastery_before=before,
            mastery_after=after,
            created_at=clock.now(),
        )
    )
    if before < MASTERED_THRESHOLD <= after:
        record(
            db,
            workspace_id=course.workspace_id,
            actor_id=user.id,
            verb="concept.mastered",
            object_type="concept",
            object_id=concept.id,
            summary=f"mastered {concept.name} in {course.title}",
            link=f"/courses/{course.id}",
        )
        notify(
            db,
            user_id=user.id,
            workspace_id=course.workspace_id,
            kind="mastery",
            title=f"You mastered {concept.name}",
            body=f"{concept.name} reached {round(after)}% in {course.title}.",
            link=f"/courses/{course.id}",
        )
    enrollment = ensure_enrollment(db, user.id, course.id)
    enrollment.last_opened_at = clock.now()
    db.commit()
    return {
        "correct": correct,
        "correct_index": key,
        "concept_id": concept.id,
        "concept": concept.name,
        "previous_mastery": before,
        "mastery": after,
        "recommendation": recommendation_payload(view.concepts),
    }


def ensure_enrollment(db: Session, user_id: int, course_id: int) -> Enrollment:
    enrollment = db.scalars(
        select(Enrollment).where(Enrollment.user_id == user_id, Enrollment.course_id == course_id)
    ).first()
    if enrollment is None:
        enrollment = Enrollment(user_id=user_id, course_id=course_id, enrolled_at=clock.now())
        db.add(enrollment)
        db.flush()
    return enrollment


def recommendation_payload(concepts: Sequence[LearnerConcept]) -> dict:
    rec = recommend(concepts)
    return {"concept_id": rec.concept_id, "concept": rec.concept, "mastery": rec.mastery, "reason": rec.reason}


def concept_payload(concept: LearnerConcept, unlocked: set[int]) -> dict:
    return {
        "id": concept.id,
        "name": concept.name,
        "summary": concept.summary,
        "mastery": round(concept.mastery, 1),
        "order_index": concept.order_index,
        "prerequisite_id": concept.prerequisite_id,
        "level": mastery_level(concept.mastery),
        "unlocked": concept.id in unlocked,
    }


def user_attempts(db: Session, user_id: int, course_ids: Sequence[int]) -> list[Attempt]:
    if not course_ids:
        return []
    return list(
        db.scalars(
            select(Attempt).where(Attempt.user_id == user_id, Attempt.course_id.in_(course_ids)).order_by(Attempt.id)
        )
    )


def course_summary(db: Session, course: Course, user_id: int, attempts: Sequence[Attempt] | None = None) -> dict:
    concepts = learner_concepts(db, course, user_id)
    mine = attempts if attempts is not None else user_attempts(db, user_id, [course.id])
    mine = [a for a in mine if a.course_id == course.id]
    enrollment = next((e for e in course.enrollments if e.user_id == user_id), None)
    mastered = sum(1 for c in concepts if c.mastery >= MASTERED_THRESHOLD)
    return {
        "id": course.id,
        "workspace_id": course.workspace_id,
        "title": course.title,
        "description": course.description,
        "subject": course.subject,
        "difficulty": course.difficulty,
        "status": course.status,
        "color": course.color,
        "tags": course.tag_list,
        "owner_id": course.owner_id,
        "created_at": course.created_at,
        "updated_at": course.updated_at,
        "concepts": len(concepts),
        "mastered_concepts": mastered,
        "sources": len(course.sources),
        "attempts": len(mine),
        "accuracy": round(100 * sum(a.correct for a in mine) / len(mine), 1) if mine else 0.0,
        "mastery": average_mastery(concepts),
        "learners": len(course.enrollments),
        "enrolled": enrollment is not None,
        "pinned": bool(enrollment and enrollment.pinned),
        "last_opened_at": enrollment.last_opened_at if enrollment else None,
    }


def course_detail(db: Session, course: Course, user_id: int) -> dict:
    concepts = learner_concepts(db, course, user_id)
    unlocked = unlocked_ids(concepts)
    summary = course_summary(db, course, user_id)
    return {
        **summary,
        "concepts": [concept_payload(c, unlocked) for c in concepts],
        "sources": [source_payload(s) for s in course.sources],
        "concept_count": summary["concepts"],
        "source_count": summary["sources"],
        "recommendation": recommendation_payload(concepts),
    }


def recent_attempts(db: Session, course: Course, user_id: int, limit: int = 10) -> list[Attempt]:
    return list(
        db.scalars(
            select(Attempt)
            .where(Attempt.course_id == course.id, Attempt.user_id == user_id)
            .order_by(Attempt.id.desc())
            .limit(limit)
        )
    )


def source_payload(source: Source) -> dict:
    return {
        "id": source.id,
        "name": source.name,
        "characters": len(source.content),
        "words": len(source.content.split()),
        "created_at": source.created_at,
    }


def remove_source(db: Session, course: Course, source: Source) -> None:
    """Delete one source. Concepts it introduced stay: they may already carry learners' progress."""
    if len(course.sources) <= 1:
        raise ValueError("A course needs at least one source; add another before removing this one")
    db.delete(source)
    course.updated_at = clock.now()
    db.commit()
    db.refresh(course)


def rename_concept(db: Session, course: Course, concept: Concept, name: str | None, summary: str | None) -> None:
    if name is not None:
        clash = next((c for c in course.concepts if c.id != concept.id and c.name.lower() == name.lower()), None)
        if clash is not None:
            raise ValueError(f"Another concept in this course is already called {clash.name}")
        concept.name = name
    if summary is not None:
        concept.summary = summary
    course.updated_at = clock.now()
    db.commit()
    db.refresh(course)


def reorder_concepts(db: Session, course: Course, ordered_ids: Sequence[int]) -> None:
    """Put the concepts in the given order and rebuild the prerequisite chain to match it."""
    by_id = {c.id: c for c in course.concepts}
    if sorted(ordered_ids) != sorted(by_id):
        raise ValueError("List every concept of this course exactly once")
    previous: int | None = None
    for index, concept_id in enumerate(ordered_ids):
        concept = by_id[concept_id]
        concept.order_index = index
        concept.prerequisite_id = previous
        previous = concept.id
    course.updated_at = clock.now()
    db.commit()
    db.refresh(course)


def duplicate_course(db: Session, course: Course, owner: User, title: str | None = None) -> Course:
    """Copy a course's sources and concepts into a new draft owned by `owner`. Nobody's progress is copied."""
    copy = Course(
        workspace_id=course.workspace_id,
        owner_id=owner.id,
        title=(title or f"Copy of {course.title}")[:160],
        description=course.description,
        subject=course.subject,
        difficulty=course.difficulty,
        tags=course.tags,
        status="draft",
        color=course.color,
        created_at=clock.now(),
        updated_at=clock.now(),
    )
    db.add(copy)
    db.flush()
    for source in course.sources:
        db.add(Source(course_id=copy.id, name=source.name, content=source.content, created_at=clock.now()))
    previous: int | None = None
    for concept in course.concepts:
        clone = Concept(
            course_id=copy.id,
            name=concept.name,
            summary=concept.summary,
            order_index=concept.order_index,
            prerequisite_id=previous,
        )
        db.add(clone)
        db.flush()
        previous = clone.id
    db.add(Enrollment(user_id=owner.id, course_id=copy.id, enrolled_at=clock.now()))
    record(
        db,
        workspace_id=copy.workspace_id,
        actor_id=owner.id,
        verb="course.duplicated",
        object_type="course",
        object_id=copy.id,
        summary=f"duplicated {course.title} as {copy.title}",
        link=f"/courses/{copy.id}",
    )
    db.commit()
    db.refresh(copy)
    return copy


def delete_course(db: Session, course: Course, actor: User) -> None:
    concept_ids = [c.id for c in course.concepts]
    if concept_ids:
        db.execute(delete(ConceptProgress).where(ConceptProgress.concept_id.in_(concept_ids)))
    record(
        db,
        workspace_id=course.workspace_id,
        actor_id=actor.id,
        verb="course.deleted",
        object_type="course",
        object_id=None,
        summary=f"deleted the course {course.title}",
    )
    db.delete(course)
    db.commit()


def reset_progress(db: Session, course: Course, user: User) -> tuple[int, int]:
    """Forget one learner's mastery and quiz answers for a course. Returns (attempts, concepts) cleared."""
    concept_ids = [c.id for c in course.concepts]
    concepts_cleared = 0
    if concept_ids:
        concepts_cleared = db.execute(
            delete(ConceptProgress).where(
                ConceptProgress.user_id == user.id, ConceptProgress.concept_id.in_(concept_ids)
            )
        ).rowcount
    attempts_cleared = db.execute(
        delete(Attempt).where(Attempt.user_id == user.id, Attempt.course_id == course.id)
    ).rowcount
    record(
        db,
        workspace_id=course.workspace_id,
        actor_id=user.id,
        verb="course.progress_reset",
        object_type="course",
        object_id=course.id,
        summary=f"reset their progress in {course.title}",
        link=f"/courses/{course.id}",
        detail=f"{attempts_cleared} answers and {concepts_cleared} concept scores cleared",
    )
    db.commit()
    db.expire_all()
    return attempts_cleared, concepts_cleared


def daily_activity(attempts: Sequence[Attempt], today: date, days: int = 14) -> list[dict]:
    """Answers and correct answers per day for the `days` days ending today (oldest first, empty days included)."""
    first = today - timedelta(days=days - 1)
    buckets = {first + timedelta(days=offset): [0, 0] for offset in range(days)}
    for attempt in attempts:
        bucket = buckets.get(attempt.created_at.date())
        if bucket is not None:
            bucket[0] += 1
            bucket[1] += int(attempt.correct)
    return [{"date": day, "answers": answers, "correct": correct} for day, (answers, correct) in buckets.items()]


def course_activity(db: Session, course: Course, user_id: int, days: int = 14) -> dict:
    today = clock.today()
    since = datetime.combine(today - timedelta(days=days - 1), datetime.min.time())
    attempts = db.scalars(
        select(Attempt).where(Attempt.course_id == course.id, Attempt.user_id == user_id, Attempt.created_at >= since)
    ).all()
    series = daily_activity(attempts, today, days)
    answers = sum(d["answers"] for d in series)
    correct = sum(d["correct"] for d in series)
    return {
        "days": series,
        "answers": answers,
        "correct": correct,
        "accuracy": round(100 * correct / answers, 1) if answers else 0.0,
        "active_days": sum(1 for d in series if d["answers"]),
    }


def course_learners(db: Session, course: Course) -> dict:
    """Every workspace member who follows the course or has answered its questions, with their progress."""
    enrollments = {e.user_id: e for e in course.enrollments}
    attempts = db.scalars(select(Attempt).where(Attempt.course_id == course.id).order_by(Attempt.id)).all()
    by_user: dict[int, list[Attempt]] = {}
    for attempt in attempts:
        by_user.setdefault(attempt.user_id, []).append(attempt)
    members = {
        m.user_id: m for m in db.scalars(select(Membership).where(Membership.workspace_id == course.workspace_id)).all()
    }
    user_ids = [uid for uid in {*enrollments, *by_user} if uid in members]
    concept_ids = [c.id for c in course.concepts]
    progress: dict[int, dict[int, float]] = {}
    if concept_ids and user_ids:
        rows = db.execute(
            select(ConceptProgress.user_id, ConceptProgress.concept_id, ConceptProgress.mastery).where(
                ConceptProgress.concept_id.in_(concept_ids), ConceptProgress.user_id.in_(user_ids)
            )
        ).all()
        for uid, concept_id, value in rows:
            progress.setdefault(uid, {})[concept_id] = value
    week_ago = clock.now() - timedelta(days=7)
    items = []
    for uid in user_ids:
        member, mine, enrollment = members[uid], by_user.get(uid, []), enrollments.get(uid)
        mastery = [progress.get(uid, {}).get(cid, INITIAL_MASTERY) for cid in concept_ids]
        moments = [a.created_at for a in mine] + ([enrollment.last_opened_at] if enrollment else [])
        last_active = max((m for m in moments if m is not None), default=None)
        items.append(
            {
                "user_id": uid,
                "name": member.user.name,
                "email": member.user.email,
                "avatar_color": member.user.avatar_color,
                "role": member.role,
                "enrolled": enrollment is not None,
                "enrolled_at": enrollment.enrolled_at if enrollment else None,
                "mastery": round(sum(mastery) / len(mastery), 1) if mastery else 0.0,
                "mastered_concepts": sum(1 for value in mastery if value >= MASTERED_THRESHOLD),
                "attempts": len(mine),
                "accuracy": round(100 * sum(a.correct for a in mine) / len(mine), 1) if mine else 0.0,
                "last_active_at": last_active,
                "concepts": [
                    {"concept_id": cid, "mastery": round(value, 1)}
                    for cid, value in zip(concept_ids, mastery, strict=True)
                ],
            }
        )
    items.sort(key=lambda item: (-item["mastery"], item["name"].lower()))
    return {
        "items": items,
        "total": len(items),
        "concepts": [{"id": c.id, "name": c.name} for c in course.concepts],
        "average_mastery": round(sum(i["mastery"] for i in items) / len(items), 1) if items else 0.0,
        "active_last_7_days": sum(1 for i in items if i["last_active_at"] and i["last_active_at"] >= week_ago),
    }
