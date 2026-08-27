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
 * 模型范围：不再维护硬编码模型清单，而是由两条官方来源动态决定：
 * 1. `model-overview.md` 的「推荐模型」+「文本模型」表给出候选模型及上下文/最大输出；
 * 2. 国内/国际定价页给出按量价。取两者交集，缺价的模型跳过并告警，不再硬失败。
 * 因此官方新增核心模型（且同时给出定价）时会自动收录，无需改代码。
 * 模态（inputModalities / outputModalities）等官方来源拿不到的字段统一维护在
 * `data/manual/capabilities.json`，同样按模型逐条登记。
 */

export const ZHIPU_PRICING_URL = "https://bigmodel.cn/pricing" as const;
export const ZHIPU_INTL_PRICING_URL =
  "https://docs.z.ai/guides/overview/pricing" as const;
export const ZHIPU_OVERVIEW_URL =
  "https://docs.bigmodel.cn/cn/guide/start/model-overview.md" as const;
export const ZHIPU_RELEASES_URL =
  "https://docs.bigmodel.cn/cn/update/new-releases.md" as const;
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

/** 去掉 markdown 删除线（`~~原价~~`），保留当前有效价。 */
function stripStrikethrough(value: string): string {
  return value.replace(/~~[^~]*~~/g, "");
}

/** 解析 USD 当前有效价（促销价优先于被删除线的原价）。 */
function parseUsdEffective(value: string): number {
  return parseUsd(stripStrikethrough(value));
}

function parseUsdEffectiveOrDash(value: string): number | undefined {
  return parseUsdOrDash(stripStrikethrough(value));
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

/** 解析 token 数量单元格（如 `128K`、`1M`）；无法识别时返回 `undefined` 以便跳过。 */
function parseTokenCount(value: string): number | undefined {
  const match = value.trim().match(/^([\d.]+)\s*([KM]?)$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const suffix = match[2]?.toUpperCase();
  if (suffix === "M") return amount * 1_000_000;
  if (suffix === "K") return Math.round(amount * 1024);
  return Math.round(amount);
}

/** 将 markdown 表格行拆成去除首尾空单元格后的单元格数组。 */
function splitTableRow(line: string): string[] {
  return line
    .split("|")
    .map((cell) => cell.trim())
    .filter((_, index, array) => index > 0 && index < array.length - 1);
}

/** 取出两个标记之间的内容；缺少标记时返回空串。 */
function markdownBetween(markdown: string, start: string, end: string): string {
  const from = markdown.indexOf(start);
  if (from < 0) return "";
  const inner = markdown.slice(from + start.length);
  const to = inner.indexOf(end);
  return to >= 0 ? inner.slice(0, to) : inner;
}

/** 取出从标记到下一个 `###` 标题之间的内容（标题可能缩进在折叠容器内）。 */
function markdownSectionTilHeading(markdown: string, start: string): string {
  const from = markdown.indexOf(start);
  if (from < 0) return "";
  const inner = markdown.slice(from + start.length);
  const to = inner.search(/\n\s*###\s/);
  return to >= 0 ? inner.slice(0, to) : inner;
}

/**
 * 解析模型概览文档中的文本模型表格。官方文档多次改版：旗舰模型
 * `glm-5.3` / `glm-5.2` 已从「### 文本模型」表移到顶部「## 推荐模型」表，
 * 而「### 文本模型」表则被收进 `<Accordion>` 折叠面板。因此同时解析
 * `## 推荐模型`…`<Accordion>` 和 `### 文本模型`…下一个 `###` 标题之间的
 * `| [模型](链接) | 特点 | 上下文 | 最大输出 |` 行。
 */
export function parseZhipuOverview(markdown: string): ZhipuOverviewModel[] {
  const recommended = markdownBetween(markdown, "## 推荐模型", "<Accordion");
  const text = markdownSectionTilHeading(markdown, "### 文本模型");
  const models: ZhipuOverviewModel[] = [];
  const seen = new Set<string>();
  for (const line of `${recommended}\n${text}`.split("\n")) {
    const cells = splitTableRow(line);
    if (cells.length < 4) continue;
    const nameMatch = cells[0]!.match(
      /\[([^\]]+)\]\((\/cn\/guide\/models\/[^)]+)\)/,
    );
    if (!nameMatch) continue;
    const idMatch = nameMatch[1]!.toLowerCase().match(/(glm[-a-z0-9.]+)/);
    if (!idMatch || seen.has(idMatch[1]!)) continue;
    const contextTokens = parseTokenCount(cells[2]!);
    const maxOutputTokens = parseTokenCount(cells[3]!);
    if (contextTokens === undefined || maxOutputTokens === undefined) continue;
    seen.add(idMatch[1]!);
    models.push({
      id: idMatch[1]!,
      name: nameMatch[1]!,
      url: nameMatch[2]!,
      contextTokens,
      maxOutputTokens,
    });
  }
  if (!models.length) {
    throw new Error("Zhipu model overview contains no text models");
  }
  return models;
}

/**
 * 解析智谱「新品发布」页，返回每个模型首次发布的 ISO 日期。
 * 公告块形如 `<Update label="2026-06-16" description="GLM-5.2 新一代旗舰模型上线">`，
 * 正文里用 `[**GLM-5.2**](/cn/guide/models/text/glm-5.2)` 指向模型。
 * 取每个模型**最早**出现的公告日期作为发布时间；未出现在公告中的模型不设日期。
 * 解析所有 GLM 开头的模型名，不再依赖硬编码清单，新模型自动获得发布日期。
 */
export function parseZhipuReleaseNotes(markdown: string): Map<string, string> {
  const result = new Map<string, string>();
  const blocks = markdown.matchAll(
    /<Update label="([^"]+)"[^>]*>([\s\S]*?)<\/Update>/g,
  );
  for (const [, label, body] of blocks) {
    // 官方公告日期可能不带前导零（如 `2026-8-19`），允许 1-2 位月/日。
    const dateMatch = label?.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!label || !body || !dateMatch) continue;
    // 统一补齐为 `YYYY-MM-DD`，保证 ISO 字符串可比较。
    const isoDate = `${dateMatch[1]}-${dateMatch[2]!.padStart(2, "0")}-${dateMatch[3]!.padStart(2, "0")}`;
    const names = body.matchAll(/\*\*([^*\]]+)\*\*/g);
    for (const match of names) {
      const id = match[1]?.toLowerCase().match(/(glm[-a-z0-9.]+)/)?.[1];
      if (!id) continue;
      const iso = `${isoDate}T00:00:00.000+08:00`;
      const existing = result.get(id);
      // 取最早日期（首次发布）；ISO 字符串可直接按字典序比较。
      if (!existing || iso < existing) result.set(id, iso);
    }
  }
  return result;
}

