import { defineConfig, devices } from "@playwright/test";

// Run after migrations + build, against disposable local test services only.
// Never reuse a developer's existing server or connect to a deployed application.
export default defineConfig({
  testDir: "./apps/api/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 45_000,
  globalTimeout: 5 * 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @ba-workbench/api start",
      url: "http://127.0.0.1:4000/api/health",
      env: {
        PORT: "4000",
        REDIS_URL: "redis://127.0.0.1:6379/15",
        OPENAI_API_KEY: "",
        DEFAULT_OWNER_EMAIL: "browser-e2e@ba-workbench.local",
        DEFAULT_OWNER_NAME: "Synthetic Browser BA",
        DEFAULT_ORGANISATION_NAME: "Synthetic Browser Test Workspace",
      },
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
    {
      command: "pnpm --filter @ba-workbench/web start --hostname 127.0.0.1",
      url: "http://127.0.0.1:3000/evidence",
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
  ],
});
