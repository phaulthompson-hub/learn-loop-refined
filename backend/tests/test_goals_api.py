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


def test_renaming_keeps_an_existing_due_date(client, sam, northwind):
    goal = goal_named(client, sam, northwind, "Master SQL")
    response = client.patch(f"/api/goals/{goal['id']}", json={"title": "Master SQL joins"}, headers=sam)
    assert response.status_code == 200
    assert response.json()["due_date"] == goal["due_date"]


def test_archive_restore_and_delete(client, alex, northwind):
    goal = goal_named(client, alex, northwind, "40 flashcard reviews a week")
    archived = client.post(f"/api/goals/{goal['id']}/archive", headers=alex)
    assert archived.status_code == 200 and archived.json()["archived"] is True
    assert "40 flashcard reviews a week" not in [g["title"] for g in goals(client, alex, northwind)["items"]]
    restored = client.post(f"/api/goals/{goal['id']}/restore", headers=alex)
    assert restored.json()["archived"] is False
    assert client.delete(f"/api/goals/{goal['id']}", headers=alex).status_code == 204
    assert client.get(f"/api/goals/{goal['id']}", headers=alex).status_code == 404


def test_active_goal_limit(client, newcomer):
    headers, workspace = newcomer
    for n in range(12):
        response = create_goal(client, headers, workspace, title=f"Goal {n}", kind="daily_answers", target=n + 1)
        assert response.status_code == 201
    extra = create_goal(client, headers, workspace, title="One too many", kind="daily_answers", target=3)
    assert extra.status_code == 409
    first = goals(client, headers, workspace)["items"][0]
    client.post(f"/api/goals/{first['id']}/archive", headers=headers)
    assert create_goal(client, headers, workspace, title="Fits now", kind="daily_answers", target=3).status_code == 201
    assert client.post(f"/api/goals/{first['id']}/restore", headers=headers).status_code == 409


def test_answering_a_question_moves_the_daily_goal(client, alex, northwind, ml_course):
    goal = goal_named(client, alex, northwind, "Answer 8 questions a day")
    question = client.get(f"/api/courses/{ml_course['id']}/quiz", params={"count": 1}, headers=alex).json()[0]
    answer = {"question_id": question["id"], "concept_id": question["concept_id"], "selected": 0}
    assert client.post(f"/api/courses/{ml_course['id']}/answers", json=answer, headers=alex).status_code == 200
    progress = client.get(f"/api/goals/{goal['id']}", headers=alex).json()["progress"]
    assert progress["current"] == 1
    assert progress["percent"] == 12


# ---------- Study time ----------


def test_log_study_time_and_list_it(client, alex, northwind, ml_course):
    before = goal_named(client, alex, northwind, "3 hours of focused study")["progress"]["current"]
    response = log_time(
        client, alex, northwind, minutes=45, activity="reading", course_id=ml_course["id"], note="Ch. 4"
    )
    assert response.status_code == 201, response.text
    log = response.json()
    assert (log["minutes"], log["logged_at"], log["course"]["id"]) == (45, "2022-03-14T09:00:00", ml_course["id"])
    after = goal_named(client, alex, northwind, "3 hours of focused study")["progress"]["current"]
    assert after == before + 45
    params = {"activity": "reading", "page_size": 100}
    page = client.get(f"/api/workspaces/{northwind}/study-logs", params=params, headers=alex).json()
    assert page["items"][0]["id"] == log["id"]  # newest first
    assert all(item["activity"] == "reading" for item in page["items"])
    assert page["total_minutes"] == sum(item["minutes"] for item in page["items"])
    recent = client.get(f"/api/workspaces/{northwind}/study-logs", params={"days": 1}, headers=alex).json()
    assert all(item["logged_at"].startswith("2022-03-14") for item in recent["items"])


