from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_memory_items_crud_flow() -> None:
    # 1. Register & Login a test user
    email = "test_memory_user@example.com"
    password = "MemoryPassword123!"

    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Memory Tester"},
    )

    login_resp = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert login_resp.status_code == 200
    token = login_resp.json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Ingest Memory Item (POST /api/v1/memory-items)
    create_payload = {
        "source_type": "webpage",
        "url": "https://example.com/test-article",
        "title": "Test Article Title",
        "content": "This is a test article content for meaningful capture engine testing.",
        "author": "Jane Doe",
        "favicon_url": "https://example.com/favicon.ico",
    }

    create_resp = client.post("/api/v1/memory-items", json=create_payload, headers=headers)
    assert create_resp.status_code == 201
    item_data = create_resp.json()["data"]
    assert item_data["title"] == "Test Article Title"
    assert item_data["url"] == "https://example.com/test-article"
    assert item_data["status"] == "pending"
    item_id = item_data["id"]

    # 3. List Memory Items (GET /api/v1/memory-items)
    list_resp = client.get("/api/v1/memory-items", headers=headers)
    assert list_resp.status_code == 200
    list_data = list_resp.json()["data"]
    assert list_data["total"] >= 1
    assert any(i["id"] == item_id for i in list_data["items"])

    # 4. Get Single Memory Item (GET /api/v1/memory-items/{id})
    get_resp = client.get(f"/api/v1/memory-items/{item_id}", headers=headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["data"]["id"] == item_id

    # 5. Delete Memory Item (DELETE /api/v1/memory-items/{id})
    del_resp = client.delete(f"/api/v1/memory-items/{item_id}", headers=headers)
    assert del_resp.status_code == 200
    assert del_resp.json()["success"] is True

    # 6. Verify item no longer returned after soft-delete
    get_after_del = client.get(f"/api/v1/memory-items/{item_id}", headers=headers)
    assert get_after_del.status_code == 404
