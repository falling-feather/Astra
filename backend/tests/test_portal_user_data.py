def login(client, name):
    password = "Portal-test-password-93"
    response = client.post("/api/auth/register", json={"username": name, "password": password, "display_name": name, "role": "student"})
    assert response.status_code == 201
    assert client.post("/api/auth/login", json={"username": name, "password": password}).status_code == 200


def test_profile_edits_cannot_change_role_and_require_a_name(client):
    assert client.patch("/api/users/me", json={"display_name": "新名称"}).status_code == 401
    login(client, "portal_profile")
    response = client.patch("/api/users/me", json={"display_name": "  星序同学  "})
    assert response.status_code == 200
    assert response.json()["display_name"] == "星序同学"
    assert client.patch("/api/users/me", json={"display_name": " ", "role": "admin"}).status_code == 422
    assert client.get("/api/users/me").json()["role"] == "student"


def test_notes_are_owned_and_use_revision_conflicts(client):
    login(client, "portal_notes_owner")
    created = client.post("/api/users/me/notes", json={"title": "实验记录", "content": "先预测再观察"})
    assert created.status_code == 201
    note = created.json()
    updated = client.patch(f'/api/users/me/notes/{note["id"]}', json={"title": "实验记录", "content": "观察完成", "expected_revision": 1})
    assert updated.status_code == 200 and updated.json()["revision"] == 2
    stale = client.patch(f'/api/users/me/notes/{note["id"]}', json={"title": "旧修改", "content": "不能覆盖", "expected_revision": 1})
    assert stale.status_code == 409
    assert client.get("/api/users/me/notes").json()[0]["content"] == "观察完成"
    login(client, "portal_notes_other")
    assert client.get("/api/users/me/notes").json() == []
    assert client.patch(f'/api/users/me/notes/{note["id"]}', json={"title": "越权", "content": "", "expected_revision": 2}).status_code == 404
    assert client.delete(f'/api/users/me/notes/{note["id"]}', params={"expected_revision": 2}).status_code == 404


def test_cookie_mutations_reject_foreign_origin_but_allow_same_origin(client):
    login(client, "portal_origin")
    response = client.patch("/api/users/me", json={"display_name": "被篡改"}, headers={"Origin": "https://attacker.invalid"})
    assert response.status_code == 403
    assert response.headers["cache-control"] == "no-store"
    response = client.patch("/api/users/me", json={"display_name": "正常修改"}, headers={"Origin": "http://testserver"})
    assert response.status_code == 200


def test_notes_preserve_code_indentation_and_reject_blank_titles(client):
    login(client, "portal_note_indentation")
    content = "    print('Astra')\n\n"
    created = client.post("/api/users/me/notes", json={"title": "  代码笔记  ", "content": content})
    assert created.status_code == 201
    assert created.json()["title"] == "代码笔记"
    assert created.json()["content"] == content
    assert client.post("/api/users/me/notes", json={"title": "   ", "content": ""}).status_code == 422
