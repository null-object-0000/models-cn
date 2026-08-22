import { createHash } from "node:crypto";
import type {
  CalibrationCheck,
  CalibrationValue,
  ModelCalibration,
  ModelsDevCalibration,
  ProviderData,
} from "../types.js";
import { healthyHealth } from "../health.js";

const MODELS_DEV_API_URL = "https://models.dev/api.json" as const;

export interface ModelsDevModel {
  id: string;
  release_date?: string;
  reasoning?: boolean;
  tool_call?: boolean;
  modalities?: { input?: string[]; output?: string[] };
  limit?: { context?: number; output?: number };
  cost?: { input?: number; output?: number; cache_read?: number };
}

export interface ModelsDevProvider {
  models: Record<string, ModelsDevModel>;
}

export type ModelsDevApi = Record<string, ModelsDevProvider>;

const moonshotModelIds = [
  "kimi-k3",
  "kimi-k2.7-code",
  "kimi-k2.7-code-highspeed",
  "kimi-k2.6",
  "kimi-k2.5",
] as const;

const zhipuModelIds = [
  "glm-5.3",
  "glm-5.2",
  "glm-5.1",
  "glm-5-turbo",
  "glm-5",
  "glm-4.7",
  "glm-4.5-air",
  "glm-4.7-flashx",
  "glm-4.7-flash",
] as const;

/**
 * 我方渠道 → models.dev 默认命名空间。同名同 ID 的模型无需手工映射，
 * 校准时按默认命名空间自动匹配（且要求 models.dev 确实收录了该 ID）。
 * 新增渠道时在这里补一行默认命名空间即可。
 */
const DEFAULT_REFERENCE_PROVIDER: Record<string, string> = {
  deepseek: "deepseek",
  longcat: "longcat",
  "moonshot-cn": "moonshotai",
  "moonshot-intl": "moonshotai",
  "qwen-cn": "alibaba",
  "zhipu-cn": "zhipuai",
  "zhipu-intl": "zai",
};

interface CalibrationMapping {
  provider: string;
  model: string;
  referenceProvider: string;
  referenceModel: string;
  referenceUrl: string;
}

/** 例外映射的简写：命名空间不同、模型 ID 一致。 */
function mirror(
  provider: string,
  model: string,
  options: { referenceProvider: string },
): CalibrationMapping {
  return {
    provider,
    model,
    referenceProvider: options.referenceProvider,
    referenceModel: model,
    referenceUrl: `https://models.dev/models/${options.referenceProvider}/${model}/`,
  };
}

/**
 * 手工例外清单：仅维护 models.dev 与我方「命名空间或模型 ID 不一致」的模型。
 * 同名模型不再逐个登记，由 resolveMappings 按默认命名空间自动匹配。
 */
const mappings: CalibrationMapping[] = [
  // LongCat：API 命名空间是 longcat，页面 slug 却是 meituan，URL 需手写。
  {
    provider: "longcat",
    model: "LongCat-2.0",
    referenceProvider: "longcat",
    referenceModel: "LongCat-2.0",
    referenceUrl: "https://models.dev/models/meituan/longcat-2.0/",
  },
  ...(["moonshot-cn", "moonshot-intl"] as const).flatMap((provider) =>
    moonshotModelIds.map((model) =>
      mirror(provider, model, { referenceProvider: "moonshotai" }),
    ),
  ),
  ...zhipuModelIds.map((model) =>
    mirror("zhipu-intl", model, { referenceProvider: "zai" }),
  ),
  ...zhipuModelIds
    .filter((model) => model !== "glm-5-turbo")
    .map((model) =>
      mirror("zhipu-cn", model, { referenceProvider: "zhipuai" }),
    ),
  mirror("zhipu-cn", "glm-5-turbo", { referenceProvider: "zai" }),
  // 这两个 flash 未收录进 alibaba 主命名空间，参考其国内命名空间。
  mirror("qwen-cn", "qwen3.7-flash", { referenceProvider: "alibaba-cn" }),
  mirror("qwen-cn", "qwen3.5-flash", { referenceProvider: "alibaba-cn" }),
];

/**
 * 手工例外 + 自动回退：未被手工清单覆盖的模型，若存在于渠道默认命名空间，
 * 则按同名规则生成映射。手工条目优先。
 */
function resolveMappings(
  providers: ProviderData[],
  api: ModelsDevApi,
): CalibrationMapping[] {
  const resolved = [...mappings];
  const covered = new Set(resolved.map((m) => `${m.provider}/${m.model}`));
  for (const provider of providers) {
    const namespace = DEFAULT_REFERENCE_PROVIDER[provider.id];
    if (!namespace) continue;
    for (const model of provider.models) {
      const key = `${provider.id}/${model.id}`;
      if (covered.has(key)) continue;
      if (!api[namespace]?.models[model.id]) continue;
      covered.add(key);
      resolved.push(
        mirror(provider.id, model.id, { referenceProvider: namespace }),
      );
    }
  }
  return resolved;
}

function sameValue(left: CalibrationValue, right: CalibrationValue): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
    );
  }
  return left === right;
}

/**
 * 发布日期容差：±1 天内的差异视为同一发布事件。厂商页与 models.dev 对
 * 「发布时刻」的时区与取整口径不同，跨零点就会产生 ±1 天的假性分歧。
 */
const CREATED_AT_TOLERANCE_DAYS = 1;

