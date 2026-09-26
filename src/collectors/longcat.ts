import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type {
  Currency,
  Market,
  ModelPrice,
  ProviderData,
  Source,
} from "../types.js";
import { SCHEMA_VERSION } from "../types.js";
import { healthyHealth } from "../health.js";

export const LONGCAT_PRICING_SOURCES = [
  {
    url: "https://longcat.chat/platform/docs/zh/pricing/long-cat-2.0",
    locale: "zh-CN",
    currency: "CNY",
    market: "china",
    modelId: "LongCat-2.0",
  },
  {
    url: "https://longcat.chat/platform/docs/pricing/long-cat-2.0",
    locale: "en",
    currency: "USD",
    market: "international",
    modelId: "LongCat-2.0",
  },
  {
    url: "https://longcat.chat/platform/docs/zh/pricing/longcat-2.5",
    locale: "zh-CN",
    currency: "CNY",
    market: "china",
    modelId: "LongCat-2.5-Preview",
  },
  {
    url: "https://longcat.chat/platform/docs/pricing/longcat-2.5",
    locale: "en",
    currency: "USD",
    market: "international",
    modelId: "LongCat-2.5-Preview",
  },
] as const;

export const LONGCAT_MODEL_DOC_URL =
  "https://longcat.chat/platform/docs/zh/api/model";
export const LONGCAT_QUICKSTART_URL = "https://longcat.chat/platform/docs/";
export const LONGCAT_MODELS_API_URL =
  "https://api.longcat.chat/openai/v1/models";

/**
 * 定价页覆盖的模型清单（去重，顺序稳定）。上游 2026-09 新增了
 * LongCat-2.5-Preview 并给它单独开了定价页，因此**模型数量不是常量**：
 * 采集时以「有定价页的模型」为产出集合，避免把 2.0 的价格挂到 2.5 名下，
 * 也避免无定价的模型被静默丢掉。
 */
export const LONGCAT_PRICED_MODEL_IDS: string[] = [
  ...new Set(LONGCAT_PRICING_SOURCES.map((source) => source.modelId)),
];

export function longCatModelApiUrl(modelId: string): string {
  return `${LONGCAT_MODELS_API_URL}/${modelId}`;
}

type PricingSource = (typeof LONGCAT_PRICING_SOURCES)[number];

interface LongCatModelDetail {
  id: string;
  name: string;
  created: number;
  context_length: number;
  architecture: {
    input_modalities: string[];
    output_modalities: string[];
    tokenizer: string;
  };
  supported_parameters: string[];
  pricing?: {
    prompt: string;
    completion: string;
    cached_tokens: string;
  };
}

interface LongCatModelList {
  data: Array<{
    id: string;
    owned_by: string;
    display_name?: string;
    context_window?: number;
    max_output_tokens?: number;
  }>;
}

