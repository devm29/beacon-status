import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests against a running stack (`pnpm dev` after `pnpm seed`). They exercise the paths a
 * reviewer would click through: sign in, add a monitor, run an incident, read the status page.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3111",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
