"""Course catalogue, course content (sources/concepts), quizzes, attempts, learners and the tutor."""

from collections.abc import Callable
from io import BytesIO
from pathlib import PurePath
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import clock
from ..database import get_db
from ..deps import Access, access_for, current_user, get_or_404, workspace_access
from ..mastery import unlocked_ids
from ..models import Concept, Course, Source, User
from ..quiz import quiz_for
from ..schemas.common import Text, error_loc
from ..schemas.learning import (
    AnswerIn,
    AnswerOut,
    AttemptOut,
    ConceptOrder,
    ConceptOut,
    ConceptUpdate,
    CourseActivity,
    CourseCreate,
    CourseDuplicate,
    CourseLearners,
    CourseMeta,
    CourseOut,
    CoursePage,
    CourseSummary,
    CourseUpdate,
    EnrollmentUpdate,
    ProgressReset,
    Question,
    RecommendationOut,
    SourceCreate,
    SourceDetail,
    SourceOut,
    TutorIn,
    TutorOut,
)
from ..services.events import record
from ..services.learning import (
    InvalidQuestion,
    add_source,
    concept_payload,
    course_activity,
    course_detail,
    course_learners,
    course_summary,
    create_course,
    delete_course,
    duplicate_course,
    ensure_enrollment,
    grade_answer,
    learner_concepts,
    learner_course,
    recent_attempts,
    recommendation_payload,
    remove_source,
    rename_concept,
    reorder_concepts,
    reset_progress,
    source_payload,
    user_attempts,
)
from ..services.listing import matches, paginate, parse_sort, sort_items
from ..tutor import tutor

router = APIRouter(tags=["courses"])

MAX_UPLOAD_BYTES = 8_000_000
MIN_TEXT_CHARS = 80
ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md"}
SORTS = ("title", "created_at", "updated_at", "mastery", "concepts", "learners", "difficulty", "last_opened_at")
DIFFICULTY_RANK = {"intro": 0, "intermediate": 1, "advanced": 2}


class UploadMeta(CourseMeta):
    title: Text(2, 160)


def readable(exc: ValidationError) -> str:
    """One sentence per problem, e.g. "title: must be at least 2 characters"."""
    parts = []
    for error in exc.errors():
        field = ".".join(str(part) for part in error_loc(error["loc"]))
        message = error["msg"]
        parts.append(f"{field}: {message}" if field else message)
    return "; ".join(parts)


def sort_key(field: str) -> Callable[[dict], Any]:
    if field == "title":
        return lambda summary: summary["title"].lower()
    if field == "difficulty":
        return lambda summary: DIFFICULTY_RANK.get(summary["difficulty"], 0)
    return lambda summary: summary[field]


def course_access(db: Session, user: User, course_id: int) -> tuple[Course, Access]:
    """Load a course the user may see. Non-members and learners asking for a draft get 404."""
    course = get_or_404(db, Course, course_id, "Course")
    access = access_for(db, user, course.workspace_id)
    if course.status == "draft" and not access.can("instructor") and course.owner_id != user.id:
        raise HTTPException(404, "Course not found")
    return course, access


def can_edit(course: Course, access: Access) -> bool:
    return course.owner_id == access.user.id or access.can("instructor")


def require_editor(course: Course, access: Access) -> None:
    if not can_edit(course, access):
        raise HTTPException(403, "Only the course owner or an instructor can change this course")


def course_source(course: Course, source_id: int) -> Source:
    source = next((s for s in course.sources if s.id == source_id), None)
    if source is None:
        raise HTTPException(404, "Source not found")
    return source


def course_concept(course: Course, concept_id: int) -> Concept:
    concept = next((c for c in course.concepts if c.id == concept_id), None)
    if concept is None:
        raise HTTPException(404, "Concept not found")
    return concept


