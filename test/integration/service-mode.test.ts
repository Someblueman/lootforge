import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { startLootForgeService } from "../../src/service/server.js";

describe("service mode", () => {
  test("serves health/tools and executes tool endpoints", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-service-mode-"));
    const workspace = path.join(tempRoot, "workspace");
    const service = await startLootForgeService({
      host: "127.0.0.1",
      port: 0,
      defaultOutDir: workspace,
    });

    try {
      const healthResponse = await fetch(`${service.baseUrl}/v1/health`);
      const health = (await healthResponse.json()) as {
        ok: boolean;
        service: string;
        apiVersion: string;
      };

      expect(healthResponse.status).toBe(200);
      expect(health.ok).toBe(true);
      expect(health.service).toBe("lootforge");
      expect(health.apiVersion).toBe("v1");

      const toolsResponse = await fetch(`${service.baseUrl}/v1/tools`);
      const toolsPayload = (await toolsResponse.json()) as {
        ok: boolean;
        tools: Array<{ name: string; endpoint: string; alias: string }>;
      };

      expect(toolsResponse.status).toBe(200);
      expect(toolsPayload.ok).toBe(true);
      expect(toolsPayload.tools.some((tool) => tool.name === "generate")).toBe(true);
      expect(toolsPayload.tools.some((tool) => tool.endpoint === "/v1/tools/generate")).toBe(
        true,
      );

      const initResponse = await fetch(`${service.baseUrl}/v1/tools/init`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          requestId: "req-init-1",
          params: {
            out: workspace,
          },
        }),
      });
      const initPayload = (await initResponse.json()) as {
        ok: boolean;
        requestId?: string;
        tool: string;
        result: { manifestPath: string; imagegenDir: string };
      };

      expect(initResponse.status).toBe(200);
      expect(initPayload.ok).toBe(true);
      expect(initPayload.requestId).toBe("req-init-1");
      expect(initPayload.tool).toBe("init");
      expect(initPayload.result.manifestPath).toBe(
        path.join(workspace, "assets", "imagegen", "manifest.json"),
      );
      expect(initPayload.result.imagegenDir).toBe(
        path.join(workspace, "assets", "imagegen"),
      );

      const generateResponse = await fetch(`${service.baseUrl}/v1/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          params: {
            out: workspace,
            provider: "openai",
          },
        }),
      });
      const generatePayload = (await generateResponse.json()) as {
        ok: boolean;
        tool: string;
        error?: { code: string; message: string };
      };

      expect(generateResponse.status).toBe(422);
      expect(generatePayload.ok).toBe(false);
      expect(generatePayload.tool).toBe("generate");
      expect(typeof generatePayload.error?.message).toBe("string");

      const badRequestResponse = await fetch(`${service.baseUrl}/v1/init`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          params: {
            badField: "nope",
          },
        }),
      });
      const badRequestPayload = (await badRequestResponse.json()) as {
        ok: boolean;
        error?: { code: string };
      };

      expect(badRequestResponse.status).toBe(400);
      expect(badRequestPayload.ok).toBe(false);
      expect(badRequestPayload.error?.code).toBe("unknown_parameter");
    } finally {
      await service.close();
    }
  });
});
