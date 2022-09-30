# LearnLoop

LearnLoop is an adaptive-learning workspace for study groups and teams. Members turn notes and PDFs
into courses with a prerequisite concept map, practise with adaptive quizzes and spaced-repetition
flashcards, plan study time on a shared calendar, track work on a study board, keep linked markdown
notes, and follow their progress in analytics — all inside workspaces with roles and invitations.

Everything runs offline: the tutor answers from the course sources by default, and the optional
OpenAI-compatible integration lives behind a single module (`backend/app/tutor.py`) with an automatic
local fallback.

## Quick start (Docker)

```bash
docker compose up --build
```

- App: http://localhost:5173
- API docs: http://localhost:8000/docs

No `.env` file or API key is needed. On first start the API loads the demo data set and pins the clock
to **Monday 14 March 2022, 09:00 UTC** (`FROZEN_NOW`), so every screen — due cards, calendar, streaks,
"2 days ago" labels — is identical on every run.

### Demo accounts

All demo accounts use the password **`learnloop123`**.

| Email | Name | Role |
|---|---|---|
| `demo@learnloop.dev` | Alex Rivera | Admin of *Northwind Data Academy*, owner of *Biology 201 Study Group* (main demo account) |
| `maya@learnloop.dev` | Maya Chen | Owner of *Northwind Data Academy* (instructor view, learner analytics) |
| `sam@learnloop.dev` | Sam Okafor | Learner |
| `priya@learnloop.dev` | Priya Nair | Learner in both workspaces |
| `jonas@learnloop.dev` | Jonas Weber | Instructor |
| `lena@learnloop.dev` | Lena Kovacs | Instructor in the biology group |

### Seed command

```bash
docker compose exec api python -m app.seed            # rebuild the database with the demo data
docker compose exec api python -m app.seed --if-empty # only seed when there are no users
```

The seed is deterministic: 2 workspaces, 6 users, 7 courses, 99 quiz answers replayed through the
real grading code, 5 decks / 70 flashcards with review history replayed through the real scheduler,
17 calendar events, 31 board tasks, 17 notes, goals, study logs, notifications and activity.
Set `FROZEN_NOW=` (empty) to use the real clock instead.

## Features and pages

| Route | What it does |
|---|---|
| `/login`, `/register` | Sign in (with one-click demo accounts) and sign up, with password-strength validation; sign-up can accept an invitation |
| `/` | Home: greeting, streak, cards due, today's timeline, focus concept, continue-learning courses, my tasks, goals, weekly stats, activity; onboarding checklist for new workspaces |
| `/courses` | Course catalogue: search, status tabs, subject/difficulty/tag filters, sort, grid/list, pinning, server pagination |
| `/courses/new` | Three-step creation wizard (details → paste or upload PDF/TXT/MD → review) with per-step validation |
| `/courses/:id` | Course overview: next-up recommendation, interactive concept map (mastery rings, locks), level distribution, 14-day activity, recent answers |
| `/courses/:id/quiz` | Adaptive quiz with keyboard answers, mastery deltas and round summary |
| `/courses/:id/tutor` | Grounded tutor chat with citations (offline answer or optional LLM) |
| `/courses/:id/sources`, `/learners`, `/settings` | Source reader and "add material"; instructor view of learners' progress; course editing, concept rename/reorder, duplicate, archive, reset, delete |
| `/review`, `/decks`, `/decks/:id` | Spaced-repetition review (flip card, 4 grades with interval previews, session summary), deck library with due counts and forecast, card table, bulk import with preview, generate cards from concepts |
| `/planner` | Month / week / agenda calendar with recurring events, conflict warnings, filters and `.ics` export |
| `/goals` | Streaks, 12-week activity heatmap, goals with pace tracking, study-time log and charts |
| `/board` | Kanban study board with drag-and-drop (plus keyboard moves), swimlanes, filters in the URL, list view, WIP limits; task drawer with checklist, comments and @mentions |
| `/notes` | Markdown notes with split preview, `[[wiki links]]` and backlinks, tags, autosave, sharing |
| `/search`, `Ctrl/⌘ K` | Global search across courses, concepts, notes, tasks, flashcards and events with highlighted snippets; command palette |
| `/analytics` | KPIs with deltas, mastery trend, daily practice, study time by course, flashcard recall and forecast, weakest concepts, leaderboard, instructor learner heat-table |
| `/activity`, `/notifications` | Workspace activity feed; notification centre (also the bell in the top bar) |
| `/members` | Members table with inline role changes (rules enforced server-side), invitations with bulk email parsing, resend/revoke/copy link |
| `/settings/*` | Profile, preferences (theme incl. dark mode, goals, quiz length, week start), security (password, sessions), workspace settings |
| `/invite/:token`, `/workspaces/new` | Invitation landing page and workspace creation |

