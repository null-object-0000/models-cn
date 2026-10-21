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
import { assertCapabilitiesProvenance, zhipuHealth } from "../health.js";
import {
  fetchJsonWithRetry,
  fetchTextWithRetry,
  MODELS_CN_USER_AGENT,
} from "../net.js";

/**
 * 智谱 GLM 采集器。渠道范围：国内版 `zhipu-cn`（人民币）+ 国际版 `zhipu-intl`（美元）。
 *
 * 数据来源：
 * - 国内价格：`bigmodel.cn/pricing`（解析页面使用的结构化配置接口）。
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
export const ZHIPU_PRICING_CONFIG_URL =
  "https://bigmodel.cn/api/biz/operation/query?ids=1160,1161" as const;
export const ZHIPU_INTL_PRICING_URL =
  "https://docs.z.ai/guides/overview/pricing" as const;
export const ZHIPU_CN_DETAIL_PRICING_URL =
  "https://docs.bigmodel.cn/cn/guide/start/pricing.md" as const;
export const ZHIPU_OVERVIEW_URL =
  "https://docs.bigmodel.cn/cn/guide/start/model-overview.md" as const;
export const ZHIPU_RELEASES_URL =
  "https://docs.bigmodel.cn/cn/update/new-releases.md" as const;
export const ZHIPU_INTL_RELEASES_URL =
  "https://docs.z.ai/release-notes/new-released.md" as const;
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
  cacheHit?: number;
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
  if (trimmed === "-" || trimmed === "\\") return undefined;
  if (!trimmed) throw new Error("Zhipu missing cached-input price");
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
    if (
      !current ||
      inputText === undefined ||
      outputText === undefined ||
      cacheText === undefined
    ) {
      throw new Error("Zhipu pricing row missing model/input/output/cache hit");
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
      ...(cacheText === "不支持" || cacheText === "-"
        ? {}
        : { cacheHit: parseMoney(cacheText ?? "") }),
      output: parseMoney(outputText),
    });
  }
  if (!models.length) {
    throw new Error("Zhipu pricing table contains no models");
  }
  return models;
}

interface ZhipuPricingField {
  label?: unknown;
  values?: unknown;
}

interface ZhipuPricingCard {
  title?: unknown;
  fieldList?: unknown;
  table?: {
    fieldList?: unknown;
    modelList?: unknown;
  };
}

function pricingCardFields(card: ZhipuPricingCard): Map<string, string> {
  const fields = new Map<string, string>();
  if (Array.isArray(card.fieldList)) {
    for (const field of card.fieldList as ZhipuPricingField[]) {
      const value = Array.isArray(field.values) ? field.values[0] : undefined;
      if (
        typeof field.label !== "string" ||
        typeof value !== "string" ||
        !field.label.trim() ||
        !value.trim() ||
        fields.has(field.label)
      )
        throw new Error(`Zhipu ${card.title}: invalid legacy pricing field`);
      fields.set(field.label, value);
    }
  }
  const columnCodes = Array.isArray(card.table?.fieldList)
    ? (card.table.fieldList as Array<{ code?: unknown }>).flatMap((field) =>
        typeof field.code === "string" ? [field.code] : [],
      )
    : [];
  if (
    card.table &&
    (columnCodes.length !== 2 ||
      new Set(columnCodes).size !== 2 ||
      !Array.isArray(card.table.modelList) ||
      !card.table.modelList.length)
  ) {
    throw new Error(`Zhipu ${card.title}: invalid table field codes/modelList`);
  }
  if (columnCodes.length === 2 && Array.isArray(card.table?.modelList)) {
    for (const row of card.table.modelList as Array<Record<string, unknown>>) {
      const labelCell = row[columnCodes[0]!];
      const valueCell = row[columnCodes[1]!];
      const label =
        labelCell && typeof labelCell === "object"
          ? (labelCell as { value?: unknown }).value
          : undefined;
      const value =
        valueCell && typeof valueCell === "object"
          ? (valueCell as { value?: unknown }).value
          : undefined;
      if (
        typeof label !== "string" ||
        typeof value !== "string" ||
        !label.trim() ||
        !value.trim() ||
        fields.has(label)
      ) {
        throw new Error(
          `Zhipu ${card.title}: table field codes do not match row cells`,
        );
      }
      fields.set(label, value);
    }
  }
  if (card.table) {
    for (const labels of [
      ["上下文", "Context"],
      ["输入单价", "Input"],
      ["输出单价", "Output"],
      ["缓存命中", "Cached Input"],
      ["缓存存储", "Cache Store"],
      ["输入模态", "Input Modality"],
    ]) {
      if (!labels.some((label) => fields.has(label)))
        throw new Error(
          `Zhipu ${card.title}: missing pricing label ${labels.join("/")}`,
        );
    }
  }
  return fields;
}

/** Parse the structured configuration used to render the current pricing page. */
export function parseZhipuPricingConfig(payload: unknown): ZhipuDomCell[][] {
  if (!payload || typeof payload !== "object") {
    throw new Error("Zhipu pricing config is not an object");
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new Error("Zhipu pricing config is missing data");
  }
  const cards: ZhipuPricingCard[] = [];
  for (const item of data as Array<{ content?: unknown }>) {
    if (typeof item.content !== "string")
      throw new Error("Zhipu pricing config missing content");
    const content = JSON.parse(item.content) as {
      list?: unknown;
      tabs?: unknown;
    };
    if (
      Array.isArray(content.list) &&
      !content.list.length &&
      !Array.isArray(content.tabs)
    ) {
      throw new Error("Zhipu pricing list is empty");
    }
    if (content.list !== undefined && !Array.isArray(content.list))
      throw new Error("Zhipu pricing list is not an array");
    if (Array.isArray(content.list)) {
      for (const card of content.list as ZhipuPricingCard[]) {
        if (
          !card ||
          typeof card.title !== "string" ||
          !/^glm-/i.test(card.title) ||
          !card.table
        )
          throw new Error("Zhipu flagship card missing title/table");
        cards.push(card);
      }
    }
    if (Array.isArray(content.tabs)) {
      for (const tab of content.tabs as Array<{ cards?: unknown }>) {
        if (!Array.isArray(tab.cards) || !tab.cards.length)
          throw new Error("Zhipu pricing tab missing cards");
        cards.push(...(tab.cards as ZhipuPricingCard[]));
      }
    }
  }
  const rows = cards.flatMap((card): ZhipuDomCell[][] => {
    if (typeof card.title !== "string" || !/^glm-/i.test(card.title)) return [];
    const fields = pricingCardFields(card);
    const input =
      fields.get("输入单价") ?? fields.get("输入价格") ?? fields.get("Input");
    const output =
      fields.get("输出单价") ?? fields.get("输出价格") ?? fields.get("Output");
    const cacheHit = fields.get("缓存命中") ?? fields.get("Cached Input");
    // 明确标注单价的非 token 服务不属于采集范围；其他 GLM 卡片缺字段必须失败。
    if (!card.table && (fields.has("单价") || fields.has("Price"))) return [];
    // 老 CN 卡片中的 OCR 是纯文档/图片模型，不在文本与旗舰多模态范围。
    const modality = fields.get("输入模态");
    if (modality && !modality.includes("文本")) return [];
    if (!input || !output || !cacheHit) {
      throw new Error(
        `Zhipu ${card.title}: pricing labels missing (input/output/cache hit)`,
      );
    }
    return [
      [
        { col: 1, text: card.title },
        { col: 2, text: fields.get("上下文") ?? fields.get("Context") ?? "" },
        { col: 3, text: input },
        { col: 4, text: output },
        { col: 6, text: cacheHit },
      ],
    ];
  });
  if (!rows.length) {
    throw new Error("Zhipu pricing config contains no token-priced models");
  }
  return rows;
}

