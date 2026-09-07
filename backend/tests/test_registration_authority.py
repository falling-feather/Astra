from app.core.config import get_settings


def _payload(name, role="teacher"):
    return {"username": name, "display_name": name, "password": "Authority-review-2026!", "role": role}


def test_default_registration_requires_teacher_review(client, monkeypatch):
    monkeypatch.setenv("ASTRA_ALLOW_LEGACY_LOCAL_BOOTSTRAP", "false")
    get_settings.cache_clear()
    assert client.post("/api/auth/register", json=_payload("direct_teacher")).status_code == 422
    assert client.post("/api/auth/register", json=_payload("normal_student", "student")).status_code == 201


def test_teacher_cannot_create_a_school_without_explicit_local_bootstrap(client, monkeypatch):
    assert client.post("/api/auth/register", json=_payload("existing_teacher")).status_code == 201
    assert client.post("/api/auth/login", json={"username": "existing_teacher", "password": "Authority-review-2026!"}).status_code == 200
    monkeypatch.setenv("ASTRA_ALLOW_LEGACY_LOCAL_BOOTSTRAP", "false")
    get_settings.cache_clear()
    assert client.post("/api/schools", json={"name": "self-authorized-school"}).status_code == 403
    admin = _payload("school_admin", "admin")
    admin.pop("role")
    assert client.post("/api/admin/bootstrap", json=admin).status_code == 201
    client.post("/api/auth/login", json={"username": "school_admin", "password": "Authority-review-2026!"})
    assert client.post("/api/schools", json={"name": "admin-created-school"}).status_code == 201


def test_legacy_bootstrap_flag_never_enables_production_teacher_registration(client, monkeypatch):
    monkeypatch.setenv("ASTRA_ALLOW_LEGACY_LOCAL_BOOTSTRAP", "true")
    monkeypatch.setenv("ASTRA_ENVIRONMENT", "production")
    get_settings.cache_clear()
    assert client.post("/api/auth/register", json=_payload("production_teacher")).status_code == 422


def test_reviewed_teacher_can_join_school_and_create_course_in_default_mode(client, monkeypatch):
    monkeypatch.setenv("ASTRA_ALLOW_LEGACY_LOCAL_BOOTSTRAP", "false")
    get_settings.cache_clear()
    password = "Authority-review-2026!"
    admin = _payload("review_admin", "admin")
    admin.pop("role")
    assert client.post("/api/admin/bootstrap", json=admin).status_code == 201
    client.post("/api/auth/login", json={"username": "review_admin", "password": password})
    school = client.post("/api/schools", json={"name": "Reviewed school"}).json()
    group = client.post("/api/classes", json={"school_id": school["id"], "name": "Reviewed class"}).json()
    assert client.post("/api/auth/register", json=_payload("reviewed_teacher", "student")).status_code == 201
    client.post("/api/auth/login", json={"username": "reviewed_teacher", "password": password})
    application = client.post("/api/v1/teacher-applications", json={"message": "申请担任数学教师"})
    assert application.status_code == 201
    client.post("/api/auth/login", json={"username": "review_admin", "password": password})
    assert client.patch(f'/api/v1/admin/teacher-applications/{application.json()["id"]}', json={"status": "approved"}).status_code == 200
    client.post("/api/auth/login", json={"username": "reviewed_teacher", "password": password})
    request = client.post(f'/api/classes/{group["id"]}/join-requests', json={"role": "teacher", "message": "申请任课"})
    assert request.status_code == 201, request.json()
    client.post("/api/auth/login", json={"username": "review_admin", "password": password})
    assert client.patch(f'/api/classes/{group["id"]}/join-requests/{request.json()["id"]}', json={"status": "approved"}).status_code == 200
    client.post("/api/auth/login", json={"username": "reviewed_teacher", "password": password})
    course = client.post("/api/v1/courses", json={"school_id": school["id"], "title": "Reviewed math", "summary": "课堂观察", "academic_year": "2026", "schedule_text": "周一 09:00—10:30", "total_hours": 12, "galaxy_key": "englab", "subject_key": "mathematics", "admission_mode": "open"})
    assert course.status_code == 201, course.json()


def test_student_cannot_approve_own_class_request_through_legacy_join(client, monkeypatch):
    monkeypatch.setenv("ASTRA_ALLOW_LEGACY_LOCAL_BOOTSTRAP", "false")
    get_settings.cache_clear()
    password = "Authority-review-2026!"
    admin = _payload("class_admin", "admin"); admin.pop("role")
    client.post("/api/admin/bootstrap", json=admin)
    client.post("/api/auth/login", json={"username": "class_admin", "password": password})
    school = client.post("/api/schools", json={"name": "Class review school"}).json()
    group = client.post("/api/classes", json={"school_id":school["id"], "name":"Class review"}).json()
    client.post("/api/auth/register", json=_payload("class_student", "student"))
    client.post("/api/auth/login", json={"username":"class_student", "password":password})
    request = client.post(f'/api/classes/{group["id"]}/join-requests', json={"role":"student"})
    assert request.status_code == 201
    assert client.post(f'/api/classes/{group["id"]}/join', json={"role":"student"}).status_code == 403
    assert client.get("/api/classes").json() == []
    client.post("/api/auth/login", json={"username":"class_admin", "password":password})
    pending = client.get(f'/api/classes/{group["id"]}/join-requests').json()
    assert pending[0]["status"] == "pending"
