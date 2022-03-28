from conftest import find_course, login
from sqlalchemy import select

from app.models import Activity, Event, Notification, User

WEEK = {"start": "2022-03-14T00:00:00", "end": "2022-03-21T00:00:00"}


def week_items(client, headers, workspace, **params) -> list[dict]:
    response = client.get(f"/api/workspaces/{workspace}/events", params={**WEEK, **params}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["items"]


def titles(items: list[dict]) -> list[str]:
    return [item["event"]["title"] for item in items]


def event_id(client, headers, workspace, title: str) -> int:
    return next(i["event"]["id"] for i in week_items(client, headers, workspace) if i["event"]["title"] == title)


def new_event(**overrides) -> dict:
    return {
        "title": "Focus block",
        "kind": "study",
        "starts_at": "2022-03-17T10:00:00",
        "ends_at": "2022-03-17T11:00:00",
        **overrides,
    }


# ---------- Listing ----------


def test_week_expands_recurrence_and_mixes_own_and_shared_events(client, alex, northwind):
    items = week_items(client, alex, northwind)
    names = titles(items)
    assert names.count("Flashcard review block") == 5  # weekdays only
    assert names.count("Evening ML study") == 1
    assert "SQL workshop: window functions" in names  # Maya's, shared
    assert "SQL practice" not in names  # Sam's private session
    assert len({i["key"] for i in items}) == len(items)
    starts = [i["starts_at"] for i in items]
    assert starts == sorted(starts)
    review = [i for i in items if i["event"]["title"] == "Flashcard review block"]
    assert [i["starts_at"][:10] for i in review] == [f"2022-03-{d}" for d in (14, 15, 16, 17, 18)]
    assert review[1]["index"] == review[0]["index"] + 1


def test_occurrence_payload_describes_the_series(client, alex, northwind):
    workshop = next(i for i in week_items(client, alex, northwind) if i["event"]["title"].startswith("SQL workshop"))
    event = workshop["event"]
    assert event["owner"]["name"] == "Maya Chen"
    assert event["course"] is not None and event["course"]["color"].startswith("#")
    assert event["shared"] is True
    assert event["can_edit"] is True  # Alex is a Northwind admin
    assert (workshop["starts_at"], workshop["ends_at"]) == ("2022-03-16T15:00:00", "2022-03-16T16:30:00")


def test_other_members_only_see_shared_events(client, sam, northwind):
    names = titles(week_items(client, sam, northwind))
    assert "SQL workshop: window functions" in names
    assert "SQL practice" in names
    assert "Evening ML study" not in names and "Flashcard review block" not in names
    workshop = next(i for i in week_items(client, sam, northwind) if i["event"]["title"].startswith("SQL workshop"))
    assert workshop["event"]["can_edit"] is False


def test_filters(client, alex, northwind):
    assert set(titles(week_items(client, alex, northwind, kind="live"))) == {
        "SQL workshop: window functions",
        "Office hours",
    }
    assert set(titles(week_items(client, alex, northwind, kind="deadline,live"))) >= {"Statistics quiz 2 closes"}
    mine = week_items(client, alex, northwind, mine="true")
    assert mine and all(i["event"]["owner"]["name"] == "Alex Rivera" for i in mine)
    shared = week_items(client, alex, northwind, shared="true")
    assert shared and all(i["event"]["shared"] for i in shared)
    ml = find_course(client, alex, northwind, "Introduction to Machine Learning")
    assert set(titles(week_items(client, alex, northwind, course_id=ml["id"]))) == {
        "Evening ML study",
        "Read: regularisation chapter",
    }


def test_all_day_deadline_spans_its_day(client, alex, northwind):
    deadline = next(i for i in week_items(client, alex, northwind) if i["event"]["title"] == "Statistics quiz 2 closes")
    assert deadline["event"]["all_day"] is True
    assert (deadline["starts_at"], deadline["ends_at"]) == ("2022-03-18T00:00:00", "2022-03-19T00:00:00")


def test_list_rejects_bad_ranges_and_kinds(client, alex, northwind):
    url = f"/api/workspaces/{northwind}/events"
    reversed_range = {"start": "2022-03-18T00:00:00", "end": "2022-03-14T00:00:00"}
    assert client.get(url, params=reversed_range, headers=alex).status_code == 422
    too_long = {"start": "2022-01-01T00:00:00", "end": "2022-12-31T00:00:00"}
    assert client.get(url, params=too_long, headers=alex).status_code == 422
    assert client.get(url, params={**WEEK, "kind": "party"}, headers=alex).status_code == 422


def test_non_members_get_404(client, sam, biology):
    assert client.get(f"/api/workspaces/{biology}/events", params=WEEK, headers=sam).status_code == 404


def test_agenda_groups_the_next_days(client, alex, northwind):
    response = client.get(f"/api/workspaces/{northwind}/agenda", params={"days": 7}, headers=alex)
    assert response.status_code == 200
    body = response.json()
    assert body["start"] == "2022-03-14"
    assert [d["date"] for d in body["days"]] == [f"2022-03-{d}" for d in range(14, 21)]
    monday = titles(body["days"][0]["items"])
    assert monday[:1] == ["Flashcard review block"]
    assert "Evening ML study" in monday
    wednesday = titles(body["days"][2]["items"])
    assert wednesday.index("SQL workshop: window functions") < wednesday.index("Pair study with Sam")
    assert body["days"][5]["items"] and titles(body["days"][5]["items"]) == ["Read: regularisation chapter"]
    assert body["total"] == sum(len(d["items"]) for d in body["days"])
    assert client.get(f"/api/workspaces/{northwind}/agenda?days=0", headers=alex).status_code == 422


# ---------- Creating ----------


