import { describe, expect, it } from "vitest";
import {
  parseZhipuCapabilities,
  parseZhipuInternationalPricing,
  parseZhipuOverview,
  parseZhipuPricingDom,
  type ZhipuDomCell,
} from "../src/collectors/zhipu.js";

const cell = (col: number, text: string): ZhipuDomCell => ({ col, text });

/** 国内定价页「旗舰模型」表格（真实抓取的 15 行）。 */
const FLAGSHIP_ROWS: ZhipuDomCell[][] = [
  [
    cell(1, "GLM-5.2 新品"),
    cell(2, "1M"),
    cell(3, "8元"),
    cell(4, "28元"),
    cell(5, "限时免费"),
    cell(6, "2元"),
  ],
  [
    cell(1, "GLM-5.1"),
    cell(2, "输入长度 [0, 32)"),
    cell(3, "6元"),
    cell(4, "24元"),
    cell(5, "限时免费"),
    cell(6, "1.3元"),
  ],
  [
    cell(2, "输入长度 [32+)"),
    cell(3, "8元"),
    cell(4, "28元"),
    cell(5, "限时免费"),
    cell(6, "2元"),
  ],
  [
    cell(1, "GLM-5-Turbo"),
    cell(2, "输入长度 [0, 32)"),
    cell(3, "5元"),
    cell(4, "22元"),
    cell(5, "限时免费"),
    cell(6, "1.2元"),
  ],
  [
    cell(2, "输入长度 [32+)"),
    cell(3, "7元"),
    cell(4, "26元"),
    cell(5, "限时免费"),
    cell(6, "1.8元"),
  ],
  [
    cell(1, "GLM-5"),
    cell(2, "输入长度 [0, 32)"),
    cell(3, "4元"),
    cell(4, "18元"),
    cell(5, "限时免费"),
    cell(6, "1元"),
  ],
  [
    cell(2, "输入长度 [32+)"),
    cell(3, "6元"),
    cell(4, "22元"),
    cell(5, "限时免费"),
    cell(6, "1.5元"),
  ],
  [
    cell(1, "GLM-4.7"),
    cell(2, "输入长度 [0, 32)输出长度 [0, 0.2)"),
    cell(3, "2元"),
    cell(4, "8元"),
    cell(5, "限时免费"),
    cell(6, "0.4元"),
  ],
  [
    cell(2, "输入长度 [0, 32)输出长度 [0.2+)"),
    cell(3, "3元"),
    cell(4, "14元"),
    cell(5, "限时免费"),
    cell(6, "0.6元"),
  ],
  [
    cell(2, "输入长度 [32, 200)"),
    cell(3, "4元"),
    cell(4, "16元"),
    cell(5, "限时免费"),
    cell(6, "0.8元"),
  ],
  [
    cell(1, "GLM-4.5-Air"),
    cell(2, "输入长度 [0, 32)输出长度 [0, 0.2)"),
    cell(3, "0.8元"),
    cell(4, "2元"),
    cell(5, "限时免费"),
    cell(6, "0.16元"),
  ],
  [
    cell(2, "输入长度 [0, 32)输出长度 [0.2+)"),
    cell(3, "0.8元"),
    cell(4, "6元"),
    cell(5, "限时免费"),
    cell(6, "0.16元"),
  ],
  [
    cell(2, "输入长度 [32, 128)"),
    cell(3, "1.2元"),
    cell(4, "8元"),
    cell(5, "限时免费"),
    cell(6, "0.24元"),
  ],
  [
    cell(1, "GLM-4.7-FlashX"),
    cell(2, "200K"),
    cell(3, "0.5元"),
    cell(4, "3元"),
    cell(5, "限时免费"),
    cell(6, "0.1元"),
  ],
  [
    cell(1, "GLM-4.7-Flash"),
    cell(2, "200K"),
    cell(3, "免费"),
    cell(4, "免费"),
    cell(5, "免费"),
    cell(6, "免费"),
  ],
];

