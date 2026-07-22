import { createHash } from "node:crypto";
import type { ModelData, ModelPrice, ProviderData, Source } from "../types.js";

export const MOONSHOT_PRICING_SOURCES = [
  "https://platform.kimi.com/docs/pricing/chat-k3",
  "https://platform.kimi.com/docs/pricing/chat-k27-code",
  "https://platform.kimi.com/docs/pricing/chat-k26",
  "https://platform.kimi.com/docs/pricing/chat-k25",
] as const;
export const MOONSHOT_MODELS_OVERVIEW_URL =
  "https://platform.kimi.com/docs/api/models-overview";

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
    .map((line) => JSON.parse(line) as string[]);
  if (!rows.length) throw new Error("Kimi pricing table contains no models");
  return rows;
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
): ParsedMoonshotPage {
  const rows = parseRows(markdown);
  const models = rows.map((row) => {
    if (row.length !== 6) {
      throw new Error(`Unexpected Kimi pricing row: ${JSON.stringify(row)}`);
    }
    const [id] = row;
    if (!id) throw new Error("Kimi pricing row is missing a model ID");
    const cacheHit = parseMoney(row[2]!);
    const cacheMiss = parseMoney(row[3]!);
    const output = parseMoney(row[4]!);
    const contextTokens = parseTokenCount(row[5]!);
    const metadata = modelMetadata(id);
    const price: ModelPrice = {
      market: "china",
      currency: "CNY",
      unit: "1M_tokens",
      rateType: "standard",
      input: {
        cacheHit,
        cacheMiss,
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

export async function collectMoonshot(
  now = new Date(),
  fetcher: (url: string) => Promise<string> = fetchMarkdown,
): Promise<ProviderData> {
  const [pages, overview] = await Promise.all([
    Promise.all(
      MOONSHOT_PRICING_SOURCES.map(async (url) => ({
        url,
        parsed: parseMoonshotPricingPage(await fetcher(url), url),
      })),
    ),
    fetcher(MOONSHOT_MODELS_OVERVIEW_URL),
  ]);
  for (const id of ["kimi-k3", "kimi-k2.7-code", "kimi-k2.6", "kimi-k2.5"]) {
    if (!overview.includes(id)) {
      throw new Error(`Kimi model overview is missing ${id}`);
    }
  }
  const retrievedAt = now.toISOString();
  const sources: Source[] = pages.map(({ url, parsed }) => ({
    url,
    kind: "pricing",
    locale: "zh-CN",
    currency: "CNY",
    retrievedAt,
    contentHash: `sha256:${createHash("sha256").update(parsed.normalizedTable).digest("hex")}`,
  }));
  sources.push({
    url: MOONSHOT_MODELS_OVERVIEW_URL,
    kind: "model-metadata",
    locale: "zh-CN",
    retrievedAt,
    contentHash: `sha256:${createHash("sha256").update(overview.replace(/\s+/g, " ").trim()).digest("hex")}`,
  });
  const models = pages.flatMap(({ parsed }) => parsed.models);
  if (new Set(models.map((model) => model.id)).size !== models.length) {
    throw new Error("Kimi pricing pages contain duplicate model IDs");
  }
  return {
    schemaVersion: "1.0",
    id: "moonshot",
    name: "Kimi",
    ownedBy: "moonshot",
    baseUrls: { openai: "https://api.moonshot.cn/v1" },
    models,
    sources,
  };
}
