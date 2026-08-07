import { createHash } from "node:crypto";
import { chromium } from "playwright";
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

/**
 * 智谱 GLM 采集器。渠道范围：国内版 `zhipu-cn`（人民币）+ 国际版 `zhipu-intl`（美元）。
 *
 * 数据来源：
 * - 国内价格：`bigmodel.cn/pricing`（Vue SPA，用 Playwright 读渲染后的 DOM 表格）。
 * - 国际价格：`docs.z.ai/guides/overview/pricing.md`（可直接 fetch 的 markdown）。
 * - 元数据（上下文 / 最大输出）：`docs.bigmodel.cn/cn/guide/start/model-overview.md`。
 * - 能力字段：各模型详情页「能力支持」Card。
 *
 * 模型范围：以国内定价页「旗舰模型」区块的 8 个文本模型为准（含免费模型
 * `glm-4.7-flash`）。`/models` 清单返回的 `glm-4.5` / `glm-4.6` 在国内定价页只有
 * Batch / 私有化计价、没有标准按量价，因此不收录；它们会通过 Inventory 的
 * `listedWithoutPricing` 如实反映「API 可用但官方定价页无按量价」。
 */

export const ZHIPU_MODEL_IDS = [
  "glm-5.2",
  "glm-5.1",
  "glm-5-turbo",
  "glm-5",
  "glm-4.7",
  "glm-4.5-air",
  "glm-4.7-flashx",
  "glm-4.7-flash",
] as const;

function isZhipuModelId(id: string): boolean {
  return (ZHIPU_MODEL_IDS as readonly string[]).includes(id);
}

export const ZHIPU_PRICING_URL = "https://bigmodel.cn/pricing" as const;
export const ZHIPU_INTL_PRICING_URL =
  "https://docs.z.ai/guides/overview/pricing" as const;
export const ZHIPU_OVERVIEW_URL =
  "https://docs.bigmodel.cn/cn/guide/start/model-overview.md" as const;
export const ZHIPU_DOCS_BASE = "https://docs.bigmodel.cn" as const;

interface ZhipuChannel {
  id: "zhipu-cn" | "zhipu-intl";
  name: string;
  displayNames: NonNullable<ProviderData["displayNames"]>;
  apiBaseUrl: string;
  market: Market;
  currency: Currency;
  locale: Source["locale"];
}

const ZHIPU_CHANNELS = {
  china: {
    id: "zhipu-cn",
    name: "Zhipu China",
    displayNames: {
      "zh-CN": "智谱",
      en: "Zhipu AI",
    },
    apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    market: "china",
    currency: "CNY",
    locale: "zh-CN",
  },
  international: {
    id: "zhipu-intl",
    name: "Zhipu International",
    displayNames: {
      "zh-CN": "智谱国际版",
      en: "Z.AI",
    },
    apiBaseUrl: "https://api.z.ai/api/paas/v4",
    market: "international",
    currency: "USD",
    locale: "en",
  },
} as const satisfies Record<string, ZhipuChannel>;

/** 国内定价页表格中的一个单元格。`col` 来自 Element UI 列 class `el-table_<N>_column_<M>`。 */
export interface ZhipuDomCell {
  col: number;
  text: string;
}

/** 一个分档价格。 */
export interface ZhipuParsedPrice {
  inputTokenRange?: ModelPrice["inputTokenRange"];
  outputTokenRange?: ModelPrice["outputTokenRange"];
  input: number;
  cacheHit: number;
  output: number;
}

/** 一个模型的全部价格分档。 */
export interface ZhipuParsedModel {
  id: string;
  prices: ZhipuParsedPrice[];
}

function parseMoney(value: string): number {
  if (value === "免费" || value === "Free" || value === "free") return 0;
  const match = value.match(/[\d.]+/);
  if (!match) throw new Error(`Cannot parse Zhipu price: ${value}`);
  return Number(match[0]);
}

