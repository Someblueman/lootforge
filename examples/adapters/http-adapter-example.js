#!/usr/bin/env node
// Minimal HTTP adapter example for LOOTFORGE_<NAME>_ADAPTER_URL.

const http = require("node:http");

const port = Number.parseInt(process.env.PORT || "8787", 10);

const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    try {
      const input = JSON.parse(body || "{}");
      const targetId = String(input.target?.id || "");
      const metrics = {
        target_id_length: targetId.length,
      };
      const score = targetId.length > 0 ? 1 : 0;

      res.setHeader("Content-Type", "application/json");
      res.statusCode = 200;
      res.end(JSON.stringify({ metrics, score }));
    } catch (error) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain");
      res.end(error instanceof Error ? error.message : String(error));
    }
  });
});

server.listen(port, () => {
  process.stdout.write(`Adapter listening on http://127.0.0.1:${port}\n`);
});
