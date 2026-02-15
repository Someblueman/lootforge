import path from "node:path";

import { ZodIssue } from "zod";

import {
  buildStructuredPrompt,
  getTargetGenerationPolicy,
  nowIso,
} from "../providers/types.js";
import type {
  PlannedTarget,
  PromptSpec,
  ProviderName,
} from "../providers/types.js";
import { safeParseManifestV2 } from "./schema.js";
import type {
  ManifestTarget,
  ManifestV2,
  ManifestValidationResult,
  PlanArtifacts,
  PlannedProviderJobSpec,
  ValidationIssue,
  ManifestSource,
} from "./types.js";

const SIZE_PATTERN = /^\d+x\d+$/i;
const SUPPORTED_OUTPUT_FORMATS = new Set(["png", "jpg", "jpeg", "webp"]);

export interface ValidateManifestOptions {
  now?: () => Date;
}

export function validateManifestSource(
  source: ManifestSource,
  options: ValidateManifestOptions = {},
): ManifestValidationResult {
  const issues: ValidationIssue[] = [];
  const parsed = safeParseManifestV2(source.data);
  let manifest: ManifestV2 | undefined;

  if (!parsed.success) {
    issues.push(...parsed.error.issues.map(toSchemaValidationIssue));
  } else {
    manifest = parsed.data as ManifestV2;
    issues.push(...collectSemanticIssues(manifest));
  }

  const errors = issues.filter((issue) => issue.level === "error").length;
  const warnings = issues.filter((issue) => issue.level === "warning").length;

  return {
    manifest,
    report: {
      manifestPath: source.manifestPath,
      generatedAt: nowIso(options.now),
      ok: errors === 0,
      errors,
      warnings,
      targetCount: manifest?.targets.length ?? 0,
      issues,
    },
  };
}

export function normalizeManifestTargets(manifest: ManifestV2): PlannedTarget[] {
  const defaultProvider = manifest.providers?.default ?? "openai";

  return manifest.targets.map((target) =>
    normalizeTargetForGeneration(manifest, target, defaultProvider),
  );
}

export function createPlanArtifacts(
  manifest: ManifestV2,
  manifestPath: string,
  now?: () => Date,
): PlanArtifacts {
  const targets = normalizeManifestTargets(manifest);
  const openaiJobs: PlannedProviderJobSpec[] = [];
  const nanoJobs: PlannedProviderJobSpec[] = [];

  for (const target of targets) {
    const provider = target.provider ?? "openai";
    const row = toProviderJobSpec(target, provider);
    if (provider === "openai") {
      openaiJobs.push(row);
    } else {
      nanoJobs.push(row);
    }
  }

  return {
    targets,
    targetsIndex: {
      generatedAt: nowIso(now),
      manifestPath,
      targets,
    },
    openaiJobs,
    nanoJobs,
  };
}

function collectSemanticIssues(manifest: ManifestV2): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();
  const seenOutPaths = new Set<string>();
  const defaultProvider = manifest.providers?.default ?? "openai";

  manifest.targets.forEach((target, index) => {
    const id = target.id.trim();
    const out = target.out.trim();

    if (seenIds.has(id)) {
      issues.push({
        level: "error",
        code: "duplicate_target_id",
        path: `targets[${index}].id`,
        message: `Duplicate target id "${id}".`,
      });
    } else {
      seenIds.add(id);
    }

    if (seenOutPaths.has(out)) {
      issues.push({
        level: "error",
        code: "duplicate_target_out",
        path: `targets[${index}].out`,
        message: `Duplicate output path "${out}".`,
      });
    } else {
      seenOutPaths.add(out);
    }

    const policySize = target.generationPolicy?.size ?? target.acceptance?.size;
    if (policySize && !SIZE_PATTERN.test(policySize)) {
      issues.push({
        level: "error",
        code: "invalid_size",
        path: `targets[${index}].generationPolicy.size`,
        message: `Size "${policySize}" must match WIDTHxHEIGHT.`,
      });
    }

    const provider = target.provider ?? defaultProvider;
    const background = resolveBackground(target);
    if (provider === "nano" && background === "transparent") {
      issues.push({
        level: "warning",
        code: "nano_transparent_background",
        path: `targets[${index}].generationPolicy.background`,
        message:
          "Nano provider may not preserve transparent backgrounds; OpenAI is safer for alpha.",
      });
    }

    const outputFormat = resolveOutputFormat(target);
    if (!SUPPORTED_OUTPUT_FORMATS.has(outputFormat)) {
      issues.push({
        level: "warning",
        code: "unusual_output_format",
        path: `targets[${index}].out`,
        message: `Output format "${outputFormat}" is uncommon for runtime pipelines.`,
      });
    }
  });

  return issues;
}