def read_upload(name: str, raw: bytes) -> str:
    extension = PurePath(name).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(415, "Upload a PDF, TXT, or Markdown file")
    try:
        if extension == ".pdf":
            from pypdf import PdfReader

            return "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(raw)).pages)
        return raw.decode("utf-8")
    except Exception as exc:
        raise HTTPException(400, "Could not read this file") from exc


# ---------- Catalogue ----------


@router.get("/api/workspaces/{workspace_id}/courses", response_model=CoursePage)
def list_courses(
    access: Access = Depends(workspace_access),
    db: Session = Depends(get_db),
    q: str | None = Query(None, max_length=100),
    status: str | None = Query(None, regex="^(draft|active|archived|all)$"),
    subject: str | None = Query(None, max_length=60),
    difficulty: str | None = Query(None, regex="^(intro|intermediate|advanced)$"),
    tag: str | None = Query(None, max_length=30),
    enrolled: bool | None = None,
    sort: str | None = Query(None, max_length=30),
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=100),
):
    field, descending = parse_sort(sort, SORTS, "-updated_at")
    courses = db.scalars(select(Course).where(Course.workspace_id == access.workspace.id).order_by(Course.id)).all()
    visible = [c for c in courses if c.status != "draft" or access.can("instructor") or c.owner_id == access.user.id]
    attempts = user_attempts(db, access.user.id, [c.id for c in visible])
    summaries = [course_summary(db, c, access.user.id, attempts) for c in visible]
    facets = {
        "subjects": sorted({s["subject"] for s in summaries}, key=str.lower),
        "tags": sorted({t for s in summaries for t in s["tags"]}),
        "statuses": {st: sum(1 for s in summaries if s["status"] == st) for st in ("draft", "active", "archived")},
        "difficulties": {d: sum(1 for s in summaries if s["difficulty"] == d) for d in DIFFICULTY_RANK},
    }
    wanted_status = status or "active"
    filtered = [
        s
        for s in summaries
        if (wanted_status == "all" or s["status"] == wanted_status)
        and (subject is None or s["subject"].lower() == subject.lower())
        and (difficulty is None or s["difficulty"] == difficulty)
        and (tag is None or tag.lower() in s["tags"])
        and (enrolled is None or s["enrolled"] == enrolled)
        and matches(q, s["title"], s["description"], s["subject"], " ".join(s["tags"]))
    ]
    ordered = sort_items(filtered, sort_key(field), descending)
    # Pinned courses always lead the list, keeping the chosen order inside each group.
    ordered = [s for s in ordered if s["pinned"]] + [s for s in ordered if not s["pinned"]]
    return {**paginate(ordered, page, page_size), "facets": facets}


@router.post("/api/workspaces/{workspace_id}/courses", response_model=CourseOut, status_code=201)
def add_course(data: CourseCreate, access: Access = Depends(workspace_access), db: Session = Depends(get_db)):
    access.require("instructor")
    course = create_course(
        db,
        workspace_id=access.workspace.id,
        owner=access.user,
        title=data.title,
        text=data.text,
        source_name="pasted-notes.txt",
        description=data.description,
        subject=data.subject,
        difficulty=data.difficulty,
        tags=data.tags,
        status=data.status,
        color=data.color,
    )
    return course_detail(db, course, access.user.id)


