#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const JOBS_DIR = "assets/imagegen/jobs";
const RAW_DIR = "assets/imagegen/raw";
const PROCESSED_DIR = "assets/imagegen/processed";
const PUBLIC_IMAGES_DIR = "public/assets/images";
const ATLASES_DIR = "public/assets/atlases";
const BACKGROUNDS_DIR = "public/assets/backgrounds";

function usage() {
  process.stdout.write(`game-asset-pipeline

Usage:
  game-asset-pipeline <command> [options]

Commands:
  plan                           Build jobs from assets/imagegen/manifest.json
  generate --mode=<draft|final>  Run image generation for planned jobs
  postprocess                    Validate/copy generated assets into runtime paths
  atlas                          Build atlas outputs (TexturePacker if available)
  preview                        Run dev server and print asset lab URL

Common options:
  --manifest=<path>              Override manifest path
\n`);
}

function readArgValue(argv, name, fallback = "") {
  const prefix = `--${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function parseExpectedSize(size) {
  if (typeof size !== "string") return null;
  const match = /^(\d+)x(\d+)$/.exec(size.trim());
  if (!match) return null;
  return {
    width: Number.parseInt(match[1], 10),
    height: Number.parseInt(match[2], 10),
  };
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid or missing ${label}`);
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveManifestPath(argv) {
  const fromArg = readArgValue(argv, "manifest", "");
  if (fromArg) return path.resolve(fromArg);
  return path.resolve("assets/imagegen/manifest.json");
}

function resolveImageGenPath() {
  if (process.env.IMAGE_GEN && process.env.IMAGE_GEN.trim()) {
    return path.resolve(process.env.IMAGE_GEN.trim());
  }
  const codexHome =
    process.env.CODEX_HOME ?? path.join(process.env.HOME ?? "", ".codex");
  return path.resolve(codexHome, "skills/imagegen/scripts/image_gen.py");
}

function hasCommand(command) {
  const run = spawnSync(command, ["--version"], { stdio: "ignore" });
  return run.status === 0;
}

function normalizeTarget(target, index) {
  assertString(target.id, `targets[${index}].id`);
  assertString(target.kind, `targets[${index}].kind`);
  assertString(target.out, `targets[${index}].out`);
  assertString(
    target.promptSpec?.primary,
    `targets[${index}].promptSpec.primary`,
  );

  const policy = target.generationPolicy ?? {};
  const runtime = target.runtimeSpec ?? {};

  return {
    id: target.id,
    kind: target.kind,
    atlasGroup: target.atlasGroup ?? null,
    out: target.out,
    promptSpec: {
      useCase: target.promptSpec.useCase ?? "stylized-concept",
      primary: target.promptSpec.primary,
      scene: target.promptSpec.scene ?? "",
      subject: target.promptSpec.subject ?? "",
      style: target.promptSpec.style ?? "",
      composition: target.promptSpec.composition ?? "",
      lighting: target.promptSpec.lighting ?? "",
      palette: target.promptSpec.palette ?? "",
      materials: target.promptSpec.materials ?? "",
      constraints: target.promptSpec.constraints ?? "",
      negative: target.promptSpec.negative ?? "",
    },
    generationPolicy: {
      size: policy.size ?? "1024x1024",
      background:
        policy.background ??
        (runtime.alphaRequired === true ? "transparent" : "opaque"),
      outputFormat: policy.outputFormat ?? "png",
      draftQuality: policy.draftQuality ?? "low",
      finalQuality: policy.finalQuality ?? "high",
    },
    runtimeSpec: {
      alphaRequired: runtime.alphaRequired === true,
      previewWidth:
        Number.isFinite(runtime.previewWidth) && runtime.previewWidth > 0
          ? runtime.previewWidth
          : 96,
      previewHeight:
        Number.isFinite(runtime.previewHeight) && runtime.previewHeight > 0
          ? runtime.previewHeight
          : 96,
    },
  };
}

