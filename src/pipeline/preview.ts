import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

export interface PreviewPipelineOptions {
  host: string;
  port: number;
  starterDir?: string;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function runPreviewPipeline(
  options: PreviewPipelineOptions,
): Promise<number> {
  const host = options.host;
  const port = options.port;
  const starterDir = path.resolve(
    options.starterDir ?? path.join(process.cwd(), "examples", "starter-phaser"),
  );
  const packageJsonPath = path.join(starterDir, "package.json");

  process.stdout.write(`Preview URL: http://${host}:${port}/\n`);

  if (!(await exists(packageJsonPath))) {
    process.stdout.write(
      `Starter app not found at ${starterDir}. Create it or pass --starter-dir.\n`,
    );
    return 0;
  }

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(
      npmCmd,
      ["run", "dev", "--", "--host", host, "--port", String(port)],
      { cwd: starterDir, stdio: "inherit" },
    );

    child.on("error", (error) => reject(error));
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