interface ParsedPricing {
  prices: Array<Omit<ModelPrice, "sourceUrl">>;
  normalizedTable: string;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseMoney(value: string): number {
  const match = cleanText(value).match(/[\d.]+/);
  if (!match) throw new Error(`Cannot parse LongCat price: ${value}`);
  return Number(match[0]);
}

function parseBinaryTokenCount(value: string): number {
  const match = value.match(/([\d.]+)\s*([KM])/i);
  if (!match?.[1] || !match[2])
    throw new Error(`Cannot parse LongCat token count: ${value}`);
  return (
    Number(match[1]) * (match[2].toUpperCase() === "M" ? 1024 * 1024 : 1024)
  );
}

export function parseLongCatPricingPage(
  html: string,
  config: PricingSource,
): ParsedPricing {
  const $ = cheerio.load(html);
  const table = $("table")
    .filter((_, element) =>
      /未命中缓存|Uncached Input/i.test($(element).text()),
    )
    .first();
  if (!table.length)
    throw new Error(`No LongCat pricing table found at ${config.url}`);

  const findValues = (pattern: RegExp): string[] => {
    const row = table
      .find("tr")
      .filter((_, element) => pattern.test(cleanText($(element).text())))
      .first();
    const found = row
      .find("td")
      .map((_, cell) => cleanText($(cell).text()))
      .get();
    // 第一个 <td> 是计费项标签（输入/输出），价格从第 2 列起。
    // 列数随上游页面而变：2.0 是「原价 + 折扣价」两列，2.5 目前只有「折扣价」一列。
    const values = found.slice(1).filter((value) => value);
    if (!values.length) {
      throw new Error(`LongCat pricing table is missing ${pattern}`);
    }
    return values;
  };

  const uncached = findValues(/^输入（未命中缓存）|^Uncached Input/i);
  const cached = findValues(/^输入（命中缓存）|^Cached Input/i);
  const output = findValues(/^输出|Output/i);
  // 同一页面的三行必须列数一致，否则归一化表格与价格会错位。
  if (uncached.length !== cached.length || uncached.length !== output.length) {
    throw new Error(`LongCat pricing table has inconsistent columns at ${config.url}`);
  }
  const makePrice = (index: number): Omit<ModelPrice, "sourceUrl"> => {
    // 只有一列时，这一列就是折扣价（上游 2.5 页面当前形态），标 promotional；
    // 两列时才区分 standard / promotional。宁可不给 standard，也不要伪造原价。
    const rateType = uncached.length === 1 || index === 1 ? "promotional" : "standard";
    return {
      market: config.market as Market,
      currency: config.currency as Currency,
      unit: "1M_tokens",
      rateType,
      input: {
        cacheHit: parseMoney(cached[index]!),
        standard: parseMoney(uncached[index]!),
      },
      output: parseMoney(output[index]!),
    };
  };

  return {
    prices: Array.from({ length: uncached.length }, (_, index) => makePrice(index)),
    normalizedTable: cleanText(table.html() ?? ""),
  };
}

export function parseLongCatModelDocs(html: string): LongCatModelDetail {
  const $ = cheerio.load(html);
  const json = $("pre")
    .map((_, element) => cleanText($(element).text()))
    .get()
    .find((text) => text.startsWith("{") && text.includes('"context_length"'));
  if (!json)
    throw new Error(
      "LongCat model documentation is missing its JSON response example",
    );
  const detail = JSON.parse(json) as LongCatModelDetail;
  // **不要硬编码模型 ID**：上游 2026-09 把文档示例从 LongCat-2.0 换成了
  // LongCat-2.5-Preview（并保留 2.0），写死 ID 会让整条采集直接判 unhealthy。
  // 文档示例只用来确认「这是一份模型详情」，具体以哪个模型为准由 API 决定。
  if (!detail.id || !detail.context_length) {
    throw new Error("LongCat model documentation returned unexpected metadata");
  }
  return detail;
}

export function parseLongCatMaxOutput(
  html: string,
  modelId = "LongCat-2.0",
): number {
  const text = cleanText(cheerio.load(html).root().text());
  // 按**模型名**取该模型那一行。上游 quickstart 现在同时列出多个模型
  // （LongCat-2.5-Preview 与 LongCat-2.0 各一行），不带模型名取第一个匹配
  // 会「碰巧」拿到别的模型的额度。模型名里的 . 需转义再拼正则。
  //
  // 两个坑（都实测过）：
  //   1. 间隔必须**非贪婪**，否则 .{0,150} 会贪心吃到后面另一个模型那一行，
  //      把「2.5-Preview」读成 128K；
  //   2. 间隔里**不允许再出现 LongCat-**，否则会跨过下一个模型名去匹配它的额度。
  const escaped = modelId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(
    new RegExp(
      `${escaped}(?:(?!LongCat-)[\\s\\S]){0,200}?maximum output length of\\s*([\\d.]+\\s*[KM])`,
      "i",
    ),
  );
  if (!match?.[1])
    throw new Error(
      `LongCat quick start is missing the maximum output length for ${modelId}`,
    );
  return parseBinaryTokenCount(match[1]);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "models-cn/0.1 (+https://github.com/null-object-0000/models-cn)",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  return response.text();
}

async function fetchAuthenticatedJson<T>(
  url: string,
  apiKey: string,
): Promise<T> {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "user-agent":
        "models-cn/0.1 (+https://github.com/null-object-0000/models-cn)",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `Failed to fetch authenticated LongCat metadata: HTTP ${response.status}`,
    );
  return response.json() as Promise<T>;
}

function assertApiPricingMatchesDocumentation(
  detail: LongCatModelDetail,
  prices: ModelPrice[],
): void {
  if (!detail.pricing) return;
  const apiPrice = {
    cacheHit: Number(detail.pricing.cached_tokens),
    standard: Number(detail.pricing.prompt),
    output: Number(detail.pricing.completion),
  };
  const matches = prices
    .filter((price) => price.rateType === "promotional")
    .some(
      (price) =>
        price.input.cacheHit === apiPrice.cacheHit &&
        price.input.standard === apiPrice.standard &&
        price.output === apiPrice.output,
    );
  if (!matches)
    throw new Error(
      "LongCat API pricing does not match either documented promotional market price",
    );
}

