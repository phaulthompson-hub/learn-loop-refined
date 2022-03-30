from conftest import register

from app.models import User


def goals(client, headers, workspace, **params) -> dict:
    response = client.get(f"/api/workspaces/{workspace}/goals", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def goal_named(client, headers, workspace, title: str, state: str = "all") -> dict:
    return next(g for g in goals(client, headers, workspace, state=state)["items"] if g["title"] == title)


def create_goal(client, headers, workspace, **body):
    return client.post(f"/api/workspaces/{workspace}/goals", json=body, headers=headers)


def log_time(client, headers, workspace, **body):
    return client.post(f"/api/workspaces/{workspace}/study-logs", json={"minutes": 30, **body}, headers=headers)


# ---------- Goals ----------


def test_list_active_goals_with_progress(client, alex, northwind):
    body = goals(client, alex, northwind)
    assert [g["title"] for g in body["items"]] == [
        "Answer 8 questions a day",
        "40 flashcard reviews a week",
        "3 hours of focused study",
        "Reach 80% on Machine Learning",
    ]
    assert body["total"] == 4
    assert sum(body["counts"].values()) == 4
    mastery = body["items"][3]
    assert mastery["course"]["title"] == "Introduction to Machine Learning"
    assert mastery["due_date"] == "2022-04-04"
    assert set(mastery["progress"]) >= {"current", "target", "percent", "status", "period_label", "unit"}
    daily = body["items"][0]["progress"]
    assert (daily["current"], daily["target"], daily["status"]) == (0, 8, "at_risk")


def test_archived_and_status_filters(client, alex, northwind):
    archived = goals(client, alex, northwind, state="archived")
    assert [g["title"] for g in archived["items"]] == ["SQL foundations to 60%"]
    assert archived["items"][0]["archived"] is True
    assert goals(client, alex, northwind, state="all")["total"] == 5
    at_risk = goals(client, alex, northwind, status="at_risk")["items"]
    assert "Answer 8 questions a day" in [g["title"] for g in at_risk]
    assert all(g["progress"]["status"] == "at_risk" for g in at_risk)
    assert client.get(f"/api/workspaces/{northwind}/goals?state=deleted", headers=alex).status_code == 422


def test_goals_are_personal_and_workspace_scoped(client, alex, sam, northwind, biology):
    assert [g["title"] for g in goals(client, alex, biology)["items"]] == ["Cells ready for the midterm"]
    assert [g["title"] for g in goals(client, sam, northwind)["items"]] == ["Answer 5 questions a day", "Master SQL"]
    alex_goal = goal_named(client, alex, northwind, "Answer 8 questions a day")
    assert client.get(f"/api/goals/{alex_goal['id']}", headers=sam).status_code == 404
    assert client.patch(f"/api/goals/{alex_goal['id']}", json={"target": 1}, headers=sam).status_code == 404
    assert client.delete(f"/api/goals/{alex_goal['id']}", headers=sam).status_code == 404


def test_create_goals_of_every_kind(client, alex, northwind, ml_course):
    answers = create_goal(client, alex, northwind, title="Ten a day", kind="daily_answers", target=10)
    assert answers.status_code == 201, answers.text
    assert answers.json()["period"] == "day"
    minutes = create_goal(
        client, alex, northwind, title="Short daily study", kind="study_minutes", period="day", target=25
    )
    assert minutes.json()["progress"]["unit"] == "minutes"
    reviews = create_goal(client, alex, northwind, title="Reviews", kind="weekly_reviews", target=50)
    assert reviews.json()["period"] == "week"
    mastery = create_goal(
        client,
        alex,
        northwind,
        title="ML mastered",
        kind="course_mastery",
        target=90,
        course_id=ml_course["id"],
        due_date="2022-04-29",
    )
    assert mastery.status_code == 201
    assert mastery.json()["period"] == "once"
    assert mastery.json()["progress"]["current"] == ml_course["mastery"]


def test_goal_validation(client, alex, northwind, biology, ml_course):
    cells = client.get(f"/api/workspaces/{biology}/courses", headers=alex).json()["items"][0]
    cases = [
        ({"kind": "course_mastery", "target": 80}, "Choose the course"),
        ({"kind": "course_mastery", "target": 120, "course_id": ml_course["id"]}, "between 1 and 100"),
        ({"kind": "daily_answers", "target": 0}, "between 1 and 200"),
        ({"kind": "daily_answers", "target": 2.5}, "whole number"),
        ({"kind": "daily_answers", "period": "week", "target": 5}, "must use the period: day"),
        ({"kind": "study_minutes", "period": "week", "target": 5000}, "between 15 and 4200"),
        ({"kind": "weekly_reviews", "target": 30, "due_date": "2022-03-30"}, "Only one-off goals"),
        (
            {"kind": "course_mastery", "target": 80, "course_id": ml_course["id"], "due_date": "2022-02-27"},
            "cannot be in the past",
        ),
        ({"kind": "course_mastery", "target": 80, "course_id": cells["id"]}, "course from this workspace"),
        ({"kind": "daily_answers", "target": 5, "title": " a "}, "at least 2 characters"),
    ]
    for body, message in cases:
        response = create_goal(client, alex, northwind, **{"title": "A goal", **body})
        assert response.status_code == 422, message
        assert message in response.text, response.text


def test_update_revalidates_the_merged_goal(client, alex, northwind):
    goal = goal_named(client, alex, northwind, "3 hours of focused study")
    url = f"/api/goals/{goal['id']}"
    updated = client.patch(url, json={"target": 240, "title": "4 hours a week"}, headers=alex)
    assert updated.status_code == 200
    assert (updated.json()["target"], updated.json()["title"]) == (240, "4 hours a week")
    assert updated.json()["progress"]["target"] == 240
    assert client.patch(url, json={"target": 10}, headers=alex).status_code == 422  # below the weekly minimum
    assert client.patch(url, json={"kind": "course_mastery"}, headers=alex).status_code == 422  # needs a course
    switched = client.patch(url, json={"kind": "daily_answers", "target": 6}, headers=alex)
    assert switched.status_code == 200
    assert switched.json()["period"] == "day"