/**
 * 上下文长度相对容差：吸收 1024 进制与 1000 进制两种单位约定
 * （例如官方 204800 = 200×1024，models.dev 记 200000）。
 */
const CONTEXT_RELATIVE_TOLERANCE = 0.05;

function createdAtCheck(
  official: string | undefined,
  reference: string | undefined,
): CalibrationCheck {
  const base = {
    field: "createdAt",
    official: official ?? null,
    reference: reference ?? null,
  };
  if (official === undefined || reference === undefined) {
    return { ...base, status: "missing" };
  }
  const officialTime = Date.parse(official);
  const referenceTime = Date.parse(reference);
  if (Number.isNaN(officialTime) || Number.isNaN(referenceTime)) {
    return { ...base, status: official === reference ? "match" : "mismatch" };
  }
  return {
    ...base,
    status:
      Math.abs(officialTime - referenceTime) <=
      CREATED_AT_TOLERANCE_DAYS * 86_400_000
        ? "match"
        : "mismatch",
  };
}

function contextTokensCheck(
  official: number | undefined,
  reference: number | undefined,
): CalibrationCheck {
  const base = {
    field: "limits.contextTokens",
    official: official ?? null,
    reference: reference ?? null,
  };
  if (official === undefined || reference === undefined) {
    return { ...base, status: "missing" };
  }
  const scale = Math.max(Math.abs(official), Math.abs(reference));
  return {
    ...base,
    status:
      scale > 0 &&
      Math.abs(official - reference) / scale <= CONTEXT_RELATIVE_TOLERANCE
        ? "match"
        : "mismatch",
  };
}

function check(
  field: string,
  official: CalibrationValue | undefined,
  reference: CalibrationValue | undefined,
): CalibrationCheck {
  return {
    field,
    official: official ?? null,
    reference: reference ?? null,
    status:
      official === undefined || reference === undefined
        ? "missing"
        : sameValue(official, reference)
          ? "match"
          : "mismatch",
  };
}

function compareModel(
  provider: ProviderData | undefined,
  mapping: CalibrationMapping,
  reference: ModelsDevModel | undefined,
): ModelCalibration {
  const model = provider?.models.find(
    (candidate) => candidate.id === mapping.model,
  );
  const usd = model?.prices.find(
    (price) =>
      price.market === "international" &&
      price.currency === "USD" &&
      price.rateType === "standard",
  );
  const checks = [
    createdAtCheck(
      model?.createdAt ? model.createdAt.slice(0, 10) : undefined,
      reference?.release_date,
    ),
    contextTokensCheck(model?.limits.contextTokens, reference?.limit?.context),
    check(
      "limits.maxOutputTokens",
      model?.limits.maxOutputTokens,
      reference?.limit?.output,
    ),
    check(
      "capabilities.thinking",
      model?.capabilities.thinking,
      reference?.reasoning,
    ),
    check(
      "capabilities.toolCalls",
      model?.capabilities.toolCalls,
      reference?.tool_call,
    ),
    check(
      "capabilities.inputModalities",
      model?.capabilities.inputModalities,
      reference?.modalities?.input,
    ),
    check(
      "capabilities.outputModalities",
      model?.capabilities.outputModalities,
      reference?.modalities?.output,
    ),
    check(
      "prices.USD.input.standard",
      usd?.input.standard,
      reference?.cost?.input,
    ),
    check(
      "prices.USD.input.cacheHit",
      usd?.input.cacheHit,
      reference?.cost?.cache_read,
    ),
    check("prices.USD.output", usd?.output, reference?.cost?.output),
  ];
  const statuses = checks.map((item) => item.status);
  const status =
    !model || !reference
      ? "missing"
      : statuses.includes("mismatch")
        ? "mismatch"
        : statuses.includes("missing")
          ? "partial"
          : "match";
  return { ...mapping, status, checks };
}

async function fetchModelsDev(): Promise<ModelsDevApi> {
  const response = await fetch(MODELS_DEV_API_URL, {
    headers: {
      "user-agent":
        "models-cn/0.1 (+https://github.com/null-object-0000/models-cn)",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `Failed to fetch ${MODELS_DEV_API_URL}: HTTP ${response.status}`,
    );
  return response.json() as Promise<ModelsDevApi>;
}

export async function collectModelsDevCalibration(
  providers: ProviderData[],
  previous?: ModelsDevCalibration,
  now = new Date(),
  fetcher: () => Promise<ModelsDevApi> = fetchModelsDev,
): Promise<ModelsDevCalibration> {
  const api = await fetcher();
  const effectiveMappings = resolveMappings(providers, api);
  const selectedReferences = effectiveMappings.map((mapping) => ({
    provider: mapping.referenceProvider,
    model: mapping.referenceModel,
    data:
      api[mapping.referenceProvider]?.models[mapping.referenceModel] ?? null,
  }));
  const contentHash = `sha256:${createHash("sha256").update(JSON.stringify(selectedReferences)).digest("hex")}`;
  const retrievedAt =
    previous?.source.contentHash === contentHash
      ? previous.source.retrievedAt
      : now.toISOString();
  const models = effectiveMappings.map((mapping) =>
    compareModel(
      providers.find((provider) => provider.id === mapping.provider),
      mapping,
      api[mapping.referenceProvider]?.models[mapping.referenceModel],
    ),
  );
  return {
    schemaVersion: "1.0",
    health: healthyHealth(now),
    source: { url: MODELS_DEV_API_URL, retrievedAt, contentHash },
    models,
  };
}
