from datetime import date, datetime

import pytest

from app.services.ics import IcsEvent, build_calendar, escape_text, event_uid, fold_line, rrule

STAMP = datetime(2022, 3, 14, 9)


def unfold(text: str) -> list[str]:
    """Undo RFC 5545 folding and split into content lines."""
    return text.replace("\r\n ", "").split("\r\n")


def workshop(**overrides) -> IcsEvent:
    values = {
        "uid": event_uid(7, 1),
        "title": "SQL workshop",
        "starts_at": datetime(2022, 3, 16, 15),
        "ends_at": datetime(2022, 3, 16, 16, 30),
    }
    return IcsEvent(**{**values, **overrides})


class TestEscaping:
    @pytest.mark.parametrize(
        ("raw", "escaped"),
        [
            ("Joins, keys; indexes", "Joins\\, keys\\; indexes"),
            ("C:\\data", "C:\\\\data"),
            ("line one\nline two", "line one\\nline two"),
            ("windows\r\nbreak", "windows\\nbreak"),
            ("plain", "plain"),
        ],
    )
    def test_escape_text(self, raw, escaped):
        assert escape_text(raw) == escaped

    def test_short_lines_are_not_folded(self):
        assert fold_line("SUMMARY:Short") == "SUMMARY:Short"

    def test_long_lines_fold_at_75_octets(self):
        line = "DESCRIPTION:" + "x" * 200
        folded = fold_line(line)
        parts = folded.split("\r\n")
        assert all(len(part.encode()) <= 75 for part in parts)
        assert all(part.startswith(" ") for part in parts[1:])
        assert folded.replace("\r\n ", "") == line

    def test_folding_never_splits_a_multibyte_character(self):
        line = "SUMMARY:" + "é" * 80  # 2 octets each
        parts = fold_line(line).split("\r\n")
        for part in parts:
            part.encode("utf-8").decode("utf-8")  # would raise on a split character
            assert len(part.encode()) <= 75
        assert fold_line(line).replace("\r\n ", "") == line


class TestRrule:
    def test_rules_per_recurrence(self):
        assert rrule("none", None, False) is None
        assert rrule("daily", None, False) == "FREQ=DAILY"
        assert rrule("weekly", None, False) == "FREQ=WEEKLY"
        assert rrule("weekdays", None, False) == "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"

    def test_until_matches_the_start_value_type(self):
        assert rrule("weekly", date(2022, 4, 25), False) == "FREQ=WEEKLY;UNTIL=20220425T235959Z"
        assert rrule("daily", date(2022, 4, 25), True) == "FREQ=DAILY;UNTIL=20220425"


class TestCalendar:
    def test_document_structure_and_crlf(self):
        text = build_calendar([workshop()], name="Northwind", stamp=STAMP)
        assert text.startswith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")
        assert text.endswith("END:VCALENDAR\r\n")
        assert "\n" not in text.replace("\r\n", "")
        lines = unfold(text)
        assert lines.count("BEGIN:VEVENT") == lines.count("END:VEVENT") == 1

    def test_timed_event_uses_utc_datetimes(self):
        lines = unfold(build_calendar([workshop(location="Zoom, room 2")], name="N", stamp=STAMP))
        assert "DTSTART:20220316T150000Z" in lines
        assert "DTEND:20220316T163000Z" in lines
        assert "DTSTAMP:20220314T090000Z" in lines
        assert "LOCATION:Zoom\\, room 2" in lines
        assert "UID:event-7-ws1@learnloop.app" in lines

    def test_all_day_event_uses_dates_with_exclusive_end(self):
        deadline = workshop(
            title="Quiz closes", starts_at=datetime(2022, 3, 18), ends_at=datetime(2022, 3, 19), all_day=True
        )
        lines = unfold(build_calendar([deadline], name="N", stamp=STAMP))
        assert "DTSTART;VALUE=DATE:20220318" in lines
        assert "DTEND;VALUE=DATE:20220319" in lines

    def test_recurring_event_carries_rrule_and_category(self):
        series = workshop(recurrence="weekdays", recurrence_until=date(2022, 4, 1), category="review")
        lines = unfold(build_calendar([series], name="N", stamp=STAMP))
        assert "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20220401T235959Z" in lines
        assert "CATEGORIES:REVIEW" in lines

    def test_output_is_deterministic_and_sorted(self):
        later = workshop(
            uid=event_uid(9, 1), title="Later", starts_at=datetime(2022, 3, 17, 9), ends_at=datetime(2022, 3, 17, 10)
        )
        first = build_calendar([later, workshop()], name="N", stamp=STAMP)
        second = build_calendar([workshop(), later], name="N", stamp=STAMP)
        assert first == second
        summaries = [line for line in unfold(first) if line.startswith("SUMMARY:")]
        assert summaries == ["SUMMARY:SQL workshop", "SUMMARY:Later"]

    def test_long_multiline_notes_are_escaped_then_folded(self):
        notes = "Bring a laptop.\n" + "Load the Northwind sample database, then open the notebook. " * 3
        text = build_calendar([workshop(description=notes)], name="N", stamp=STAMP)
        assert all(len(line.encode()) <= 75 for line in text.split("\r\n"))
        description = next(line for line in unfold(text) if line.startswith("DESCRIPTION:"))
        assert description.startswith("DESCRIPTION:Bring a laptop.\\nLoad the Northwind sample database\\, then")