@router.post("/api/workspaces/{workspace_id}/courses/upload", response_model=CourseOut, status_code=201)
async def upload_course(
    title: str = Form(...),
    file: UploadFile = File(...),
    subject: str = Form("General"),
    difficulty: str = Form("intro"),
    description: str = Form(""),
    tags: str = Form(""),
    status: str = Form("active"),
    color: str | None = Form(None),
    access: Access = Depends(workspace_access),
    db: Session = Depends(get_db),
):
    access.require("instructor")
    try:
        meta = UploadMeta(
            title=title,
            subject=subject,
            difficulty=difficulty,
            description=description,
            tags=tags,
            status=status,
            color=color or None,
        )
    except ValidationError as exc:
        raise HTTPException(422, readable(exc)) from exc
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File must be under 8 MB")
    name = PurePath(file.filename or "upload.txt").name
    text = read_upload(name, raw)
    if len(text.strip()) < MIN_TEXT_CHARS:
        raise HTTPException(400, f"The file needs at least {MIN_TEXT_CHARS} characters of readable text")
    course = create_course(
        db,
        workspace_id=access.workspace.id,
        owner=access.user,
        title=meta.title,
        text=text,
        source_name=name,
        description=meta.description,
        subject=meta.subject,
        difficulty=meta.difficulty,
        tags=meta.tags,
        status=meta.status,
        color=meta.color,
    )
    return course_detail(db, course, access.user.id)


# ---------- One course ----------


