import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3000",
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ??
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox"],
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    env: { IDEATOR_TEST_NAMESPACE: randomUUID() },
    url: "http://127.0.0.1:3000/health",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
