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
      "zh-CN": "Kimi 国内版",
      en: "Kimi China",
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
      "zh-CN": "Kimi 国际版",
      en: "Kimi International",
    },
    apiBaseUrl: "https://api.moonshot.ai/v1",
    docsBaseUrl: "https://platform.kimi.ai",
    market: "international",
    currency: "USD",
    locale: "en",
  },
} as const satisfies Record<string, MoonshotChannel>;

const pricingPaths = [
  "/docs/pricing/chat-k3",
  "/docs/pricing/chat-k27-code",
  "/docs/pricing/chat-k26",
  "/docs/pricing/chat-k25",
] as const;

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

function parseRows(markdown: string): string[][] {
  const rowsBlock = markdown.match(/rows=\{\[([\s\S]*?)\]\}/)?.[1];
  if (!rowsBlock)
    throw new Error("Kimi pricing page is missing its rows table");
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
  if (!rows.length) throw new Error("Kimi pricing table contains no models");
  return rows;
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
  for (const id of ["kimi-k3", "kimi-k2.6", "kimi-k2.5"]) {
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

function modelMetadata(id: string): Pick<ModelData, "name" | "capabilities"> {
  const multimodal = ["text", "image", "video"];
  if (id === "kimi-k3") {
    return {
      name: "Kimi K3",
      capabilities: {
        thinking: true,
        thinkingModes: ["thinking"],
        reasoningEfforts: ["low", "high", "max"],
        dynamicTools: true,
        jsonOutput: true,
        toolCalls: true,
        inputModalities: ["text", "image", "video"],
        outputModalities: ["text"],
        supportedParameters: [
          "reasoning_effort",
          "tool_choice",
          "temperature",
          "top_p",
          "n",
          "presence_penalty",
          "frequency_penalty",
        ],
      },
    };
  }
  if (id.startsWith("kimi-k2.7-code")) {
    return {
      name:
        id === "kimi-k2.7-code-highspeed"
          ? "Kimi K2.7 Code HighSpeed"
          : "Kimi K2.7 Code",
      capabilities: {
        thinking: true,
        thinkingModes: ["thinking"],
        jsonOutput: true,
        toolCalls: true,
        inputModalities: multimodal,
        outputModalities: ["text"],
        supportedParameters: [
          "thinking",
          "tool_choice",
          "temperature",
          "top_p",
          "n",
          "presence_penalty",
          "frequency_penalty",
        ],
      },
    };
  }
  if (id === "kimi-k2.6" || id === "kimi-k2.5") {
    return {
      name: id === "kimi-k2.6" ? "Kimi K2.6" : "Kimi K2.5",
      capabilities: {
        thinking: true,
        thinkingModes: ["thinking", "non-thinking"],
        jsonOutput: true,
        toolCalls: true,
        inputModalities: multimodal,
        outputModalities: ["text"],
        supportedParameters:
          id === "kimi-k2.6"
            ? [
                "thinking",
                "tool_choice",
                "temperature",
                "top_p",
                "n",
                "presence_penalty",
                "frequency_penalty",
              ]
            : ["thinking", "temperature"],
      },
    };
  }
  if (!id.startsWith("kimi-")) {
    throw new Error(`Unsupported non-Kimi model in Kimi collector: ${id}`);
  }
  return {
    name: id,
    capabilities: {
      inputModalities: ["text"],
      outputModalities: ["text"],
    },
  };
}

export function parseMoonshotPricingPage(
  markdown: string,
  sourceUrl: string,
  market: Market = "china",
  currency: Currency = "CNY",
): ParsedMoonshotPage {
  const rows = parseRows(markdown);
  const models = rows.map((row) => {
    if (row.length !== 6) {
      throw new Error(`Unexpected Kimi pricing row: ${JSON.stringify(row)}`);
    }
    const [id] = row;
    if (!id) throw new Error("Kimi pricing row is missing a model ID");
    const cacheHit = parseMoney(row[2]!);
    const standard = parseMoney(row[3]!);
    const output = parseMoney(row[4]!);
    const contextTokens = parseTokenCount(row[5]!);
    const metadata = modelMetadata(id);
    const price: ModelPrice = {
      market,
      currency,
      unit: "1M_tokens",
      rateType: "standard",
      input: {
        cacheHit,
        standard,
      },
      output,
      sourceUrl,
    };
    return {
      id,
      ...metadata,
      aliases: [],
      limits: { contextTokens },
      prices: [price],
    } satisfies ModelData;
  });
  return { models, normalizedTable: JSON.stringify(rows) };
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
  for (const id of ["kimi-k3", "kimi-k2.7-code", "kimi-k2.6", "kimi-k2.5"]) {
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
