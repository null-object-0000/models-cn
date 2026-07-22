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
  },
  {
    url: "https://longcat.chat/platform/docs/pricing/long-cat-2.0",
    locale: "en",
    currency: "USD",
    market: "international",
  },
] as const;

export const LONGCAT_MODEL_DOC_URL =
  "https://longcat.chat/platform/docs/zh/api/model";
export const LONGCAT_QUICKSTART_URL = "https://longcat.chat/platform/docs/";
export const LONGCAT_MODEL_API_URL =
  "https://api.longcat.chat/openai/v1/models/LongCat-2.0";
export const LONGCAT_MODELS_API_URL =
  "https://api.longcat.chat/openai/v1/models";

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

  const findValues = (pattern: RegExp): [string, string] => {
    const row = table
      .find("tr")
      .filter((_, element) => pattern.test(cleanText($(element).text())))
      .first();
    const cells = row
      .find("td")
      .map((_, cell) => cleanText($(cell).text()))
      .get();
    if (cells.length < 3 || !cells.at(-2) || !cells.at(-1)) {
      throw new Error(`LongCat pricing table is missing ${pattern}`);
    }
    return [cells.at(-2)!, cells.at(-1)!];
  };

  const uncached = findValues(/^输入（未命中缓存）|^Uncached Input/i);
  const cached = findValues(/^输入（命中缓存）|^Cached Input/i);
  const output = findValues(/^输出|Output/i);
  const makePrice = (index: 0 | 1): Omit<ModelPrice, "sourceUrl"> => ({
    market: config.market as Market,
    currency: config.currency as Currency,
    unit: "1M_tokens",
    rateType: index === 0 ? "standard" : "promotional",
    input: {
      cacheHit: parseMoney(cached[index]),
      standard: parseMoney(uncached[index]),
    },
    output: parseMoney(output[index]),
  });

  return {
    prices: [makePrice(0), makePrice(1)],
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
  if (detail.id !== "LongCat-2.0" || !detail.context_length) {
    throw new Error("LongCat model documentation returned unexpected metadata");
  }
  return detail;
}

export function parseLongCatMaxOutput(html: string): number {
  const text = cleanText(cheerio.load(html).root().text());
  const match = text.match(
    /LongCat-2\.0.{0,150}maximum output length of\s*([\d.]+\s*[KM])/i,
  );
  if (!match?.[1])
    throw new Error("LongCat quick start is missing the maximum output length");
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

  let detail = parseLongCatModelDocs(modelDocsHtml);
  let maxOutputTokens = parseLongCatMaxOutput(quickstartHtml);
  const retrievedAt = now.toISOString();
  const sources: Source[] = pricingPages.map(({ config, parsed }) => ({
    url: config.url,
    kind: "pricing",
    locale: config.locale,
    currency: config.currency,
    retrievedAt,
    contentHash: hash(parsed.normalizedTable),
  }));
  sources.push(
    {
      url: LONGCAT_MODEL_DOC_URL,
      kind: "model-metadata",
      locale: "zh-CN",
      retrievedAt,
      contentHash: hash(JSON.stringify(detail)),
    },
    {
      url: LONGCAT_QUICKSTART_URL,
      kind: "model-metadata",
      locale: "en",
      retrievedAt,
      contentHash: hash(String(maxOutputTokens)),
    },
  );

  const prices = pricingPages.flatMap(({ config, parsed }) =>
    parsed.prices.map((price) => ({ ...price, sourceUrl: config.url })),
  );

  if (apiKey) {
    const [apiDetail, list] = await Promise.all([
      fetchAuthenticatedJson<LongCatModelDetail>(LONGCAT_MODEL_API_URL, apiKey),
      fetchAuthenticatedJson<LongCatModelList>(LONGCAT_MODELS_API_URL, apiKey),
    ]);
    const listed = list.data.find((model) => model.id === "LongCat-2.0");
    if (!listed)
      throw new Error("LongCat API model list does not include LongCat-2.0");
    assertApiPricingMatchesDocumentation(apiDetail, prices);
    detail = apiDetail;
    maxOutputTokens = listed.max_output_tokens ?? maxOutputTokens;
    if (
      listed.context_window &&
      listed.context_window !== detail.context_length
    ) {
      throw new Error(
        "LongCat list and detail endpoints disagree on context length",
      );
    }
    sources.push(
      {
        url: LONGCAT_MODEL_API_URL,
        kind: "model-metadata",
        locale: "en",
        retrievedAt,
        contentHash: hash(JSON.stringify(apiDetail)),
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

  const parameters = detail.supported_parameters;
  return {
    schemaVersion: SCHEMA_VERSION,
    health: healthyHealth(now),
    id: "longcat",
    name: "LongCat",
    ownedBy: "longcat",
    baseUrls: {
      openai: "https://api.longcat.chat/openai",
      anthropic: "https://api.longcat.chat/anthropic",
    },
    models: [
      {
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
        prices,
      },
    ],
    sources,
  };
}