function toJob(target, quality) {
  const prompt = target.promptSpec;
  const policy = target.generationPolicy;

  return {
    prompt: prompt.primary,
    out: target.out,
    use_case: prompt.useCase,
    scene: prompt.scene,
    subject: prompt.subject,
    style: prompt.style,
    composition: prompt.composition,
    lighting: prompt.lighting,
    palette: prompt.palette,
    materials: prompt.materials,
    constraints: prompt.constraints,
    negative: prompt.negative,
    size: policy.size,
    quality,
    background: policy.background,
    output_format: policy.outputFormat,
  };
}

async function writeJsonl(filePath, rows) {
  const content = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, content + (content ? "\n" : ""), "utf8");
}

function parseJsonFile(raw, filePath) {
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new Error(`Failed to parse JSON in ${filePath}: ${cause.message}`);
  }
}

async function planCommand(argv) {
  const manifestPath = resolveManifestPath(argv);
  const jobsDir = path.resolve(JOBS_DIR);
  const rawDir = path.resolve(RAW_DIR);
  const processedDir = path.resolve(PROCESSED_DIR);

  const manifestRaw = await fs.readFile(manifestPath, "utf8");
  const manifest = parseJsonFile(manifestRaw, manifestPath);
  const targets = Array.isArray(manifest.targets) ? manifest.targets : [];
  if (targets.length === 0) {
    throw new Error(`Manifest has no targets: ${manifestPath}`);
  }

  const normalizedTargets = targets.map((target, index) =>
    normalizeTarget(target, index),
  );

  await fs.mkdir(jobsDir, { recursive: true });
  await fs.mkdir(rawDir, { recursive: true });
  await fs.mkdir(processedDir, { recursive: true });

  const draftJobs = normalizedTargets.map((target) =>
    toJob(target, target.generationPolicy.draftQuality),
  );
  const finalJobs = normalizedTargets.map((target) =>
    toJob(target, target.generationPolicy.finalQuality),
  );

  await writeJsonl(path.join(jobsDir, "draft.jsonl"), draftJobs);
  await writeJsonl(path.join(jobsDir, "final.jsonl"), finalJobs);

  await fs.writeFile(
    path.join(jobsDir, "targets-index.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        manifestPath,
        targets: normalizedTargets,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  process.stdout.write(
    `Planned ${normalizedTargets.length} targets -> assets/imagegen/jobs/{draft,final}.jsonl\n`,
  );
}

async function buildFilteredJobInput(mode, idsCsv) {
  const jobsDir = path.resolve(JOBS_DIR);
  const inputPath = path.join(jobsDir, `${mode}.jsonl`);
  const raw = await fs.readFile(inputPath, "utf8");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseJsonFile(line, inputPath));

  if (!idsCsv) {
    return { inputPath, tempPath: null };
  }

  const ids = new Set(
    idsCsv
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (ids.size === 0) {
    return { inputPath, tempPath: null };
  }

  const indexPath = path.join(jobsDir, "targets-index.json");
  const indexRaw = await fs.readFile(indexPath, "utf8");
  const index = parseJsonFile(indexRaw, indexPath);
  const idToOut = new Map(
    (index.targets ?? []).map((target) => [String(target.id), String(target.out)]),
  );
  const allowedOut = new Set(
    Array.from(ids)
      .map((id) => idToOut.get(id))
      .filter(Boolean),
  );

  const filtered = lines.filter((row) => allowedOut.has(row.out));
  if (filtered.length === 0) {
    throw new Error(
      "No jobs matched --ids. Check assets/imagegen/jobs/targets-index.json",
    );
  }

  const tempPath = path.join(jobsDir, `.run-${mode}.jsonl`);
  await writeJsonl(tempPath, filtered);
  return { inputPath: tempPath, tempPath };
}

async function generateCommand(argv) {
  const mode = readArgValue(argv, "mode", "draft");
  if (mode !== "draft" && mode !== "final") {
    throw new Error("Unknown --mode. Expected draft or final.");
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY. Set it locally before generation.");
  }

  const imageGenPath = resolveImageGenPath();
  await fs.access(imageGenPath).catch(() => {
    throw new Error(
      `image_gen.py not found at ${imageGenPath}. Set IMAGE_GEN explicitly.`,
    );
  });

  const idsCsv = readArgValue(argv, "ids", "");
  const concurrency = readArgValue(argv, "concurrency", "4");
  const maxAttempts = readArgValue(argv, "max-attempts", "3");
  const jobs = await buildFilteredJobInput(mode, idsCsv);

  const outDir = path.resolve(RAW_DIR);
  await fs.mkdir(outDir, { recursive: true });

  const args = [
    imageGenPath,
    "generate-batch",
    "--input",
    jobs.inputPath,
    "--out-dir",
    outDir,
    "--concurrency",
    concurrency,
    "--max-attempts",
    maxAttempts,
  ];

  process.stdout.write(`Running image generation: python3 ${args.join(" ")}\n`);
  const run = spawnSync("python3", args, { stdio: "inherit" });

  if (jobs.tempPath) {
    await fs.rm(jobs.tempPath, { force: true });
  }

  if (run.status !== 0) {
    const code = run.status ?? 1;
    throw new Error(`image_gen.py exited with code ${code}`);
  }
}

function readPngMeta(buffer) {
  if (buffer.length < 33) return null;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer[25];

  let hasTRNS = false;
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    if (offset + 12 + chunkLength > buffer.length) break;
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "tRNS") hasTRNS = true;
    offset += 12 + chunkLength;
  }

  return {
    width,
    height,
    hasAlpha: colorType === 4 || colorType === 6 || hasTRNS,
  };
}

