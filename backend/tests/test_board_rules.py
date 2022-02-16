from dataclasses import dataclass, field
from datetime import date

import pytest

from app.services.board import (
    TaskFilters,
    column_points,
    due_state,
    is_overdue,
    matches_due,
    mentioned_ids,
    over_wip_limit,
    task_key,
    task_matches,
    workspace_prefix,
)

MONDAY = date(2022, 3, 14)
PEOPLE = [(1, "Alex Rivera"), (2, "Maya Chen"), (3, "Sam Okafor"), (4, "Samira Haddad"), (5, "Priya Nair")]


@dataclass
class FakeLabel:
    id: int
    name: str


@dataclass
class FakeTask:
    title: str = "Read chapter 4"
    description: str = ""
    status: str = "todo"
    priority: str = "medium"
    assignee_id: int | None = None
    course_id: int | None = None
    due_date: date | None = None
    labels: list[FakeLabel] = field(default_factory=list)


class TestWorkspacePrefix:
    @pytest.mark.parametrize(
        ("name", "prefix"),
        [
            ("Northwind Data Academy", "NDA"),
            ("Biology 201 Study Group", "BSG"),
            ("Physics", "PH"),
            ("The Art of Statistics", "AS"),
            ("  data   science  ", "DS"),
            ("2022", "LL"),
            ("One Two Three Four", "OTT"),
        ],
    )
    def test_prefix(self, name, prefix):
        assert workspace_prefix(name) == prefix

    def test_task_key(self):
        assert task_key("NDA", 12) == "NDA-12"


class TestDueState:
    def test_none(self):
        assert due_state(None, "todo", MONDAY) == "none"

    def test_done_is_never_overdue(self):
        assert due_state(date(2022, 2, 27), "done", MONDAY) == "done"
        assert not is_overdue(date(2022, 2, 27), "done", MONDAY)

    def test_overdue(self):
        assert due_state(date(2022, 3, 13), "in_progress", MONDAY) == "overdue"
        assert is_overdue(date(2022, 3, 13), "review", MONDAY)

    def test_today_is_not_overdue(self):
        assert due_state(MONDAY, "todo", MONDAY) == "today"
        assert not is_overdue(MONDAY, "todo", MONDAY)

    @pytest.mark.parametrize(("day", "state"), [(15, "soon"), (17, "soon"), (18, "later"), (28, "later")])
    def test_future(self, day, state):
        assert due_state(date(2022, 3, day), "todo", MONDAY) == state


class TestMatchesDue:
    def test_none_filter(self):
        assert matches_due(None, "todo", "none", MONDAY)
        assert not matches_due(MONDAY, "todo", "none", MONDAY)

    def test_overdue_filter_skips_done(self):
        assert matches_due(date(2022, 3, 8), "todo", "overdue", MONDAY)
        assert not matches_due(date(2022, 3, 8), "done", "overdue", MONDAY)

    def test_today_filter(self):
        assert matches_due(MONDAY, "todo", "today", MONDAY)
        assert not matches_due(date(2022, 3, 15), "todo", "today", MONDAY)

    def test_week_is_monday_to_sunday(self):
        wednesday = date(2022, 3, 16)
        assert matches_due(date(2022, 3, 14), "todo", "week", wednesday)
        assert matches_due(date(2022, 3, 20), "todo", "week", wednesday)
        assert not matches_due(date(2022, 3, 21), "todo", "week", wednesday)
        assert not matches_due(date(2022, 3, 13), "todo", "week", wednesday)

    def test_week_skips_finished_and_undated(self):
        assert not matches_due(MONDAY, "done", "week", MONDAY)
        assert not matches_due(None, "todo", "week", MONDAY)


class TestMentions:
    def test_full_name(self):
        assert mentioned_ids("Thanks @Maya Chen!", PEOPLE) == [2]

    def test_unique_first_name(self):
        assert mentioned_ids("@priya can you check?", PEOPLE) == [5]

    def test_first_name_must_not_be_prefix_of_another_word(self):
        assert mentioned_ids("@Samira will review", PEOPLE) == [4]

    def test_order_of_first_appearance(self):
        assert mentioned_ids("@Priya and @Alex, cc @Priya", PEOPLE) == [5, 1]

    def test_email_addresses_are_not_mentions(self):
        assert mentioned_ids("mail alex@example.com", PEOPLE) == []

    def test_ambiguous_first_name_needs_full_name(self):
        people = [(1, "Sam Okafor"), (2, "Sam Lee")]
        assert mentioned_ids("@Sam please look", people) == []
        assert mentioned_ids("@Sam Lee please look", people) == [2]

    def test_no_mentions(self):
        assert mentioned_ids("Nothing to see here", PEOPLE) == []

    def test_single_word_names(self):
        assert mentioned_ids("hey @Cher", [(9, "Cher")]) == [9]


