export const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 60_000;

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

export function toOptionalPositiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.round(value);
}

export function toOptionalNonNegativeInteger(value: number | undefined): number | undefined {
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
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError"
  );
}
