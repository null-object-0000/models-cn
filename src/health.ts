import type { ModelData, ProviderHealth } from "./types.js";

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
    ...(previous.warnings ? { warnings: previous.warnings } : {}),
    message: error instanceof Error ? error.message : String(error),
  };
}

/** 缺日期必须有「未出现在发布页 + 官方价格」证据，不能用来源标签掩盖解析失败。 */
export function assertCreatedAtProvenance(
  model: Pick<
    ModelData,
    "id" | "createdAt" | "createdAtSource" | "createdAtEvidence" | "prices"
  >,
): void {
  const mentioned = model.createdAtEvidence?.releaseNotesMentioned;
  if (model.createdAtSource === "not-documented") {
    if (
      model.createdAt !== null ||
      mentioned !== false ||
      !model.prices.length ||
      !model.prices.every(
        (price) =>
          price.sourceUrl === "https://docs.z.ai/guides/overview/pricing" ||
          price.sourceUrl ===
            "https://docs.bigmodel.cn/cn/guide/start/pricing.md",
      )
    )
      throw new Error(
        `Zhipu ${model.id}: invalid not-documented createdAt evidence`,
      );
  } else if (
    model.createdAtSource !== "release-notes" ||
    mentioned !== true ||
    !model.createdAt ||
    !Number.isFinite(Date.parse(model.createdAt))
  ) {
    throw new Error(
      `Zhipu ${model.id}: missing createdAt / release-notes evidence (possible parsing failure)`,
    );
  }
}

export function zhipuHealth(models: ModelData[], now: Date): ProviderHealth {
  for (const model of models) assertCreatedAtProvenance(model);
  const modelIds = models
    .filter((model) => model.createdAtSource === "not-documented")
    .map((model) => model.id);
  return {
    ...healthyHealth(now),
    ...(modelIds.length
      ? { warnings: [{ code: "createdAt-not-documented" as const, modelIds }] }
      : {}),
  };
}

export function formatHealthWarnings(
  provider: string,
  health: ProviderHealth,
): string[] {
  return (health.warnings ?? []).map(
    (warning) =>
      `${provider}: ${warning.code} (${warning.modelIds.length}): ${warning.modelIds.join(", ")}`,
  );
}