## Architecture

```text
frontend/  React 18 + TypeScript 4.9 + Vite 4 SPA (React Router 6), no UI kit — own design system in src/styles
  src/app/         auth, server clock, toasts
  src/lib/         http client, UTC date + formatting helpers, table sorting/paging, validation
  src/components/  Modal/Drawer, Menu, DataTable, Pagination, Tabs, Avatar, Field…
  src/features/    one folder per feature: pages, api.ts, types.ts, pure helpers + tests, CSS
backend/   FastAPI 0.88 + SQLAlchemy 1.4 (SQLite), Pydantic 1.10
  app/models/      ORM models per area (identity, learning, flashcards, planner, board, notes, social)
  app/routers/     one router per feature, workspace-scoped with role checks (app/deps.py)
  app/services/    shared logic: mastery/learning, SM-2 scheduler, recurrence + iCalendar, streaks and
                   goal pace, analytics aggregation, search ranking, ordering, membership rules…
  app/seeding/     deterministic demo data, one module per feature
  tests/           pytest: pure-logic unit tests + API tests against a seeded database
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for conventions (clock, permissions, list endpoints,
fixtures). The only third-party integration is the optional LLM call in `backend/app/tutor.py`.

## Local development (without Docker)

Backend (Python 3.11+):

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
FROZEN_NOW=2022-03-14T09:00:00Z python -m app.seed
FROZEN_NOW=2022-03-14T09:00:00Z uvicorn app.main:app --reload --port 8000
```

Frontend (Node 18+):

```bash
cd frontend
npm ci
npm run dev        # http://localhost:5173, talks to http://localhost:8000/api
```

## Tests, lint and type checks

```bash
cd backend
python -m pytest                 # ~1,000 tests
ruff . && black --check .

cd frontend
npm test                         # Vitest, ~600 tests
npm run typecheck
npm run lint
npm run build
```

With Docker: `docker compose run --rm api python -m pytest`.

Backend tests cover the pure logic (mastery, quiz generation, concept extraction, SM-2 scheduling,
recurrence and iCalendar output, streaks and goal pace, analytics aggregation, search ranking and
snippets, fractional ordering, wiki-link parsing, membership rules, password hashing) and every API
area (validation, permissions per role, status codes, persistence, seed determinism). Frontend tests
cover shared helpers (dates, formatting, tables, http errors), feature logic (calendar layout, board
filtering and reordering, markdown rendering incl. XSS cases, chart scales, scheduler mirror, form
validation) and key components with Testing Library.

## Size

`python scripts/loc.py` counts non-blank lines of git-tracked source (excluding lockfiles, build
output and binary assets).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AI_MODE` | `demo` | `demo` = local tutor answers; `openai` = call an OpenAI-compatible API (falls back locally on errors) |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | empty / OpenAI / `gpt-4o-mini` | Only used when `AI_MODE=openai` |
| `DATABASE_URL` | `sqlite:///./learnloop.db` | SQLAlchemy URL |
| `FROZEN_NOW` | empty (compose: `2022-03-14T09:00:00Z`) | Pin "now" for reproducible screens |
| `SEED_ON_START` | `false` (compose: `true`) | Seed demo data on startup when the database has no users |
| `CORS_ORIGINS` | `http://localhost:5173` | Allowed browser origins |
| `VITE_API_URL` | `http://localhost:8000/api` | Frontend build-time API URL |

## License

MIT — see [LICENSE](LICENSE).
