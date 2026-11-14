import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { ModelData, ModelPrice, ProviderData, Source } from "../types.js";
import { SCHEMA_VERSION } from "../types.js";
import { healthyHealth } from "../health.js";
import { fetchTextWithRetry } from "../net.js";

/**
 * 腾讯混元的官方数据源是 **TokenHub**（cloud.tencent.com/document/product/1823）。
 *
 * 老的「混元生文」文档（product/1729）已经写明：相关功能将逐步迁移至 TokenHub，
 * 原平台不再新增模型能力、也停止新购。所以新模型只会在 TokenHub 上出现。
 *
 * TokenHub 上同时挂着腾讯自研混元（Hy*）和转售的第三方模型（DeepSeek / Kimi / GLM /
 * MiniMax / MiMo / Step）。第三方模型由各自的官方采集器负责，这里**只收自研混元**，
 * 否则同一个模型会出现两套价格（原厂价 vs 腾讯渠道价）。
 */
export const TENCENT_HUNYUAN_PRICING_URL =
  "https://cloud.tencent.com/document/product/1823/130055";
export const TENCENT_HUNYUAN_MODELS_URL =
  "https://cloud.tencent.com/document/product/1823/130051";
export const TENCENT_HUNYUAN_BASE_URL =
  "https://api.hunyuan.cloud.tencent.com/v1";

/** 腾讯自研混元的调用参数前缀：hy4 / hy3 / hy-mt2-* / hy-role / hunyuan-role-latest。 */
const SELF_HOSTED_PATTERN = /^(?:hy\d|hy-)/i;

/**
 * 不收录的系列：翻译（hy-mt2-*）与角色扮演（hy-role / hunyuan-role-latest）。
 * 这两个系列不是通用对话模型，官方也没给它们发布日期，收进来只会让目录里多出
 * 一堆缺字段的条目；保留前缀判断是为了让以后新增的旗舰（如 hy4-flash）自动进来。
 */
const EXCLUDED_FAMILIES = [/^hy-mt/i, /^hy-role/i, /^hunyuan-/i];

export function isTencentHunyuanModel(modelId: string): boolean {
  return (
    SELF_HOSTED_PATTERN.test(modelId) &&
    !EXCLUDED_FAMILIES.some((pattern) => pattern.test(modelId))
  );
}

export interface HunyuanPricingRow {
  id: string;
  name: string;
  condition: string;
  peak: string;
  input: number | undefined;
  output: number | undefined;
  cacheHit: number | undefined;
}

export interface HunyuanModelRow {
  id: string;
  name: string;
  capabilitiesText: string;
  contextTokens: number;
  maxOutputTokens: number | undefined;
}