function parseUsd(value: string): number {
  if (/free/i.test(value)) return 0;
  const match = value.match(/[\d.]+/);
  if (!match) throw new Error(`Cannot parse Zhipu USD price: ${value}`);
  return Number(match[0]);
}

function parseUsdOrDash(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "-" || trimmed === "\\" || trimmed === "") return undefined;
  return parseUsd(trimmed);
}

/**
 * 从一个区间标签中解析出 token 范围。标签形如 `输入长度 [0, 32)`、
 * `输出长度 [0, 0.2)`、`输入长度 [32, 200)`、`输入长度 [32+)`。
 * 单位按 K tokens 换算（`32` → 32000、`0.2` → 200）。
 */
function tokenRange(
  text: string,
  kind: string,
  unit: number,
): ModelPrice["inputTokenRange"] | undefined {
  // 支持 `[0, 32)`、`[32, 200)` 与 `[32+)`（加号表示无上界）。
  const match = text.match(
    new RegExp(`${kind}\\s*\\[([\\d.]+)([+]|,\\s*[\\d.]*)?\\)`),
  );
  if (!match) return undefined;
  const from = Number(match[1]);
  const tail = match[2]?.trim();
  const range: ModelPrice["inputTokenRange"] = { label: match[0] };
  if (tail === "+") {
    range.minExclusive = Math.round(from * unit);
  } else if (tail !== undefined && tail !== "") {
    const to = Number(tail.replace(/^,/, ""));
    if (from > 0) range.minExclusive = Math.round(from * unit);
    range.maxInclusive = Math.round(to * unit);
  } else {
    range.minExclusive = Math.round(from * unit);
  }
  return range;
}

/**
 * 解析国内定价页「旗舰模型 → 文本模型」表格（Element UI 表格，固定 6 列）：
 * `c1` 模型名或分档标签，`c2` 上下文或分档标签，`c3` 输入价，`c4` 输出价，
 * `c5` 缓存存储（限时免费，忽略），`c6` 缓存命中。
 */
export function parseZhipuPricingDom(
  rows: ZhipuDomCell[][],
): ZhipuParsedModel[] {
  const models: ZhipuParsedModel[] = [];
  let current: ZhipuParsedModel | undefined;
  for (const row of rows) {
    const byCol = new Map(row.map((cell) => [cell.col, cell.text]));
    const c1 = byCol.get(1);
    const c2 = byCol.get(2);
    const inputText = byCol.get(3);
    const outputText = byCol.get(4);
    const cacheText = byCol.get(6);
    if (c1) {
      const idMatch = c1.toLowerCase().match(/(glm[-a-z0-9.]+)/);
      if (idMatch && idMatch[1]) {
        current = { id: idMatch[1], prices: [] };
        models.push(current);
      }
    }
    if (!current || inputText === undefined || outputText === undefined) {
      continue;
    }
    const labelText = `${c1 ?? ""}${c2 ?? ""}`;
    current.prices.push({
      ...(tokenRange(labelText, "输入长度", 1_000)
        ? { inputTokenRange: tokenRange(labelText, "输入长度", 1_000) }
        : {}),
      ...(tokenRange(labelText, "输出长度", 1_000)
        ? { outputTokenRange: tokenRange(labelText, "输出长度", 1_000) }
        : {}),
      input: parseMoney(inputText),
      cacheHit: parseMoney(cacheText ?? ""),
      output: parseMoney(outputText),
    });
  }
  if (!models.length) {
    throw new Error("Zhipu pricing table contains no models");
  }
  return models;
}