async function loadZhipuPricingRows(): Promise<ZhipuDomCell[][]> {
  const payload = await fetchJsonWithRetry<unknown>(ZHIPU_PRICING_CONFIG_URL, {
    headers: {
      accept: "application/json",
      "user-agent": MODELS_CN_USER_AGENT,
    },
  });
  const summary = parseZhipuPricingConfig(payload);
  const detailed = parseZhipuChinaPricingMarkdown(
    await fetchMarkdown(ZHIPU_CN_DETAIL_PRICING_URL),
  );
  const summaryIds = new Set(
    parseZhipuPricingDom(summary).map((model) => model.id),
  );
  let include = false;
  return [
    ...summary,
    ...detailed.filter((row) => {
      const title = row.find((cell) => cell.col === 1)?.text;
      if (title) include = !summaryIds.has(title.toLowerCase());
      return include;
    }),
  ];
}

async function fetchMarkdown(url: string): Promise<string> {
  return fetchTextWithRetry(url, {
    headers: {
      accept: "text/markdown",
      "user-agent": MODELS_CN_USER_AGENT,
    },
  });
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

/** 官方将折叠组件转成引用块后，保留内容，移除行首引用标记。 */
function unquoteMarkdown(markdown: string): string {
  return markdown.replace(/^[ \t]*(?:>[ \t]*)+/gm, "");
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
  markdown = unquoteMarkdown(markdown);
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
    if (contextTokens === undefined || maxOutputTokens === undefined) {
      // 推荐表还含图像/语音等非 token 生成模型，只有文本及旗舰多模态属于范围。
      if (/\/(text|free)\//.test(nameMatch[2]!) || /glm-5\./.test(idMatch[1]!))
        throw new Error(`Zhipu ${idMatch[1]}: missing token limits`);
      continue;
    }
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
 * 新模板使用独立的粗体日期行。取模型链接最早出现的公告日期；无日期时明确失败。
 * 解析所有 GLM 开头的模型名，不再依赖硬编码清单，新模型自动获得发布日期。
 */
export function parseZhipuReleaseNotes(markdown: string): Map<string, string> {
  const result = new Map<string, string>();
  const record = (label: string, body: string) => {
    const dateMatch = label.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!dateMatch) throw new Error(`Zhipu invalid release date: ${label}`);
    const isoDate = `${dateMatch[1]}-${dateMatch[2]!.padStart(2, "0")}-${dateMatch[3]!.padStart(2, "0")}`;
    const date = new Date(`${isoDate}T00:00:00Z`);
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== isoDate
    )
      throw new Error(`Zhipu invalid release date: ${label}`);
    for (const match of body.matchAll(/\[\*\*([^*\]]+)\*\*\]\([^)]+\)/g)) {
      const id = match[1]?.toLowerCase().match(/(glm[-a-z0-9.]+)/)?.[1];
      if (!id) continue;
      const iso = `${isoDate}T00:00:00.000+08:00`;
      if (!result.has(id) || iso < result.get(id)!) result.set(id, iso);
    }
  };
  for (const [, label, body] of markdown.matchAll(
    /<Update label="([^"]+)"[^>]*>([\s\S]*?)<\/Update>/g,
  )) {
    record(label!, body!);
  }
  const plain = unquoteMarkdown(
    markdown.replace(/<Update\b[\s\S]*?<\/Update>/g, ""),
  );
  const dates = [
    ...plain.matchAll(/^\s*\*\*(\d{4}-\d{1,2}-\d{1,2})\*\*\s*$/gm),
  ];
  for (let i = 0; i < dates.length; i++) {
    const match = dates[i]!;
    record(
      match[1]!,
      plain.slice(match.index! + match[0].length, dates[i + 1]?.index),
    );
  }
  if (!result.size)
    throw new Error("Zhipu release notes contain no dated models");
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
  const section =
    unquoteMarkdown(markdown)
      .split("## 能力支持")[1]
      ?.split(/\n#{2,}\s/)[0] ?? "";
  const titles = Array.from(section.matchAll(/<Card title="([^"]+)"/g))
    .map((match) => match[1])
    .filter((title): title is string => title !== undefined);
  // 新版文档模板：`* [思考模式](/cn/guide/capabilities/thinking-mode)：…`
  for (const match of section.matchAll(
    /(?:^\s*[-*]\s+|^\s*\*\*)\[([^\]]+)\]\(/gm,
  )) {
    const title = match[1]?.trim();
    if (title) titles.push(title);
  }
  if (!titles.some((title) => /思考|Function Calling|结构化输出/.test(title)))
    throw new Error(
      "Zhipu capability section has no recognized capability titles",
    );
  const supported = (pattern: RegExp, field: string): boolean => {
    const title = titles.find((title) => pattern.test(title));
    if (!title) throw new Error(`Zhipu missing capability ${field}`);
    return !/不支持|unsupported/i.test(title);
  };
  return {
    thinking: supported(/思考/, "thinking"),
    toolCalls: supported(/Function Calling/, "toolCalls"),
    jsonOutput: supported(/结构化输出/, "jsonOutput"),
  };
}

