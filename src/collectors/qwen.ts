import { createHash } from "node:crypto";
import { chromium, type APIRequestContext, type Request } from "playwright";
import type { ModelData, ModelPrice, ProviderData, Source } from "../types.js";
import { SCHEMA_VERSION } from "../types.js";
import { healthyHealth } from "../health.js";

export const QWEN_MODELS_URL = "https://www.qianwenai.com/models";
export const QWEN_DATA_API_URL =
  "https://platform-home.qianwenai.com/data/api.json";
const QWEN_LIST_ACTION = "ListModelSeries";
const QWEN_DETAIL_ACTION = "GetSeriesModel";

interface QwenApiEnvelope<T> {
  code?: string;
  data?: T;
}

interface QwenListItem {
  DataId?: string;
  Provider?: string;
}

interface QwenListData {
  Data?: QwenListItem[];
  Ext?: { totalCount?: number };
  Success?: boolean;
}

interface QwenRawPrice {
  Discount?: string;
  Price?: string;
  PriceUnit?: string;
  Type?: string;
}

interface QwenPriceRange {
  Prices?: QwenRawPrice[];
  RangeName?: string;
}

interface QwenRawModel {
  Features?: string[];
  GroupModel?: string;
  InferenceMetadata?: {
    RequestModality?: string[];
    ResponseModality?: string[];
  };
  LatestOnlineAt?: string;
  ModelAlias?: string;
  Model?: string;
  ModelInfo?: {
    ContextWindow?: number;
    MaxOutputTokens?: number;
    ReasoningMaxInputTokens?: number;
    ReasoningMaxOutputTokens?: number;
  };
  MultiPrices?: QwenPriceRange[];
  Name?: string;
  OpenSource?: boolean;
  Prices?: QwenRawPrice[];
}

interface QwenDetailData {
  Data?: QwenRawModel[];
}

export interface QwenCapturedData {
  details: QwenApiEnvelope<QwenDetailData>[];
  list: QwenApiEnvelope<QwenListData>;
}

interface ParsedQwenDetails {
  models: ModelData[];
  normalizedContent: string;
}

