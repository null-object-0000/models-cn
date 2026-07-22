import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type {
  Currency,
  Market,
  ModelAlias,
  ModelData,
  ModelPrice,
  ProviderData,
  Source,
} from "../types.js";
import { SCHEMA_VERSION } from "../types.js";
import { healthyHealth } from "../health.js";

export const DEEPSEEK_SOURCES = [
  {
    url: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
    locale: "zh-CN",
    currency: "CNY",
    market: "china",
  },
  {
    url: "https://api-docs.deepseek.com/quick_start/pricing/",
    locale: "en",
    currency: "USD",
    market: "international",
  },
] as const;

type SourceConfig = (typeof DEEPSEEK_SOURCES)[number];

interface ParsedPage {
  models: Array<
    Omit<ModelData, "prices" | "aliases"> & {
      price: Omit<ModelPrice, "sourceUrl">;
    }
  >;
  aliases: ModelAlias[];
  baseUrls: ProviderData["baseUrls"];
  normalizedTable: string;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseTokenCount(value: string): number {
  const match = cleanText(value).match(/([\d.]+)\s*([KM])?/i);
  if (!match?.[1]) throw new Error(`Cannot parse token count: ${value}`);
  const amount = Number(match[1]);
  const multiplier =
    match[2]?.toUpperCase() === "M"
      ? 1_000_000
      : match[2]?.toUpperCase() === "K"
        ? 1_000
        : 1;
  return amount * multiplier;
}

function parseMoney(value: string): number {
  const match = cleanText(value).match(/[\d.]+/);
  if (!match) throw new Error(`Cannot parse price: ${value}`);
  return Number(match[0]);
}

function rowTexts($: cheerio.CheerioAPI, row: AnyNode): string[] {
  return $(row)
    .find("td")
    .map((_, cell) => cleanText($(cell).text()))
    .get();
}

function findRow(
  $: cheerio.CheerioAPI,
  rows: AnyNode[],
  matcher: (texts: string[]) => boolean,
): string[] {
  for (const row of rows) {
    const texts = rowTexts($, row);
    if (matcher(texts)) return texts;
  }
  throw new Error("DeepSeek pricing table is missing an expected row");
}

function valuesForModels(texts: string[], modelCount: number): string[] {
  if (texts.length < modelCount) {
    throw new Error(
      `Expected ${modelCount} model values, received ${texts.length}`,
    );
  }
  const values = texts.slice(-modelCount);
  if (values.length !== modelCount) throw new Error("Incomplete model row");
  return values;
}

export function parseDeepSeekPage(
  html: string,
  config: SourceConfig,
): ParsedPage {
  const $ = cheerio.load(html);
  const table = $("table")
    .filter((_, element) => $(element).text().includes("deepseek-"))
    .first();
  if (!table.length)
    throw new Error(`No DeepSeek pricing table found at ${config.url}`);

  const rows = table.find("tr").toArray();
  const modelRow = findRow($, rows, (texts) =>
    texts.some((text) => text.startsWith("deepseek-")),
  );
  const modelIds = modelRow
    .filter((text) => text.startsWith("deepseek-"))
    .map((text) => text.replace(/\(\d+\)$/, ""));
  if (!modelIds.length)
    throw new Error("No model IDs found in DeepSeek pricing table");

  const versionRow = findRow($, rows, (texts) =>
    /模型版本|MODEL VERSION/i.test(texts[0] ?? ""),
  );
  const contextRow = findRow($, rows, (texts) =>
    /上下文长度|CONTEXT LENGTH/i.test(texts[0] ?? ""),
  );
  const outputRow = findRow($, rows, (texts) =>
    /输出长度|MAX OUTPUT/i.test(texts[0] ?? ""),
  );
  const cacheHitRow = findRow($, rows, (texts) =>
    /缓存命中|CACHE HIT/i.test(texts.join(" ")),
  );
  const standardRow = findRow($, rows, (texts) =>
    /缓存未命中|CACHE MISS/i.test(texts.join(" ")),
  );
  const outputPriceRow = findRow($, rows, (texts) =>
    /百万tokens输出|1M OUTPUT TOKENS/i.test(texts.join(" ")),
  );
  const concurrencyRow = findRow($, rows, (texts) =>
    /并发限制|Concurrency Limit/i.test(texts[0] ?? ""),
  );

  const versions = valuesForModels(versionRow, modelIds.length);
  const cacheHits = valuesForModels(cacheHitRow, modelIds.length);
  const standardPrices = valuesForModels(standardRow, modelIds.length);
  const outputPrices = valuesForModels(outputPriceRow, modelIds.length);
  const concurrencies = valuesForModels(concurrencyRow, modelIds.length);
  const contextTokens = parseTokenCount(contextRow.at(-1) ?? "");
  const maxOutputTokens = parseTokenCount(outputRow.at(-1) ?? "");

  const featureValues = (hrefSuffix: string): string[] => {
    const row = table.find(`a[href$="${hrefSuffix}"]`).first().closest("tr");
    if (!row.length) throw new Error(`Feature row ${hrefSuffix} is missing`);
    return valuesForModels(rowTexts($, row.get(0)!), modelIds.length);
  };
  const jsonOutput = featureValues("json_mode");
  const toolCalls = featureValues("tool_calls");
  const prefixCompletion = featureValues("chat_prefix_completion");
  const fimCompletion = featureValues("fim_completion");

  const links = table
    .find('a[href^="https://api.deepseek.com"]')
    .map((_, link) => $(link).attr("href")!)
    .get();
  const baseUrls: ProviderData["baseUrls"] = {
    openai:
      links.find((url) => !url.endsWith("/anthropic")) ??
      "https://api.deepseek.com",
    anthropic:
      links.find((url) => url.endsWith("/anthropic")) ??
      "https://api.deepseek.com/anthropic",
  };

  const pageText = cleanText($.root().text());
  const deprecatedMatch =
    config.locale === "zh-CN"
      ? pageText.match(
          /北京时间\s*(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})\s*弃用/,
        )
      : pageText.match(
          /deprecated on\s+(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})\s+UTC/i,
        );
  const deprecatedAt = deprecatedMatch
    ? `${deprecatedMatch[1]}-${deprecatedMatch[2]}-${deprecatedMatch[3]}T${deprecatedMatch[4]}:${deprecatedMatch[5]}:00${config.locale === "zh-CN" ? "+08:00" : "Z"}`
    : undefined;
  const aliases: ModelAlias[] = [];
  if (modelIds.includes("deepseek-v4-flash")) {
    aliases.push(
      {
        id: "deepseek-chat",
        mode: "non-thinking",
        ...(deprecatedAt ? { deprecatedAt } : {}),
      },
      {
        id: "deepseek-reasoner",
        mode: "thinking",
        ...(deprecatedAt ? { deprecatedAt } : {}),
      },
    );
  }

  const supported = (value: string) => /支持|✓/.test(value);
  const models = modelIds.map((id, index) => ({
    id,
    name: versions[index] ?? id,
    capabilities: {
      thinking: true,
      jsonOutput: supported(jsonOutput[index] ?? ""),
      toolCalls: supported(toolCalls[index] ?? ""),
      chatPrefixCompletion: supported(prefixCompletion[index] ?? ""),
      fimCompletion: /仅非思考|Non-thinking mode only/i.test(
        fimCompletion[index] ?? "",
      )
        ? ("non-thinking-only" as const)
        : supported(fimCompletion[index] ?? "")
          ? ("supported" as const)
          : ("unsupported" as const),
    },
    limits: {
      contextTokens,
      maxOutputTokens,
      concurrency: Number(concurrencies[index]),
    },
    price: {
      market: config.market as Market,
      currency: config.currency as Currency,
      unit: "1M_tokens" as const,
      rateType: "standard" as const,
      input: {
        cacheHit: parseMoney(cacheHits[index] ?? ""),
        standard: parseMoney(standardPrices[index] ?? ""),
      },
      output: parseMoney(outputPrices[index] ?? ""),
    },
  }));

  return {
    models,
    aliases,
    baseUrls,
    normalizedTable: cleanText(table.html() ?? ""),
  };
}

