# LearnLoop architecture

LearnLoop is a multi-workspace adaptive-learning app: FastAPI + SQLAlchemy (SQLite) API in
`backend/`, React 18 + TypeScript + Vite SPA in `frontend/`.

## Backend (`backend/app`)

| Path | Purpose |
|---|---|
| `clock.py` | The only source of "now". `FROZEN_NOW` pins it; `clock.travel(dt)` moves it temporarily (seed/tests). Never call `datetime.now()` / `utcnow()` directly. |
| `models/` | All ORM models, one module per area (`identity`, `learning`, `flashcards`, `planner`, `board`, `notes`, `social`). Datetimes are naive UTC. |
| `deps.py` | `current_user`, `workspace_access` (for `/api/workspaces/{workspace_id}/...`), `access_for(db, user, workspace_id)` (for item routes), `Access.require("instructor")`, `get_or_404`. Non-members get 404. Roles: learner < instructor < admin < owner. |
| `routers/<feature>.py` | One `router = APIRouter(...)` per feature, all included by `main.py`. Collection routes live under `/api/workspaces/{workspace_id}/<things>`, item routes under `/api/<things>/{id}`. |
| `schemas/<feature>.py` | Pydantic request/response models. Use `schemas.common.Text(min, max)` (strips, then length-checks), `Color`, `Email`. |
| `services/` | Shared logic: `learning` (courses, per-learner mastery, grading), `accounts` (users, workspaces, sessions), `events` (`record()` activity feed, `notify()` notifications), `listing` (`paginate`, `parse_sort`, `sort_items`, `matches`, `split_tags`). |
| `seeding/` | Deterministic demo data. `core.py` creates users/workspaces/courses/quiz history; each feature has `seeding/<feature>.py` with `seed(ctx: SeedContext)`. Use `ctx.at(days_ago, hour)` / `ctx.ahead(days, hour)` for timestamps and `ctx.rng` for any variety. |
| `mastery.py`, `quiz.py`, `concepts.py`, `tutor.py` | Pure learning logic (unchanged algorithms from v1). |

List endpoints return `{items, total, page, page_size}` (plus extra keys where useful).
Mutations that other people should see call `services.events.record(...)`; things a specific
person must act on call `services.events.notify(...)`.

### Tests (`backend/tests`)
`conftest.py` freezes the clock at **2022-03-14 09:00 UTC (a Monday)** and provides fixtures:
`client`, `db`, `seeded` (full demo data, copied from a template per test), `alex` / `maya` / `sam`
(auth headers), `northwind` / `biology` (workspace ids), `ml_course`, `newcomer` (fresh account +
empty workspace), plus helpers `login()`, `register()`, `workspace_id()`, `find_course()`.

Run: `cd backend && python -m pytest` · lint: `ruff . && black --check .`

## Frontend (`frontend/src`)

| Path | Purpose |
|---|---|
| `lib/http.ts` | `http.get/post/put/patch/delete/upload`, `query({...})`, `ApiError`, `Page<T>`. Adds the bearer token. |
| `lib/format.ts` | Date/number formatting in UTC with a fixed locale (`formatDate`, `relativeTime(value, now)`, `formatDuration`, `plural`, `humanize`…). |
| `lib/dates.ts` | UTC date math (`parseDate`, `dayKey`, `addDays`, `startOfWeek`, `daysBetween`, `toApiDateTime`…). |
| `lib/table.ts` | `sortBy`, `toggleSort`, `matchesQuery`, `paginate`, `pageWindow`, `groupBy`, `countBy`. |
| `app/auth.tsx` | `useAuth()`, `useUser()`, `useWorkspace()` (current workspace + `can(role)`). |
| `app/clock.tsx` | `useNow()` — server time from `/api/meta`. **Always use this for "today"/relative times, never `new Date()`**. |
| `app/toast.tsx` | `useToast().success/error/info`. |
| `hooks/useLoader.ts` | `useLoader(fn, key)` → `{data, error, loading, reload}`. |
| `components/` | `ui.tsx` (PageHeader, StatCard, EmptyState, ErrorBanner, Loading, MasteryBar, LevelBadge), `Modal` + `ConfirmDialog` (dialog or drawer), `Menu`, `DataTable`, `Pagination`, `Tabs` / `RouteTabs`, `Avatar` / `AvatarStack`, `Field` / `Switch`. |
| `features/<feature>/` | Pages, `api.ts`, `types.ts`, `<feature>.css`, pure helpers + `*.test.ts(x)`. Each feature exports its `<Route>`s from `routes.tsx`; `App.tsx` mounts them inside the app shell. |
| `styles/base.css` | Design tokens (light + `[data-theme='dark']`) and shared primitives. Feature CSS must use the tokens (`var(--card)`, `var(--line)`, `var(--brand)`…). |

Run: `cd frontend && npm test && npm run typecheck && npm run lint && npm run build`
