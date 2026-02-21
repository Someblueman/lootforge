import { access, mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { startLootForgeService } from "../../src/service/server.js";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5WcXwAAAAASUVORK5CYII=";

async function startFakeLocalDiffusionService(options?: { delayMs?: number }): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const delayMs = Math.max(0, options?.delayMs ?? 0);
  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/generate") {
      for await (const _chunk of req) {
        // drain request body
      }
      if (delayMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, delayMs);
        });
      }
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(
        `${JSON.stringify({
          images: [{ b64_json: TINY_PNG_BASE64 }],
        })}\n`,
      );
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Failed to resolve fake local diffusion service address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await closeServer(server);
    },
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    server.closeAllConnections?.();
  });
}

function buildCanonicalGenerationRequest(params: {
  requestId: string;
  outDir: string;
  localBaseUrl: string;
  targetId: string;
}): Record<string, unknown> {
  return {
    requestId: params.requestId,
    request: {
      outDir: params.outDir,
      provider: "auto",
      manifest: {
        version: "next",
        pack: {
          id: `svc-pack-${params.targetId}`,
          version: "0.1.0",
        },
        providers: {
          default: "local",
          local: {
            model: "sdxl-controlnet",
            baseUrl: params.localBaseUrl,
          },
        },
        styleKits: [
          {
            id: "default-kit",
            rulesPath: "style/default/style.md",
            referenceImages: [],
            lightingModel: "flat",
          },
        ],
        consistencyGroups: [
          {
            id: "default-group",
            styleKitId: "default-kit",
            referenceImages: [],
          },
        ],
        evaluationProfiles: [{ id: "quality" }],
        targets: [
          {
            id: params.targetId,
            kind: "sprite",
            out: `${params.targetId}.png`,
            styleKitId: "default-kit",
            consistencyGroup: "default-group",
            evaluationProfileId: "quality",
            prompt: "hero",
            generationPolicy: {
              outputFormat: "png",
              background: "transparent",
            },
          },
        ],
      },
    },
  };
}

