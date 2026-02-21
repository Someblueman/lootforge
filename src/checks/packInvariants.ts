import sharp from "sharp";

import { type PlannedTarget } from "../providers/types.js";
import { normalizeTargetOutPath, resolvePathWithinDir } from "../shared/paths.js";

const BYTES_PER_MEGABYTE = 1024 * 1024;

export interface PackInvariantIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  targetIds: string[];
  evaluationProfileId?: string;
  metrics?: Record<string, number>;
}

export interface PackInvariantMetrics {
  textureBudgetMBByProfile?: Record<
    string,
    {
      estimatedMB: number;
      budgetMB?: number;
      targetCount: number;
    }
  >;
  spritesheetContinuityByAnimation?: Record<
    string,
    {
      comparisons: number;
      maxSilhouetteDrift: number;
      maxAnchorDrift: number;
    }
  >;
}

export interface PackInvariantSummary {
  errors: number;
  warnings: number;
  issues: PackInvariantIssue[];
  metrics?: PackInvariantMetrics;
}

export interface PackInvariantTargetIssue {
  targetId: string;
  level: "error" | "warning";
  code: string;
  message: string;
}

interface AcceptanceItemLike {
  targetId: string;
  out: string;
  imagePath: string;
  exists: boolean;
  width?: number;
  height?: number;
}

interface FrameInspection {
  frame: PlannedTarget;
  width: number;
  height: number;
  silhouette: AlphaSilhouette | null;
}

interface AlphaSilhouette {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
  centerX: number;
  centerY: number;
}

interface PackFamily {
  id: string;
  sheets: PlannedTarget[];
  frames: PlannedTarget[];
}

export interface PackInvariantCheckResult {
  summary?: PackInvariantSummary;
  targetIssues: PackInvariantTargetIssue[];
}

export async function runPackInvariantChecks(params: {
  targets: PlannedTarget[];
  items: AcceptanceItemLike[];
  imagesDir: string;
}): Promise<PackInvariantCheckResult> {
  const runtimeTargets = params.targets.filter((target) => target.catalogDisabled !== true);
  const runtimeTargetIds = new Set(runtimeTargets.map((target) => target.id));
  const issues: PackInvariantIssue[] = [];
  const targetIssues: PackInvariantTargetIssue[] = [];
  const continuityMetricsByAnimation: NonNullable<
    PackInvariantMetrics["spritesheetContinuityByAnimation"]
  > = {};

  const addIssue = (issue: PackInvariantIssue): void => {
    const normalizedTargetIds = Array.from(new Set(issue.targetIds));
    if (normalizedTargetIds.length === 0) {
      return;
    }

    const normalizedIssue: PackInvariantIssue = {
      ...issue,
      targetIds: normalizedTargetIds,
    };
    issues.push(normalizedIssue);

    for (const targetId of normalizedTargetIds) {
      if (!runtimeTargetIds.has(targetId)) {
        continue;
      }
      targetIssues.push({
        targetId,
        level: normalizedIssue.level,
        code: normalizedIssue.code,
        message: normalizedIssue.message,
      });
    }
  };

  enforceRuntimeOutputUniqueness(runtimeTargets, addIssue);

  const families = collectSpritesheetFamilies(params.targets);
  for (const family of families.values()) {
    await enforceSpritesheetFamilyInvariants({
      family,
      imagesDir: params.imagesDir,
      addIssue,
      continuityMetricsByAnimation,
      runtimeTargetIds,
    });
  }

  const textureBudgetMetricsByProfile = enforceTextureBudgetByProfile({
    runtimeTargets,
    items: params.items,
    addIssue,
  });

  const metrics: PackInvariantMetrics = {
    ...(Object.keys(textureBudgetMetricsByProfile).length > 0
      ? { textureBudgetMBByProfile: textureBudgetMetricsByProfile }
      : {}),
    ...(Object.keys(continuityMetricsByAnimation).length > 0
      ? { spritesheetContinuityByAnimation: continuityMetricsByAnimation }
      : {}),
  };

  const hasMetrics = Object.keys(metrics).length > 0;
  const summary =
    issues.length > 0 || hasMetrics
      ? {
          errors: issues.filter((issue) => issue.level === "error").length,
          warnings: issues.filter((issue) => issue.level === "warning").length,
          issues,
          ...(hasMetrics ? { metrics } : {}),
        }
      : undefined;

  return {
    summary,
    targetIssues,
  };
}

