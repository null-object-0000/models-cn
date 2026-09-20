import { createHash } from "node:crypto";
import type {
  Currency,
  Market,
  ModelData,
  ModelPrice,
  ProviderData,
  Source,
} from "../types.js";
import { SCHEMA_VERSION } from "../types.js";
import { healthyHealth } from "../health.js";

interface MoonshotChannel {
  id: "moonshot-cn" | "moonshot-intl";
  name: string;
  displayNames: NonNullable<ProviderData["displayNames"]>;
  apiBaseUrl: string;
  docsBaseUrl: string;
  market: Market;
  currency: Currency;
  locale: Source["locale"];
}

export const MOONSHOT_CHANNELS = {
  china: {
    id: "moonshot-cn",
    name: "Kimi China",
    displayNames: {
      "zh-CN": "月之暗面",
      en: "Moonshot AI",
    },
    apiBaseUrl: "https://api.moonshot.cn/v1",
    docsBaseUrl: "https://platform.kimi.com",
    market: "china",
    currency: "CNY",
    locale: "zh-CN",
  },
  international: {
    id: "moonshot-intl",
    name: "Kimi International",
    displayNames: {
      "zh-CN": "月之暗面",
      en: "Moonshot AI",
    },
    apiBaseUrl: "https://api.moonshot.ai/v1",
    docsBaseUrl: "https://platform.kimi.ai",
    market: "international",
    currency: "USD",
    locale: "en",
  },
} as const satisfies Record<string, MoonshotChannel>;

/** Kimi 现在把全部在售模型的定价放在同一张表里（旧的 chat-k3/k27-code/k26 路由 307 到 chat.md）。 */
const pricingPaths = ["/docs/pricing/chat"] as const;

function pricingSources(channel: MoonshotChannel): string[] {
  return pricingPaths.map((path) => `${channel.docsBaseUrl}${path}`);
}

function modelsOverviewUrl(channel: MoonshotChannel): string {
  return `${channel.docsBaseUrl}/docs/api/models-overview`;
}

function outputLimitsUrl(channel: MoonshotChannel): string {
  return `${channel.docsBaseUrl}/docs/guide/troubleshooting#kimi`;
}

export const MOONSHOT_PRICING_SOURCES = pricingSources(MOONSHOT_CHANNELS.china);
export const MOONSHOT_MODELS_OVERVIEW_URL = modelsOverviewUrl(
  MOONSHOT_CHANNELS.china,
);
export const MOONSHOT_OUTPUT_LIMITS_URL = outputLimitsUrl(
  MOONSHOT_CHANNELS.china,
);

interface ParsedMoonshotPage {
  models: ModelData[];
  normalizedTable: string;
}

function parseMoney(value: string): number {
  const match = value.match(/[\d.]+/);
  if (!match) throw new Error(`Cannot parse Kimi price: ${value}`);
  return Number(match[0]);
}

function parseTokenCount(value: string): number {
  const normalized = value.replaceAll(",", "");
  const match = normalized.match(/[\d.]+/);
  if (!match) throw new Error(`Cannot parse Kimi token count: ${value}`);
  return Number(match[0]);
}

/** One `<DocTable>` block: its column titles and its row arrays, in document order. */
interface KimiTable {
  columns: string[];
  rows: string[][];
}

function parseTables(markdown: string): KimiTable[] {
  const tables: KimiTable[] = [];
  // The block terminator is a `/>` at the start of a line. A bare `/>` search would stop early on
  // the MDX currency cells (`<>{"$"}3.00</>` contains `/>`), which only the international page
  // uses — the Chinese page writes plain `¥` strings and hid the bug.
  for (const match of markdown.matchAll(/<DocTable\b([\s\S]*?)\n\/>/g)) {
    const block = match[1]!;
    const columnsBlock = block.match(/columns=\{\[([\s\S]*?)\]\}/)?.[1];
    if (!columnsBlock) continue;
    const columns = [...columnsBlock.matchAll(/title:\s*"([^"]+)"/g)].map(
      (entry) => entry[1]!,
    );
    const rowsBlock = block.match(/rows=\{\[([\s\S]*?)\]\}/)?.[1];
    if (!columns.length || !rowsBlock) continue;
    const rows = rowsBlock
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/,$/, ""))
      .filter((line) => line.startsWith("["))
      .map(
        (line) =>
          JSON.parse(
            line.replace(
              /<>\s*\{\s*["']\$["']\s*\}\s*([\d.]+)\s*<\/>/g,
              '"$$$1"',
            ),
          ) as string[],
      );
    if (rows.length) tables.push({ columns, rows });
  }
  if (!tables.length)
    throw new Error("Kimi pricing page is missing its rows table");
  return tables;
}