async function loadZhipuPricingDom(): Promise<ZhipuDomCell[][]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ locale: "zh-CN" });
    const page = await context.newPage();
    await page.goto(ZHIPU_PRICING_URL, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await page.waitForFunction(
      () => document.body.innerText.includes("GLM-4.7"),
      { timeout: 15_000 },
    );
    const tables = await page.evaluate(() =>
      Array.from(document.querySelectorAll("table"))
        .filter((table) => (table.textContent ?? "").includes("GLM-4.7"))
        .map((table) =>
          Array.from(table.querySelectorAll("tr")).map((tr) =>
            Array.from(tr.querySelectorAll("td"))
              .map((td) => {
                const cls = (td.className || "").toString();
                const match = cls.match(/el-table_\d+_column_(\d+)/);
                return {
                  col: match ? Number(match[1]) : null,
                  text: (td.textContent ?? "").replace(/\s+/g, " ").trim(),
                };
              })
              .filter((cell): cell is ZhipuDomCell => cell.col !== null),
          ),
        ),
    );
    const rows = tables[0] ?? [];
    if (!rows.length) {
      throw new Error("Zhipu pricing page contains no flagship model table");
    }
    return rows;
  } finally {
    await browser.close();
  }
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

export interface ZhipuOverviewModel {
  id: string;
  name: string;
  url: string;
  contextTokens: number;
  maxOutputTokens: number;
}

function tokenCount(value: string): number {
  const match = value.match(/^([\d.]+)\s*([KM]?)$/i);
  if (!match) throw new Error(`Cannot parse Zhipu token count: ${value}`);
  const amount = Number(match[1]);
  const suffix = match[2]?.toUpperCase();
  if (suffix === "M") return amount * 1_000_000;
  if (suffix === "K") return Math.round(amount * 1024);
  return Math.round(amount);
}

/**
 * 解析模型概览文档「文本模型」表格。每行：
 * `| [GLM-5.2](/cn/guide/models/text/glm-5.2) | 特点 | 1M | 128K |`。
 */
export function parseZhipuOverview(markdown: string): ZhipuOverviewModel[] {
  const section =
    markdown.split("### 文本模型")[1]?.split("### 视觉模型")[0] ?? "";
  const models: ZhipuOverviewModel[] = [];
  for (const line of section.split("\n")) {
    const match = line.match(
      /^\s*\|\s*\[([^\]]+)\]\((\/cn\/guide\/models\/[^)]+)\)\s*\|.*\|\s*(\S+)\s*\|\s*(\S+)\s*\|/,
    );
    if (!match) continue;
    const idMatch = match[1]!.toLowerCase().match(/(glm[-a-z0-9.]+)/);
    if (!idMatch) continue;
    models.push({
      id: idMatch[1]!,
      name: match[1]!,
      url: match[2]!,
      contextTokens: tokenCount(match[3]!),
      maxOutputTokens: tokenCount(match[4]!),
    });
  }
  if (!models.length) {
    throw new Error("Zhipu model overview contains no text models");
  }
  return models;
}

export interface ZhipuCapabilities {
  thinking: boolean;
  toolCalls: boolean;
  jsonOutput: boolean;
}

/**
 * 从模型详情页「能力支持」区块解析能力。
 * `思考模式` → thinking，`Function Calling` → toolCalls，`结构化输出` → jsonOutput。
 */
export function parseZhipuCapabilities(markdown: string): ZhipuCapabilities {
  const section = markdown.split("## 能力支持")[1]?.split("##")[0] ?? "";
  const titles = Array.from(section.matchAll(/<Card title="([^"]+)"/g))
    .map((match) => match[1])
    .filter((title): title is string => title !== undefined);
  return {
    // 官方能力卡标题有「思考模式」与「深度思考」两种写法。
    thinking: titles.some((title) => /思考/.test(title)),
    toolCalls: titles.includes("Function Calling"),
    jsonOutput: titles.includes("结构化输出"),
  };
}

interface ZhipuMetadata extends ZhipuOverviewModel {
  capabilities: ZhipuCapabilities;
}