function enforceRuntimeOutputUniqueness(
  runtimeTargets: PlannedTarget[],
  addIssue: (issue: PackInvariantIssue) => void,
): void {
  const outPathToTargetIds = new Map<string, Set<string>>();

  for (const target of runtimeTargets) {
    let normalizedOut: string;
    try {
      normalizedOut = normalizeTargetOutPath(target.out).toLowerCase();
    } catch {
      continue;
    }

    const targetIds = outPathToTargetIds.get(normalizedOut) ?? new Set<string>();
    targetIds.add(target.id);
    outPathToTargetIds.set(normalizedOut, targetIds);
  }

  for (const [normalizedOut, targetIds] of outPathToTargetIds) {
    if (targetIds.size < 2) {
      continue;
    }

    const duplicates = Array.from(targetIds).sort((left, right) => left.localeCompare(right));
    addIssue({
      level: "error",
      code: "pack_duplicate_runtime_out",
      message: `Runtime output collision for normalized path "${normalizedOut}" across targets: ${duplicates.join(", ")}.`,
      targetIds: duplicates,
    });
  }
}

function collectSpritesheetFamilies(targets: PlannedTarget[]): Map<string, PackFamily> {
  const families = new Map<string, PackFamily>();

  for (const target of targets) {
    const sheetTargetId = target.spritesheet?.sheetTargetId;
    if (!sheetTargetId) {
      continue;
    }

    const family = families.get(sheetTargetId) ?? {
      id: sheetTargetId,
      sheets: [],
      frames: [],
    };

    if (target.spritesheet?.isSheet === true) {
      family.sheets.push(target);
    } else {
      family.frames.push(target);
    }

    families.set(sheetTargetId, family);
  }

  return families;
}