async function postprocessCommand(argv) {
  const manifestPath = resolveManifestPath(argv);
  const rawDir = path.resolve(RAW_DIR);
  const processedDir = path.resolve(PROCESSED_DIR);
  const publicImagesDir = path.resolve(PUBLIC_IMAGES_DIR);

  const manifestRaw = await fs.readFile(manifestPath, "utf8");
  const manifest = parseJsonFile(manifestRaw, manifestPath);
  const targets = Array.isArray(manifest.targets) ? manifest.targets : [];

  if (targets.length === 0) {
    throw new Error("No targets found in manifest.");
  }

  await fs.mkdir(processedDir, { recursive: true });
  await fs.mkdir(publicImagesDir, { recursive: true });

  const errors = [];
  const catalog = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    process.stdout.write(`Processing ${i + 1}/${targets.length}: ${target.out}\n`);
    const src = path.join(rawDir, target.out);
    if (!(await exists(src))) {
      errors.push(`Missing generated asset: ${src}`);
      continue;
    }

    const processedDest = path.join(processedDir, target.out);
    const publicDest = path.join(publicImagesDir, target.out);

    await fs.copyFile(src, processedDest);
    await fs.copyFile(src, publicDest);

    const ext = path.extname(target.out).toLowerCase();
    if (ext === ".png") {
      const buffer = await fs.readFile(src);
      const meta = readPngMeta(buffer);
      if (!meta) {
        errors.push(`Unable to parse PNG metadata: ${target.out}`);
      } else {
        const expected = parseExpectedSize(target.generationPolicy?.size ?? "");
        if (
          expected &&
          (meta.width !== expected.width || meta.height !== expected.height)
        ) {
          errors.push(
            `Unexpected size for ${target.id}: got ${meta.width}x${meta.height}, expected ${expected.width}x${expected.height}`,
          );
        }

        if (target.runtimeSpec?.alphaRequired === true && !meta.hasAlpha) {
          errors.push(`Alpha required but missing for ${target.id} (${target.out})`);
        }
      }
    }

    catalog.push({
      id: target.id,
      kind: target.kind,
      atlasGroup: target.atlasGroup ?? null,
      out: target.out,
      url: `/assets/images/${target.out}`,
      alphaRequired: target.runtimeSpec?.alphaRequired === true,
      previewWidth: target.runtimeSpec?.previewWidth ?? 96,
      previewHeight: target.runtimeSpec?.previewHeight ?? 96,
    });
  }

  await fs.writeFile(
    path.join(processedDir, "catalog.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        items: catalog,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  process.stdout.write(
    "Postprocess complete. Catalog written to assets/imagegen/processed/catalog.json\n",
  );
}

