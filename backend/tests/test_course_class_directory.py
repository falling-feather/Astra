def test_course_class_directory_is_authorized_and_uses_real_bindings(client):
    password = "directory-test-password-934"
    for name, role in [("owner", "teacher"), ("outsider", "teacher"), ("pupil", "student")]:
        assert client.post("/api/auth/register", json={"username": name, "password": password, "display_name": name, "role": role}).status_code == 201
    client.post("/api/auth/login", json={"username": "owner", "password": password})
    school = client.post("/api/schools", json={"name": "Directory school"}).json()
    group = client.post("/api/classes", json={"school_id": school["id"], "name": "Class A"}).json()
    course = client.post("/api/courses", json={"school_id": school["id"], "title": "Directory course"}).json()
    path = f'/api/courses/{course["id"]}/classes'
    assert client.post(path, json={"class_id": group["id"]}).status_code == 201
    response = client.get(path)
    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()] == [group["id"]]
    for name in ["outsider", "pupil"]:
        client.post("/api/auth/login", json={"username": name, "password": password})
        assert client.get(path).status_code == 403
