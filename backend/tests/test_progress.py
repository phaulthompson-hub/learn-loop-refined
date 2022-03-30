from dataclasses import dataclass
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import select

from app import clock
from app.mastery import average_mastery
from app.models import Course, Goal, StudyLog, User, Workspace
from app.services.learning import learner_concepts
from app.services.progress import (
    activity_heatmap,
    activity_score,
    current_streak,
    elapsed_fraction,
    goal_period,
    goal_progress,
    goal_status,
    intensity_level,
    longest_streak,
    streak_summary,
    study_summary,
)

NOW = datetime(2022, 3, 14, 9)  # Monday
TODAY = NOW.date()


@dataclass
class FakeGoal:
    period: str
    created_at: datetime = datetime(2022, 2, 27, 9)
    due_date: date | None = None


def days_ago(*offsets: int) -> set[date]:
    return {TODAY - timedelta(days=n) for n in offsets}


# ---------- Pure helpers ----------


class TestStreaks:
    def test_streak_counts_back_from_today(self):
        assert current_streak(days_ago(0, 1, 2, 4), TODAY) == 3

    def test_streak_still_alive_when_today_is_not_yet_active(self):
        assert current_streak(days_ago(1, 2, 3), TODAY) == 3

    def test_streak_broken_after_a_missed_day(self):
        assert current_streak(days_ago(2, 3, 4), TODAY) == 0

    def test_longest_streak_finds_the_best_run(self):
        assert longest_streak(days_ago(0, 1, 5, 6, 7, 8, 20)) == 4
        assert longest_streak(set()) == 0


class TestPeriods:
    def test_day_period(self):
        period = goal_period(FakeGoal("day"), NOW)
        assert (period.start, period.end) == (datetime(2022, 3, 14), datetime(2022, 3, 15))
        assert period.label == "Today · Mon 14 Mar"

    @pytest.mark.parametrize(("week_starts_on", "first_day"), [(0, 14), (6, 13), (3, 10)])
    def test_week_period_follows_the_users_week_start(self, week_starts_on, first_day):
        period = goal_period(FakeGoal("week"), NOW, week_starts_on)
        assert period.start == datetime(2022, 3, first_day)
        assert period.end - period.start == timedelta(days=7)

    def test_week_label_spanning_two_months(self):
        period = goal_period(FakeGoal("week"), datetime(2022, 3, 31, 12))
        assert period.label == "This week · 28 Mar – 3 Apr"

    def test_one_off_period_runs_from_creation_to_end_of_due_day(self):
        period = goal_period(FakeGoal("once", due_date=date(2022, 4, 4)), NOW)
        assert period.start == datetime(2022, 2, 27, 9)
        assert period.end == datetime(2022, 4, 5)
        assert period.label == "Due 4 Apr 2022"
        assert goal_period(FakeGoal("once"), NOW).end is None

    def test_elapsed_fraction(self):
        start, end = datetime(2022, 3, 14), datetime(2022, 3, 15)
        assert elapsed_fraction(start, end, datetime(2022, 3, 14, 6)) == 0.25
        assert elapsed_fraction(start, end, datetime(2022, 3, 13)) == 0.0
        assert elapsed_fraction(start, end, datetime(2022, 3, 18)) == 1.0
        assert elapsed_fraction(start, None, NOW) == 0.0


class TestGoalStatus:
    def test_done_beats_everything(self):
        assert goal_status(10, 8, 0.1, overdue=True) == "done"

    def test_overdue_when_past_due_and_short(self):
        assert goal_status(50, 80, 1.0, overdue=True) == "overdue"

    def test_pace_with_tolerance(self):
        # Half the week gone: expected 90 of 180 minutes, 80% of that (72) keeps the goal on track.
        assert goal_status(72, 180, 0.5, overdue=False) == "on_track"
        assert goal_status(71, 180, 0.5, overdue=False) == "at_risk"

    def test_nothing_expected_yet_is_on_track(self):
        assert goal_status(0, 8, 0.0, overdue=False) == "on_track"

    def test_mastery_pace_starts_from_the_baseline(self):
        # 35% baseline, target 80%: halfway expects 57.5%; 54% is within tolerance of the 22.5 gain.
        assert goal_status(54, 80, 0.5, overdue=False, baseline=35) == "on_track"
        assert goal_status(50, 80, 0.5, overdue=False, baseline=35) == "at_risk"


