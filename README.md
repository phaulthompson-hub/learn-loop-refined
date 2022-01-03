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

