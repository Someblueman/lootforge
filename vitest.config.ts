import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/playwright-smoke*"],
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/pipeline/generate.ts", "src/cli/commands/generate.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        perFile: true,
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,
      },
    },
  },
});