class TestHeatmapLevels:
    def test_activity_score_weights_minutes(self):
        assert activity_score(3, 2, 25) == 7.5

    @pytest.mark.parametrize(("score", "level"), [(0, 0), (0.5, 1), (2.5, 1), (2.6, 2), (5, 2), (7.6, 4), (10, 4)])
    def test_levels_are_relative_to_the_busiest_day(self, score, level):
        assert intensity_level(score, 10) == level

    def test_no_activity_anywhere(self):
        assert intensity_level(0, 0) == 0


# ---------- A fresh learner with hand-made study logs ----------


@pytest.fixture
def learner(newcomer, db):
    """(user, workspace, course) for a brand-new account, so other features' seed data cannot interfere."""
    _, workspace_id = newcomer
    user = db.scalars(select(User).where(User.email == "learner@example.com")).one()
    course = Course(workspace_id=workspace_id, title="Statistics", color="#2563eb")
    db.add(course)
    db.flush()
    return user, db.get(Workspace, workspace_id), course


def log(db, user: User, days_back: int, hour: int, minutes: int, course: Course | None = None) -> None:
    moment = datetime.combine(TODAY - timedelta(days=days_back), datetime.min.time()) + timedelta(hours=hour)
    db.add(StudyLog(user_id=user.id, minutes=minutes, logged_at=moment, course_id=course.id if course else None))


def test_weekly_minutes_follow_the_week_start_preference(learner, db):
    user, workspace, course = learner
    log(db, user, 0, 8, 20)
    log(db, user, 1, 18, 55, course)  # Sunday
    log(db, user, 2, 18, 30)  # Saturday
    goal = Goal(
        workspace_id=workspace.id, user_id=user.id, title="3 h", kind="study_minutes", period="week", target=180
    )
    db.add(goal)
    db.flush()
    progress = goal_progress(db, goal)
    assert (progress["current"], progress["status"], progress["unit"]) == (20, "on_track", "minutes")
    assert progress["days_left"] == 6
    user.week_starts_on = 6  # a Sunday week start pulls yesterday into this week
    assert goal_progress(db, goal)["current"] == 75
    user.week_starts_on = 5
    assert goal_progress(db, goal)["current"] == 105


def test_minutes_goal_for_one_course_ignores_general_study(learner, db):
    user, workspace, course = learner
    log(db, user, 0, 7, 40)
    log(db, user, 0, 8, 15, course)
    goal = Goal(
        workspace_id=workspace.id,
        user_id=user.id,
        course_id=course.id,
        title="Stats",
        kind="study_minutes",
        period="day",
        target=30,
    )
    db.add(goal)
    db.flush()
    progress = goal_progress(db, goal)
    assert progress["current"] == 15
    assert progress["status"] == "on_track"  # 37.5% of the day gone: 15 of an expected 11.25


def test_heatmap_covers_whole_weeks_and_flags_the_future(learner, db):
    user, _, _ = learner
    log(db, user, 0, 8, 20)
    log(db, user, 3, 8, 80)
    log(db, user, 40, 8, 10)
    db.flush()
    heatmap = activity_heatmap(db, user.id, TODAY, weeks=12, week_starts_on=0)
    days = {d["date"]: d for d in heatmap["days"]}
    assert len(heatmap["days"]) == 84
    assert heatmap["start"] == date(2021, 12, 27)  # a Monday, 11 weeks before this week
    assert heatmap["end"] == date(2022, 3, 20)
    assert [d["future"] for d in heatmap["days"]].count(True) == 6
    assert [days[TODAY - timedelta(days=n)]["level"] for n in (3, 0, 40, 1)] == [4, 1, 1, 0]
    assert heatmap["max_score"] == 8.0
    assert heatmap["active_days"] == 3
    assert heatmap["totals"] == {"answers": 0, "reviews": 0, "minutes": 110}