/**
 * Kimi's pricing page is bilingual (zh/en) and carries one table per model family, and the
 * families do not share a column layout: K3 bills cache writes per TTL tier (two extra columns)
 * while the K2 family does not. Reading by column *title* instead of by position keeps a new
 * column from breaking the whole collector — which is exactly what happened when the K3 table
 * grew from 6 to 8 columns.
 */
function columnIndex(columns: string[], ...patterns: RegExp[]): number {
  for (const pattern of patterns) {
    const index = columns.findIndex((column) => pattern.test(column));
    if (index >= 0) return index;
  }
  return -1;
}

const COLUMN_PATTERNS = {
  model: [/模型/, /^Model$/i],
  unit: [/计费单位/, /^Unit$/i],
  cacheWriteShort: [/缓存写入（TTL 5min）/, /Cache Write Price \(TTL 5min\)/i],
  cacheWriteLong: [/缓存写入（TTL 1h）/, /Cache Write Price \(TTL 1h\)/i],
  // The two English tables name the same columns differently: K3 uses "Cached Input Price" /
  // "Input Price", the K2 family uses "Input Price (Cache Hit)" / "Input Price (Cache Miss)".
  // Order matters — "Cache Miss" must be tried before the bare "Input Price".
  cacheHit: [/缓存命中/, /Cache Hit/i, /Cached Input Price/i],
  inputStandard: [/缓存未命中/, /Cache Miss/i, /^Input Price$/i],
  output: [/^输出价格$/, /^Output Price$/i],
  context: [/上下文窗口/, /Context Window/i],
} as const;

function tableToModels(
  table: KimiTable,
  sourceUrl: string,
  market: Market,
  currency: Currency,
): ModelData[] {
  const { columns } = table;
  const index = {
    model: columnIndex(columns, ...COLUMN_PATTERNS.model),
    cacheWriteShort: columnIndex(columns, ...COLUMN_PATTERNS.cacheWriteShort),
    cacheWriteLong: columnIndex(columns, ...COLUMN_PATTERNS.cacheWriteLong),
    cacheHit: columnIndex(columns, ...COLUMN_PATTERNS.cacheHit),
    inputStandard: columnIndex(columns, ...COLUMN_PATTERNS.inputStandard),
    output: columnIndex(columns, ...COLUMN_PATTERNS.output),
    context: columnIndex(columns, ...COLUMN_PATTERNS.context),
  };
  if (index.model < 0 || index.inputStandard < 0 || index.output < 0) {
    throw new Error(
      `Unexpected Kimi pricing table columns: ${JSON.stringify(columns)}`,
    );
  }
  return table.rows.map((row) => {
    const id = row[index.model]!;
    if (!id) throw new Error("Kimi pricing row is missing a model ID");
    const cell = (at: number): string | undefined =>
      at >= 0 ? row[at] : undefined;
    const cacheHitValue = cell(index.cacheHit);
    const cacheWriteShort = cell(index.cacheWriteShort);
    const cacheWriteLong = cell(index.cacheWriteLong);
    const contextValue = cell(index.context);
    const price: ModelPrice = {
      market,
      currency,
      unit: "1M_tokens",
      rateType: "standard",
      input: {
        ...(cacheHitValue ? { cacheHit: parseMoney(cacheHitValue) } : {}),
        ...(cacheWriteShort
          ? { explicitCacheCreation: parseMoney(cacheWriteShort) }
          : {}),
        ...(cacheWriteLong
          ? { explicitCacheCreation1h: parseMoney(cacheWriteLong) }
          : {}),
        standard: parseMoney(row[index.inputStandard]!),
      },
      output: parseMoney(row[index.output]!),
      sourceUrl,
    };
    return {
      id,
      name: modelName(id),
      aliases: [],
      capabilities: {},
      limits: {
        contextTokens: contextValue ? parseTokenCount(contextValue) : 0,
      },
      prices: [price],
    } satisfies ModelData;
  });
}

export function parseMoonshotOutputLimits(
  markdown: string,
): ReadonlyMap<string, number> {
  const section =
    markdown
      .split("Kimi 大模型的输出长度是多少")[1]
      ?.split("Kimi 大模型支持的汉字数量是多少")[0] ??
    markdown
      .split("What is the output length of the Kimi model?")[1]
      ?.split("How many Chinese characters does the Kimi model support?")[0];
  if (!section) {
    throw new Error("Kimi troubleshooting page is missing output limits");
  }

  const limits = new Map<string, number>();
  for (const id of ["kimi-k3", "kimi-k2.6"]) {
    const escapedId = id.replaceAll(".", "\\.");
    const expression = section.match(
      new RegExp(
        `${escapedId}[^\\n]*?(\\d+)\\s*\\*\\s*(\\d+)\\s*-\\s*prompt_tokens`,
        "i",
      ),
    );
    if (!expression) {
      throw new Error(`Kimi output limits are missing ${id}`);
    }
    limits.set(id, Number(expression[1]) * Number(expression[2]));
  }
  return limits;
}