describe("service mode", () => {
  test("serves health/tools and executes tool endpoints", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-service-mode-"));
    const workspace = path.join(tempRoot, "workspace");
    const service = await startLootForgeService({
      host: "127.0.0.1",
      port: 0,
      defaultOutDir: workspace,
    });
    const fakeLocal = await startFakeLocalDiffusionService();

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
        tools: { name: string; endpoint: string; alias: string }[];
        contracts?: {
          generationRequest?: {
            version: string;
            endpoint: string;
          };
          providerCapabilities?: {
            version: string;
            endpoint: string;
          };
        };
      };

      expect(toolsResponse.status).toBe(200);
      expect(toolsPayload.ok).toBe(true);
      expect(toolsPayload.tools.some((tool) => tool.name === "generate")).toBe(true);
      expect(toolsPayload.tools.some((tool) => tool.endpoint === "/v1/tools/generate")).toBe(true);
      expect(toolsPayload.contracts?.generationRequest?.endpoint).toBe("/v1/generation/requests");
      expect(toolsPayload.contracts?.providerCapabilities?.endpoint).toBe(
        "/v1/providers/capabilities",
      );

      const contractResponse = await fetch(`${service.baseUrl}/v1/contracts/generation-request`);
      const contractPayload = (await contractResponse.json()) as {
        ok: boolean;
        contract: {
          version: string;
          endpoint: string;
          fields: Record<string, string>;
        };
      };
      expect(contractResponse.status).toBe(200);
      expect(contractPayload.ok).toBe(true);
      expect(contractPayload.contract.endpoint).toBe("/v1/generation/requests");
      expect(typeof contractPayload.contract.fields.manifestPath).toBe("string");

      const providerContractResponse = await fetch(
        `${service.baseUrl}/v1/contracts/provider-capabilities`,
      );
      const providerContractPayload = (await providerContractResponse.json()) as {
        ok: boolean;
        contract: {
          version: string;
          endpoint: string;
          query: Record<string, string>;
        };
      };
      expect(providerContractResponse.status).toBe(200);
      expect(providerContractPayload.ok).toBe(true);
      expect(providerContractPayload.contract.endpoint).toBe("/v1/providers/capabilities");
      expect(typeof providerContractPayload.contract.query.provider).toBe("string");

      const providerCapabilitiesResponse = await fetch(
        `${service.baseUrl}/v1/providers/capabilities`,
      );
      const providerCapabilitiesPayload = (await providerCapabilitiesResponse.json()) as {
        ok: boolean;
        endpoint: string;
        capabilities: {
          provider: string;
          model: string;
          directives: {
            pixel: { supported: boolean; mode: string };
            highRes: { supported: boolean; mode: string };
            references: { supported: boolean; mode: string };
          };
        }[];
      };
      expect(providerCapabilitiesResponse.status).toBe(200);
      expect(providerCapabilitiesPayload.ok).toBe(true);
      expect(providerCapabilitiesPayload.endpoint).toBe("/v1/providers/capabilities");
      expect(providerCapabilitiesPayload.capabilities.length).toBe(3);
      expect(
        providerCapabilitiesPayload.capabilities.every(
          (entry) => entry.directives.pixel.mode === "post-process",
        ),
      ).toBe(true);
      expect(
        providerCapabilitiesPayload.capabilities.every(
          (entry) => entry.directives.highRes.mode === "scaffold-only",
        ),
      ).toBe(true);

      const providerQueryResponse = await fetch(
        `${service.baseUrl}/v1/providers/capabilities?provider=nano&model=gemini-2.5-flash`,
      );
      const providerQueryPayload = (await providerQueryResponse.json()) as {
        ok: boolean;
        capabilities: {
          provider: string;
          model: string;
          directives: {
            references: { supported: boolean };
          };
        }[];
      };
      expect(providerQueryResponse.status).toBe(200);
      expect(providerQueryPayload.ok).toBe(true);
      expect(providerQueryPayload.capabilities).toHaveLength(1);
      expect(providerQueryPayload.capabilities[0].provider).toBe("nano");
      expect(providerQueryPayload.capabilities[0].model).toBe("gemini-2.5-flash");
      expect(providerQueryPayload.capabilities[0].directives.references.supported).toBe(false);

      const providerInvalidQueryResponse = await fetch(
        `${service.baseUrl}/v1/providers/capabilities?model=gemini-2.5-flash`,
      );
      const providerInvalidQueryPayload = (await providerInvalidQueryResponse.json()) as {
        ok: boolean;
        error?: { code: string };
      };
      expect(providerInvalidQueryResponse.status).toBe(400);
      expect(providerInvalidQueryPayload.ok).toBe(false);
      expect(providerInvalidQueryPayload.error?.code).toBe("invalid_query_parameter");

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
      expect(initPayload.result.imagegenDir).toBe(path.join(workspace, "assets", "imagegen"));

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

      const emptyBodyResponse = await fetch(`${service.baseUrl}/v1/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{}",
      });
      const emptyBodyPayload = (await emptyBodyResponse.json()) as {
        ok: boolean;
        error?: { code: string };
      };
      expect(emptyBodyResponse.status).toBe(400);
      expect(emptyBodyPayload.ok).toBe(false);
      expect(emptyBodyPayload.error?.code).toBe("invalid_request_body");

      const argsAndParamsResponse = await fetch(`${service.baseUrl}/v1/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          args: ["--out", workspace],
          params: { out: workspace },
        }),
      });
      const argsAndParamsPayload = (await argsAndParamsResponse.json()) as {
        ok: boolean;
        error?: { code: string };
      };
      expect(argsAndParamsResponse.status).toBe(400);
      expect(argsAndParamsPayload.ok).toBe(false);
      expect(argsAndParamsPayload.error?.code).toBe("invalid_request_body");

      const canonicalResponse = await fetch(`${service.baseUrl}/v1/generation/requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(
          buildCanonicalGenerationRequest({
            requestId: "req-canonical-1",
            outDir: workspace,
            localBaseUrl: fakeLocal.baseUrl,
            targetId: "svc-hero",
          }),
        ),
      });
      const canonicalPayload = (await canonicalResponse.json()) as {
        ok: boolean;
        operation: string;
        result: {
          requestId?: string;
          mappingVersion: string;
          normalizedRequest: {
            manifestSource: string;
          };
          plan: {
            targets: number;
          };
          generate: {
            jobs: number;
            runId: string;
          };
        };
      };

      expect(canonicalResponse.status).toBe(200);
      expect(canonicalPayload.ok).toBe(true);
      expect(canonicalPayload.operation).toBe("generation_request");
      expect(canonicalPayload.result.requestId).toBe("req-canonical-1");
      expect(canonicalPayload.result.mappingVersion).toBe("v1");
      expect(canonicalPayload.result.normalizedRequest.manifestSource).toBe("inline");
      expect(canonicalPayload.result.plan.targets).toBe(1);
      expect(canonicalPayload.result.generate.jobs).toBe(1);
      expect(typeof canonicalPayload.result.generate.runId).toBe("string");
      await expect(
        access(canonicalPayload.result.normalizedRequest.manifestPath),
      ).rejects.toThrow();

      const canonicalBadResponse = await fetch(`${service.baseUrl}/v1/generation/requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          request: {
            outDir: workspace,
          },
        }),
      });
      const canonicalBadPayload = (await canonicalBadResponse.json()) as {
        ok: boolean;
        error?: { code: string };
      };
      expect(canonicalBadResponse.status).toBe(400);
      expect(canonicalBadPayload.ok).toBe(false);
      expect(canonicalBadPayload.error?.code).toBe("invalid_canonical_generation_request");
    } finally {
      await Promise.all([service.close(), fakeLocal.close()]);
    }
  });

  test("returns 429 when max active jobs is exceeded", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-service-mode-busy-"));
    const workspaceA = path.join(tempRoot, "workspace-a");
    const workspaceB = path.join(tempRoot, "workspace-b");
    const service = await startLootForgeService({
      host: "127.0.0.1",
      port: 0,
      maxActiveJobs: 1,
    });
    const fakeLocal = await startFakeLocalDiffusionService({ delayMs: 300 });

    try {
      const firstRequest = fetch(`${service.baseUrl}/v1/generation/requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(
          buildCanonicalGenerationRequest({
            requestId: "req-canonical-a",
            outDir: workspaceA,
            localBaseUrl: fakeLocal.baseUrl,
            targetId: "svc-hero-a",
          }),
        ),
      });

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25);
      });

      const secondRequest = fetch(`${service.baseUrl}/v1/generation/requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(
          buildCanonicalGenerationRequest({
            requestId: "req-canonical-b",
            outDir: workspaceB,
            localBaseUrl: fakeLocal.baseUrl,
            targetId: "svc-hero-b",
          }),
        ),
      });

      const [secondResponse, firstResponse] = await Promise.all([secondRequest, firstRequest]);
      const secondPayload = (await secondResponse.json()) as {
        ok: boolean;
        operation?: string;
        error?: {
          code?: string;
          message?: string;
        };
      };
      const firstPayload = (await firstResponse.json()) as {
        ok: boolean;
        operation?: string;
      };

      expect(secondResponse.status).toBe(429);
      expect(secondPayload.ok).toBe(false);
      expect(secondPayload.operation).toBe("generation_request");
      expect(secondPayload.error?.code).toBe("service_busy");
      expect(typeof secondPayload.error?.message).toBe("string");

      expect(firstResponse.status).toBe(200);
      expect(firstPayload.ok).toBe(true);
      expect(firstPayload.operation).toBe("generation_request");
    } finally {
      await Promise.all([service.close(), fakeLocal.close()]);
    }
  });
});
