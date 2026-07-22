import type { CalibrationModel, Currency, Model, Provider } from "../types.js";

export const numberFormatter = new Intl.NumberFormat("zh-CN");

export function modelKey(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

export function modelDomId(providerId: string, modelId: string): string {
  return `model-${providerId}-${modelId}`;
}

export function modelHash(providerId: string, modelId: string): string {
  return `${encodeURIComponent(providerId)}/${encodeURIComponent(modelId)}`;
}

export function providerName(provider: Provider): string {
  return provider.displayNames?.["zh-CN"] ?? provider.name;
}

export function formatPrice(value: number, currency: Currency): string {
  const symbol = currency === "CNY" ? "¥" : "$";
  return `${symbol}${value.toLocaleString("zh-CN", { maximumFractionDigits: 6 })}`;
}

export function compactTokens(value?: number): string {
  if (value === undefined) return "未公开";
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}K`;
  }
  return numberFormatter.format(value);
}

export function capabilityLabels(
  capabilities: Record<string, unknown>,
): string[] {
  const labels: string[] = [];
  if (capabilities.thinking) labels.push("思考");
  if (capabilities.dynamicTools) labels.push("动态工具");
  if (capabilities.toolCalls) labels.push("工具调用");
  if (capabilities.jsonOutput) labels.push("JSON");
  if (capabilities.chatPrefixCompletion) labels.push("前缀续写");
  const inputs = capabilities.inputModalities as string[] | undefined;
  if (inputs?.length) labels.push(inputs.join(" / "));
  const efforts = capabilities.reasoningEfforts as string[] | undefined;
  if (efforts?.length) labels.push(`effort: ${efforts.join(" / ")}`);
  return labels;
}

export function modelReleaseDate(
  model: Model,
  calibration: CalibrationModel | undefined,
): string | undefined {
  if (model.createdAt) return model.createdAt;
  const reference = calibration?.checks.find(
    (check) => check.field === "createdAt",
  )?.reference;
  return typeof reference === "string" ? reference : undefined;
}

export function compareModelsByReleaseDate(
  left: { model: Model; calibration: CalibrationModel | undefined },
  right: { model: Model; calibration: CalibrationModel | undefined },
): number {
  const leftDate = Date.parse(
    modelReleaseDate(left.model, left.calibration) ?? "",
  );
  const rightDate = Date.parse(
    modelReleaseDate(right.model, right.calibration) ?? "",
  );
  const leftTimestamp = Number.isNaN(leftDate)
    ? Number.NEGATIVE_INFINITY
    : leftDate;
  const rightTimestamp = Number.isNaN(rightDate)
    ? Number.NEGATIVE_INFINITY
    : rightDate;
  return (
    rightTimestamp - leftTimestamp ||
    left.model.id.localeCompare(right.model.id)
  );
}
