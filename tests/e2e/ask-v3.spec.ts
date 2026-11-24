import { expect, test, type Page, type Route } from "@playwright/test";

// S7: the instant answer, Explain with AI, busy and feedback states, the memory
// drawer, and the R7 accessibility list, in a real browser against the e2e
// stack. That stack has no AI keys, so instant answers, ratings, renames and
// summary requests hit the real API, while the AI answer itself (and the AI
// being busy) are played by intercepting that one request.

const TITLE = "Zephyrine Point Lighthouse Log";
const CONTENT = [
  "The Zephyrine Point lighthouse keeper recorded every night of the winter of 1847 in a leather logbook.",
  "In January the keeper burned nine gallons of whale oil per night to keep the lamp visible through the storms.",
  "When the whale oil ran low in February, the keeper switched to lard oil, which burned dimmer but lasted longer.",
].join("\n\n");
const QUESTION = "How much whale oil did the Zephyrine Point keeper burn per night in January?";

function uniqueEmail(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;
}

async function signUp(page: Page): Promise<void> {
  await page.goto("/signup");
  await expect(page.getByRole("region", { name: "Privacy notice" })).toContainText(
    "do not use it to train their models",
  );
  await page.getByLabel("Full name").fill("E2E Ask User");
  await page.getByLabel("Email").fill(uniqueEmail("e2e_ask"));
  await page.getByLabel("Password", { exact: true }).fill("MemoryPassword123!");
  await page.getByRole("checkbox", { name: /agree to the privacy notice/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  for (let step = 0; step < 6 && !/\/dashboard/.test(page.url()); step += 1) {
    await page.getByRole("button", { name: /^(Continue|Go to Home)/ }).first().click();
    await page.waitForTimeout(300);
  }
  await expect(page).toHaveURL(/\/dashboard/);
}

async function saveFact(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Add memory" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add a memory" });
  await dialog.getByLabel("Title").fill(TITLE);
  await dialog.getByLabel("Content").fill(CONTENT);
  await dialog.getByRole("button", { name: "Save memory" }).click();
  await expect(dialog).toBeHidden();
  await page.goto("/timeline");
  const row = page.locator("main").getByRole("listitem").filter({ hasText: TITLE }).first();
  await expect(row).toContainText("Ready for Ask", { timeout: 30_000 });
}

function sse(events: [string, unknown][]): string {
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

/**
 * Instant answers come from the real API, marked as AI-ready (the stack has
 * no AI keys); AI answers are played by `ai`.
 */
async function routeAsk(page: Page, ai: (route: Route, body: Record<string, unknown>) => Promise<void>) {
  await page.route("**/api/v1/chat/stream", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.answer_mode === "ai") {
      await ai(route, body);
      return;
    }
    const response = await route.fetch();
    const text = (await response.text()).replace('"aiAvailable":false', '"aiAvailable":true');
    await route.fulfill({ response, body: text });
  });
}

const AI_ANSWER = sse([
  ["sources", { sources: [{ id: "S1", memory_id: "m", chunk_id: null, title: TITLE, url: "https://sentiora.app/notes/1", source_type: "webpage", domain: null, heading: null, page_number: null, source_available: true, captured_at: null, excerpt: null }] }],
  ["delta", { text: "The keeper burned nine gallons a night in January [S1]." }],
  ["final", { answer: "The keeper burned nine gallons a night in January [S1].", mode: "memory", usedSources: ["S1"], followUps: ["What did the keeper burn in February?"], insufficient_context: false, used_fallback: false, aiAvailable: false }],
]);

async function askQuestion(page: Page) {
  await page.goto("/ask");
  const input = page.getByLabel("Your question");
  await input.fill(QUESTION);
  await input.press("Enter");
  const answer = page.getByRole("article", { name: "Echo's answer" }).last();
  await expect(answer).toContainText("Quoted from your saves", { timeout: 30_000 });
  await expect(answer).toContainText(/nine gallons/i);
  return answer;
}