describe("Zhipu pricing DOM parser", () => {
  it("parses flagship models with no token ranges", () => {
    const parsed = parseZhipuPricingDom(FLAGSHIP_ROWS);
    const glm52 = parsed.find((model) => model.id === "glm-5.2");
    expect(glm52?.prices).toEqual([
      {
        input: 8,
        cacheHit: 2,
        output: 28,
      },
    ]);
  });

  it("parses input-tiered pricing for GLM-5.1", () => {
    const parsed = parseZhipuPricingDom(FLAGSHIP_ROWS);
    const glm51 = parsed.find((model) => model.id === "glm-5.1");
    expect(glm51?.prices).toEqual([
      {
        inputTokenRange: { label: "输入长度 [0, 32)", maxInclusive: 32_000 },
        input: 6,
        cacheHit: 1.3,
        output: 24,
      },
      {
        inputTokenRange: { label: "输入长度 [32+)", minExclusive: 32_000 },
        input: 8,
        cacheHit: 2,
        output: 28,
      },
    ]);
  });

  it("parses combined input+output tiers for GLM-4.7", () => {
    const parsed = parseZhipuPricingDom(FLAGSHIP_ROWS);
    const glm47 = parsed.find((model) => model.id === "glm-4.7");
    expect(glm47?.prices).toEqual([
      {
        inputTokenRange: { label: "输入长度 [0, 32)", maxInclusive: 32_000 },
        outputTokenRange: { label: "输出长度 [0, 0.2)", maxInclusive: 200 },
        input: 2,
        cacheHit: 0.4,
        output: 8,
      },
      {
        inputTokenRange: { label: "输入长度 [0, 32)", maxInclusive: 32_000 },
        outputTokenRange: { label: "输出长度 [0.2+)", minExclusive: 200 },
        input: 3,
        cacheHit: 0.6,
        output: 14,
      },
      {
        inputTokenRange: {
          label: "输入长度 [32, 200)",
          minExclusive: 32_000,
          maxInclusive: 200_000,
        },
        input: 4,
        cacheHit: 0.8,
        output: 16,
      },
    ]);
  });

  it("parses output-tiered pricing for GLM-4.5-Air", () => {
    const parsed = parseZhipuPricingDom(FLAGSHIP_ROWS);
    const glm45 = parsed.find((model) => model.id === "glm-4.5-air");
    expect(glm45?.prices.map((price) => price.output)).toEqual([2, 6, 8]);
  });

  it("parses free models as zero prices", () => {
    const parsed = parseZhipuPricingDom(FLAGSHIP_ROWS);
    const flash = parsed.find((model) => model.id === "glm-4.7-flash");
    expect(flash?.prices).toEqual([{ input: 0, cacheHit: 0, output: 0 }]);
  });

  it("rejects an empty table", () => {
    expect(() => parseZhipuPricingDom([])).toThrow("contains no models");
  });
});

