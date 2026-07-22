import type { ProviderHealth } from "./types.js";

export function healthyHealth(now = new Date()): ProviderHealth {
  const timestamp = now.toISOString();
  return {
    status: "healthy",
    lastSuccessfulAt: timestamp,
    lastAttemptAt: timestamp,
    consecutiveFailures: 0,
  };
}

export function failedHealth(
  previous: ProviderHealth,
  error: unknown,
  now = new Date(),
): ProviderHealth {
  return {
    status: "error",
    lastSuccessfulAt: previous.lastSuccessfulAt,
    lastAttemptAt: now.toISOString(),
    consecutiveFailures: previous.consecutiveFailures + 1,
    message: error instanceof Error ? error.message : String(error),
  };
}
