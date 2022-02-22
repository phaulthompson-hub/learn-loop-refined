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


