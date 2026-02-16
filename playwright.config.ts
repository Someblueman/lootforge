import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/demo",
  testMatch: "playwright-smoke.test.ts",
  timeout: 30000,
  retries: 1,
  use: {
    headless: true,
    viewport: { width: 1024, height: 600 },
    baseURL: "http://localhost:5174",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command:
      "npx vite preview --config examples/phaser-demo/vite.config.ts --port 5174",
    port: 5174,
    reuseExistingServer: !process.env.CI,
  },
});
