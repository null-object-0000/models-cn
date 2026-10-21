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

/**
 * 只有完全没有能力区才允许 null；存在区块时，三个字段必须都是布尔值
 * （列了的来自真实解析，没列的按白名单判 false，见 capabilitiesEvidence）。
 */
export function assertCapabilitiesProvenance(
  model: Pick<
    ModelData,
    "id" | "capabilities" | "capabilitiesSource" | "capabilitiesEvidence"
  >,
): void {
  const present = model.capabilitiesEvidence?.sectionPresent;
  if (model.capabilitiesSource === "not-documented") {
    if (model.capabilities !== null || present !== false)
      throw new Error(
        `Zhipu ${model.id}: invalid not-documented capabilities evidence`,
      );
    return;
  }
  if (model.capabilitiesSource !== "docs" || present !== true)
    throw new Error(`Zhipu ${model.id}: missing capability docs evidence`);
  for (const key of ["thinking", "toolCalls", "jsonOutput"] as const) {
    if (typeof model.capabilities?.[key] !== "boolean")
      throw new Error(`Zhipu ${model.id}: missing capability ${key}`);
  }
}

export function zhipuHealth(models: ModelData[], now: Date): ProviderHealth {
  for (const model of models) {
    assertCreatedAtProvenance(model);
    assertCapabilitiesProvenance(model);
  }
  const warnings: NonNullable<ProviderHealth["warnings"]> = [];
  for (const field of ["createdAt", "capabilities"] as const) {
    const modelIds = models
      .filter((model) => model[`${field}Source`] === "not-documented")
      .map((model) => model.id);
    if (modelIds.length)
      warnings.push({ code: `${field}-not-documented`, modelIds });
  }
  return { ...healthyHealth(now), ...(warnings.length ? { warnings } : {}) };
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
