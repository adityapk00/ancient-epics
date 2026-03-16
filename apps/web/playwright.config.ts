import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const uiTestWebPort = Number(process.env.UI_TEST_WEB_PORT ?? 4173);
const uiTestBaseUrl = `http://127.0.0.1:${uiTestWebPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // run tests sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL: uiTestBaseUrl,
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm test:ui:server",
    cwd: repoRoot,
    url: uiTestBaseUrl,
    timeout: 120_000,
    reuseExistingServer: false,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
