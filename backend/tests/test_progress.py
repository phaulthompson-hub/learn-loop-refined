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


