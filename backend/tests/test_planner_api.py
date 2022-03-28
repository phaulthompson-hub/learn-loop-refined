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


def test_create_event_and_read_it_back(client, alex, northwind):
    response = client.post(f"/api/workspaces/{northwind}/events", json=new_event(location="Desk"), headers=alex)
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["conflicts"] == []
    event = saved["event"]
    assert (event["title"], event["location"], event["can_edit"]) == ("Focus block", "Desk", True)
    assert client.get(f"/api/events/{event['id']}", headers=alex).json()["starts_at"] == "2022-03-17T10:00:00"


def test_create_reports_overlapping_occurrences(client, alex, northwind):
    body = new_event(starts_at="2022-03-16T15:30:00", ends_at="2022-03-16T16:00:00")
    conflicts = client.post(f"/api/workspaces/{northwind}/events", json=body, headers=alex).json()["conflicts"]
    assert [c["title"] for c in conflicts] == ["SQL workshop: window functions", "Pair study with Sam"]
    assert conflicts[0]["starts_at"] == "2022-03-16T15:00:00"


def test_recurring_event_conflicts_with_a_recurring_series(client, alex, northwind):
    body = new_event(starts_at="2022-03-15T07:45:00", ends_at="2022-03-15T08:15:00", recurrence="weekly")
    conflicts = client.post(f"/api/workspaces/{northwind}/events", json=body, headers=alex).json()["conflicts"]
    assert conflicts and all(c["title"] == "Flashcard review block" for c in conflicts)
    assert [c["starts_at"][:10] for c in conflicts[:3]] == ["2022-03-15", "2022-03-22", "2022-03-29"]


def test_timezone_aware_input_is_stored_as_utc(client, alex, northwind):
    body = new_event(starts_at="2022-03-17T12:00:00+02:00", ends_at="2022-03-17T13:30:45+02:00")
    event = client.post(f"/api/workspaces/{northwind}/events", json=body, headers=alex).json()["event"]
    assert (event["starts_at"], event["ends_at"]) == ("2022-03-17T10:00:00", "2022-03-17T11:30:00")


def test_all_day_events_are_normalised(client, alex, northwind):
    body = new_event(all_day=True, starts_at="2022-03-17T14:00:00", ends_at="2022-03-18T09:00:00")
    event = client.post(f"/api/workspaces/{northwind}/events", json=body, headers=alex).json()["event"]
    assert (event["starts_at"], event["ends_at"]) == ("2022-03-17T00:00:00", "2022-03-19T00:00:00")
    single = new_event(all_day=True, ends_at=None)
    event = client.post(f"/api/workspaces/{northwind}/events", json=single, headers=alex).json()["event"]
    assert event["ends_at"] == "2022-03-18T00:00:00"


def test_non_repeating_events_drop_the_until_date(client, alex, northwind):
    body = new_event(recurrence="none", recurrence_until="2022-04-28")
    event = client.post(f"/api/workspaces/{northwind}/events", json=body, headers=alex).json()["event"]
    assert event["recurrence_until"] is None


def test_validation_errors(client, alex, northwind):
    url = f"/api/workspaces/{northwind}/events"
    cases = {
        "The end time must be after the start time": new_event(ends_at="2022-03-17T09:00:00"),
        "at most 12 hours": new_event(ends_at="2022-03-18T09:00:00"),
        "Choose an end time": new_event(ends_at=None),
        "must start on a weekday": new_event(
            starts_at="2022-03-19T10:00:00", ends_at="2022-03-19T11:00:00", recurrence="weekdays"
        ),
        "on or after the first day": new_event(recurrence="daily", recurrence_until="2022-03-16"),
        "at most one year": new_event(recurrence="weekly", recurrence_until="2023-05-30"),
        "at most 14 days": new_event(all_day=True, ends_at="2022-04-08T00:00:00"),
        "Only single-day all-day events can repeat": new_event(
            all_day=True, ends_at="2022-03-19T00:00:00", recurrence="weekly"
        ),
        "at least 2 characters": new_event(title=" x "),
    }
    for message, body in cases.items():
        response = client.post(url, json=body, headers=alex)
        assert response.status_code == 422, message
        assert message in response.text, response.text


def test_course_must_belong_to_the_workspace(client, alex, northwind, biology):
    cells = client.get(f"/api/workspaces/{biology}/courses", headers=alex).json()["items"][0]
    response = client.post(f"/api/workspaces/{northwind}/events", json=new_event(course_id=cells["id"]), headers=alex)
    assert response.status_code == 422


def test_learners_cannot_announce_exams_or_live_sessions(client, sam, northwind):
    url = f"/api/workspaces/{northwind}/events"
    response = client.post(url, json=new_event(kind="live", shared=True), headers=sam)
    assert response.status_code == 403
    assert client.post(url, json=new_event(kind="study", shared=True), headers=sam).status_code == 201


def test_shared_exam_records_activity_and_notifies_other_members(client, maya, northwind, db):
    body = new_event(title="Statistics final", kind="exam", shared=True, location="Hall A")
    event = client.post(f"/api/workspaces/{northwind}/events", json=body, headers=maya).json()["event"]
    activity = db.scalars(
        select(Activity).where(Activity.verb == "event.created", Activity.object_id == event["id"])
    ).one()
    assert "Statistics final" in activity.summary
    notified = db.scalars(select(Notification).where(Notification.title == "New exam: Statistics final")).all()
    recipients = {db.get(User, n.user_id).email for n in notified}
    assert recipients == {"demo@learnloop.dev", "sam@learnloop.dev", "priya@learnloop.dev", "jonas@learnloop.dev"}
    assert all(n.kind == "event" and n.link.startswith("/planner?date=2022-03-17") for n in notified)
    assert "Hall A" in notified[0].body


def test_private_events_are_silent(client, alex, northwind, db):
    before = db.scalar(select(Notification.id).order_by(Notification.id.desc()).limit(1))
    client.post(f"/api/workspaces/{northwind}/events", json=new_event(kind="exam"), headers=alex)
    after = db.scalar(select(Notification.id).order_by(Notification.id.desc()).limit(1))
    assert before == after


# ---------- Updating and deleting ----------


def test_owner_updates_with_a_partial_patch(client, alex, northwind):
    event_id_ = event_id(client, alex, northwind, "Pair study with Sam")
    response = client.patch(
        f"/api/events/{event_id_}",
        json={"starts_at": "2022-03-16T17:00:00", "ends_at": "2022-03-16T18:00:00"},
        headers=alex,
    )
    assert response.status_code == 200, response.text
    assert response.json()["conflicts"] == []
    assert response.json()["event"]["title"] == "Pair study with Sam"
    assert response.json()["event"]["location"] == "Library room 2"


def test_patch_is_validated_against_the_merged_event(client, alex, northwind):
    event_id_ = event_id(client, alex, northwind, "Pair study with Sam")
    response = client.patch(f"/api/events/{event_id_}", json={"ends_at": "2022-03-16T10:00:00"}, headers=alex)
    assert response.status_code == 422
    assert "after the start time" in response.json()["detail"][0]["msg"]
    assert client.patch(f"/api/events/{event_id_}", json={"title": None}, headers=alex).status_code == 422


