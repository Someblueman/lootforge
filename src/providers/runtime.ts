import path from "node:path";

export const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 60_000;

/** Maximum decoded image size (50 MB). */
export const MAX_DECODED_IMAGE_BYTES = 50 * 1024 * 1024;

const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\.0\.0\.1$/,
  /^::1$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
  /^fc00:/i,
  /^fe80:/i,
];

export function validateImageUrl(url: string, label: string): void {
  const parsed = new URL(url);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `SSRF protection: ${label} URL "${url}" targets a blocked address.`,
    );
  }

  for (const pattern of BLOCKED_HOSTNAME_PATTERNS) {
    if (pattern.test(parsed.hostname)) {
      throw new Error(
        `SSRF protection: ${label} URL "${url}" targets a blocked address.`,
      );
    }
  }
}

export class ProviderRequestTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms.`);
    this.name = "ProviderRequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  return fallback;
}

export function normalizeNonNegativeInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  return fallback;
}

export function toOptionalPositiveInteger(
  value: number | undefined,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.round(value);
}

export function toOptionalNonNegativeInteger(
  value: number | undefined,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.round(value);
}

export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const normalizedTimeoutMs = normalizePositiveInteger(
    timeoutMs,
    DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), normalizedTimeoutMs);

  try {
    return await fetchImpl(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new ProviderRequestTimeoutError(normalizedTimeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

export function parseTimeoutMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

export function withCandidateSuffix(
  filePath: string,
  candidateNumber: number,
): string {
  const ext = path.extname(filePath);
  const base = filePath.slice(0, filePath.length - ext.length);
  return `${base}.candidate-${candidateNumber}${ext}`;
}