describe("Zhipu international pricing parser", () => {
  const PRICING = `# Pricing

## Models

### Text Models

Prices per 1M tokens.

| Model | Input | Cached Input | Cached Input Storage | Output |
| :-- | :-- | :-- | :-- | :-- |
| GLM-5.2 | $1.4 | $0.26 | Limited-time Free | $4.4 |
| GLM-5.1 | $1.4 | $0.26 | Limited-time Free | $4.4 |
| GLM-5 | $1 | $0.2 | Limited-time Free | $3.2 |
| GLM-5-Turbo | $1.2 | $0.24 | Limited-time Free | $4.0 |
| GLM-4.7 | $0.6 | $0.11 | Limited-time Free | $2.2 |
| GLM-4.7-FlashX | $0.07 | $0.01 | Limited-time Free | $0.4 |
| GLM-4.5-Air | $0.2 | $0.03 | Limited-time Free | $1.1 |
| GLM-4.7-Flash | Free | Free | Free | Free |

### Vision Models

| Model | Input | Cached Input | Cached Input Storage | Output |
| GLM-5V-Turbo | $1.2 | $0.24 | Limited-time Free | $4 |
`;

  it("parses single-tier USD prices with cache-hit", () => {
    const prices = parseZhipuInternationalPricing(PRICING);
    expect(prices.get("glm-5.2")).toMatchObject({
      market: "international",
      currency: "USD",
      input: { standard: 1.4, cacheHit: 0.26 },
      output: 4.4,
    });
  });

  it("maps Free to zero and skips non-target models", () => {
    const prices = parseZhipuInternationalPricing(PRICING);
    expect(prices.get("glm-4.7-flash")).toMatchObject({
      input: { standard: 0, cacheHit: 0 },
      output: 0,
    });
    // 视觉模型不收录
    expect(prices.has("glm-5v-turbo")).toBe(false);
  });

  it("rejects markdown with no target models", () => {
    expect(() => parseZhipuInternationalPricing("# no table here")).toThrow(
      "contains no target GLM models",
    );
  });
});

describe("Zhipu model overview parser", () => {
  const OVERVIEW = `## 模型一览

### 文本模型

| 模型 | 特点 | 上下文 | 最大输出 |
| :-- | :-- | :-- | :-- |
| [GLM-5.2](/cn/guide/models/text/glm-5.2) | 1M 上下文 | 1M | 128K |
| [GLM-5-Turbo](/cn/guide/models/text/glm-5-turbo) | 龙虾优化 | 200K | 128K |
| [GLM-4.5-Air](/cn/guide/models/text/glm-4.5) | 高性价比 | 128K | 96K |
| [GLM-4.7-Flash](/cn/guide/models/free/glm-4.7-flash) | 免费模型 | 200K | 128K |

### 视觉模型
`;

  it("parses context and output token limits", () => {
    const models = parseZhipuOverview(OVERVIEW);
    expect(models).toEqual([
      {
        id: "glm-5.2",
        name: "GLM-5.2",
        url: "/cn/guide/models/text/glm-5.2",
        contextTokens: 1_000_000,
        maxOutputTokens: 131_072,
      },
      {
        id: "glm-5-turbo",
        name: "GLM-5-Turbo",
        url: "/cn/guide/models/text/glm-5-turbo",
        contextTokens: 204_800,
        maxOutputTokens: 131_072,
      },
      {
        id: "glm-4.5-air",
        name: "GLM-4.5-Air",
        url: "/cn/guide/models/text/glm-4.5",
        contextTokens: 131_072,
        maxOutputTokens: 98_304,
      },
      {
        id: "glm-4.7-flash",
        name: "GLM-4.7-Flash",
        url: "/cn/guide/models/free/glm-4.7-flash",
        contextTokens: 204_800,
        maxOutputTokens: 131_072,
      },
    ]);
  });

  it("rejects overview with no text models", () => {
    expect(() => parseZhipuOverview("# no table")).toThrow(
      "contains no text models",
    );
  });
});

describe("Zhipu capability parser", () => {
  it("reads capability cards from the detail page", () => {
    const markdown = `## 能力支持

<CardGroup cols={3}>
  <Card title="思考模式" ...>提供多种思考模式</Card>
  <Card title="Function Calling" ...>强大的工具调用能力</Card>
  <Card title="上下文缓存" ...>智能缓存机制</Card>
  <Card title="结构化输出" ...>支持 JSON 输出</Card>
</CardGroup>

## 推荐场景
`;
    expect(parseZhipuCapabilities(markdown)).toEqual({
      thinking: true,
      toolCalls: true,
      jsonOutput: true,
    });
  });

  it("keeps unsupported capabilities false", () => {
    expect(parseZhipuCapabilities("## 能力支持\n\n<empty>\n")).toEqual({
      thinking: false,
      toolCalls: false,
      jsonOutput: false,
    });
  });
});
