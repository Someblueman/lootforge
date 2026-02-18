#!/usr/bin/env node
// Minimal stdin/stdout adapter example for LOOTFORGE_<NAME>_ADAPTER_CMD.

const fs = require("node:fs");

function main() {
  const raw = fs.readFileSync(0, "utf8");
  const input = JSON.parse(raw);

  const prompt = String(input.prompt || "");
  const referenceImages = Array.isArray(input.referenceImages) ? input.referenceImages : [];

  const metrics = {
    prompt_length: prompt.length,
    reference_count: referenceImages.length,
  };

  // Positive if prompt exists, neutral otherwise.
  const score = prompt.length > 0 ? 1 : 0;

  process.stdout.write(`${JSON.stringify({ metrics, score })}\n`);
}

main();
