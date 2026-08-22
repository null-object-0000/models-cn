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

const mappings = [
  {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    referenceProvider: "deepseek",
    referenceModel: "deepseek-v4-flash",
    referenceUrl: "https://models.dev/models/deepseek/deepseek-v4-flash/",
  },
  {
    provider: "deepseek",
    model: "deepseek-v4-pro",
    referenceProvider: "deepseek",
    referenceModel: "deepseek-v4-pro",
    referenceUrl: "https://models.dev/models/deepseek/deepseek-v4-pro/",
  },
  {
    provider: "longcat",
    model: "LongCat-2.0",
    referenceProvider: "longcat",
    referenceModel: "LongCat-2.0",
    referenceUrl: "https://models.dev/models/meituan/longcat-2.0/",
  },
  ...(["moonshot-cn", "moonshot-intl"] as const).flatMap((provider) =>
    moonshotModelIds.map((model) => ({
      provider,
      model,
      referenceProvider: "moonshotai",
      referenceModel: model,
      referenceUrl: `https://models.dev/models/moonshotai/${model}/`,
    })),
  ),
  {
    provider: "qwen-cn",
    model: "qwen3.8-max",
    referenceProvider: "alibaba",
    referenceModel: "qwen3.8-max",
    referenceUrl: "https://models.dev/models/alibaba/qwen3.8-max/",
  },
  {
    provider: "qwen-cn",
    model: "qwen3.7-plus",
    referenceProvider: "alibaba",
    referenceModel: "qwen3.7-plus",
    referenceUrl: "https://models.dev/models/alibaba/qwen3.7-plus/",
  },
  {
    provider: "qwen-cn",
    model: "qwen3.7-max",
    referenceProvider: "alibaba",
    referenceModel: "qwen3.7-max",
    referenceUrl: "https://models.dev/models/alibaba/qwen3.7-max/",
  },
  {
    provider: "qwen-cn",
    model: "qwen3.6-plus",
    referenceProvider: "alibaba",
    referenceModel: "qwen3.6-plus",
    referenceUrl: "https://models.dev/models/alibaba/qwen3.6-plus/",
  },
  {
    provider: "qwen-cn",
    model: "qwen3.5-plus",
    referenceProvider: "alibaba",
    referenceModel: "qwen3.5-plus",
    referenceUrl: "https://models.dev/models/alibaba/qwen3.5-plus/",
  },
  {
    provider: "qwen-cn",
    model: "qwen3-max",
    referenceProvider: "alibaba",
    referenceModel: "qwen3-max",
    referenceUrl: "https://models.dev/models/alibaba/qwen3-max/",
  },
  {
    provider: "qwen-cn",
    model: "qwen3.6-max-preview",
    referenceProvider: "alibaba",
    referenceModel: "qwen3.6-max-preview",
    referenceUrl: "https://models.dev/models/alibaba/qwen3.6-max-preview/",
  },
  {
    provider: "qwen-cn",
    model: "qwen3.6-flash",
    referenceProvider: "alibaba",
    referenceModel: "qwen3.6-flash",
    referenceUrl: "https://models.dev/models/alibaba/qwen3.6-flash/",
  },
  {
    provider: "qwen-cn",
    model: "qwen3-coder-plus",
    referenceProvider: "alibaba",
    referenceModel: "qwen3-coder-plus",
    referenceUrl: "https://models.dev/models/alibaba/qwen3-coder-plus/",
  },
  {
    provider: "qwen-cn",
    model: "qwen3-coder-flash",
    referenceProvider: "alibaba",
    referenceModel: "qwen3-coder-flash",
    referenceUrl: "https://models.dev/models/alibaba/qwen3-coder-flash/",
  },
  // 这两个模型 models.dev 未收录在 alibaba 主命名空间，参考其国内命名空间。
  {
    provider: "qwen-cn",
    model: "qwen3.7-flash",
    referenceProvider: "alibaba-cn",
    referenceModel: "qwen3.7-flash",
    referenceUrl: "https://models.dev/models/alibaba-cn/qwen3.7-flash/",
  },
  {
    provider: "qwen-cn",
    model: "qwen3.5-flash",
    referenceProvider: "alibaba-cn",
    referenceModel: "qwen3.5-flash",
    referenceUrl: "https://models.dev/models/alibaba-cn/qwen3.5-flash/",
  },
  ...zhipuModelIds.map((model) => ({
    provider: "zhipu-intl",
    model,
    referenceProvider: "zai",
    referenceModel: model,
    referenceUrl: `https://models.dev/models/zai/${model}/`,
  })),
  ...zhipuModelIds
    .filter((model) => model !== "glm-5-turbo")
    .map((model) => ({
      provider: "zhipu-cn",
      model,
      referenceProvider: "zhipuai",
      referenceModel: model,
      referenceUrl: `https://models.dev/models/zhipuai/${model}/`,
    })),
  {
    provider: "zhipu-cn",
    model: "glm-5-turbo",
    referenceProvider: "zai",
    referenceModel: "glm-5-turbo",
    referenceUrl: "https://models.dev/models/zai/glm-5-turbo/",
  },
] as const;

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
  mapping: (typeof mappings)[number],
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
  const selectedReferences = mappings.map((mapping) => ({
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
  const models = mappings.map((mapping) =>
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