export async function collectLongCat(
  now = new Date(),
  apiKey = process.env.LONGCAT_API_KEY,
): Promise<ProviderData> {
  const [pricingPages, modelDocsHtml, quickstartHtml] = await Promise.all([
    Promise.all(
      LONGCAT_PRICING_SOURCES.map(async (config) => ({
        config,
        parsed: parseLongCatPricingPage(await fetchText(config.url), config),
      })),
    ),
    fetchText(LONGCAT_MODEL_DOC_URL),
    fetchText(LONGCAT_QUICKSTART_URL),
  ]);

  // 文档示例只描述「其中一个」模型，且上游会换（2026-09：LongCat-2.0 →
  // LongCat-2.5-Preview）。它只能作为无 API key 时的兜底元数据，
  // **不能**用来决定产出哪些模型——产出集合由定价页决定。
  const documented = parseLongCatModelDocs(modelDocsHtml);
  const retrievedAt = now.toISOString();
  const sources: Source[] = pricingPages.map(({ config, parsed }) => ({
    url: config.url,
    kind: "pricing",
    locale: config.locale,
    currency: config.currency,
    retrievedAt,
    contentHash: hash(parsed.normalizedTable),
  }));
  sources.push({
    url: LONGCAT_MODEL_DOC_URL,
    kind: "model-metadata",
    locale: "zh-CN",
    retrievedAt,
    contentHash: hash(JSON.stringify(documented)),
  });

  // 定价按模型分别归集：上游给每个模型单独开定价页，混在一起会张冠李戴
  // （把 2.0 的价格挂到 2.5 名下）。
  const pricesByModel = new Map<string, ModelPrice[]>();
  for (const { config, parsed } of pricingPages) {
    const list = pricesByModel.get(config.modelId) ?? [];
    list.push(
      ...parsed.prices.map((price) => ({ ...price, sourceUrl: config.url })),
    );
    pricesByModel.set(config.modelId, list);
  }

  const maxOutputByModel = new Map<string, number>();
  for (const modelId of LONGCAT_PRICED_MODEL_IDS) {
    maxOutputByModel.set(modelId, parseLongCatMaxOutput(quickstartHtml, modelId));
  }

  const detailByModel = new Map<string, LongCatModelDetail>();
  if (apiKey) {
    const list = await fetchAuthenticatedJson<LongCatModelList>(
      LONGCAT_MODELS_API_URL,
      apiKey,
    );
    for (const modelId of LONGCAT_PRICED_MODEL_IDS) {
      const listed = list.data.find((model) => model.id === modelId);
      if (!listed)
        throw new Error(`LongCat API model list does not include ${modelId}`);
      const detail = await fetchAuthenticatedJson<LongCatModelDetail>(
        longCatModelApiUrl(modelId),
        apiKey,
      );
      assertApiPricingMatchesDocumentation(
        detail,
        pricesByModel.get(modelId) ?? [],
      );
      if (
        listed.context_window &&
        listed.context_window !== detail.context_length
      ) {
        throw new Error(
          "LongCat list and detail endpoints disagree on context length",
        );
      }
      detailByModel.set(modelId, detail);
      if (listed.max_output_tokens)
        maxOutputByModel.set(modelId, listed.max_output_tokens);
      sources.push(
        {
          url: longCatModelApiUrl(modelId),
          kind: "model-metadata",
          locale: "en",
          retrievedAt,
          contentHash: hash(JSON.stringify(detail)),
        },
        {
          url: LONGCAT_MODELS_API_URL,
          kind: "model-metadata",
          locale: "en",
          retrievedAt,
          contentHash: hash(JSON.stringify(listed)),
        },
      );
    }
  } else {
    // 无 key 时，文档示例只能覆盖一个模型；其余模型的完整元数据拿不到。
    // 与其用别的模型的字段冒充，不如明确报错（CI 始终带 key，不受影响）。
    if (LONGCAT_PRICED_MODEL_IDS.includes(documented.id)) {
      detailByModel.set(documented.id, documented);
    }
    const missing = LONGCAT_PRICED_MODEL_IDS.filter(
      (modelId) => !detailByModel.has(modelId),
    );
    if (missing.length)
      throw new Error(
        `LongCat model metadata for ${missing.join(", ")} requires LONGCAT_API_KEY`,
      );
  }

  sources.push({
    url: LONGCAT_QUICKSTART_URL,
    kind: "model-metadata",
    locale: "en",
    retrievedAt,
    contentHash: hash(JSON.stringify([...maxOutputByModel.entries()])),
  });

  const models = LONGCAT_PRICED_MODEL_IDS.map((modelId) => {
    const detail = detailByModel.get(modelId)!;
    const maxOutputTokens = maxOutputByModel.get(modelId);
    if (!maxOutputTokens)
      throw new Error(`LongCat quick start is missing the maximum output length for ${modelId}`);
    const parameters = detail.supported_parameters;
    return {
      id: detail.id,
      name: detail.name,
      createdAt: new Date(detail.created * 1000).toISOString(),
      tokenizer: detail.architecture.tokenizer,
      aliases: [],
      capabilities: {
        thinking: parameters.includes("thinking"),
        toolCalls: parameters.includes("tools"),
        inputModalities: detail.architecture.input_modalities,
        outputModalities: detail.architecture.output_modalities,
        supportedParameters: parameters,
      },
      limits: {
        contextTokens: detail.context_length,
        maxOutputTokens,
      },
      prices: pricesByModel.get(modelId) ?? [],
    };
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    health: healthyHealth(now),
    id: "longcat",
    name: "LongCat",
    displayNames: {
      "zh-CN": "美团",
      en: "Meituan",
    },
    ownedBy: "longcat",
    baseUrls: {
      openai: "https://api.longcat.chat/openai",
      anthropic: "https://api.longcat.chat/anthropic",
    },
    models,
    sources,
  };
}