/** 全文检测区块标题及已知能力模板；模板漂移仍交给严格解析器报错。 */
export function resolveZhipuCapabilities(markdown: string): {
  capabilities: ZhipuCapabilities | null;
  capabilitiesSource: "docs" | "not-documented";
  capabilitiesEvidence: { sectionPresent: boolean };
} {
  const text = unquoteMarkdown(markdown);
  const sectionPresent =
    /^\s*#{1,6}\s*[^\n]*(?:能力支持|模型能力|能力介绍|功能支持|capabilities|supported features)/im.test(
      text,
    ) ||
    /^\s*#{1,6}\s*(?:能力|功能|features)\s*$/im.test(text) ||
    /<(?:Card|Accordion)\b[^>]*title=["'][^"']*(?:能力|思考|Function Calling|结构化输出)/i.test(
      text,
    ) ||
    /\]\([^)]*\/capabilities\//i.test(text);
  return {
    capabilities: sectionPresent ? parseZhipuCapabilities(markdown) : null,
    capabilitiesSource: sectionPresent ? "docs" : "not-documented",
    capabilitiesEvidence: { sectionPresent },
  };
}

interface ZhipuMetadata
  extends
    ZhipuOverviewModel,
    Pick<ModelData, "createdAt" | "createdAtSource" | "createdAtEvidence"> {
  capabilities: ZhipuCapabilities | null;
  capabilitiesSource: NonNullable<ModelData["capabilitiesSource"]>;
  capabilitiesEvidence: NonNullable<ModelData["capabilitiesEvidence"]>;
}

