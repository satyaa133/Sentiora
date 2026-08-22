import { expect, test } from "@playwright/test";

const API = process.env.E2E_API_BASE_URL ?? "http://localhost:8000";

function uniqueEmail(): string {
  return `e2e_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;
}

test("register, capture, search, ask, and delete memory", async ({ request }) => {
  const email = uniqueEmail();
  const password = "MemoryPassword123!";

  const register = await request.post(`${API}/api/v1/auth/register`, {
    data: { email, password, full_name: "E2E User" },
  });
  expect(register.status()).toBe(201);

  const login = await request.post(`${API}/api/v1/auth/login`, {
    data: { email, password },
  });
  expect(login.status()).toBe(200);
  const token = (await login.json()).data.access_token as string;
  const auth = { Authorization: `Bearer ${token}` };

  const create = await request.post(`${API}/api/v1/memory-items`, {
    headers: auth,
    data: {
      source_type: "webpage",
      url: "https://docs.example.com/e2e-binary-search",
      title: "E2E Binary Search",
      content:
        "Binary search repeatedly halves the search interval. It compares the target with the middle element, then continues on one side of the collection until the value is found.",
    },
  });
  expect(create.status()).toBe(201);
  const created = await create.json();
  const itemId = created.data.id as string;
  expect(created.data.status).toMatch(/pending|ready/);

  const listed = await request.get(`${API}/api/v1/memory-items`, { headers: auth });
  expect(listed.status()).toBe(200);
  const items = (await listed.json()).data.items as Array<{ id: string; title: string }>;
  expect(items.some((item) => item.id === itemId)).toBeTruthy();

  const search = await request.get(`${API}/api/v1/search`, {
    headers: auth,
    params: { q: "halves the search interval" },
  });
  expect(search.status()).toBe(200);
  const hits = (await search.json()).data as Array<{ memory_id: string }>;
  expect(hits.some((hit) => hit.memory_id === itemId)).toBeTruthy();

  const chat = await request.post(`${API}/api/v1/chat`, {
    headers: auth,
    data: { question: "What is binary search?" },
  });
  expect(chat.status()).toBe(200);
  const answer = await chat.json();
  expect(answer.data.answer.toLowerCase()).toMatch(/binary search|halves/);
  expect(answer.data.citations[0].memory_id).toBe(itemId);

  const deleted = await request.delete(`${API}/api/v1/memory-items/${itemId}`, { headers: auth });
  expect(deleted.status()).toBe(200);

  const missing = await request.get(`${API}/api/v1/memory-items/${itemId}`, { headers: auth });
  expect(missing.status()).toBe(404);

  const afterDelete = await request.post(`${API}/api/v1/chat`, {
    headers: auth,
    data: { question: "What is binary search?", memory_id: itemId },
  });
  expect((await afterDelete.json()).data.insufficient_context).toBeTruthy();
});
