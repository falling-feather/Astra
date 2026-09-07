def test_information_draft_can_be_corrected_with_conflict_and_review_lock(client):
    password = "Course-info-test-934"
    assert client.post("/api/auth/register", json={"username": "info_editor", "display_name": "任课教师", "password": password, "role": "teacher"}).status_code == 201
    assert client.post("/api/auth/login", json={"username": "info_editor", "password": password}).status_code == 200
    school = client.post("/api/schools", json={"name": "资料编辑测试学校"}).json()
    payload = {"school_id": school["id"], "title": "初始标题", "summary": "初始说明", "academic_year": "2026—2027", "schedule_text": "周一 09:00—10:30", "total_hours": 12, "galaxy_key": "englab", "subject_key": "mathematics", "admission_mode": "open", "collaborator_user_ids": [], "admission_class_ids": []}
    created = client.post("/api/v1/courses", json=payload)
    assert created.status_code == 201, created.json()
    course = created.json(); revision = course["information_revision"]
    url = f'/api/v1/courses/{course["id"]}/information-revisions/{revision["id"]}'
    edited = {**payload, "title": "修正后的标题", "expected_revision": revision["edit_revision"]}
    response = client.patch(url, json=edited)
    assert response.status_code == 200, response.json()
    assert response.json()["information_revision"]["information_snapshot"]["title"] == "修正后的标题"
    assert response.json()["information_revision"]["edit_revision"] == 2
    assert client.patch(url, json=edited).status_code == 409
    submitted = client.post(url + "/submit")
    assert submitted.status_code == 200
    assert client.patch(url, json={**edited, "expected_revision": 2}).status_code == 409