function assertMetadata(meta: ZhipuMetadata): void {
  if (meta.createdAtSource === "not-documented") {
    if (
      meta.createdAt !== null ||
      meta.createdAtEvidence?.releaseNotesMentioned !== false
    )
      throw new Error(
        `Zhipu ${meta.id}: invalid not-documented createdAt evidence`,
      );
  } else if (
    meta.createdAtSource !== "release-notes" ||
    meta.createdAtEvidence?.releaseNotesMentioned !== true ||
    !meta.createdAt ||
    !Number.isFinite(Date.parse(meta.createdAt))
  ) {
    throw new Error(
      `Zhipu ${meta.id}: missing createdAt / release-notes evidence`,
    );
  }
  if (!(meta.contextTokens > 0) || !(meta.maxOutputTokens > 0))
    throw new Error(`Zhipu ${meta.id}: missing token limits`);
  assertCapabilitiesProvenance(meta);
}

/** 在全部官方发布文本里匹配完整模型名；链接、标题及正文中的出现都算证据。 */
export function resolveZhipuCreatedAt(
  id: string,
  releaseTexts: string[],
  dates: Map<string, string>,
  hasOfficialPricing: boolean,
): Pick<ModelData, "createdAt" | "createdAtSource" | "createdAtEvidence"> {
  const mentioned = releaseTexts.some((text) =>
    [...text.toLowerCase().matchAll(/glm[-a-z0-9.]+/g)].some(
      (match) => match[0].replace(/\.+$/, "") === id,
    ),
  );
  const createdAt = dates.get(id);
  if (mentioned && !createdAt)
    throw new Error(
      `Zhipu ${id}: release notes missing createdAt (parsing failure)`,
    );
  const result = {
    createdAt: createdAt ?? null,
    createdAtSource: createdAt
      ? ("release-notes" as const)
      : ("not-documented" as const),
    createdAtEvidence: { releaseNotesMentioned: mentioned },
  };
  if (!createdAt && !hasOfficialPricing)
    throw new Error(
      `Zhipu ${id}: invalid not-documented without official pricing`,
    );
  if (createdAt && (!mentioned || !Number.isFinite(Date.parse(createdAt))))
    throw new Error(`Zhipu ${id}: invalid release-notes evidence`);
  return result;
}