def test_study_log_validation(client, alex, northwind, biology):
    cells = client.get(f"/api/workspaces/{biology}/courses", headers=alex).json()["items"][0]
    cases = [
        ({"minutes": 0}, "greater than or equal to 1"),
        ({"minutes": 601}, "less than or equal to 600"),
        ({"logged_at": "2022-03-14T10:00:00"}, "in the future"),
        ({"logged_at": "2021-10-30T10:00:00"}, "last 90 days"),
        ({"activity": "napping"}, "unexpected value; permitted"),
        ({"course_id": cells["id"]}, "course from this workspace"),
    ]
    for body, message in cases:
        response = log_time(client, alex, northwind, **body)
        assert response.status_code == 422, message
        assert message in response.text, response.text


def test_a_day_holds_at_most_24_hours(client, newcomer):
    headers, workspace = newcomer
    for hour in (1, 2):
        stamp = f"2022-03-13T0{hour}:00:00"
        assert log_time(client, headers, workspace, minutes=600, logged_at=stamp).status_code == 201
    response = log_time(client, headers, workspace, minutes=300, logged_at="2022-03-13T20:00:00")
    assert response.status_code == 422
    assert "at most 240 more fit" in response.text
    assert log_time(client, headers, workspace, minutes=240, logged_at="2022-03-13T20:00:00").status_code == 201


def test_update_and_delete_own_logs_only(client, alex, sam, northwind):
    log = log_time(client, alex, northwind, minutes=20).json()
    url = f"/api/study-logs/{log['id']}"
    assert client.patch(url, json={"minutes": 35, "note": "Longer than planned"}, headers=alex).json()["minutes"] == 35
    assert client.patch(url, json={"logged_at": "2022-03-15T08:00:00"}, headers=alex).status_code == 422
    assert client.patch(url, json={"minutes": 5}, headers=sam).status_code == 404
    assert client.delete(url, headers=sam).status_code == 404
    assert client.delete(url, headers=alex).status_code == 204
    assert client.delete(url, headers=alex).status_code == 404


def test_study_summary_endpoint(client, newcomer):
    headers, workspace = newcomer
    log_time(client, headers, workspace, minutes=40, logged_at="2022-03-14T07:00:00")
    log_time(client, headers, workspace, minutes=25, logged_at="2022-03-08T18:00:00")
    response = client.get(f"/api/workspaces/{workspace}/study-logs/summary", params={"weeks": 2}, headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert [w["minutes"] for w in body["weeks"]] == [25, 40]
    assert body["weeks"][0]["days"][1] == {"date": "2022-03-08", "minutes": 25}
    assert body["by_course"] == [{"course_id": None, "title": "General study", "color": None, "minutes": 65}]
    assert (body["today_minutes"], body["daily_goal_minutes"]) == (40, 30)
    assert client.get(f"/api/workspaces/{workspace}/study-logs/summary?weeks=13", headers=headers).status_code == 422


# ---------- Streak ----------


def test_streak_with_heatmap(client, alex, northwind):
    body = client.get(f"/api/workspaces/{northwind}/streak", headers=alex).json()
    assert body["active_today"] is True
    assert body["current"] >= 13 and body["longest"] >= 27
    heatmap = body["heatmap"]
    assert (heatmap["start"], heatmap["end"], heatmap["weeks"]) == ("2021-12-27", "2022-03-20", 12)
    assert len(heatmap["days"]) == 84
    assert {d["level"] for d in heatmap["days"]} <= {0, 1, 2, 3, 4}
    assert all(d["level"] == 0 for d in heatmap["days"] if d["future"])


def test_streak_heatmap_follows_week_start(client, db):
    headers, workspace, me = register(client, email="sunday@example.com")
    db.get(User, me["user"]["id"]).week_starts_on = 6
    db.commit()
    body = client.get(f"/api/workspaces/{workspace}/streak", headers=headers).json()
    assert body["week_starts_on"] == 6
    assert body["heatmap"]["start"] == "2021-12-26"  # a Sunday
    assert (body["current"], body["active_today"]) == (0, False)
    log_time(client, headers, workspace, minutes=15)
    body = client.get(f"/api/workspaces/{workspace}/streak", headers=headers).json()
    assert (body["current"], body["longest"], body["active_today"]) == (1, 1, True)


def test_streak_requires_membership(client, sam, biology):
    assert client.get(f"/api/workspaces/{biology}/streak", headers=sam).status_code == 404
