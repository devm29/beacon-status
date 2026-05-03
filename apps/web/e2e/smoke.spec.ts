import { expect, test, type Page } from "@playwright/test";

const API_KEY = process.env.E2E_API_KEY ?? "bk_demo_acme_local_development_key";
const SLUG = process.env.E2E_SLUG ?? "acme";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("API key").fill(API_KEY);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.describe.configure({ mode: "serial" });

test("signs in and creates a monitor", async ({ page }) => {
  const name = `Smoke ${Date.now()}`;
  await signIn(page);
  await page.goto("/monitors");
  await page.getByRole("button", { name: "New monitor" }).click();
  const sheet = page.getByRole("dialog", { name: "New monitor" });
  await sheet.getByLabel("Name").fill(name);
  await sheet.getByLabel("URL").fill("https://example.com/health");
  await sheet.getByRole("button", { name: "Create monitor" }).click();
  await expect(page.getByText(`${name} is being probed`)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
});

test("declares an incident, resolves it and shows it publicly", async ({ page }) => {
  const title = `Smoke incident ${Date.now()}`;
  await signIn(page);
  await page.goto("/incidents");
  await page.getByRole("button", { name: "Declare incident" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Declare an incident" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("First update").fill("We are looking into reports of errors.");
  await dialog.getByRole("button", { name: "Declare incident" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

  await page.getByRole("tab", { name: "Resolved" }).click();
  await page.getByLabel("Message").fill("A fix has been deployed.");
  await page.getByRole("button", { name: "Post update" }).click();
  await expect(page.getByText("Incident resolved")).toBeVisible();

  await page.goto(`/status/${SLUG}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("90 days ago").first()).toBeVisible();
});

test("serves the embeddable badge", async ({ request }) => {
  const api = process.env.E2E_API_URL ?? "http://localhost:8111";
  const badge = await request.get(`${api}/public/status/${SLUG}/badge.svg`);
  expect(badge.ok()).toBe(true);
  expect(await badge.text()).toContain("<svg");
});