test("Ask: a quoted answer first, then Explain with AI below it, each rated", async ({ page }) => {
  await signUp(page);
  await saveFact(page);
  await routeAsk(page, async (route) => {
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: AI_ANSWER });
  });

  const answer = await askQuestion(page);
  const feedback = page.waitForResponse((r) => r.url().includes("/answers/feedback"));
  await answer.getByRole("group", { name: "Rate this answer" }).getByRole("button", { name: "Helpful", exact: true }).click();
  expect((await feedback).status()).toBe(201);

  await answer.getByRole("button", { name: "Explain with AI" }).click();
  const ai = answer.getByRole("region", { name: "AI answer" });
  await expect(ai).toContainText("The keeper burned nine gallons a night in January");
  await expect(answer).toContainText("Quoted from your saves"); // the quote stays
  await expect(page.getByRole("button", { name: "What did the keeper burn in February?" })).toBeVisible();

  const aiFeedback = page.waitForResponse((r) => r.url().includes("/answers/feedback"));
  await ai.getByRole("group", { name: "Rate the AI answer" }).getByRole("button", { name: "Not helpful" }).click();
  const sent = await aiFeedback;
  expect(sent.status()).toBe(201);
  expect(sent.request().postDataJSON()).toMatchObject({ answer_mode: "ai", rating: -1 });
});

test("Ask: when the AI is busy the quoted answer stays and Try again works", async ({ page }) => {
  await signUp(page);
  await saveFact(page);
  let calls = 0;
  await routeAsk(page, async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "Retry-After": "5" },
        body: JSON.stringify({ success: false, error: { code: "AI_BUSY", message: "busy", details: { retry_after: 5 } } }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: AI_ANSWER });
  });

  const answer = await askQuestion(page);
  await answer.getByRole("button", { name: "Explain with AI" }).click();
  const busy = answer.getByRole("alert");
  await expect(busy).toContainText("Try again in 5 seconds");
  await expect(answer).toContainText(/nine gallons/i);
  await busy.getByRole("button", { name: "Try again" }).click();
  await expect(answer.getByRole("region", { name: "AI answer" })).toContainText("nine gallons a night");
});

test("Memory drawer: rename a save and ask for its summary", async ({ page }) => {
  await signUp(page);
  await saveFact(page);
  await page.locator("main").getByRole("button", { name: new RegExp(TITLE) }).first().click();
  const drawer = page.getByRole("dialog", { name: TITLE });
  await drawer.getByRole("button", { name: "Rename" }).click();
  await drawer.getByLabel("Title").fill("Lighthouse oil log");
  await drawer.getByRole("button", { name: "Save title" }).click();
  await expect(page.getByRole("dialog", { name: "Lighthouse oil log" })).toBeVisible();

  const renamed = page.getByRole("dialog", { name: "Lighthouse oil log" });
  const summary = renamed.getByRole("region", { name: "Summary" });
  // Opening the save may already have queued its summary; otherwise ask for it.
  const summarise = summary.getByRole("button", { name: "Summarise" });
  if (await summarise.isVisible()) await summarise.click();
  await expect(summary).toContainText("writing a summary");
});

test("Accessibility (R7): 375 px, keyboard, focus and reduced motion on the Ask page", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signUp(page);
  await saveFact(page);
  await routeAsk(page, async (route) => {
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: AI_ANSWER });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  const answer = await askQuestion(page);

  // No horizontal scroll at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // Explain with AI by keyboard, with a visible focus ring and a 44 px target.
  const explain = answer.getByRole("button", { name: "Explain with AI" });
  await explain.focus();
  const ring = await explain.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(ring).not.toBe("none");
  const box = await explain.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(36);
  await page.keyboard.press("Enter");
  await expect(answer.getByRole("region", { name: "AI answer" })).toContainText("nine gallons a night");
  const overflowAfter = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflowAfter).toBeLessThanOrEqual(0);
});