async function enforceSpritesheetFamilyInvariants(params: {
  family: PackFamily;
  imagesDir: string;
  addIssue: (issue: PackInvariantIssue) => void;
  continuityMetricsByAnimation: NonNullable<
    PackInvariantMetrics["spritesheetContinuityByAnimation"]
  >;
  runtimeTargetIds: Set<string>;
}): Promise<void> {
  const { family } = params;
  const sheetTargets = family.sheets;
  const frameTargets = family.frames;

  if (sheetTargets.length === 0 && frameTargets.length > 0) {
    params.addIssue({
      level: "error",
      code: "spritesheet_missing_sheet_target",
      message: `Spritesheet family "${family.id}" has frame targets but no sheet target.`,
      targetIds: frameTargets.map((target) => target.id),
    });
    return;
  }

  if (sheetTargets.length > 1) {
    params.addIssue({
      level: "error",
      code: "spritesheet_multiple_sheet_targets",
      message: `Spritesheet family "${family.id}" has multiple sheet targets: ${sheetTargets
        .map((target) => target.id)
        .join(", ")}.`,
      targetIds: sheetTargets.map((target) => target.id),
    });
  }

  const sheetTarget = sheetTargets[0] as PlannedTarget | undefined;
  if (!sheetTarget) {
    return;
  }

  if (sheetTarget.id !== family.id) {
    params.addIssue({
      level: "error",
      code: "spritesheet_sheet_target_id_mismatch",
      message: `Spritesheet sheet target "${sheetTarget.id}" does not match family id "${family.id}".`,
      targetIds: [sheetTarget.id, ...frameTargets.map((target) => target.id)],
    });
  }

  const sheetTargetId = sheetTarget.id;
  const expectedAtlasGroup = normalizeAtlasGroup(sheetTarget.atlasGroup);
  const mismatchedFrames = frameTargets.filter(
    (frame) => normalizeAtlasGroup(frame.atlasGroup) !== expectedAtlasGroup,
  );
  if (mismatchedFrames.length > 0) {
    params.addIssue({
      level: "error",
      code: "spritesheet_atlas_group_mismatch",
      message: `Spritesheet family "${family.id}" has frame targets outside atlas group "${expectedAtlasGroup ?? "(none)"}".`,
      targetIds: [sheetTargetId, ...mismatchedFrames.map((frame) => frame.id)],
    });
  }

  const expectedAnimationCounts = new Map<string, number>(
    (sheetTarget.spritesheet?.animations ?? []).map((animation) => [
      animation.name,
      animation.count,
    ]),
  );
  const framesByAnimation = new Map<string, PlannedTarget[]>();
  for (const frame of frameTargets) {
    const animationName = frame.spritesheet?.animationName;
    if (!animationName) {
      params.addIssue({
        level: "error",
        code: "spritesheet_frame_missing_animation_name",
        message: `Frame target "${frame.id}" in family "${family.id}" is missing spritesheet.animationName.`,
        targetIds: [sheetTargetId, frame.id],
      });
      continue;
    }

    const list = framesByAnimation.get(animationName) ?? [];
    list.push(frame);
    framesByAnimation.set(animationName, list);
  }

  for (const [animationName, expectedCount] of expectedAnimationCounts) {
    const actualCount = framesByAnimation.get(animationName)?.length ?? 0;
    if (actualCount !== expectedCount) {
      params.addIssue({
        level: "error",
        code: "spritesheet_frame_count_mismatch",
        message: `Spritesheet animation "${animationName}" in family "${family.id}" expected ${expectedCount} frame(s) but found ${actualCount}.`,
        targetIds: [
          sheetTargetId,
          ...(framesByAnimation.get(animationName) ?? []).map((frame) => frame.id),
        ],
      });
    }
  }

  for (const [animationName, frames] of framesByAnimation) {
    if (!expectedAnimationCounts.has(animationName)) {
      params.addIssue({
        level: "error",
        code: "spritesheet_unexpected_animation_frames",
        message: `Spritesheet family "${family.id}" contains frames for unexpected animation "${animationName}".`,
        targetIds: [sheetTargetId, ...frames.map((frame) => frame.id)],
      });
    }
  }

  const inspectedFrames = await inspectSpritesheetFrames({
    frames: frameTargets,
    imagesDir: params.imagesDir,
    sheetTargetId,
    addIssue: params.addIssue,
    runtimeTargetIds: params.runtimeTargetIds,
  });
  if (inspectedFrames.size === 0) {
    return;
  }

  for (const [animationName, frames] of framesByAnimation) {
    const orderedFrames = [...frames].sort((left, right) => {
      const leftIndex = left.spritesheet?.frameIndex ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = right.spritesheet?.frameIndex ?? Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }
      return left.id.localeCompare(right.id);
    });

    if (orderedFrames.length < 2) {
      continue;
    }

    let comparisons = 0;
    let maxSilhouetteDrift = 0;
    let maxAnchorDrift = 0;

    for (let index = 1; index < orderedFrames.length; index += 1) {
      const previous = inspectedFrames.get(orderedFrames[index - 1].id);
      const current = inspectedFrames.get(orderedFrames[index].id);
      if (!previous || !current) {
        continue;
      }

      if (previous.silhouette && current.silhouette) {
        const silhouetteDrift = computeSilhouetteDrift(previous, current);
        maxSilhouetteDrift = Math.max(maxSilhouetteDrift, silhouetteDrift);
      }

      const anchorDrift = computeAnchorDrift(previous, current);
      maxAnchorDrift = Math.max(maxAnchorDrift, anchorDrift);
      comparisons += 1;
    }

    if (comparisons === 0) {
      continue;
    }

    const continuityKey = `${sheetTargetId}:${animationName}`;
    params.continuityMetricsByAnimation[continuityKey] = {
      comparisons,
      maxSilhouetteDrift: Number(maxSilhouetteDrift.toFixed(6)),
      maxAnchorDrift: Number(maxAnchorDrift.toFixed(6)),
    };

    const silhouetteThreshold = resolveMaxDriftThreshold([
      sheetTarget.spritesheetSilhouetteDriftMax,
      ...orderedFrames.map((frame) => frame.spritesheetSilhouetteDriftMax),
    ]);
    if (typeof silhouetteThreshold === "number" && maxSilhouetteDrift > silhouetteThreshold) {
      params.addIssue({
        level: "error",
        code: "spritesheet_silhouette_drift_exceeded",
        message: `Spritesheet animation "${animationName}" in family "${family.id}" exceeded silhouette drift threshold (${maxSilhouetteDrift.toFixed(
          4,
        )} > ${silhouetteThreshold.toFixed(4)}).`,
        targetIds: [sheetTargetId, ...orderedFrames.map((frame) => frame.id)],
        metrics: {
          measured: Number(maxSilhouetteDrift.toFixed(6)),
          threshold: Number(silhouetteThreshold.toFixed(6)),
        },
      });
    }

    const anchorThreshold = resolveMaxDriftThreshold([
      sheetTarget.spritesheetAnchorDriftMax,
      ...orderedFrames.map((frame) => frame.spritesheetAnchorDriftMax),
    ]);
    if (typeof anchorThreshold === "number" && maxAnchorDrift > anchorThreshold) {
      params.addIssue({
        level: "error",
        code: "spritesheet_anchor_drift_exceeded",
        message: `Spritesheet animation "${animationName}" in family "${family.id}" exceeded anchor drift threshold (${maxAnchorDrift.toFixed(
          4,
        )} > ${anchorThreshold.toFixed(4)}).`,
        targetIds: [sheetTargetId, ...orderedFrames.map((frame) => frame.id)],
        metrics: {
          measured: Number(maxAnchorDrift.toFixed(6)),
          threshold: Number(anchorThreshold.toFixed(6)),
        },
      });
    }
  }
}