export interface ZhipuCapabilities {
  thinking: boolean;
  toolCalls: boolean;
  jsonOutput: boolean;
}

/**
 * 从模型详情页「能力支持」区块解析能力。
 * `思考模式` → thinking，`Function Calling` → toolCalls，`结构化输出` → jsonOutput。
 *
 * 官方页面存在两种模板：旧模板用 `<Card title="...">` 卡片，新模板（如 GLM-5.3）
 * 用 `* [能力名](链接)` 列表，两种都解析。
 */
export function parseZhipuCapabilities(markdown: string): ZhipuCapabilities {
  const section = markdown.split("## 能力支持")[1]?.split("##")[0] ?? "";
  const titles = Array.from(section.matchAll(/<Card title="([^"]+)"/g))
    .map((match) => match[1])
    .filter((title): title is string => title !== undefined);
  // 新版文档模板：`* [思考模式](/cn/guide/capabilities/thinking-mode)：…`
  for (const match of section.matchAll(/^\s*\*\s+\[([^\]]+)\]\(/gm)) {
    const title = match[1]?.trim();
    if (title) titles.push(title);
  }
  return {
    // 官方能力卡标题有「思考模式」与「深度思考」两种写法。
    thinking: titles.some((title) => /思考/.test(title)),
    toolCalls: titles.includes("Function Calling"),
    jsonOutput: titles.includes("结构化输出"),
  };
}

interface ZhipuMetadata extends ZhipuOverviewModel {
  capabilities: ZhipuCapabilities;
  createdAt?: string;
}