function money(value: string | undefined, label: string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Cannot parse Qwen ${label} price: ${value}`);
  }
  return amount;
}

function discountedPrice(price: QwenRawPrice, label: string): number {
  const discount = Number(price.Discount);
  if (!Number.isFinite(discount) || discount <= 0 || discount >= 1) {
    throw new Error(`Cannot parse Qwen ${label} discount: ${price.Discount}`);
  }
  return Number((money(price.Price, label) * discount).toFixed(12));
}

function tokenAmount(value: string, unit: string): number {
  const multiplier = unit.toLowerCase() === "m" ? 1_000_000 : 1_000;
  return Number(value) * multiplier;
}

function parseInputTokenRange(
  label: string | undefined,
): ModelPrice["inputTokenRange"] | undefined {
  if (!label) return undefined;
  const compact = label.replace(/\s+/g, "").toLowerCase();
  const bounded = compact.match(/^([\d.]+)([km])<输入<=([\d.]+)([km])$/i);
  if (bounded) {
    return {
      label,
      minExclusive: tokenAmount(bounded[1]!, bounded[2]!),
      maxInclusive: tokenAmount(bounded[3]!, bounded[4]!),
    };
  }
  const maximum = compact.match(/^输入<=([\d.]+)([km])$/i);
  if (maximum) {
    return {
      label,
      maxInclusive: tokenAmount(maximum[1]!, maximum[2]!),
    };
  }
  return { label };
}

function priceByType(
  range: QwenPriceRange,
  type: string,
): QwenRawPrice | undefined {
  return range.Prices?.find((price) => price.Type === type);
}

function parsePrices(
  ranges: QwenPriceRange[] | undefined,
  sourceUrl: string,
): ModelPrice[] {
  const prices: ModelPrice[] = [];
  for (const range of ranges ?? []) {
    const input = priceByType(range, "input_token");
    const output = priceByType(range, "output_token");
    const cache = priceByType(range, "input_token_cache");
    if (!input || !output) continue;
    if (
      input.PriceUnit !== "每百万tokens" ||
      output.PriceUnit !== "每百万tokens" ||
      (cache && cache.PriceUnit !== "每百万tokens")
    ) {
      throw new Error(`Unexpected Qwen price unit in ${range.RangeName}`);
    }
    const inputTokenRange = parseInputTokenRange(range.RangeName);
    const standard: ModelPrice = {
      market: "china",
      currency: "CNY",
      unit: "1M_tokens",
      rateType: "standard",
      ...(inputTokenRange ? { inputTokenRange } : {}),
      input: {
        standard: money(input.Price, "input"),
        ...(cache ? { cacheHit: money(cache.Price, "cache hit") } : {}),
      },
      output: money(output.Price, "output"),
      sourceUrl,
    };
    prices.push(standard);

    if (input.Discount && output.Discount) {
      prices.push({
        ...standard,
        rateType: "promotional",
        input: {
          standard: discountedPrice(input, "input"),
          ...(cache
            ? {
                cacheHit: cache.Discount
                  ? discountedPrice(cache, "cache hit")
                  : money(cache.Price, "cache hit"),
              }
            : {}),
        },
        output: discountedPrice(output, "output"),
      });
    }
  }
  return prices;
}

function modalities(values: string[] | undefined): string[] | undefined {
  const normalized = values?.map((value) => value.toLowerCase());
  return normalized?.length ? [...new Set(normalized)] : undefined;
}

export function isQwenDatedSnapshot(id: string): boolean {
  return /-(?:\d{4}|\d{8}|\d{4}-\d{2}-\d{2})$/.test(id);
}

export function isQwenOpenSourceModel(
  displayName: string | undefined,
  explicitlyOpenSource = false,
): boolean {
  return explicitlyOpenSource || displayName?.includes("开源模型") === true;
}

export function isExcludedQwenCategory(id: string): boolean {
  return /(?:^|-)(?:ocr|character|tts|vl|math)(?:-|$)/i.test(id);
}

export function isLegacyQwenModel(id: string): boolean {
  return /^qwen-/i.test(id);
}

function qwenModelId(model: QwenRawModel): string | undefined {
  return model.ModelAlias || model.Model || undefined;
}

export function parseQwenDetails(
  details: QwenApiEnvelope<QwenDetailData>[],
): ParsedQwenDetails {
  const rawModels = details.flatMap((detail) => detail.data?.Data ?? []);
  const parsedModels = rawModels
    .filter((model) => {
      const id = qwenModelId(model);
      return Boolean(
        id?.toLowerCase().startsWith("qwen") &&
        !isQwenDatedSnapshot(id) &&
        !isExcludedQwenCategory(id) &&
        !isLegacyQwenModel(id) &&
        !isQwenOpenSourceModel(
          model.GroupModel ?? model.Name,
          model.OpenSource === true,
        ),
      );
    })
    .flatMap<ModelData>((model) => {
      const id = qwenModelId(model)!;
      const sourceUrl = `${QWEN_MODELS_URL}/${encodeURIComponent(id)}`;
      const priceRanges = model.MultiPrices?.length
        ? model.MultiPrices
        : model.Prices?.length
          ? [{ Prices: model.Prices }]
          : undefined;
      const prices = parsePrices(priceRanges, sourceUrl);
      if (!prices.length) return [];
      const contextTokens = model.ModelInfo?.ContextWindow;
      if (!contextTokens || contextTokens < 1) {
        throw new Error(`Qwen model ${id} is missing its context window`);
      }
      const features = new Set(model.Features ?? []);
      const inputModalities = modalities(
        model.InferenceMetadata?.RequestModality,
      );
      const outputModalities = modalities(
        model.InferenceMetadata?.ResponseModality,
      );
      const thinking = Boolean(
        model.ModelInfo?.ReasoningMaxInputTokens ||
        model.ModelInfo?.ReasoningMaxOutputTokens,
      );
      return [
        {
          id,
          name: model.GroupModel ?? model.Name ?? id,
          ...(model.LatestOnlineAt ? { createdAt: model.LatestOnlineAt } : {}),
          aliases: [],
          capabilities: {
            ...(thinking ? { thinking: true } : {}),
            ...(features.has("structured-outputs") ? { jsonOutput: true } : {}),
            ...(features.has("function-calling") ? { toolCalls: true } : {}),
            ...(features.has("prefix-completion")
              ? { chatPrefixCompletion: true }
              : {}),
            ...(inputModalities ? { inputModalities } : {}),
            ...(outputModalities ? { outputModalities } : {}),
          },
          limits: {
            contextTokens,
            ...(model.ModelInfo?.MaxOutputTokens
              ? { maxOutputTokens: model.ModelInfo.MaxOutputTokens }
              : {}),
          },
          prices,
        } satisfies ModelData,
      ];
    });
  if (!parsedModels.length) {
    throw new Error(
      "Qwen detail responses contain no token-priced Qwen models",
    );
  }
  const byId = new Map<string, ModelData>();
  for (const model of parsedModels) {
    const existing = byId.get(model.id);
    if (!existing) {
      byId.set(model.id, model);
      continue;
    }
    const existingDate = Date.parse(existing.createdAt ?? "") || 0;
    const modelDate = Date.parse(model.createdAt ?? "") || 0;
    if (
      modelDate > existingDate ||
      (modelDate === existingDate &&
        JSON.stringify(model).length > JSON.stringify(existing).length)
    ) {
      byId.set(model.id, model);
    }
  }
  const models = [...byId.values()].filter((model) => {
    if (!model.id.endsWith("-preview")) return true;
    const stable = byId.get(model.id.slice(0, -"-preview".length));
    return !stable || stable.name !== model.name;
  });
  return {
    models,
    normalizedContent: JSON.stringify(rawModels),
  };
}

function assertEnvelope<T>(
  value: QwenApiEnvelope<T>,
  action: string,
): QwenApiEnvelope<T> {
  if (value.code !== "200" || !value.data) {
    throw new Error(`Qwen ${action} request failed with code ${value.code}`);
  }
  return value;
}

async function postAction<T>(
  request: APIRequestContext,
  token: string | undefined,
  action: string,
  params: unknown,
  region?: string,
): Promise<QwenApiEnvelope<T>> {
  const response = await request.post(
    `${QWEN_DATA_API_URL}?product=AliyunDeliveryService&action=${action}`,
    {
      form: {
        product: "AliyunDeliveryService",
        action,
        ...(token ? { sec_token: token } : {}),
        ...(region ? { region } : {}),
        params: JSON.stringify(params),
      },
      headers: {
        accept: "application/json, text/plain, */*",
        origin: "https://www.qianwenai.com",
        referer: `${QWEN_MODELS_URL}/`,
      },
      timeout: 30_000,
    },
  );
  if (!response.ok()) {
    throw new Error(
      `Qwen ${action} request returned HTTP ${response.status()}`,
    );
  }
  return assertEnvelope((await response.json()) as QwenApiEnvelope<T>, action);
}

function capturedToken(request: Request): string | undefined {
  let token: string | undefined;
  try {
    const body = request.postDataJSON() as Record<string, unknown> | null;
    if (typeof body?.sec_token === "string") token = body.sec_token;
  } catch {
    token =
      new URLSearchParams(request.postData() ?? "").get("sec_token") ??
      undefined;
  }
  return token;
}

async function loadQwenData(): Promise<QwenCapturedData> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ locale: "zh-CN" });
    const page = await context.newPage();
    const capturedRequest = page.waitForRequest(
      (request) =>
        request.url().includes(`action=${QWEN_LIST_ACTION}`) &&
        request.method() === "POST",
      { timeout: 30_000 },
    );
    await page.goto(QWEN_MODELS_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const token = capturedToken(await capturedRequest);
    const items: QwenListItem[] = [];
    let pageNo = 1;
    let totalCount = Number.POSITIVE_INFINITY;
    let list: QwenApiEnvelope<QwenListData> | undefined;
    while (items.length < totalCount) {
      list = await postAction<QwenListData>(
        context.request,
        token,
        QWEN_LIST_ACTION,
        {
          OrderType: "Featured",
          PageNo: pageNo,
          PageSize: 100,
          Language: "zh-CN",
        },
      );
      const pageItems = list.data?.Data ?? [];
      totalCount = list.data?.Ext?.totalCount ?? pageItems.length;
      items.push(...pageItems);
      if (!pageItems.length && items.length < totalCount) {
        throw new Error("Qwen model list pagination ended before totalCount");
      }
      pageNo += 1;
    }
    const qwenSeries = items.filter(
      (item) => item.Provider === "qwen" && item.DataId,
    );
    if (!qwenSeries.length) {
      throw new Error("Qwen model list contains no Provider=qwen series");
    }
    const details: QwenApiEnvelope<QwenDetailData>[] = [];
    for (const series of qwenSeries) {
      details.push(
        await postAction<QwenDetailData>(
          context.request,
          token,
          QWEN_DETAIL_ACTION,
          { language: "zh-CN", dataId: series.DataId },
          "cn-beijing",
        ),
      );
    }
    return {
      list: {
        ...list!,
        data: { ...list!.data, Data: qwenSeries },
      },
      details,
    };
  } finally {
    await browser.close();
  }
}

export async function collectQwen(
  now = new Date(),
  loader: () => Promise<QwenCapturedData> = loadQwenData,
): Promise<ProviderData> {
  const captured = await loader();
  const parsed = parseQwenDetails(captured.details);
  const retrievedAt = now.toISOString();
  const listHash = createHash("sha256")
    .update(JSON.stringify(captured.list.data?.Data ?? []))
    .digest("hex");
  const detailsHash = createHash("sha256")
    .update(parsed.normalizedContent)
    .digest("hex");
  const sources: Source[] = [
    {
      url: QWEN_MODELS_URL,
      kind: "model-metadata",
      locale: "zh-CN",
      retrievedAt,
      contentHash: `sha256:${listHash}`,
    },
    {
      url: QWEN_MODELS_URL,
      kind: "pricing",
      locale: "zh-CN",
      currency: "CNY",
      retrievedAt,
      contentHash: `sha256:${detailsHash}`,
    },
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    health: healthyHealth(now),
    id: "qwen-cn",
    name: "Qwen China",
    displayNames: {
      "zh-CN": "千问国内版",
      en: "Qwen China",
    },
    ownedBy: "alibaba",
    baseUrls: {
      openai: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
    models: parsed.models,
    sources,
  };
}