async function inspectSpritesheetFrames(params: {
  frames: PlannedTarget[];
  imagesDir: string;
  sheetTargetId: string;
  addIssue: (issue: PackInvariantIssue) => void;
  runtimeTargetIds: Set<string>;
}): Promise<Map<string, FrameInspection>> {
  const inspected = new Map<string, FrameInspection>();

  for (const frame of params.frames) {
    let frameOut: string;
    try {
      frameOut = normalizeTargetOutPath(frame.out);
    } catch (error) {
      params.addIssue({
        level: "warning",
        code: "spritesheet_frame_path_invalid",
        message: `Unable to normalize frame output path for "${frame.id}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        targetIds: [params.sheetTargetId, frame.id],
      });
      continue;
    }

    const framePath = resolvePathWithinDir(
      params.imagesDir,
      frameOut,
      `spritesheet frame output for "${frame.id}"`,
    );

    try {
      const raw = await sharp(framePath, { failOn: "none" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const silhouette = extractAlphaSilhouette(
        raw.data,
        raw.info.channels,
        raw.info.width,
        raw.info.height,
      );
      inspected.set(frame.id, {
        frame,
        width: raw.info.width,
        height: raw.info.height,
        silhouette,
      });
    } catch (error) {
      params.addIssue({
        level: "warning",
        code: "spritesheet_frame_image_unavailable",
        message: `Unable to inspect frame image for "${frame.id}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        targetIds: [params.sheetTargetId, frame.id].filter((targetId) =>
          params.runtimeTargetIds.has(targetId),
        ),
      });
    }
  }

  return inspected;
}