/** 页面单元格里混了零宽字符和多余空白，先归一化再比对。 */
function normalizeCell(value: string): string {
  return value
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tableRows(html: string, requiredHeaders: string[]): string[][] {
  const $ = cheerio.load(html);
  const tables = $("table").toArray();
  for (const table of tables) {
    const rows: string[][] = [];
    $(table)
      .find("tr")
      .each((_, tr) => {
        const cells = $(tr)
          .find("th,td")
          .toArray()
          .map((cell) => normalizeCell($(cell).text()));
        if (cells.length) rows.push(cells);
      });
    if (!rows.length) continue;
    const header = rows[0]!.join("|");
    if (requiredHeaders.every((needle) => header.includes(needle))) return rows;
  }
  return [];
}

function columnIndex(header: string[], ...patterns: RegExp[]): number {
  for (const pattern of patterns) {
    const index = header.findIndex((cell) => pattern.test(cell));
    if (index >= 0) return index;
  }
  return -1;
}

/** "1M" / "960k" / "8192" → token 数；"-" 或空返回 undefined。 */
export function parseTokenCount(raw: string): number | undefined {
  const value = raw.replace(/[,\s]/g, "");
  if (!value || value === "-") return undefined;
  const match = value.match(/^(\d+(?:\.\d+)?)([MmKk])?$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  const unit = match[2]?.toLowerCase();
  if (unit === "m") return Math.round(amount * 1024 * 1024);
  if (unit === "k") return Math.round(amount * 1024);
  return Math.round(amount);
}

/** "6" / "0.3" / "-" → 数字；空或横线返回 undefined。 */
export function parsePriceCell(raw: string): number | undefined {
  const value = raw.replace(/[,\s元]/g, "");
  if (!value || value === "-") return undefined;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : undefined;
}

/**
 * 价格表：模型名称 | model | 条件(token) | 峰谷计费 | 推理输入 | 推理输出 | 缓存命中 | 缓存写入...
 *
 * 阶梯（条件列）和峰谷计费的行会以「首列留空」的续行出现，这里把续行并回上一个模型，
 * 但**只保留无阶梯、无峰谷的标准行**：混元自研目前全部是单一价格，遇到其它形态直接报错，
 * 免得把分档价格当成统一价写进去。
 */
export function parseTencentHunyuanPricing(html: string): HunyuanPricingRow[] {
  const rows = tableRows(html, ["模型名称", "推理输入"]);
  if (!rows.length) {
    throw new Error(
      "TokenHub pricing page is missing the inference price table",
    );
  }
  const header = rows[0]!;
  const idColumn = columnIndex(header, /^model/);
  const nameColumn = columnIndex(header, /模型名称/);
  const conditionColumn = columnIndex(header, /^条件/);
  const peakColumn = columnIndex(header, /峰谷/);
  const inputColumn = columnIndex(header, /推理输入/);
  const outputColumn = columnIndex(header, /推理输出/);
  const cacheHitColumn = columnIndex(header, /缓存命中/);
  if (idColumn < 0 || inputColumn < 0 || outputColumn < 0) {
    throw new Error("TokenHub pricing table lost its model/price columns");
  }

  const parsed: HunyuanPricingRow[] = [];
  for (const cells of rows.slice(1)) {
    const id = normalizeCell(cells[idColumn] ?? "");
    // 续行（阶梯/峰谷的第二行）首列为空，这里跳过：混元自研都是单一价格，
    // 若哪个模型变成分档，会在 collect 阶段被显式报错，而不是被静默合并。
    if (!id) continue;
    const name = normalizeCell(cells[nameColumn] ?? "");
    parsed.push({
      id,
      name,
      condition: normalizeCell(cells[conditionColumn] ?? "-"),
      peak: normalizeCell(cells[peakColumn] ?? "-"),
      input: parsePriceCell(cells[inputColumn] ?? ""),
      output: parsePriceCell(cells[outputColumn] ?? ""),
      cacheHit:
        cacheHitColumn >= 0
          ? parsePriceCell(cells[cacheHitColumn] ?? "")
          : undefined,
    });
  }
  return parsed;
}

/**
 * 模型列表：模型名称 | model | 能力支持 | 上下文窗口 | 最大输入 | 最大输出
 */
export function parseTencentHunyuanModels(html: string): HunyuanModelRow[] {
  const rows = tableRows(html, ["模型名称", "上下文窗口"]);
  if (!rows.length) {
    throw new Error("TokenHub model list is missing the limits table");
  }
  const header = rows[0]!;
  const idColumn = columnIndex(header, /^model/);
  const nameColumn = columnIndex(header, /模型名称/);
  const capabilitiesColumn = columnIndex(header, /能力支持/);
  const contextColumn = columnIndex(header, /上下文窗口/);
  const outputColumn = columnIndex(header, /最大输出/);
  if (idColumn < 0 || contextColumn < 0) {
    throw new Error("TokenHub model list lost its model/context columns");
  }

  return rows
    .slice(1)
    .map((cells) => ({
      id: normalizeCell(cells[idColumn] ?? ""),
      name: normalizeCell(cells[nameColumn] ?? ""),
      capabilitiesText: normalizeCell(cells[capabilitiesColumn] ?? ""),
      contextTokens: parseTokenCount(normalizeCell(cells[contextColumn] ?? "")),
      maxOutputTokens:
        outputColumn >= 0
          ? parseTokenCount(normalizeCell(cells[outputColumn] ?? ""))
          : undefined,
    }))
    .filter((row) => Boolean(row.id) && typeof row.contextTokens === "number")
    .map((row) => ({ ...row, contextTokens: row.contextTokens as number }));
}

/**
 * 能力列是自然语言描述（混元翻译/角色模型给的是整句介绍），按关键词映射。
 * 三个布尔能力**必须都给出**：没列到的一律 false（能力列是白名单，未列 = 不支持），
 * 这样 validateProvider 的来源校验才能通过，也不会靠 null 掩盖解析失败。
 */
export function parseHunyuanCapabilities(
  text: string,
): NonNullable<ModelData["capabilities"]> {
  const capabilities: NonNullable<ModelData["capabilities"]> = {
    thinking: /深度思考|思考/.test(text),
    jsonOutput: /结构化输出/.test(text),
    toolCalls: /Function\s*Calling/i.test(text),
  };
  const inputModalities = ["text"];
  if (/图片理解|图片、视频理解/.test(text)) inputModalities.push("image");
  if (/视频理解/.test(text)) inputModalities.push("video");
  capabilities.inputModalities = inputModalities;
  capabilities.outputModalities = ["text"];
  return capabilities;
}

export const TENCENT_HUNYUAN_SOURCES = [
  { url: TENCENT_HUNYUAN_PRICING_URL, kind: "pricing" as const },
  { url: TENCENT_HUNYUAN_MODELS_URL, kind: "model-metadata" as const },
];

const DOCS_HEADERS = {
  accept: "text/html,application/xhtml+xml",
  "accept-language": "zh-CN,zh;q=0.9",
  "cache-control": "no-cache",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

/**
 * 发布时间只有一个官方来源：混元官网「研究」页背后的文章接口。
 * 每篇文章带 `customUrl`（hy4 / hy4-preview / hy3 …）与 `publishedAt`，
 * 正文里也写着发布日期。TokenHub 的文档页本身**不提供**上线时间。
 *
 * 只有发布文章明确对应的模型才写 createdAt；Hy-MT2 与两个角色扮演模型
 * 在该接口里没有条目（中文页有 Hy-MT2 的文章，但接口只回英文列表），
 * 因此保持缺省，不猜日期。
 */
export const TENCENT_HUNYUAN_RELEASE_NOTES_URL =
  "https://api.hunyuan.tencent.com/api/blog/publicList";

/** 发布文章 customUrl → 它正式发布的模型 id。 */
const RELEASE_NOTE_MODELS: Record<string, string[]> = {
  hy4: ["hy4"],
  "hy4-preview": ["hy4-preview"],
  hy3: ["hy3"],
};

interface ReleaseNoteItem {
  customUrl?: string;
  publishedAt?: number;
  displayPublishTime?: number;
}

export function parseHunyuanReleaseDates(payload: string): Map<string, string> {
  const parsed = JSON.parse(payload) as {
    data?: { list?: ReleaseNoteItem[] };
  };
  const list = parsed.data?.list ?? [];
  if (!list.length) {
    throw new Error("Hunyuan release notes returned an empty article list");
  }
  const dates = new Map<string, string>();
  for (const item of list) {
    const customUrl = item.customUrl?.trim();
    if (!customUrl) continue;
    const modelIds = RELEASE_NOTE_MODELS[customUrl];
    if (!modelIds) continue;
    const timestamp = item.publishedAt ?? item.displayPublishTime;
    if (!timestamp) continue;
    const iso = new Date(timestamp * 1000).toISOString();
    for (const modelId of modelIds) dates.set(modelId, iso);
  }
  return dates;
}

function contentHash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export interface HunyuanFetchInit {
  headers: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
}

/**
 * 默认 fetcher：统一走 src/net.ts 的带重试实现（仓库有 network-guard 用例禁止裸 fetch）。
 * 发布文章接口只接受 POST（GET 返回 405），所以 init 里带上 method/body。
 */
const defaultFetcher = (url: string, init: HunyuanFetchInit): Promise<string> =>
  fetchTextWithRetry(url, init);

export async function collectTencentHunyuan(
  now = new Date(),
  fetcher: (
    url: string,
    init: HunyuanFetchInit,
  ) => Promise<string> = defaultFetcher,
): Promise<ProviderData> {
  const [pricingHtml, modelsHtml, releaseNotes] = await Promise.all([
    fetcher(TENCENT_HUNYUAN_PRICING_URL, { headers: DOCS_HEADERS }),
    fetcher(TENCENT_HUNYUAN_MODELS_URL, { headers: DOCS_HEADERS }),
    fetcher(TENCENT_HUNYUAN_RELEASE_NOTES_URL, {
      headers: { ...DOCS_HEADERS, "content-type": "application/json" },
      method: "POST",
      body: '{"pageNum":1,"pageSize":50}',
    }),
  ]);
  const releaseDates = parseHunyuanReleaseDates(releaseNotes);

  const pricing = parseTencentHunyuanPricing(pricingHtml).filter((row) =>
    isTencentHunyuanModel(row.id),
  );
  const models = parseTencentHunyuanModels(modelsHtml).filter((row) =>
    isTencentHunyuanModel(row.id),
  );
  if (!pricing.length) {
    throw new Error("TokenHub pricing table has no Tencent Hunyuan models");
  }
  if (!models.length) {
    throw new Error("TokenHub model list has no Tencent Hunyuan models");
  }

  const pricingById = new Map(pricing.map((row) => [row.id, row]));
  const modelsById = new Map(models.map((row) => [row.id, row]));

  const collected: ModelData[] = [];
  for (const row of models) {
    const price = pricingById.get(row.id);
    if (!price) continue;
    if (price.condition !== "-" || price.peak !== "-") {
      throw new Error(
        `TokenHub model ${row.id} uses tiered/peak pricing, which this collector does not model yet`,
      );
    }
    if (price.input === undefined || price.output === undefined) {
      throw new Error(
        `TokenHub model ${row.id} is missing an input/output price`,
      );
    }

    const modelPrice: ModelPrice = {
      market: "china",
      currency: "CNY",
      unit: "1M_tokens",
      rateType: "standard",
      input: {
        standard: price.input,
        ...(price.cacheHit === undefined ? {} : { cacheHit: price.cacheHit }),
      },
      output: price.output,
      sourceUrl: TENCENT_HUNYUAN_PRICING_URL,
    };

    const capabilities = parseHunyuanCapabilities(row.capabilitiesText);
    const createdAt = releaseDates.get(row.id);

    collected.push({
      id: row.id,
      name: row.name || row.id,
      aliases: [],
      ...(createdAt
        ? {
            createdAt,
            createdAtSource: "release-notes" as const,
            createdAtEvidence: { releaseNotesMentioned: true },
          }
        : {}),
      capabilitiesSource: "docs",
      capabilitiesEvidence: {
        sectionPresent: true,
        parsedFields: ["inputModalities", "outputModalities"],
        defaultedFields: (
          ["thinking", "jsonOutput", "toolCalls"] as const
        ).filter((key) => capabilities[key] !== true),
      },
      capabilities,
      limits: {
        contextTokens: row.contextTokens,
        ...(row.maxOutputTokens === undefined
          ? {}
          : { maxOutputTokens: row.maxOutputTokens }),
      },
      prices: [modelPrice],
    });
  }

  if (!collected.length) {
    throw new Error("TokenHub pricing and model list share no Hunyuan model");
  }

  const retrievedAt = now.toISOString();
  const sources: Source[] = [
    {
      url: TENCENT_HUNYUAN_PRICING_URL,
      kind: "pricing",
      locale: "zh-CN",
      currency: "CNY",
      retrievedAt,
      contentHash: contentHash(
        pricing
          .map(
            (row) =>
              `${row.id}:${row.input}:${row.output}:${row.cacheHit ?? ""}`,
          )
          .join("\n"),
      ),
    },
    {
      url: TENCENT_HUNYUAN_MODELS_URL,
      kind: "model-metadata",
      locale: "zh-CN",
      retrievedAt,
      contentHash: contentHash(
        models
          .map(
            (row) =>
              `${row.id}:${row.contextTokens}:${row.maxOutputTokens ?? ""}:${row.capabilitiesText}`,
          )
          .join("\n"),
      ),
    },
    {
      url: TENCENT_HUNYUAN_RELEASE_NOTES_URL,
      kind: "model-metadata",
      locale: "en",
      retrievedAt,
      contentHash: contentHash(
        [...releaseDates.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([modelId, createdAt]) => `${modelId}:${createdAt}`)
          .join("\n"),
      ),
    },
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    id: "tencent-hunyuan",
    name: "Tencent Hunyuan",
    displayNames: { "zh-CN": "腾讯混元", en: "Tencent Hunyuan" },
    ownedBy: "tencent",
    baseUrls: { openai: TENCENT_HUNYUAN_BASE_URL },
    health: healthyHealth(now),
    models: collected,
    sources,
  };
}
