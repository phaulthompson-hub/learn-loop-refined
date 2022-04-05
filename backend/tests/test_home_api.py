from datetime import date, datetime, timedelta

from conftest import login, register
from sqlalchemy import select

from app.models import Attempt, Deck, Event, Flashcard, Goal, ReviewLog, StudyLog, Task, User, Workspace
from app.seeding.materials import SQL_TEXT
from app.services.accounts import add_member
from app.services.learning import create_course
from app.services.progress import goal_progress
from app.services.review_queue import due_summary

NOW = datetime(2022, 3, 14, 9, 0)
TODAY = NOW.date()


def home(client, headers, workspace: int) -> dict:
    response = client.get(f"/api/workspaces/{workspace}/home", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def user_by_email(db, email: str) -> User:
    return db.scalars(select(User).where(User.email == email)).one()


def second_member(client, db, workspace: int) -> tuple[dict, User]:
    """Register a classmate and add them to `workspace` as a learner."""
    headers, _, _ = register(client, name="Casey Park", email="casey@example.com", workspace="Casey's space")
    casey = user_by_email(db, "casey@example.com")
    add_member(db, db.get(Workspace, workspace), casey)
    db.commit()
    return headers, casey


def event(db, workspace: int, user: User, title: str, start: datetime, minutes: int = 60, **extra) -> Event:
    row = Event(
        workspace_id=workspace,
        user_id=user.id,
        title=title,
        starts_at=start,
        ends_at=start + timedelta(minutes=minutes),
        **extra,
    )
    db.add(row)
    db.commit()
    return row


# ---------- Access ----------


def test_home_requires_sign_in_and_membership(client, alex, biology, sam):
    assert client.get(f"/api/workspaces/{biology}/home").status_code == 401
    assert client.get(f"/api/workspaces/{biology}/home", headers=sam).status_code == 404


# ---------- Seeded dashboard ----------


def test_greeting_uses_first_name_and_the_frozen_clock(client, alex, northwind):
    greeting = home(client, alex, northwind)["greeting"]
    assert greeting == {
        "first_name": "Alex",
        "part_of_day": "morning",
        "today": "2022-03-14",
        "now": "2022-03-14T09:00:00",
    }


def test_due_cards_match_the_review_queue(client, alex, northwind, db):
    data = home(client, alex, northwind)
    user = user_by_email(db, "demo@learnloop.dev")
    assert data["flashcards"] == due_summary(db, user.id, northwind)


def test_continue_learning_puts_pinned_then_recently_opened_courses_first(client, alex, northwind):
    cards = home(client, alex, northwind)["continue_learning"]
    titles = [c["title"] for c in cards]
    assert titles[0] == "Introduction to Machine Learning"
    assert cards[0]["pinned"] is True
    assert titles.index("Statistics Fundamentals") < titles.index("Relational Databases & SQL")
    assert "Data Visualization Principles" not in titles  # draft courses never appear
    for card in cards:
        expected = round(100 * card["mastered_concepts"] / card["concepts"], 1)
        assert card["progress"] == expected


def test_continue_learning_recommends_the_same_concept_as_the_course_page(client, alex, northwind):
    for card in home(client, alex, northwind)["continue_learning"]:
        recommendation = client.get(f"/api/courses/{card['id']}/recommendation", headers=alex).json()
        assert card["next"] == recommendation


def test_focus_is_the_weakest_recommendation_across_enrolled_courses(client, alex, northwind):
    data = home(client, alex, northwind)
    recommendations = [
        client.get(f"/api/courses/{c['id']}/recommendation", headers=alex).json() for c in data["continue_learning"]
    ]
    weakest = min((r for r in recommendations if r["concept_id"]), key=lambda r: r["mastery"])
    focus = data["focus"]
    assert focus["concept_id"] == weakest["concept_id"]
    assert focus["mastery"] == weakest["mastery"]
    assert focus["level"] in {"needs review", "learning", "proficient"}


def test_recent_activity_is_newest_first_and_limited(client, alex, northwind):
    items = home(client, alex, northwind)["activity"]
    assert 0 < len(items) <= 6
    stamps = [item["created_at"] for item in items]
    assert stamps == sorted(stamps, reverse=True)
    assert all(item["workspace_id"] == northwind for item in items)


# ---------- A fresh workspace ----------


def test_empty_workspace_returns_onboarding_state(client, newcomer):
    headers, workspace = newcomer
    data = home(client, headers, workspace)
    assert data["greeting"]["first_name"] == "Test"
    assert data["onboarding"] == {
        "courses": 0,
        "enrolled": 0,
        "decks": 0,
        "events": 0,
        "goals": 0,
        "can_create_courses": True,
    }
    assert data["continue_learning"] == []
    assert data["focus"] is None
    assert data["agenda"] == []
    assert data["tasks"] == {"items": [], "total_open": 0, "overdue": 0}
    assert data["flashcards"] == {"due": 0, "new": 0, "total": 0}
    assert data["week"]["answers"] == {"value": 0, "previous": 0, "change": 0, "percent": None}
    assert len(data["week"]["days"]) == 7
    assert data["streak"]["current"] == 0


def test_agenda_expands_recurrences_and_hides_other_peoples_private_events(client, newcomer, db):
    headers, workspace = newcomer
    me = user_by_email(db, "learner@example.com")
    _, casey = second_member(client, db, workspace)
    past = event(db, workspace, me, "Morning review", datetime(2022, 3, 14, 7, 0))
    current = event(db, workspace, me, "Focus block", datetime(2022, 3, 14, 8, 30))
    weekly = event(
        db, workspace, me, "Weekly lab", datetime(2022, 3, 7, 14, 0), recurrence="weekly", recurrence_until=None
    )
    shared = event(db, workspace, casey, "Group study", datetime(2022, 3, 14, 11, 0), shared=True)
    all_day = event(db, workspace, me, "Exam day", datetime(2022, 3, 14), minutes=24 * 60, all_day=True, kind="exam")
    event(db, workspace, casey, "Casey's private session", datetime(2022, 3, 14, 12, 0))
    event(db, workspace, me, "Tomorrow", datetime(2022, 3, 15, 9, 0))
    ended = date(2022, 3, 8)
    event(db, workspace, me, "Ended series", datetime(2022, 2, 28, 10, 0), recurrence="daily", recurrence_until=ended)

    agenda = home(client, headers, workspace)["agenda"]
    assert [item["event_id"] for item in agenda] == [all_day.id, past.id, current.id, shared.id, weekly.id]
    by_id = {item["event_id"]: item for item in agenda}
    assert by_id[past.id]["status"] == "past"
    assert by_id[current.id]["status"] == "now"
    assert by_id[weekly.id]["status"] == "upcoming"
    assert by_id[weekly.id]["recurring"] is True
    assert by_id[weekly.id]["starts_at"] == "2022-03-14T14:00:00"
    assert by_id[shared.id]["mine"] is False
    assert by_id[shared.id]["shared"] is True


def test_open_tasks_are_mine_sorted_by_due_date_with_overdue_flags(client, newcomer, db):
    headers, workspace = newcomer
    me = user_by_email(db, "learner@example.com")
    _, casey = second_member(client, db, workspace)

    def task(number: int, title: str, due: date | None, **extra) -> Task:
        row = Task(
            workspace_id=workspace,
            number=number,
            title=title,
            due_date=due,
            reporter_id=casey.id,
            assignee_id=extra.pop("assignee_id", me.id),
            **extra,
        )
        db.add(row)
        return row

    task(1, "No due date", None)
    task(2, "Due next week", TODAY + timedelta(days=7))
    task(3, "Overdue", TODAY - timedelta(days=2))
    task(4, "Due today, low", TODAY, priority="low")
    task(5, "Due today, urgent", TODAY, priority="urgent")
    task(6, "Already done", TODAY - timedelta(days=5), status="done")
    task(7, "Casey's task", TODAY, assignee_id=casey.id)
    task(8, "Later", TODAY + timedelta(days=30))
    db.commit()

    tasks = home(client, headers, workspace)["tasks"]
    assert tasks["total_open"] == 6
    assert tasks["overdue"] == 1
    assert [t["title"] for t in tasks["items"]] == [
        "Overdue",
        "Due today, urgent",
        "Due today, low",
        "Due next week",
        "Later",
    ]
    first = tasks["items"][0]
    assert first["overdue"] is True
    assert first["due_in_days"] == -2
    assert tasks["items"][1]["due_in_days"] == 0
    assert tasks["items"][1]["overdue"] is False


def test_goals_mirror_goal_progress_and_skip_archived_ones(client, newcomer, db):
    headers, workspace = newcomer
    me = user_by_email(db, "learner@example.com")
    active = Goal(workspace_id=workspace, user_id=me.id, title="Study an hour", kind="study_minutes", target=60)
    archived = Goal(workspace_id=workspace, user_id=me.id, title="Old", kind="study_minutes", target=60, archived=True)
    db.add_all([active, archived])
    db.add(StudyLog(user_id=me.id, minutes=30, activity="reading", logged_at=NOW - timedelta(hours=1)))
    db.commit()

    goals = home(client, headers, workspace)["goals"]
    assert [g["title"] for g in goals] == ["Study an hour"]
    expected = goal_progress(db, db.get(Goal, active.id))
    for key in ("current", "target", "percent", "status", "period_label", "unit"):
        assert goals[0][key] == expected[key]


def test_week_summary_compares_the_last_seven_days_with_the_seven_before(client, newcomer, db):
    headers, workspace = newcomer
    me = user_by_email(db, "learner@example.com")
    course = create_course(db, workspace_id=workspace, owner=me, title="SQL", text=SQL_TEXT, source_name="sql.md")
    concept = course.concepts[0]
    deck = Deck(course_id=course.id, name="Keys")
    db.add(deck)
    db.flush()
    card = Flashcard(deck_id=deck.id, front="Primary key?", back="Unique row id")
    db.add(card)
    db.flush()

    def attempt(when: datetime, correct: bool) -> Attempt:
        return Attempt(
            user_id=me.id,
            course_id=course.id,
            concept_id=concept.id,
            concept_name=concept.name,
            selected=0,
            correct=correct,
            mastery_before=35,
            mastery_after=50,
            created_at=when,
        )

    db.add_all([attempt(NOW, True), attempt(NOW, True), attempt(NOW - timedelta(days=1), False)])
    db.add(attempt(NOW - timedelta(days=8), True))
    db.add_all(
        [
            ReviewLog(user_id=me.id, card_id=card.id, course_id=course.id, grade=2, reviewed_at=NOW),
            ReviewLog(user_id=me.id, card_id=card.id, course_id=course.id, grade=3, reviewed_at=NOW),
            StudyLog(user_id=me.id, course_id=course.id, minutes=25, logged_at=NOW - timedelta(days=2)),
            StudyLog(user_id=me.id, minutes=50, logged_at=NOW - timedelta(days=10)),
        ]
    )
    db.commit()

    week = home(client, headers, workspace)["week"]
    assert week["answers"] == {"value": 3, "previous": 1, "change": 2, "percent": 200.0}
    assert week["accuracy"]["value"] == 66.7
    assert week["accuracy"]["previous"] == 100.0
    assert week["reviews"]["value"] == 2
    assert week["minutes"] == {"value": 25, "previous": 50, "change": -25, "percent": -50.0}
    assert [d["date"] for d in week["days"]][-1] == "2022-03-14"
    assert week["days"][-1] == {"date": "2022-03-14", "answers": 2, "reviews": 2, "minutes": 0}
    assert week["days"][-2]["answers"] == 1


def test_learners_do_not_see_draft_courses_or_get_course_creation(client, newcomer, db):
    headers, workspace = newcomer
    me = user_by_email(db, "learner@example.com")
    casey_headers, casey = second_member(client, db, workspace)
    create_course(
        db, workspace_id=workspace, owner=me, title="Draft", text=SQL_TEXT, source_name="d.md", status="draft"
    )
    create_course(db, workspace_id=workspace, owner=me, title="Live", text=SQL_TEXT, source_name="l.md")
    data = home(client, casey_headers, workspace)
    assert data["onboarding"]["courses"] == 1
    assert data["onboarding"]["can_create_courses"] is False
    assert data["onboarding"]["enrolled"] == 0
    assert data["continue_learning"] == []
    # The owner is enrolled in both, but drafts never appear under "continue learning".
    owner_view = home(client, headers, workspace)
    assert [c["title"] for c in owner_view["continue_learning"]] == ["Live"]
    assert owner_view["onboarding"]["courses"] == 2


def test_home_is_scoped_to_the_requested_workspace(client, alex, biology, northwind):
    bio = home(client, alex, biology)
    titles = {c["title"] for c in bio["continue_learning"]}
    assert titles <= {"Cell Biology", "Mendelian Genetics"}
    assert all(item["workspace_id"] == biology for item in bio["activity"])
    north = home(client, login(client, "demo@learnloop.dev"), northwind)
    assert not titles & {c["title"] for c in north["continue_learning"]}