function extractAlphaSilhouette(
  raw: Buffer,
  channels: number,
  width: number,
  height: number,
): AlphaSilhouette | null {
  if (channels < 4 || width <= 0 || height <= 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let area = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * channels;
      const alpha = raw[index + 3];
      if (alpha <= 0) {
        continue;
      }

      area += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (area === 0) {
    return null;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    area,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

function computeSilhouetteDrift(left: FrameInspection, right: FrameInspection): number {
  if (!left.silhouette || !right.silhouette) {
    return 0;
  }

  const diagonal = Math.max(
    Math.hypot(left.width, left.height),
    Math.hypot(right.width, right.height),
    1,
  );
  const centerDelta =
    Math.hypot(
      left.silhouette.centerX - right.silhouette.centerX,
      left.silhouette.centerY - right.silhouette.centerY,
    ) / diagonal;
  const areaDelta =
    Math.abs(left.silhouette.area - right.silhouette.area) /
    Math.max(left.silhouette.area, right.silhouette.area, 1);

  return (centerDelta + areaDelta) / 2;
}

function computeAnchorDrift(left: FrameInspection, right: FrameInspection): number {
  if (!left.silhouette || !right.silhouette) {
    return 0;
  }

  const leftAnchor = resolveAnchorPoint(left);
  const rightAnchor = resolveAnchorPoint(right);
  const diagonal = Math.max(
    Math.hypot(left.width, left.height),
    Math.hypot(right.width, right.height),
    1,
  );

  const leftVectorX = leftAnchor.x - left.silhouette.centerX;
  const leftVectorY = leftAnchor.y - left.silhouette.centerY;
  const rightVectorX = rightAnchor.x - right.silhouette.centerX;
  const rightVectorY = rightAnchor.y - right.silhouette.centerY;

  return Math.hypot(leftVectorX - rightVectorX, leftVectorY - rightVectorY) / diagonal;
}

function resolveAnchorPoint(frame: FrameInspection): { x: number; y: number } {
  const pivot = frame.frame.spritesheet?.pivot;
  const normalizedPivot = {
    x: clamp01(pivot?.x ?? 0.5),
    y: clamp01(pivot?.y ?? 0.5),
  };

  return {
    x: normalizedPivot.x * frame.width,
    y: normalizedPivot.y * frame.height,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function resolveMaxDriftThreshold(values: (number | undefined)[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function enforceTextureBudgetByProfile(params: {
  runtimeTargets: PlannedTarget[];
  items: AcceptanceItemLike[];
  addIssue: (issue: PackInvariantIssue) => void;
}): NonNullable<PackInvariantMetrics["textureBudgetMBByProfile"]> {
  const metricsByProfile: NonNullable<PackInvariantMetrics["textureBudgetMBByProfile"]> = {};
  const itemByTargetId = new Map(params.items.map((item) => [item.targetId, item]));

  const profileStats = new Map<
    string,
    {
      targetIds: Set<string>;
      estimatedBytes: number;
      budgetMB?: number;
      hasMismatchedBudget: boolean;
    }
  >();

  for (const target of params.runtimeTargets) {
    const profileId = target.evaluationProfileId ?? "__default__";
    const entry = profileStats.get(profileId) ?? {
      targetIds: new Set<string>(),
      estimatedBytes: 0,
      budgetMB: undefined,
      hasMismatchedBudget: false,
    };

    entry.targetIds.add(target.id);

    const item = itemByTargetId.get(target.id);
    const width = item?.width;
    const height = item?.height;
    if (typeof width === "number" && typeof height === "number") {
      entry.estimatedBytes += width * height * 4;
    }

    const budgetMB = target.packTextureBudgetMB;
    if (typeof budgetMB === "number") {
      if (typeof entry.budgetMB === "number" && Math.abs(entry.budgetMB - budgetMB) > 1e-6) {
        entry.hasMismatchedBudget = true;
      }
      entry.budgetMB = Math.min(entry.budgetMB ?? budgetMB, budgetMB);
    }

    profileStats.set(profileId, entry);
  }

  for (const [profileId, entry] of profileStats) {
    const estimatedMB = entry.estimatedBytes / BYTES_PER_MEGABYTE;
    metricsByProfile[profileId] = {
      estimatedMB: Number(estimatedMB.toFixed(6)),
      ...(typeof entry.budgetMB === "number"
        ? { budgetMB: Number(entry.budgetMB.toFixed(6)) }
        : {}),
      targetCount: entry.targetIds.size,
    };

    if (entry.hasMismatchedBudget) {
      params.addIssue({
        level: "warning",
        code: "pack_texture_budget_profile_mismatch",
        message: `Evaluation profile "${profileId}" resolved conflicting packTextureBudgetMB values across targets.`,
        targetIds: Array.from(entry.targetIds),
        evaluationProfileId: profileId,
      });
    }

    if (typeof entry.budgetMB === "number" && estimatedMB > entry.budgetMB) {
      params.addIssue({
        level: "error",
        code: "pack_texture_budget_exceeded",
        message: `Evaluation profile "${profileId}" estimated texture memory ${estimatedMB.toFixed(
          2,
        )}MB exceeds configured budget ${entry.budgetMB.toFixed(2)}MB.`,
        targetIds: Array.from(entry.targetIds),
        evaluationProfileId: profileId,
        metrics: {
          estimatedMB: Number(estimatedMB.toFixed(6)),
          budgetMB: Number(entry.budgetMB.toFixed(6)),
        },
      });
    }
  }

  return metricsByProfile;
}

function normalizeAtlasGroup(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