/** 抓取国内站元数据（上下文 / 最大输出 + 能力 + 发布页发布时间），按模型 id 返回。 */
async function loadZhipuMetadata(
  pricedIds: Set<string>,
): Promise<Map<string, ZhipuMetadata>> {
  const [overviewMarkdown, releasesMarkdown, intlReleasesMarkdown] =
    await Promise.all([
      fetchMarkdown(ZHIPU_OVERVIEW_URL),
      fetchMarkdown(ZHIPU_RELEASES_URL),
      fetchMarkdown(ZHIPU_INTL_RELEASES_URL),
    ]);
  const overview = parseZhipuOverview(overviewMarkdown).filter((model) =>
    pricedIds.has(model.id),
  );
  const releaseDates = parseZhipuReleaseNotes(releasesMarkdown);
  const provenance = new Map(
    overview.map((model) => [
      model.id,
      resolveZhipuCreatedAt(
        model.id,
        [releasesMarkdown, intlReleasesMarkdown],
        releaseDates,
        pricedIds.has(model.id),
      ),
    ]),
  );
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
    if (!markdown)
      throw new Error(`Zhipu ${model.id}: missing detail markdown`);
    let capabilityMetadata: ReturnType<typeof resolveZhipuCapabilities>;
    try {
      capabilityMetadata = resolveZhipuCapabilities(markdown);
    } catch (error) {
      throw new Error(`Zhipu ${model.id}: ${(error as Error).message}`);
    }
    metadata.set(model.id, {
      ...model,
      ...capabilityMetadata,
      ...provenance.get(model.id),
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
    .map(([id, m]) => ({
      id,
      createdAt: m.createdAt,
      evidence: m.createdAtEvidence,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
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
  pricingLoader: () => Promise<ZhipuDomCell[][]> = loadZhipuPricingRows,
  metadataLoader?: () => Promise<Map<string, ZhipuMetadata>>,
): Promise<ProviderData> {
  const rows = await pricingLoader();
  const parsed = parseZhipuPricingDom(rows);
  const metadata = await (metadataLoader
    ? metadataLoader()
    : loadZhipuMetadata(new Set(parsed.map((model) => model.id))));
  const byId = new Map(parsed.map((model) => [model.id, model]));
  const models: ModelData[] = [];
  const skipped: string[] = [];
  for (const meta of metadata.values()) {
    const priceModel = byId.get(meta.id);
    if (!priceModel) {
      skipped.push(meta.id);
      continue;
    }
    assertMetadata(meta);
    models.push({
      id: meta.id,
      name: meta.name,
      ...(meta.createdAt !== undefined ? { createdAt: meta.createdAt } : {}),
      ...(meta.createdAtSource
        ? { createdAtSource: meta.createdAtSource }
        : {}),
      ...(meta.createdAtEvidence
        ? { createdAtEvidence: meta.createdAtEvidence }
        : {}),
      aliases: [],
      capabilities: meta.capabilities,
      capabilitiesSource: meta.capabilitiesSource,
      capabilitiesEvidence: meta.capabilitiesEvidence,
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
        input: {
          standard: price.input,
          ...(price.cacheHit === undefined ? {} : { cacheHit: price.cacheHit }),
        },
        output: price.output,
        sourceUrl: ZHIPU_CN_DETAIL_PRICING_URL,
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
    {
      url: ZHIPU_CN_DETAIL_PRICING_URL,
      kind: "pricing",
      locale: "zh-CN",
      currency: "CNY",
      retrievedAt,
      contentHash: `sha256:${pricingHash}`,
    },
    metadataSource(now, metadata),
    releasesSource(now, metadata),
    {
      ...releasesSource(now, metadata),
      url: ZHIPU_INTL_RELEASES_URL,
      locale: "en",
    },
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    health: zhipuHealth(models, now),
    id: ZHIPU_CHANNELS.china.id,
    name: ZHIPU_CHANNELS.china.name,
    displayNames: ZHIPU_CHANNELS.china.displayNames,
    ownedBy: "zhipu",
    baseUrls: { openai: ZHIPU_CHANNELS.china.apiBaseUrl },
    models,
    sources,
  };
}

/** 价格首页仅展示部分模型，完整文本模型价格来自其「详细价格」官方文档。 */
export function parseZhipuChinaPricingMarkdown(
  markdown: string,
): ZhipuDomCell[][] {
  markdown = unquoteMarkdown(markdown);
  const sections = [
    ...pricingSections(markdown, "最新模型"),
    ...pricingSections(markdown, "文本模型"),
  ];
  const rows: ZhipuDomCell[][] = [];
  let lastId: string | undefined;
  for (const line of sections.join("\n").split("\n")) {
    const cells = splitTableRow(line);
    if (!/^glm-/i.test(cells[0] ?? "")) continue;
    if (cells.length < 6)
      throw new Error(`Zhipu incomplete CN pricing row: ${line}`);
    const id = cells[0]!.toLowerCase();
    const label = cells[1]!
      .replace(/\\\[/g, "[")
      .replace(/(输入|输出)(?!长度)/g, "$1长度")
      .replace(/≥([\d.]+)K/g, "[$1+)")
      .replace(/([\d.]+)K/g, "$1");
    rows.push([
      { col: 1, text: id === lastId ? "" : cells[0]! },
      { col: 2, text: label },
      { col: 3, text: cells[2]! },
      { col: 4, text: cells[3]! },
      { col: 6, text: cells[5]! },
    ]);
    lastId = id;
  }
  if (!rows.length)
    throw new Error("Zhipu CN pricing markdown contains no models");
  return rows;
}

/**
 * 按标题名取出 markdown 中**所有**同名小节（含折叠面板内的缩进标题）。
 * 与 `split` 只取第一次不同：官方把旧模型表整段搬进 `<Accordion>` 后，
 * 同一个 `### Text Models` 会出现两次，只取第一段会漏掉折叠里的模型。
 * 每段延伸到下一个任意级别的 `##`/`###` 标题为止。
 */
function pricingSections(markdown: string, title: string): string[] {
  const heading = new RegExp(`^[ \\t]*#{2,}[ \\t]*${title}[ \\t]*$`, "gm");
  const starts = Array.from(markdown.matchAll(heading)).map(
    (match) => match.index! + match[0].length,
  );
  return starts.map((start) => {
    const rest = markdown.slice(start);
    const to = rest.search(/\n\s*#{2,}\s/);
    return to >= 0 ? rest.slice(0, to) : rest;
  });
}

/**
 * 解析国际站定价 markdown 的「Latest Models」与全部「Text Models」表。每行：
 * `| GLM-5.2 | $1.4 | $0.26 | Limited-time Free | $4.4 |`。单档价格，无分档。
 * 官方将 `glm-5.3` / `glm-5.2` 上移到新增的「### Latest Models」表；
 * 又把旧模型整段收进 `<Accordion title="Other Pricing">`（标题缩进成
 * `    ### Text Models`）。因此 **按标题正则扫描全文**，收全所有同级标题段，
 * 不能只取第一次出现的 `### Text Models`（那只剩折叠面板外的半张表）。
 */
export function parseZhipuInternationalPricing(
  markdown: string,
): Map<string, ModelPrice> {
  markdown = unquoteMarkdown(markdown);
  const section = [
    ...pricingSections(markdown, "Latest Models"),
    ...pricingSections(markdown, "Text Models"),
  ].join("\n");
  const result = new Map<string, ModelPrice>();
  for (const line of section.split("\n")) {
    const idMatch = line.toLowerCase().match(/(glm[-a-z0-9.]+)/);
    if (!idMatch || !idMatch[1]) continue;
    const cells = line
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell, index, array) => index > 0 && index < array.length - 1);
    // cells: [Model, Input, Cached Input, Cached Input Storage, Output]
    if (cells.length < 5)
      throw new Error(`Z.AI ${idMatch[1]}: incomplete pricing row`);
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
  metadataLoader?: () => Promise<Map<string, ZhipuMetadata>>,
): Promise<ProviderData> {
  const markdown = await pricingFetcher();
  const prices = parseZhipuInternationalPricing(markdown);
  const metadata = await (metadataLoader
    ? metadataLoader()
    : loadZhipuMetadata(new Set(prices.keys())));
  const models: ModelData[] = [];
  const skipped: string[] = [];
  for (const meta of metadata.values()) {
    const price = prices.get(meta.id);
    if (!price) {
      skipped.push(meta.id);
      continue;
    }
    assertMetadata(meta);
    models.push({
      id: meta.id,
      name: meta.name,
      ...(meta.createdAt !== undefined ? { createdAt: meta.createdAt } : {}),
      ...(meta.createdAtSource
        ? { createdAtSource: meta.createdAtSource }
        : {}),
      ...(meta.createdAtEvidence
        ? { createdAtEvidence: meta.createdAtEvidence }
        : {}),
      aliases: [],
      capabilities: meta.capabilities,
      capabilitiesSource: meta.capabilitiesSource,
      capabilitiesEvidence: meta.capabilitiesEvidence,
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
    {
      ...releasesSource(now, metadata),
      url: ZHIPU_INTL_RELEASES_URL,
      locale: "en",
    },
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    health: zhipuHealth(models, now),
    id: ZHIPU_CHANNELS.international.id,
    name: ZHIPU_CHANNELS.international.name,
    displayNames: ZHIPU_CHANNELS.international.displayNames,
    ownedBy: "zhipu",
    baseUrls: { openai: ZHIPU_CHANNELS.international.apiBaseUrl },
    models,
    sources,
  };
}