/** 抓取国内站元数据（上下文 / 最大输出 + 能力 + 发布页发布时间），按模型 id 返回。 */
async function loadZhipuMetadata(): Promise<Map<string, ZhipuMetadata>> {
  const [overviewMarkdown, releasesMarkdown] = await Promise.all([
    fetchMarkdown(ZHIPU_OVERVIEW_URL),
    fetchMarkdown(ZHIPU_RELEASES_URL),
  ]);
  const overview = parseZhipuOverview(overviewMarkdown);
  const releaseDates = parseZhipuReleaseNotes(releasesMarkdown);
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
    const createdAt = releaseDates.get(model.id);
    metadata.set(model.id, {
      ...model,
      capabilities: parseZhipuCapabilities(markdown),
      ...(createdAt ? { createdAt } : {}),
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

/** 发布页来源：内容哈希基于解析出的 createdAt，发布时间变化时同步更新。 */
function releasesSource(
  now: Date,
  metadata: Map<string, ZhipuMetadata>,
): Source {
  const dates = [...metadata]
    .map(([, m]) => m.createdAt)
    .filter((date): date is string => Boolean(date))
    .sort();
  return {
    url: ZHIPU_RELEASES_URL,
    kind: "model-metadata",
    locale: "zh-CN",
    retrievedAt: now.toISOString(),
    contentHash: `sha256:${createHash("sha256")
      .update(JSON.stringify(dates))
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
  const skipped: string[] = [];
  for (const meta of metadata.values()) {
    const priceModel = byId.get(meta.id);
    if (!priceModel) {
      skipped.push(meta.id);
      continue;
    }
    models.push({
      id: meta.id,
      name: meta.name,
      ...(meta.createdAt ? { createdAt: meta.createdAt } : {}),
      aliases: [],
      capabilities: {
        thinking: meta.capabilities.thinking,
        jsonOutput: meta.capabilities.jsonOutput,
        toolCalls: meta.capabilities.toolCalls,
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
  if (!models.length) {
    throw new Error(
      "Zhipu pricing page contains no model with both price and metadata",
    );
  }
  if (skipped.length) {
    console.warn(
      `zhipu-cn skipped models without CN pricing: ${skipped.join(", ")}`,
    );
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
    releasesSource(now, metadata),
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
 * 解析国际站定价 markdown 的「Latest Models」与「Text Models」两张表。每行：
 * `| GLM-5.2 | $1.4 | $0.26 | Limited-time Free | $4.4 |`。单档价格，无分档。
 * 官方将 `glm-5.3` / `glm-5.2` 上移到新增的「### Latest Models」表，因此两段合并解析。
 */
export function parseZhipuInternationalPricing(
  markdown: string,
): Map<string, ModelPrice> {
  const latest =
    markdown.split("### Latest Models")[1]?.split("### Text Models")[0] ?? "";
  const text =
    markdown.split("### Text Models")[1]?.split("### Vision Models")[0] ?? "";
  const section = `${latest}\n${text}`;
  const result = new Map<string, ModelPrice>();
  for (const line of section.split("\n")) {
    const idMatch = line.toLowerCase().match(/(glm[-a-z0-9.]+)/);
    if (!idMatch || !idMatch[1]) continue;
    const cells = line
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell, index, array) => index > 0 && index < array.length - 1);
    // cells: [Model, Input, Cached Input, Cached Input Storage, Output]
    if (cells.length < 5) continue;
    const input = parseUsdEffective(cells[1]!);
    const cacheHit = parseUsdEffectiveOrDash(cells[2]!);
    const output = parseUsdEffective(cells[4]!);
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
  const skipped: string[] = [];
  for (const meta of metadata.values()) {
    const price = prices.get(meta.id);
    if (!price) {
      skipped.push(meta.id);
      continue;
    }
    models.push({
      id: meta.id,
      name: meta.name,
      ...(meta.createdAt ? { createdAt: meta.createdAt } : {}),
      aliases: [],
      capabilities: {
        thinking: meta.capabilities.thinking,
        jsonOutput: meta.capabilities.jsonOutput,
        toolCalls: meta.capabilities.toolCalls,
      },
      limits: {
        contextTokens: meta.contextTokens,
        maxOutputTokens: meta.maxOutputTokens,
      },
      prices: [price],
    });
  }
  if (!models.length) {
    throw new Error(
      "Z.AI pricing markdown contains no model with both price and metadata",
    );
  }
  if (skipped.length) {
    console.warn(
      `zhipu-intl skipped models without international pricing: ${skipped.join(", ")}`,
    );
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
    releasesSource(now, metadata),
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