def test_study_summary_splits_by_week_and_course(learner, db):
    user, workspace, course = learner
    log(db, user, 0, 8, 20)
    log(db, user, 1, 18, 55, course)
    log(db, user, 3, 18, 30, course)
    log(db, user, 30, 18, 99)  # before the two-week window
    db.flush()
    summary = study_summary(db, user.id, workspace.id, TODAY, weeks=2)
    assert [w["start"] for w in summary["weeks"]] == [date(2022, 3, 7), date(2022, 3, 14)]
    assert [w["minutes"] for w in summary["weeks"]] == [85, 20]
    assert summary["weeks"][0]["days"][6] == {"date": date(2022, 3, 13), "minutes": 55}
    assert [(row["title"], row["minutes"]) for row in summary["by_course"]] == [
        ("Statistics", 85),
        ("General study", 20),
    ]
    assert (summary["total_minutes"], summary["active_days"], summary["average_per_active_day"]) == (105, 3, 35)
    assert summary["today_minutes"] == 20


def test_study_summary_excludes_courses_of_other_workspaces(learner, db):
    user, workspace, _ = learner
    elsewhere = Course(workspace_id=workspace.id + 1000, title="Elsewhere")
    db.add(elsewhere)
    db.flush()
    log(db, user, 0, 8, 45, elsewhere)
    db.flush()
    assert study_summary(db, user.id, workspace.id, TODAY, weeks=1)["total_minutes"] == 0


# ---------- Against the seeded demo data ----------


def user_named(db, email: str) -> User:
    return db.scalars(select(User).where(User.email == email)).one()


def goal_titled(db, title: str) -> Goal:
    return db.scalars(select(Goal).where(Goal.title == title)).one()


def test_alex_has_a_live_streak_and_a_long_best_run(seeded, db):
    summary = streak_summary(db, user_named(db, "demo@learnloop.dev").id)
    assert summary["active_today"] is True
    assert summary["current"] >= 13  # today plus the twelve quiz days before it
    assert summary["longest"] >= 27  # the seeded run from 46 to 20 days ago
    assert summary["longest"] > summary["current"]
    assert summary["active_days_last_30"] >= 20


def test_daily_answers_goal_is_at_risk_before_any_answers_today(seeded, db):
    progress = goal_progress(db, goal_titled(db, "Answer 8 questions a day"))
    assert progress["current"] == 0
    assert progress["status"] == "at_risk"
    assert progress["expected"] == 3.0  # 9 of 24 hours gone
    assert progress["period_label"] == "Today · Mon 14 Mar"
    assert progress["days_left"] == 0


def test_course_mastery_goal_uses_the_learners_average(seeded, db):
    goal = goal_titled(db, "Reach 80% on Machine Learning")
    course = db.get(Course, goal.course_id)
    expected = average_mastery(learner_concepts(db, course, goal.user_id))
    progress = goal_progress(db, goal)
    assert progress["current"] == round(expected, 1)
    assert progress["percent"] == min(100, round(100 * expected / 80))
    assert progress["period_label"] == "Due 4 Apr 2022"
    assert progress["days_left"] == 21


def test_goal_done_and_overdue(seeded, db):
    sam = user_named(db, "sam@learnloop.dev")
    northwind = db.scalars(select(Workspace).where(Workspace.slug == "northwind-data-academy")).one()
    minutes = Goal(
        workspace_id=northwind.id, user_id=sam.id, title="Daily study", kind="study_minutes", period="day", target=30
    )
    db.add_all([minutes, StudyLog(user_id=sam.id, minutes=45, logged_at=clock.now() - timedelta(hours=1))])
    sql = goal_titled(db, "Master SQL")
    sql.due_date = TODAY - timedelta(days=1)
    db.flush()
    done = goal_progress(db, minutes)
    assert (done["status"], done["percent"], done["remaining"]) == ("done", 100, 0)
    assert goal_progress(db, sql)["status"] == "overdue"


def test_answers_in_other_workspaces_do_not_count(seeded, db):
    alex = user_named(db, "demo@learnloop.dev")
    biology = db.scalars(select(Workspace).where(Workspace.slug == "biology-201-study-group")).one()
    goal = Goal(workspace_id=biology.id, user_id=alex.id, title="Bio", kind="daily_answers", period="day", target=5)
    db.add(goal)
    db.flush()
    with clock.travel(datetime(2022, 3, 11, 20)):  # Friday: Alex answered ML and SQL questions only
        assert goal_progress(db, goal)["current"] == 0
    with clock.travel(datetime(2022, 3, 12, 20)):  # Saturday: a cells quiz in the biology workspace
        assert goal_progress(db, goal)["current"] == 2
