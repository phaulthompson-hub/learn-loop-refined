from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import clock
from .config import get_settings
from .database import init_db
from .routers import (
    account,
    activity,
    analytics,
    auth,
    board,
    courses,
    flashcards,
    goals,
    home,
    notes,
    notifications,
    planner,
    search,
    workspaces,
)
from .schemas.common import error_loc

VERSION = "2.0.0"


app = FastAPI(
    title="LearnLoop API",
    version=VERSION,
    description="Adaptive learning workspaces: courses, quizzes, spaced repetition, planning and study boards.",
)
settings = get_settings()


@app.on_event("startup")
def startup() -> None:
    init_db()
    if get_settings().seed_on_start:
        from .seeding import seed_if_empty

        seed_if_empty()


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    """FastAPI's standard 422 body, with model-level errors located at the body rather than at `__root__`."""
    errors = [{**error, "loc": error_loc(error["loc"])} for error in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(errors)})


app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (
    auth,
    account,
    workspaces,
    courses,
    flashcards,
    planner,
    goals,
    board,
    notes,
    notifications,
    activity,
    analytics,
    search,
    home,
):
    app.include_router(module.router)


@app.get("/health")
def health():
    return {"status": "ok", "ai_mode": settings.ai_mode}


@app.get("/api/meta")
def meta():
    """Server clock and mode, so the UI computes "today" and relative times from the same instant."""
    return {"now": clock.now(), "frozen": clock.is_frozen(), "ai_mode": settings.ai_mode, "version": VERSION}