/** 抓取国内站元数据（上下文 / 最大输出 + 能力），按模型 id 返回。 */
async function loadZhipuMetadata(): Promise<Map<string, ZhipuMetadata>> {
  const overviewMarkdown = await fetchMarkdown(ZHIPU_OVERVIEW_URL);
  const overview = parseZhipuOverview(overviewMarkdown);
  const byId = new Map(overview.map((model) => [model.id, model]));
  // 去重详情页 URL（glm-4.7-flashx / glm-4.5-air 与同系列共享详情页）。
  const uniqueUrls = [...new Set(overview.map((model) => model.url))];
  const capabilityMarkdown = new Map<string, string>();
  for (const url of uniqueUrls) {
    capabilityMarkdown.set(
      url,
      await fetchMarkdown(`${ZHIPU_DOCS_BASE}${url}.md`),
    );
  }
  const metadata = new Map<string, ZhipuMetadata>();
  for (const model of overview) {
    const markdown = capabilityMarkdown.get(model.url);
    if (!markdown) continue;
    metadata.set(model.id, {
      ...model,
      capabilities: parseZhipuCapabilities(markdown),
    });
  }
  return metadata;
}

function metadataSource(
  now: Date,
  metadata: Map<string, ZhipuMetadata>,
): Source {
  return {
    url: ZHIPU_OVERVIEW_URL,
    kind: "model-metadata",
    locale: "zh-CN",
    retrievedAt: now.toISOString(),
    contentHash: `sha256:${createHash("sha256")
      .update(JSON.stringify([...metadata].map(([, m]) => m)))
      .digest("hex")}`,
  };
}

export async function collectZhipuChina(
  now = new Date(),
  pricingLoader: () => Promise<ZhipuDomCell[][]> = loadZhipuPricingDom,
  metadataLoader: () => Promise<Map<string, ZhipuMetadata>> = loadZhipuMetadata,
): Promise<ProviderData> {
  const [rows, metadata] = await Promise.all([
    pricingLoader(),
    metadataLoader(),
  ]);
  const parsed = parseZhipuPricingDom(rows);
  const byId = new Map(parsed.map((model) => [model.id, model]));
  const models: ModelData[] = [];
  for (const id of ZHIPU_MODEL_IDS) {
    const meta = metadata.get(id);
    const priceModel = byId.get(id);
    if (!meta || !priceModel) {
      throw new Error(
        `Zhipu flagship model ${id} is missing price or metadata`,
      );
    }
    models.push({
      id,
      name: meta.name,
      aliases: [],
      capabilities: {
        thinking: meta.capabilities.thinking,
        jsonOutput: meta.capabilities.jsonOutput,
        toolCalls: meta.capabilities.toolCalls,
        inputModalities: ["text"],
        outputModalities: ["text"],
      },
      limits: {
        contextTokens: meta.contextTokens,
        maxOutputTokens: meta.maxOutputTokens,
      },
      prices: priceModel.prices.map((price): ModelPrice => ({
        market: "china",
        currency: "CNY",
        unit: "1M_tokens",
        rateType: "standard",
        ...(price.inputTokenRange
          ? { inputTokenRange: price.inputTokenRange }
          : {}),
        ...(price.outputTokenRange
          ? { outputTokenRange: price.outputTokenRange }
          : {}),
        input: { standard: price.input, cacheHit: price.cacheHit },
        output: price.output,
        sourceUrl: ZHIPU_PRICING_URL,
      })),
    });
  }
  const retrievedAt = now.toISOString();
  const pricingHash = createHash("sha256")
    .update(JSON.stringify(parsed))
    .digest("hex");
  const sources: Source[] = [
    {
      url: ZHIPU_PRICING_URL,
      kind: "pricing",
      locale: "zh-CN",
      currency: "CNY",
      retrievedAt,
      contentHash: `sha256:${pricingHash}`,
    },
    metadataSource(now, metadata),
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    health: healthyHealth(now),
    id: ZHIPU_CHANNELS.china.id,
    name: ZHIPU_CHANNELS.china.name,
    displayNames: ZHIPU_CHANNELS.china.displayNames,
    ownedBy: "zhipu",
    baseUrls: { openai: ZHIPU_CHANNELS.china.apiBaseUrl },
    models,
    sources,
  };
}

