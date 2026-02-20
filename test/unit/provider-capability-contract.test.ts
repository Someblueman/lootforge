import { describe, expect, it } from "vitest";

import {
  getProviderCapabilitiesContract,
  resolveProviderCapabilityDescriptors,
} from "../../src/service/providerCapabilities.ts";

describe("provider capability introspection contract", () => {
  it("returns stable provider-capability contract metadata", () => {
    const contract = getProviderCapabilitiesContract();

    expect(contract.version).toBe("v1");
    expect(contract.endpoint).toBe("/v1/providers/capabilities");
    expect(typeof contract.query.provider).toBe("string");
    expect(typeof contract.query.model).toBe("string");
  });

  it("resolves default provider capability descriptors with directive gating signals", () => {
    const descriptors = resolveProviderCapabilityDescriptors();

    expect(descriptors).toHaveLength(3);
    expect(descriptors.every((entry) => entry.directives.pixel.mode === "post-process")).toBe(
      true,
    );
    expect(descriptors.every((entry) => entry.directives.highRes.mode === "scaffold-only")).toBe(
      true,
    );
    expect(descriptors.some((entry) => entry.provider === "local")).toBe(true);
  });

  it("supports provider/model-specific introspection for nano edit capability", () => {
    const descriptors = resolveProviderCapabilityDescriptors({
      provider: "nano",
      model: "gemini-2.5-flash",
    });

    expect(descriptors).toHaveLength(1);
    expect(descriptors[0].provider).toBe("nano");
    expect(descriptors[0].model).toBe("gemini-2.5-flash");
    expect(descriptors[0].providerFeatures.imageEdits).toBe(false);
    expect(descriptors[0].directives.references.supported).toBe(false);
  });
});
