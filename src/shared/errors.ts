export interface CliErrorOptions {
  code?: string;
  exitCode?: number;
  cause?: unknown;
}

export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  declare readonly cause?: unknown;

  constructor(message: string, options: CliErrorOptions = {}) {
    super(message);
    this.name = "CliError";
    this.code = options.code ?? "cli_error";
    this.exitCode = options.exitCode ?? 1;
    this.cause = options.cause;
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function getErrorExitCode(error: unknown, fallback = 1): number {
  if (error instanceof CliError) {
    return error.exitCode;
  }
  return fallback;
}