/**
 * 解析国际站定价 markdown「Text Models」表格。每行：
 * `| GLM-5.2 | $1.4 | $0.26 | Limited-time Free | $4.4 |`。单档价格，无分档。
 */
export function parseZhipuInternationalPricing(
  markdown: string,
): Map<string, ModelPrice> {
  const section =
    markdown.split("### Text Models")[1]?.split("### Vision Models")[0] ?? "";
  const result = new Map<string, ModelPrice>();
  for (const line of section.split("\n")) {
    const idMatch = line.toLowerCase().match(/(glm[-a-z0-9.]+)/);
    if (!idMatch || !idMatch[1] || !isZhipuModelId(idMatch[1])) continue;
    const cells = line
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell, index, array) => index > 0 && index < array.length - 1);
    // cells: [Model, Input, Cached Input, Cached Input Storage, Output]
    if (cells.length < 5) continue;
    const input = parseUsd(cells[1]!);
    const cacheHit = parseUsdOrDash(cells[2]!);
    const output = parseUsd(cells[4]!);
    result.set(idMatch[1]!, {
      market: "international",
      currency: "USD",
      unit: "1M_tokens",
      rateType: "standard",
      input: {
        standard: input,
        ...(cacheHit !== undefined ? { cacheHit } : {}),
      },
      output,
      sourceUrl: ZHIPU_INTL_PRICING_URL,
    });
  }
  if (!result.size) {
    throw new Error("Z.AI pricing markdown contains no target GLM models");
  }
  return result;
}

export async function collectZhipuInternational(
  now = new Date(),
  pricingFetcher: () => Promise<string> = () =>
    fetchMarkdown(ZHIPU_INTL_PRICING_URL),
  metadataLoader: () => Promise<Map<string, ZhipuMetadata>> = loadZhipuMetadata,
): Promise<ProviderData> {
  const [markdown, metadata] = await Promise.all([
    pricingFetcher(),
    metadataLoader(),
  ]);
  const prices = parseZhipuInternationalPricing(markdown);
  const models: ModelData[] = [];
  for (const id of ZHIPU_MODEL_IDS) {
    const meta = metadata.get(id);
    const price = prices.get(id);
    if (!meta || !price) {
      throw new Error(
        `Zhipu international model ${id} is missing price or metadata`,
      );
    }
    models.push({
      id,
      name: meta.name,
      aliases: [],
      capabilities: {
        thinking: meta.capabilities.thinking,
        jsonOutput: meta.capabilities.jsonOutput,
        toolCalls: meta.capabilities.toolCalls,
        inputModalities: ["text"],
        outputModalities: ["text"],
      },
      limits: {
        contextTokens: meta.contextTokens,
        maxOutputTokens: meta.maxOutputTokens,
      },
      prices: [price],
    });
  }
  const retrievedAt = now.toISOString();
  const pricingHash = createHash("sha256")
    .update(markdown.replace(/\s+/g, " ").trim())
    .digest("hex");
  const sources: Source[] = [
    {
      url: ZHIPU_INTL_PRICING_URL,
      kind: "pricing",
      locale: "en",
      currency: "USD",
      retrievedAt,
      contentHash: `sha256:${pricingHash}`,
    },
    metadataSource(now, metadata),
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    health: healthyHealth(now),
    id: ZHIPU_CHANNELS.international.id,
    name: ZHIPU_CHANNELS.international.name,
    displayNames: ZHIPU_CHANNELS.international.displayNames,
    ownedBy: "zhipu",
    baseUrls: { openai: ZHIPU_CHANNELS.international.apiBaseUrl },
    models,
    sources,
  };
}
