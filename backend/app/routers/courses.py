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