async function fetchPage(url: string): Promise<string> {
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

export async function collectDeepSeek(
  now = new Date(),
  fetcher: (url: string) => Promise<string> = fetchPage,
): Promise<ProviderData> {
  const pages = await Promise.all(
    DEEPSEEK_SOURCES.map(async (config) => ({
      config,
      parsed: parseDeepSeekPage(await fetcher(config.url), config),
    })),
  );
  const first = pages[0]!;
  const byId = new Map<string, ModelData>();

  for (const { config, parsed } of pages) {
    for (const model of parsed.models) {
      const existing = byId.get(model.id);
      if (!existing) {
        byId.set(model.id, {
          id: model.id,
          name: model.name,
          aliases: model.id === "deepseek-v4-flash" ? first.parsed.aliases : [],
          capabilities: model.capabilities,
          limits: model.limits,
          prices: [{ ...model.price, sourceUrl: config.url }],
        });
      } else {
        existing.prices.push({ ...model.price, sourceUrl: config.url });
      }
    }
  }

  const retrievedAt = now.toISOString();
  const sources: Source[] = pages.map(({ config, parsed }) => ({
    url: config.url,
    kind: "pricing",
    locale: config.locale,
    currency: config.currency,
    retrievedAt,
    contentHash: `sha256:${createHash("sha256").update(parsed.normalizedTable).digest("hex")}`,
  }));

  return {
    schemaVersion: SCHEMA_VERSION,
    health: healthyHealth(now),
    id: "deepseek",
    name: "DeepSeek",
    ownedBy: "deepseek",
    baseUrls: first.parsed.baseUrls,
    models: [...byId.values()],
    sources,
  };
}
