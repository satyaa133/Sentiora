# mypy: ignore-errors
import requests
import time

BASE_URL = "http://localhost:8000/api/v1"
s1 = requests.Session()
s2 = requests.Session()

def print_step(msg):
    print(f"\n--- {msg} ---")

try:
    print_step("Auth: Registration")
    email1 = f"test1_{int(time.time())}@example.com"
    email2 = f"test2_{int(time.time())}@example.com"
    pw = "TestPassword123!"

    r1 = s1.post(f"{BASE_URL}/auth/register", json={"email": email1, "password": pw, "full_name": "Test User 1"})
    print("User 1 Register:", r1.status_code, r1.json())
    
    r2 = s2.post(f"{BASE_URL}/auth/register", json={"email": email2, "password": pw, "full_name": "Test User 2"})
    print("User 2 Register:", r2.status_code)

    r_dup = s1.post(f"{BASE_URL}/auth/register", json={"email": email1, "password": pw, "full_name": "Test User 1"})
    print("Duplicate Register (should fail):", r_dup.status_code)

    r_inv = s1.post(f"{BASE_URL}/auth/login", json={"email": email1, "password": "WrongPassword"})
    print("Invalid Login:", r_inv.status_code)

    print_step("Auth: Login")
    login1 = s1.post(f"{BASE_URL}/auth/login", json={"email": email1, "password": pw}).json()
    t1 = login1['data']['access_token']
    s1.headers.update({"Authorization": f"Bearer {t1}"})
    print("User 1 Login OK")

    login2 = s2.post(f"{BASE_URL}/auth/login", json={"email": email2, "password": pw}).json()
    t2 = login2['data']['access_token']
    s2.headers.update({"Authorization": f"Bearer {t2}"})
    print("User 2 Login OK")

    print_step("Auth: Protected endpoint")
    r_me = s1.get(f"{BASE_URL}/auth/me")
    print("GET /auth/me:", r_me.status_code, r_me.json())

    r_unauth = requests.get(f"{BASE_URL}/auth/me")
    print("GET /auth/me (unauth):", r_unauth.status_code)

    print_step("Capture: Webpage")
    mem_payload = {
        "source_type": "webpage",
        "url": "https://example.com",
        "title": "Example Domain",
        "content": "This domain is for use in illustrative examples in documents."
    }
    r_cap = s1.post(f"{BASE_URL}/memory-items", json=mem_payload)
    print("Capture webpage:", r_cap.status_code)
    
    print_step("Capture: PDF")
    mem_payload_pdf = {
        "source_type": "pdf",
        "url": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        "title": "Dummy PDF",
        "content": "Dummy PDF Content extracted by client."
    }
    r_cap_pdf = s1.post(f"{BASE_URL}/memory-items", json=mem_payload_pdf)
    print("Capture PDF:", r_cap_pdf.status_code)

    print_step("Capture: YouTube")
    mem_payload_yt = {
        "source_type": "youtube",
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "title": "Rick Astley",
        "content": "Never gonna give you up transcript..."
    }
    r_cap_yt = s1.post(f"{BASE_URL}/memory-items", json=mem_payload_yt)
    print("Capture YouTube:", r_cap_yt.status_code)

    item_id = r_cap.json()['data']['id']
    
    # Wait for processing
    for _ in range(10):
        r_item = s1.get(f"{BASE_URL}/memory-items/{item_id}").json()
        status = r_item['data'].get('processing_status') or r_item['data'].get('status')
        if status in ['ready', 'failed']:
            break
        time.sleep(1)

    print_step("Authorization (IDOR) check")
    r_idor = s2.get(f"{BASE_URL}/memory-items/{item_id}")
    print("User 2 trying to GET User 1's memory:", r_idor.status_code)

    print_step("Retrieval & Ask")
    r_ask = s1.post(f"{BASE_URL}/chat", json={"question": "What is this domain used for?"})
    print("Ask response:", r_ask.status_code)
    if r_ask.status_code == 200:
        print(r_ask.json()['data']['answer'])
    else:
        print(r_ask.json())

except Exception as e:
    print(f"Error: {e}")