async function atlasCommand(argv) {
  const manifestPath = resolveManifestPath(argv);
  const catalogPath = path.resolve(PROCESSED_DIR, "catalog.json");
  const processedDir = path.resolve(PROCESSED_DIR);
  const atlasDir = path.resolve(ATLASES_DIR);
  const backgroundDir = path.resolve(BACKGROUNDS_DIR);

  const manifest = parseJsonFile(await fs.readFile(manifestPath, "utf8"), manifestPath);
  const catalog = parseJsonFile(await fs.readFile(catalogPath, "utf8"), catalogPath);
  const targets = Array.isArray(manifest.targets) ? manifest.targets : [];
  const items = Array.isArray(catalog.items) ? catalog.items : [];

  await fs.mkdir(atlasDir, { recursive: true });
  await fs.mkdir(backgroundDir, { recursive: true });

  const targetById = new Map(targets.map((target) => [target.id, target]));
  const groups = new Map();
  for (const item of items) {
    const groupId = item.atlasGroup ?? "";
    if (!groupId) continue;
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push(item);
  }

  let packer = "none";
  const atlasBundles = [];

  if (hasCommand("texturepacker")) {
    packer = "texturepacker";

    for (const [groupId, groupItems] of groups) {
      const inputPaths = groupItems.map((item) =>
        path.join(processedDir, item.out),
      );
      const sheetPath = path.join(atlasDir, `${groupId}.png`);
      const dataPath = path.join(atlasDir, `${groupId}.json`);

      const run = spawnSync(
        "texturepacker",
        [
          "--format",
          "phaser-json-hash",
          "--sheet",
          sheetPath,
          "--data",
          dataPath,
          ...inputPaths,
        ],
        { stdio: "inherit" },
      );

      if (run.status !== 0) {
        throw new Error(`TexturePacker failed for atlas group: ${groupId}`);
      }

      atlasBundles.push({
        id: groupId,
        imageUrl: `/assets/atlases/${groupId}.png`,
        jsonUrl: `/assets/atlases/${groupId}.json`,
        targets: groupItems.map((item) => item.id),
      });
    }
  }

  for (const item of items) {
    const target = targetById.get(item.id);
    if (target?.kind !== "background") continue;
    await fs.copyFile(
      path.join(processedDir, item.out),
      path.join(backgroundDir, item.out),
    );
  }

  const previewManifest = {
    generatedAt: new Date().toISOString(),
    packer,
    atlasBundles,
    items: items.map((item) => ({
      id: item.id,
      kind: item.kind,
      url: item.url,
      atlasGroup: item.atlasGroup,
      alphaRequired: item.alphaRequired,
      previewWidth: item.previewWidth,
      previewHeight: item.previewHeight,
    })),
  };

  await fs.writeFile(
    path.join(atlasDir, "manifest.json"),
    JSON.stringify(previewManifest, null, 2) + "\n",
    "utf8",
  );

  process.stdout.write(
    "Atlas step complete. Manifest written to public/assets/atlases/manifest.json\n",
  );
}

async function previewCommand(argv) {
  const host = readArgValue(argv, "host", "127.0.0.1");
  const port = readArgValue(argv, "port", "4173");
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  process.stdout.write(`Asset preview URL: http://${host}:${port}/?assetlab=1\n`);

  const child = spawn(
    npmCmd,
    ["run", "dev", "--", "--host", host, "--port", port],
    { stdio: "inherit" },
  );

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const rest = argv.slice(1);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "plan") {
    await planCommand(rest);
    return;
  }

  if (command === "generate") {
    await generateCommand(rest);
    return;
  }

  if (command === "postprocess") {
    await postprocessCommand(rest);
    return;
  }

  if (command === "atlas") {
    await atlasCommand(rest);
    return;
  }

  if (command === "preview") {
    await previewCommand(rest);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
