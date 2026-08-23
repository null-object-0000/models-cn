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
      prices: Array<Omit<ModelPrice, "sourceUrl">>;
    }
  >;
  aliases: ModelAlias[];
  baseUrls: ProviderData["baseUrls"];
  normalizedTable: string;
}

function announcedEffectiveFrom(
  pageText: string,
  config: SourceConfig,
): string | undefined {
  if (config.locale === "zh-CN") {
    const match = pageText.match(
      /北京时间\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{2}):(\d{2})\s*开始生效/,
    );
    return match
      ? `${match[1]}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}T${match[4]}:${match[5]}:00+08:00`
      : undefined;
  }
  const match = pageText.match(
    /take effect at\s*(\d{2}):(\d{2})\s*UTC on ([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/i,
  );
  if (!match) return undefined;
  const month = new Date(`${match[3]} 1, 2000 UTC`).getUTCMonth() + 1;
  return `${match[5]}-${String(month).padStart(2, "0")}-${match[4]!.padStart(2, "0")}T${match[1]}:${match[2]}:00Z`;
}

/**
 * Weekdays on which the peak windows apply. Peak hours are defined as
 * 周一至周五 (Monday through Friday) in the local timezone, so the peak
 * intervals below repeat only on weekdays while off-peak additionally
 * covers the whole weekend (expressed as a full-day `00:00–00:00` interval).
 */
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"] as const;
const WEEKEND = ["sat", "sun"] as const;

type TimeInterval = NonNullable<
  ModelPrice["dailyTimeRange"]
>["intervals"][number];

function weekdayWindows(
  windows: Array<[start: string, end: string]>,
): TimeInterval[] {
  return windows.map(([start, end]) => ({ start, end, days: [...WEEKDAYS] }));
}

function timeRange(
  config: SourceConfig,
  peak: boolean,
): NonNullable<ModelPrice["dailyTimeRange"]> {
  if (config.locale === "zh-CN") {
    return peak
      ? {
          label: "高峰时段",
          timeZone: "Asia/Shanghai",
          intervals: weekdayWindows([
            ["09:00", "12:00"],
            ["14:00", "18:00"],
          ]),
        }
      : {
          label: "空闲时段",
          timeZone: "Asia/Shanghai",
          intervals: [
            ...weekdayWindows([
              ["00:00", "09:00"],
              ["12:00", "14:00"],
              ["18:00", "00:00"],
            ]),
            { start: "00:00", end: "00:00", days: [...WEEKEND] },
          ],
        };
  }
  return peak
    ? {
        label: "Peak",
        timeZone: "UTC",
        intervals: weekdayWindows([
          ["01:00", "04:00"],
          ["06:00", "10:00"],
        ]),
      }
    : {
        label: "Off-peak",
        timeZone: "UTC",
        intervals: [
          ...weekdayWindows([
            ["00:00", "01:00"],
            ["04:00", "06:00"],
            ["10:00", "00:00"],
          ]),
          { start: "00:00", end: "00:00", days: [...WEEKEND] },
        ],
      };
}

function parseScheduledPrices(
  $: cheerio.CheerioAPI,
  config: SourceConfig,
  effectiveFrom: string | undefined,
): Map<string, Array<Omit<ModelPrice, "sourceUrl">>> {
  if (!effectiveFrom) return new Map();
  const table = $("table")
    .filter((_, element) => /空闲时段|OFF-PEAK/i.test($(element).text()))
    .first();
  if (!table.length) return new Map();

  const result = new Map<string, Array<Omit<ModelPrice, "sourceUrl">>>();
  let currentModel: string | undefined;
  for (const row of table.find("tr").toArray()) {
    const texts = rowTexts($, row);
    const model = texts.find((text) => text.startsWith("deepseek-"));
    if (model) currentModel = model;
    const peakIndex = texts.findIndex((text) =>
      /^(高峰时段|PEAK)$/i.test(text),
    );
    const offPeakIndex = texts.findIndex((text) =>
      /^(空闲时段|OFF-PEAK)$/i.test(text),
    );
    const periodIndex = peakIndex >= 0 ? peakIndex : offPeakIndex;
    if (!currentModel || periodIndex < 0) continue;
    const values = texts.slice(periodIndex + 1);
    if (values.length < 3) continue;
    const prices = result.get(currentModel) ?? [];
    prices.push({
      market: config.market,
      currency: config.currency,
      unit: "1M_tokens",
      rateType: "standard",
      dailyTimeRange: timeRange(config, peakIndex >= 0),
      input: {
        cacheHit: parseMoney(values[0]!),
        standard: parseMoney(values[1]!),
      },
      output: parseMoney(values[2]!),
      effectiveFrom,
    });
    result.set(currentModel, prices);
  }
  return result;
}

const PERIOD_LABEL = /^(空闲时段|OFF-PEAK|高峰时段|PEAK)$/i;

/**
 * Parse the finalized pricing layout where the off-peak / peak prices are
 * listed directly in the main model table (row-spanned price dimensions, one
 * row per period), e.g.:
 *
 *   `<td rowspan="2">百万tokens输入（缓存命中）</td><td>空闲时段</td><td>…</td>`
 *   `<td>高峰时段</td><td>…</td>`
 *
 * The previous transitional layout (plain current prices + a separate
 * "prices take effect" table) is handled separately by
 * `parseScheduledPrices`. Returns an empty map when the main table does not
 * use period-labeled price rows.
 */
function parseFinalizedPrices(
  $: cheerio.CheerioAPI,
  config: SourceConfig,
  modelIds: string[],
): Map<string, Array<Omit<ModelPrice, "sourceUrl">>> {
  const result = new Map<string, Array<Omit<ModelPrice, "sourceUrl">>>();
  const table = $("table")
    .filter((_, element) => $(element).text().includes("deepseek-"))
    .first();
  if (!table.length) return result;

  const rows = table.find("tr").toArray();
  const hasPeriodRows = rows.some((row) =>
    rowTexts($, row).some((text) => PERIOD_LABEL.test(text)),
  );
  if (!hasPeriodRows) return result;

  const perPeriod = new Map<
    "idle" | "peak",
    { cacheHit: number[]; standard: number[]; output: number[] }
  >();
  let dimension: "cacheHit" | "standard" | "output" | undefined;
  for (const row of rows) {
    const texts = rowTexts($, row);
    const joined = texts.join(" ");
    if (/缓存命中|CACHE HIT/i.test(joined)) dimension = "cacheHit";
    else if (/缓存未命中|CACHE MISS/i.test(joined)) dimension = "standard";
    else if (/百万tokens输出|1M OUTPUT TOKENS/i.test(joined))
      dimension = "output";
    const periodText = texts.find((text) => PERIOD_LABEL.test(text));
    if (!periodText || !dimension) continue;
    const period: "idle" | "peak" = /^(高峰时段|PEAK)$/i.test(periodText)
      ? "peak"
      : "idle";
    const values = valuesForModels(texts, modelIds.length).map(parseMoney);
    const slot = perPeriod.get(period) ?? {
      cacheHit: [],
      standard: [],
      output: [],
    };
    slot[dimension] = values;
    perPeriod.set(period, slot);
  }

  const expected = modelIds.length;
  for (const period of ["idle", "peak"] as const) {
    const slot = perPeriod.get(period);
    if (
      !slot ||
      slot.cacheHit.length !== expected ||
      slot.standard.length !== expected ||
      slot.output.length !== expected
    ) {
      throw new Error(
        `DeepSeek pricing table is missing ${period} period values for every model`,
      );
    }
  }

  for (const [index, id] of modelIds.entries()) {
    const prices: Array<Omit<ModelPrice, "sourceUrl">> = [];
    for (const period of ["idle", "peak"] as const) {
      const slot = perPeriod.get(period)!;
      prices.push({
        market: config.market as Market,
        currency: config.currency as Currency,
        unit: "1M_tokens" as const,
        rateType: "standard" as const,
        dailyTimeRange: timeRange(config, period === "peak"),
        input: {
          cacheHit: slot.cacheHit[index]!,
          standard: slot.standard[index]!,
        },
        output: slot.output[index]!,
      });
    }
    result.set(id, prices);
  }
  return result;
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
  const effectiveFrom = announcedEffectiveFrom(pageText, config);
  const scheduledPrices = parseScheduledPrices($, config, effectiveFrom);
  const finalizedPrices = parseFinalizedPrices($, config, modelIds);
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

  const supported = (value: string) => /支持|✓|Supported|Yes/i.test(value);
  const finalized = finalizedPrices.size > 0;
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
    prices: finalized
      ? (finalizedPrices.get(id) ?? [])
      : [
          {
            market: config.market as Market,
            currency: config.currency as Currency,
            unit: "1M_tokens" as const,
            rateType: "standard" as const,
            input: {
              cacheHit: parseMoney(cacheHits[index] ?? ""),
              standard: parseMoney(standardPrices[index] ?? ""),
            },
            output: parseMoney(outputPrices[index] ?? ""),
            ...(effectiveFrom ? { effectiveTo: effectiveFrom } : {}),
          },
          ...(scheduledPrices.get(id) ?? []),
        ],
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
          prices: model.prices.map((price) => ({
            ...price,
            sourceUrl: config.url,
          })),
        });
      } else {
        existing.prices.push(
          ...model.prices.map((price) => ({
            ...price,
            sourceUrl: config.url,
          })),
        );
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
    displayNames: {
      "zh-CN": "深度求索",
      en: "DeepSeek",
    },
    ownedBy: "deepseek",
    baseUrls: first.parsed.baseUrls,
    models: [...byId.values()],
    sources,
  };
}