function normalizeTargetForGeneration(
  manifest: ManifestV2,
  target: ManifestTarget,
  defaultProvider: ProviderName,
): PlannedTarget {
  const provider = target.provider ?? defaultProvider;
  const model = resolveTargetModel(manifest, target, provider);

  const normalized: PlannedTarget = {
    id: target.id.trim(),
    out: target.out.trim(),
    provider,
    promptSpec: normalizePromptSpec(target),
    generationPolicy: {
      size: resolveSize(target),
      quality: resolveQuality(target),
      background: resolveBackground(target),
      outputFormat: resolveOutputFormat(target),
    },
  };

  if (model) {
    normalized.model = model;
  }

  return normalized;
}

function normalizePromptSpec(target: ManifestTarget): PromptSpec {
  if (target.promptSpec) {
    return trimPromptSpec(target.promptSpec);
  }

  if (typeof target.prompt === "string") {
    return {
      primary: target.prompt.trim(),
    };
  }

  if (target.prompt && typeof target.prompt === "object") {
    return trimPromptSpec(target.prompt);
  }

  throw new Error(`Target "${target.id}" has no prompt content.`);
}

function trimPromptSpec(promptSpec: PromptSpec): PromptSpec {
  return {
    primary: promptSpec.primary.trim(),
    ...(promptSpec.useCase ? { useCase: promptSpec.useCase.trim() } : {}),
    ...(promptSpec.scene ? { scene: promptSpec.scene.trim() } : {}),
    ...(promptSpec.subject ? { subject: promptSpec.subject.trim() } : {}),
    ...(promptSpec.style ? { style: promptSpec.style.trim() } : {}),
    ...(promptSpec.composition ? { composition: promptSpec.composition.trim() } : {}),
    ...(promptSpec.lighting ? { lighting: promptSpec.lighting.trim() } : {}),
    ...(promptSpec.palette ? { palette: promptSpec.palette.trim() } : {}),
    ...(promptSpec.materials ? { materials: promptSpec.materials.trim() } : {}),
    ...(promptSpec.constraints ? { constraints: promptSpec.constraints.trim() } : {}),
    ...(promptSpec.negative ? { negative: promptSpec.negative.trim() } : {}),
  };
}

function resolveSize(target: ManifestTarget): string {
  return firstNonEmpty(
    target.generationPolicy?.size,
    target.acceptance?.size,
    "1024x1024",
  );
}

function resolveQuality(target: ManifestTarget): string {
  return firstNonEmpty(
    target.generationPolicy?.quality,
    target.generationPolicy?.finalQuality,
    "high",
  );
}

function resolveBackground(target: ManifestTarget): string {
  const policyBackground = target.generationPolicy?.background?.trim();
  if (policyBackground) {
    return policyBackground;
  }

  if (target.acceptance?.alpha === true || target.runtimeSpec?.alphaRequired === true) {
    return "transparent";
  }

  return "opaque";
}

function resolveOutputFormat(target: ManifestTarget): string {
  const policyFormat = target.generationPolicy?.outputFormat?.trim();
  if (policyFormat) {
    return policyFormat.toLowerCase();
  }

  const ext = path.extname(target.out).replace(".", "").trim().toLowerCase();
  return ext || "png";
}

function resolveTargetModel(
  manifest: ManifestV2,
  target: ManifestTarget,
  provider: ProviderName,
): string | undefined {
  if (target.model && target.model.trim()) {
    return target.model.trim();
  }

  if (provider === "openai") {
    return manifest.providers?.openai?.model?.trim() || undefined;
  }

  return manifest.providers?.nano?.model?.trim() || undefined;
}

function toProviderJobSpec(
  target: PlannedTarget,
  provider: ProviderName,
): PlannedProviderJobSpec {
  const row: PlannedProviderJobSpec = {
    targetId: target.id,
    out: target.out,
    provider,
    prompt: buildStructuredPrompt(target.promptSpec),
    promptSpec: target.promptSpec,
    generationPolicy: getTargetGenerationPolicy(target),
  };

  if (target.model) {
    row.model = target.model;
  }

  return row;
}

function toSchemaValidationIssue(issue: ZodIssue): ValidationIssue {
  return {
    level: "error",
    code: `schema_${issue.code}`,
    path: formatIssuePath(issue.path),
    message: issue.message,
  };
}

function formatIssuePath(pathItems: Array<string | number>): string {
  if (pathItems.length === 0) {
    return "$";
  }

  return pathItems
    .map((item, index) => {
      if (typeof item === "number") {
        return `[${item}]`;
      }
      return index === 0 ? item : `.${item}`;
    })
    .join("");
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return "";
}
