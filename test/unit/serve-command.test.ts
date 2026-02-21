import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { parseServeCommandArgs } from "../../src/cli/commands/serve.js";

describe("serve command", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses explicit service flags", () => {
    const args = parseServeCommandArgs([
      "--host",
      "0.0.0.0",
      "--port",
      "9901",
      "--out",
      "tmp/service-out",
    ]);

    expect(args.host).toBe("0.0.0.0");
    expect(args.port).toBe(9901);
    expect(args.defaultOutDir).toBe(path.resolve("tmp/service-out"));
  });

  it("uses service environment defaults when flags are omitted", () => {
    vi.stubEnv("LOOTFORGE_SERVICE_HOST", "127.0.0.2");
    vi.stubEnv("LOOTFORGE_SERVICE_PORT", "9012");
    vi.stubEnv("LOOTFORGE_SERVICE_OUT", "tmp/env-out");

    const args = parseServeCommandArgs([]);
    expect(args.host).toBe("127.0.0.2");
    expect(args.port).toBe(9012);
    expect(args.defaultOutDir).toBe(path.resolve("tmp/env-out"));
  });

  it("throws on invalid port values", () => {
    expect(() => parseServeCommandArgs(["--port", "abc"])).toThrow(/Invalid --port value/i);
    expect(() => parseServeCommandArgs(["--port", "99999"])).toThrow(/Invalid --port value/i);
  });
});
