import { describe, expect, it } from "vitest";

import {
  buildRuntimeManifestArtifacts,
  parseRuntimeManifestTargetsArg,
  resolveRuntimeManifestTargets,
} from "../../src/output/runtimeManifests.js";
import { type PlannedTarget } from "../../src/providers/types.js";

const TARGETS: PlannedTarget[] = [
  {
    id: "hero",
    kind: "sprite",
    out: "hero.png",
    atlasGroup: "actors",
    promptSpec: {
      primary: "hero",
    },
    runtimeSpec: {
      alphaRequired: true,
      previewWidth: 64,
      previewHeight: 64,
      anchorX: 0.25,
      anchorY: 0.75,
    },
  },
];

describe("runtime manifest output", () => {
  it("always includes phaser baseline target", () => {
    expect(resolveRuntimeManifestTargets(["pixi", "unity"])).toEqual(["phaser", "pixi", "unity"]);
  });

  it("parses runtime list and rejects unknown values", () => {
    expect(parseRuntimeManifestTargetsArg("pixi,unity,pixi")).toEqual(["pixi", "unity"]);
    expect(() => parseRuntimeManifestTargetsArg("pixi,unknown")).toThrow(/Unsupported runtime/i);
  });

  it("builds pixi and unity manifests from the same catalog data", () => {
    const artifacts = buildRuntimeManifestArtifacts({
      packId: "test-pack",
      atlasBundles: [
        {
          id: "atlas-actors",
          imageUrl: "/assets/atlases/atlas-actors.png",
          jsonUrl: "/assets/atlases/atlas-actors.json",
          targets: ["hero"],
        },
      ],
      catalogItems: [
        {
          id: "hero",
          kind: "sprite",
          atlasGroup: "actors",
          out: "hero.png",
          url: "/assets/images/hero.png",
          alphaRequired: true,
          previewWidth: 64,
          previewHeight: 64,
          sizeBytes: 128,
          exists: true,
        },
      ],
      targets: TARGETS,
      runtimeTargets: ["pixi", "unity"],
    });

    expect(artifacts.map((artifact) => artifact.target)).toEqual(["phaser", "pixi", "unity"]);
    const unityArtifact = artifacts.find((artifact) => artifact.target === "unity");
    expect(unityArtifact).toBeDefined();
    const textures = (unityArtifact?.payload.textures as Record<string, unknown>[]) ?? [];
    expect(textures[0]?.pivot).toEqual({ x: 0.25, y: 0.75 });
  });
});
