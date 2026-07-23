import type {
  CalibrationModel,
  Currency,
  Model,
  Provider,
} from "../types.js";

export type VersionViewMode = "merged" | "separate";

export interface RegionModel {
  model: Model;
  provider: Provider;
  region: "cn" | "intl";
  calibration: CalibrationModel | undefined;
}

export interface MergedModel {
  id: string;
  name: string;
  cn: RegionModel | undefined;
  intl: RegionModel | undefined;
  mergeable: boolean;
  differences: string[];
}

export interface MergedGroup {
  id: string;
  name: string;
  displayName: string;
  merged: boolean;
  cn: Provider | undefined;
  intl: Provider | undefined;
  models: MergedModel[];
}

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

export function formatPriceRange(
  values: Array<number | undefined>,
  currency: Currency,
): string | undefined {
  const available = values.filter(
    (value): value is number => value !== undefined,
  );
  if (!available.length) return undefined;

  const minimum = Math.min(...available);
  const maximum = Math.max(...available);
  if (minimum === maximum) return formatPrice(minimum, currency);

  const symbol = currency === "CNY" ? "¥" : "$";
  const formatter = new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 6,
  });
  return `${symbol}${formatter.format(minimum)} - ${formatter.format(maximum)}`;
}

export function isPriceRange(
  values: Array<number | undefined>,
): boolean {
  const available = values.filter(
    (value): value is number => value !== undefined,
  );
  if (available.length < 2) return false;
  const minimum = Math.min(...available);
  const maximum = Math.max(...available);
  return minimum !== maximum;
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

function providerBaseId(provider: Provider): string {
  const match = provider.id.match(/^(.+)-(cn|intl)$/);
  return match?.[1] ?? provider.id;
}

function providerRegion(
  provider: Provider,
): "cn" | "intl" | "other" {
  if (provider.id.endsWith("-cn")) return "cn";
  if (provider.id.endsWith("-intl")) return "intl";
  return "other";
}

function stripRegionSuffix(name: string): string {
  return name
    .replace(/\s*国内版\s*/g, "")
    .replace(/\s*国际版\s*/g, "")
    .replace(/\s*China\s*/gi, "")
    .replace(/\s*International\s*/gi, "")
    .trim();
}

function modelSignature(model: Model): string {
  const caps = model.capabilities;
  const inputModalities = (caps.inputModalities as string[] | undefined)
    ?.slice()
    .sort()
    .join(",");
  const outputModalities = (caps.outputModalities as string[] | undefined)
    ?.slice()
    .sort()
    .join(",");
  return JSON.stringify({
    context: model.limits.contextTokens,
    maxOutput: model.limits.maxOutputTokens,
    thinking: !!caps.thinking,
    toolCalls: !!caps.toolCalls,
    jsonOutput: !!caps.jsonOutput,
    dynamicTools: !!caps.dynamicTools,
    inputModalities,
    outputModalities,
  });
}

function detectDifferences(left: Model, right: Model): string[] {
  const differences: string[] = [];
  if (left.limits.contextTokens !== right.limits.contextTokens) {
    differences.push("上下文窗口");
  }
  if (left.limits.maxOutputTokens !== right.limits.maxOutputTokens) {
    differences.push("最大输出");
  }
  if (modelSignature(left) !== modelSignature(right)) {
    differences.push("能力");
  }
  return differences;
}

export function buildMergedGroups(
  providers: Provider[],
  calibrationMap: Map<string, CalibrationModel>,
  filter: (provider: Provider, model: Model) => boolean,
  viewMode: VersionViewMode = "merged",
): MergedGroup[] {
  const byBase = new Map<string, Provider[]>();
  const order: string[] = [];
  for (const provider of providers) {
    const base = providerBaseId(provider);
    const existing = byBase.get(base);
    if (existing) {
      existing.push(provider);
    } else {
      byBase.set(base, [provider]);
      order.push(base);
    }
  }

  const groups: MergedGroup[] = [];
  const regionModel = (provider: Provider, model: Model, region: "cn" | "intl"): RegionModel => ({
    model,
    provider,
    region,
    calibration: calibrationMap.get(modelKey(provider.id, model.id)),
  });

  const buildStandaloneGroup = (provider: Provider, region: "cn" | "intl"): MergedGroup => ({
    id: provider.id,
    name: provider.name,
    displayName: provider.displayNames?.["zh-CN"] ?? provider.name,
    merged: false,
    cn: region === "cn" ? provider : undefined,
    intl: region === "intl" ? provider : undefined,
    models: provider.models
      .filter((model) => filter(provider, model))
      .map((model) => ({
        id: model.id,
        name: model.name,
        mergeable: true,
        differences: [],
        cn: region === "cn" ? regionModel(provider, model, region) : undefined,
        intl: region === "intl" ? regionModel(provider, model, region) : undefined,
      })),
  });

  for (const base of order) {
    const members = byBase.get(base) ?? [];
    const cn = members.find((p) => providerRegion(p) === "cn");
    const intl = members.find((p) => providerRegion(p) === "intl");

    if (cn && intl && viewMode === "merged") {
      groups.push(mergePair(cn, intl, calibrationMap, filter));
    } else {
      for (const provider of members) {
        const region: "cn" | "intl" =
          providerRegion(provider) === "cn" ? "cn" : "intl";
        groups.push(buildStandaloneGroup(provider, region));
      }
    }
  }
  return groups;
}

function mergePair(
  cn: Provider,
  intl: Provider,
  calibrationMap: Map<string, CalibrationModel>,
  filter: (provider: Provider, model: Model) => boolean,
): MergedGroup {
  const cnModels = new Map(
    cn.models.filter((m) => filter(cn, m)).map((m) => [m.id, m]),
  );
  const intlModels = new Map(
    intl.models.filter((m) => filter(intl, m)).map((m) => [m.id, m]),
  );
  const allIds = new Set([...cnModels.keys(), ...intlModels.keys()]);

  const models: MergedModel[] = [];
  for (const id of allIds) {
    const cnModel = cnModels.get(id);
    const intlModel = intlModels.get(id);
    const primary = cnModel ?? intlModel;
    if (!primary) continue;

    const mergeable = !!cnModel && !!intlModel;
    const differences =
      cnModel && intlModel ? detectDifferences(cnModel, intlModel) : [];

    const cnRegion: RegionModel | undefined = cnModel
      ? {
          model: cnModel,
          provider: cn,
          region: "cn",
          calibration: calibrationMap.get(modelKey(cn.id, cnModel.id)),
        }
      : undefined;
    const intlRegion: RegionModel | undefined = intlModel
      ? {
          model: intlModel,
          provider: intl,
          region: "intl",
          calibration: calibrationMap.get(modelKey(intl.id, intlModel.id)),
        }
      : undefined;

    models.push({
      id,
      name: primary.name,
      mergeable: mergeable && differences.length === 0,
      differences,
      cn: cnRegion,
      intl: intlRegion,
    });
  }

  const displayName = stripRegionSuffix(
    cn.displayNames?.["zh-CN"] ??
      intl.displayNames?.["zh-CN"] ??
      cn.name ??
      providerBaseId(cn),
  );
  return {
    id: providerBaseId(cn),
    name: displayName,
    displayName,
    merged: true,
    cn,
    intl,
    models,
  };
}
