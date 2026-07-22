import { createHash } from "node:crypto";
import type {
  CalibrationCheck,
  CalibrationValue,
  ModelCalibration,
  ModelsDevCalibration,
  ProviderData,
} from "../types.js";

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
  {
    provider: "moonshot-cn",
    model: "kimi-k3",
    referenceProvider: "moonshotai",
    referenceModel: "kimi-k3",
    referenceUrl: "https://models.dev/models/moonshotai/kimi-k3/",
  },
  {
    provider: "moonshot-cn",
    model: "kimi-k2.7-code",
    referenceProvider: "moonshotai",
    referenceModel: "kimi-k2.7-code",
    referenceUrl: "https://models.dev/models/moonshotai/kimi-k2.7-code/",
  },
  {
    provider: "moonshot-cn",
    model: "kimi-k2.7-code-highspeed",
    referenceProvider: "moonshotai",
    referenceModel: "kimi-k2.7-code-highspeed",
    referenceUrl:
      "https://models.dev/models/moonshotai/kimi-k2.7-code-highspeed/",
  },
  {
    provider: "moonshot-cn",
    model: "kimi-k2.6",
    referenceProvider: "moonshotai",
    referenceModel: "kimi-k2.6",
    referenceUrl: "https://models.dev/models/moonshotai/kimi-k2.6/",
  },
  {
    provider: "moonshot-cn",
    model: "kimi-k2.5",
    referenceProvider: "moonshotai",
    referenceModel: "kimi-k2.5",
    referenceUrl: "https://models.dev/models/moonshotai/kimi-k2.5/",
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
    check(
      "createdAt",
      model?.createdAt ? model.createdAt.slice(0, 10) : undefined,
      reference?.release_date,
    ),
    check(
      "limits.contextTokens",
      model?.limits.contextTokens,
      reference?.limit?.context,
    ),
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
    source: { url: MODELS_DEV_API_URL, retrievedAt, contentHash },
    models,
  };
}
