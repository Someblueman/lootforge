import { describe, expect, it } from "vitest";

import { parseCommandLine } from "../../src/checks/commandParser.ts";

describe("command parser", () => {
  it("preserves empty quoted arguments", () => {
    const parsed = parseCommandLine('node script.js --name "hero icon" "" --out "/tmp/asset out"');
    expect(parsed).toEqual({
      command: "node",
      args: ["script.js", "--name", "hero icon", "", "--out", "/tmp/asset out"],
    });
  });

  it("throws on unmatched quotes", () => {
    expect(() => parseCommandLine('node "unterminated')).toThrow(/unmatched quote/i);
  });
});