/** 仅保留外显名称与范围守卫；能力字段统一由 data/manual/capabilities.json 维护。 */
function modelName(id: string): string {
  if (id === "kimi-k3") return "Kimi K3";
  if (id.startsWith("kimi-k2.7-code")) {
    return id === "kimi-k2.7-code-highspeed"
      ? "Kimi K2.7 Code HighSpeed"
      : "Kimi K2.7 Code";
  }
  if (id === "kimi-k2.6") return "Kimi K2.6";
  if (id === "kimi-k2.5") return "Kimi K2.5";
  if (!id.startsWith("kimi-")) {
    throw new Error(`Unsupported non-Kimi model in Kimi collector: ${id}`);
  }
  return id;
}

export function parseMoonshotPricingPage(
  markdown: string,
  sourceUrl: string,
  market: Market = "china",
  currency: Currency = "CNY",
): ParsedMoonshotPage {
  const tables = parseTables(markdown);
  const models = tables.flatMap((table) =>
    tableToModels(table, sourceUrl, market, currency),
  );
  const ids = new Set(models.map((model) => model.id));
  if (ids.size !== models.length) {
    throw new Error("Kimi pricing page contains duplicate model IDs");
  }
  return {
    models,
    normalizedTable: JSON.stringify(tables.map((table) => table.rows)),
  };
}

async function fetchMarkdown(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept: "text/markdown",
      "user-agent":
        "models-cn/0.1 (+https://github.com/null-object-0000/models-cn)",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  return response.text();
}

async function collectMoonshotChannel(
  channel: MoonshotChannel,
  now = new Date(),
  fetcher: (url: string) => Promise<string> = fetchMarkdown,
): Promise<ProviderData> {
  const pricingUrls = pricingSources(channel);
  const overviewUrl = modelsOverviewUrl(channel);
  const limitsUrl = outputLimitsUrl(channel);
  const [pages, overview, troubleshooting] = await Promise.all([
    Promise.all(
      pricingUrls.map(async (url) => ({
        url,
        parsed: parseMoonshotPricingPage(
          await fetcher(url),
          url,
          channel.market,
          channel.currency,
        ),
      })),
    ),
    fetcher(overviewUrl),
    fetcher(limitsUrl),
  ]);
  for (const id of ["kimi-k3", "kimi-k2.7-code", "kimi-k2.6"]) {
    if (!overview.includes(id)) {
      throw new Error(`Kimi model overview is missing ${id}`);
    }
  }
  const outputLimits = parseMoonshotOutputLimits(troubleshooting);
  for (const { parsed } of pages) {
    for (const model of parsed.models) {
      const maxOutputTokens = outputLimits.get(model.id);
      if (maxOutputTokens !== undefined) {
        model.limits.maxOutputTokens = maxOutputTokens;
      }
    }
  }
  const retrievedAt = now.toISOString();
  const sources: Source[] = pages.map(({ url, parsed }) => ({
    url,
    kind: "pricing",
    locale: channel.locale,
    currency: channel.currency,
    retrievedAt,
    contentHash: `sha256:${createHash("sha256").update(parsed.normalizedTable).digest("hex")}`,
  }));
  sources.push({
    url: overviewUrl,
    kind: "model-metadata",
    locale: channel.locale,
    retrievedAt,
    contentHash: `sha256:${createHash("sha256").update(overview.replace(/\s+/g, " ").trim()).digest("hex")}`,
  });
  sources.push({
    url: limitsUrl,
    kind: "model-metadata",
    locale: channel.locale,
    retrievedAt,
    contentHash: `sha256:${createHash("sha256").update(troubleshooting.replace(/\s+/g, " ").trim()).digest("hex")}`,
  });
  const models = pages.flatMap(({ parsed }) => parsed.models);
  if (new Set(models.map((model) => model.id)).size !== models.length) {
    throw new Error("Kimi pricing pages contain duplicate model IDs");
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    health: healthyHealth(now),
    id: channel.id,
    name: channel.name,
    displayNames: channel.displayNames,
    ownedBy: "moonshot",
    baseUrls: { openai: channel.apiBaseUrl },
    models,
    sources,
  };
}

export function collectMoonshotChina(
  now = new Date(),
  fetcher: (url: string) => Promise<string> = fetchMarkdown,
): Promise<ProviderData> {
  return collectMoonshotChannel(MOONSHOT_CHANNELS.china, now, fetcher);
}

export function collectMoonshotInternational(
  now = new Date(),
  fetcher: (url: string) => Promise<string> = fetchMarkdown,
): Promise<ProviderData> {
  return collectMoonshotChannel(MOONSHOT_CHANNELS.international, now, fetcher);
}

export const collectMoonshot = collectMoonshotChina;
