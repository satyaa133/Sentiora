import { expect, test, type Page } from "@playwright/test";

// Browser-driven flow through the real dashboard UI, against the isolated e2e
// stack (test database, separate Redis DB, providers disabled → deterministic
// grounded fallback answers). Complements the API-level mvp-flow spec.

const FACT_TITLE = "Zephyrine Point Lighthouse Log";
const FACT_CONTENT = [
  "The Zephyrine Point lighthouse keeper recorded every night of the winter of 1847 in a leather logbook.",
  "In January the keeper burned nine gallons of whale oil per night to keep the lamp visible through the storms.",
  "When the whale oil ran low in February, the keeper switched to lard oil, which burned dimmer but lasted longer.",
].join("\n\n");

function uniqueEmail(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;
}

async function signUpAndOnboard(page: Page): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("E2E UI User");
  await page.getByLabel("Email").fill(uniqueEmail("e2e_ui"));
  await page.getByLabel("Password", { exact: true }).fill("MemoryPassword123!");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();

  // Walk the onboarding steps until Home opens.
  await expect(page).toHaveURL(/\/onboarding/);
  for (let step = 0; step < 6 && !/\/dashboard/.test(page.url()); step += 1) {
    const next = page.getByRole("button", { name: /^(Continue|Go to Home)/ }).first();
    await next.click();
    await page.waitForTimeout(300);
  }
  await expect(page).toHaveURL(/\/dashboard/);
}

async function addMemory(page: Page, title: string, content: string): Promise<void> {
  await page.getByRole("button", { name: "Add memory" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add a memory" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Content").fill(content);
  await dialog.getByRole("button", { name: "Save memory" }).click();
  await expect(dialog).toBeHidden();
}

function memoryRow(page: Page, title: string) {
  return page.locator("main").getByRole("listitem").filter({ hasText: title }).first();
}

test("UI: sign up, add a memory, see it processed, and get a grounded cited answer", async ({
  page,
}) => {
  await signUpAndOnboard(page);
  await addMemory(page, FACT_TITLE, FACT_CONTENT);

  // Wait (bounded) for the worker to finish: the row loses its "Processing" tag.
  await page.goto("/timeline");
  const row = memoryRow(page, FACT_TITLE);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).not.toContainText(/Processing|Failed/, { timeout: 30_000 });

  // Direct navigation + refresh keep the right view.
  await page.goto("/ask");
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Ask Sentiora" }),
  ).toBeVisible();

  const input = page.getByLabel("Your question");
  await input.fill(
    "How many gallons of whale oil did the Zephyrine Point keeper burn per night in January?",
  );
  await input.press("Enter");

  const main = page.locator("main");
  await expect(main).toContainText(/nine gallons/i, { timeout: 30_000 });
  await expect(main.getByRole("heading", { name: "Sources used" })).toBeVisible();
  await expect(main.getByText(FACT_TITLE).last()).toBeVisible();
  await expect(main.getByRole("button", { name: "Open memory" }).first()).toBeVisible();

  // Browser history returns to the previous view.
  await page.goto("/timeline");
  await page.goBack();
  await expect(page).toHaveURL(/\/ask$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Ask Sentiora" }),
  ).toBeVisible();
});

test("UI: a capture that cannot be indexed is shown as failed with its reason", async ({
  page,
}) => {
  await signUpAndOnboard(page);
  await addMemory(page, "Too Short Note", "Too short to index.");

  await page.goto("/timeline");
  const row = memoryRow(page, "Too Short Note");
  await expect(row).toContainText("Failed", { timeout: 30_000 });

  await row.getByRole("button", { name: /Too Short Note/ }).click();
  const alert = page.getByRole("alert").filter({ hasText: "It is not searchable" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/too short to index/i);
});