@router.get("/api/courses/{course_id}", response_model=CourseOut)
def get_course(course_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    course, _ = course_access(db, user, course_id)
    return course_detail(db, course, user.id)


@router.patch("/api/courses/{course_id}", response_model=CourseOut)
def update_course(
    course_id: int, data: CourseUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    course, access = course_access(db, user, course_id)
    require_editor(course, access)
    changes = data.dict(exclude_unset=True)
    if "tags" in changes:
        changes["tags"] = ",".join(changes["tags"])
    previous_status = course.status
    for key, value in changes.items():
        setattr(course, key, value)
    course.updated_at = clock.now()
    if course.status != previous_status:
        verb = "restored" if previous_status == "archived" and course.status == "active" else course.status
        record(
            db,
            workspace_id=course.workspace_id,
            actor_id=user.id,
            verb=f"course.{verb}",
            object_type="course",
            object_id=course.id,
            summary=f"marked {course.title} as {course.status}",
            link=f"/courses/{course.id}",
        )
    db.commit()
    return course_detail(db, course, user.id)


@router.delete("/api/courses/{course_id}", status_code=204)
def remove_course(course_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    course, access = course_access(db, user, course_id)
    if course.owner_id != user.id:
        access.require("admin")
    delete_course(db, course, user)
    return Response(status_code=204)


@router.post("/api/courses/{course_id}/duplicate", response_model=CourseOut, status_code=201)
def duplicate(
    course_id: int,
    data: CourseDuplicate | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    course, access = course_access(db, user, course_id)
    access.require("instructor")
    copy = duplicate_course(db, course, user, data.title if data else None)
    return course_detail(db, copy, user.id)


@router.get("/api/courses/{course_id}/summary", response_model=CourseSummary)
def get_course_summary(course_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    course, _ = course_access(db, user, course_id)
    return course_summary(db, course, user.id)


@router.put("/api/courses/{course_id}/enrollment", response_model=CourseSummary)
def enroll(course_id: int, data: EnrollmentUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    course, _ = course_access(db, user, course_id)
    enrollment = ensure_enrollment(db, user.id, course.id)
    enrollment.pinned = data.pinned
    db.commit()
    db.refresh(course)
    return course_summary(db, course, user.id)


@router.delete("/api/courses/{course_id}/enrollment", status_code=204)
def unenroll(course_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    course, _ = course_access(db, user, course_id)
    for enrollment in [e for e in course.enrollments if e.user_id == user.id]:
        db.delete(enrollment)
    db.commit()
    return Response(status_code=204)


@router.post("/api/courses/{course_id}/opened", status_code=204)
def mark_opened(course_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    course, _ = course_access(db, user, course_id)
    ensure_enrollment(db, user.id, course.id).last_opened_at = clock.now()
    db.commit()
    return Response(status_code=204)


@router.get("/api/courses/{course_id}/learners", response_model=CourseLearners)
def get_learners(course_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    course, access = course_access(db, user, course_id)
    if not can_edit(course, access):
        raise HTTPException(403, "Only the course owner or an instructor can see learners' progress")
    return course_learners(db, course)


@router.get("/api/courses/{course_id}/activity", response_model=CourseActivity)
def get_activity(
    course_id: int,
    days: int = Query(14, ge=7, le=60),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    course, _ = course_access(db, user, course_id)
    return course_activity(db, course, user.id, days)


@router.post("/api/courses/{course_id}/reset-progress", response_model=ProgressReset)
def reset_my_progress(course_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    course, _ = course_access(db, user, course_id)
    attempts, concepts = reset_progress(db, course, user)
    return {"attempts_cleared": attempts, "concepts_cleared": concepts, "course": course_detail(db, course, user.id)}


# ---------- Sources and concepts ----------


@router.get("/api/courses/{course_id}/sources/{source_id}", response_model=SourceDetail)
def get_source(course_id: int, source_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    course, _ = course_access(db, user, course_id)
    source = course_source(course, source_id)
    return {**source_payload(source), "course_id": course.id, "content": source.content}


@router.post("/api/courses/{course_id}/sources", response_model=SourceOut, status_code=201)
def create_source(
    course_id: int, data: SourceCreate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    course, access = course_access(db, user, course_id)
    require_editor(course, access)
    return source_payload(add_source(db, course, data.name, data.text))


@router.delete("/api/courses/{course_id}/sources/{source_id}", status_code=204)
def delete_source(course_id: int, source_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    course, access = course_access(db, user, course_id)
    require_editor(course, access)
    try:
        remove_source(db, course, course_source(course, source_id))
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return Response(status_code=204)


@router.patch("/api/courses/{course_id}/concepts/{concept_id}", response_model=ConceptOut)
def update_concept(
    course_id: int,
    concept_id: int,
    data: ConceptUpdate,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    course, access = course_access(db, user, course_id)
    require_editor(course, access)
    concept = course_concept(course, concept_id)
    try:
        rename_concept(db, course, concept, data.name, data.summary)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    views = learner_concepts(db, course, user.id)
    view = next(v for v in views if v.id == concept.id)
    return concept_payload(view, unlocked_ids(views))


@router.put("/api/courses/{course_id}/concepts/order", response_model=list[ConceptOut])
def order_concepts(
    course_id: int, data: ConceptOrder, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    course, access = course_access(db, user, course_id)
    require_editor(course, access)
    try:
        reorder_concepts(db, course, data.concept_ids)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    views = learner_concepts(db, course, user.id)
    unlocked = unlocked_ids(views)
    return [concept_payload(v, unlocked) for v in views]


# ---------- Practice ----------


@router.get("/api/courses/{course_id}/quiz", response_model=list[Question])
def get_quiz(
    course_id: int,
    count: int = Query(4, ge=1, le=10),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    course, _ = course_access(db, user, course_id)
    questions, _ = quiz_for(learner_course(db, course, user.id), count)
    return questions


@router.post("/api/courses/{course_id}/answers", response_model=AnswerOut)
def answer(course_id: int, data: AnswerIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    course, _ = course_access(db, user, course_id)
    try:
        return grade_answer(db, course, user, data.question_id, data.concept_id, data.selected)
    except InvalidQuestion as exc:
        raise HTTPException(400, "Invalid question") from exc


@router.get("/api/courses/{course_id}/attempts", response_model=list[AttemptOut])
def get_attempts(
    course_id: int,
    limit: int = Query(10, ge=1, le=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    course, _ = course_access(db, user, course_id)
    return recent_attempts(db, course, user.id, limit)


@router.get("/api/courses/{course_id}/recommendation", response_model=RecommendationOut)
def get_recommendation(course_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    course, _ = course_access(db, user, course_id)
    return recommendation_payload(learner_concepts(db, course, user.id))


@router.post("/api/courses/{course_id}/tutor", response_model=TutorOut)
async def ask_tutor(course_id: int, data: TutorIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    course, _ = course_access(db, user, course_id)
    return await tutor(learner_course(db, course, user.id), data.message)
