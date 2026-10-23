import { validateProvider } from "../src/validation.js";
import { failedHealth, formatHealthWarnings } from "../src/health.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  collectZhipuChina,
  collectZhipuInternational,
  parseZhipuCapabilities,
  parseZhipuCapabilitiesWithEvidence,
  parseZhipuChinaPricingMarkdown,
  parseZhipuInternationalPricing,
  parseZhipuOverview,
  parseZhipuPricingConfig,
  parseZhipuPricingDom,
  parseZhipuReleaseNotes,
  resolveZhipuCreatedAt,
  resolveZhipuCapabilities,
  type ZhipuDomCell,
} from "../src/collectors/zhipu.js";

const readFixture = (name: string) =>
  readFileSync(
    new URL(`../docs/zhipu-fixtures/${name}`, import.meta.url),
    "utf8",
  );

const cell = (col: number, text: string): ZhipuDomCell => ({ col, text });

/** 国内定价页「旗舰模型」表格（真实抓取的 16 行）。 */
const FLAGSHIP_ROWS: ZhipuDomCell[][] = [
  [
    cell(1, "GLM-5.3 新品"),
    cell(2, "1M"),
    cell(3, "8元"),
    cell(4, "28元"),
    cell(5, "限时免费"),
    cell(6, "2元"),
  ],
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
    const glm53 = parsed.find((model) => model.id === "glm-5.3");
    expect(glm53?.prices).toEqual([
      {
        input: 8,
        cacheHit: 2,
        output: 28,
      },
    ]);
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

  it("uses the effective price from dual-value promo cells", () => {
    const rows: ZhipuDomCell[][] = [
      [
        cell(1, "GLM-5.3-Flash 5折限时两周"),
        cell(2, "1M"),
        cell(3, "0.4元 0.8元"),
        cell(4, "1.4元 2.8元"),
        cell(5, "限时免费"),
        cell(6, "0.115元 0.23元"),
      ],
    ];
    const parsed = parseZhipuPricingDom(rows);
    expect(
      parsed.find((model) => model.id === "glm-5.3-flash")?.prices,
    ).toEqual([{ input: 0.4, cacheHit: 0.115, output: 1.4 }]);
  });

  it("rejects an empty table", () => {
    expect(() => parseZhipuPricingDom([])).toThrow("contains no models");
  });
});

describe("Zhipu pricing config parser", () => {
  const fixture = (operation: number) =>
    JSON.parse(
      readFileSync(
        new URL(`../docs/zhipu-fixtures/op-${operation}.json`, import.meta.url),
        "utf8",
      ),
    );

  it.each([1160, 1163])(
    "reads real flagship tables with dynamic codes: %s",
    (operation) => {
      const models = parseZhipuPricingDom(
        parseZhipuPricingConfig(fixture(operation)),
      );
      expect(models.map((model) => model.id)).toEqual([
        "glm-5.3",
        "glm-5.3-flash",
      ]);
      expect(models[0]!.prices).toEqual([
        operation === 1160
          ? { input: 8, cacheHit: 2, output: 28 }
          : { input: 1.4, cacheHit: 0.26, output: 4.4 },
      ]);
      expect(models[1]!.prices[0]!.input).toBe(operation === 1160 ? 0.8 : 0.15);
    },
  );

  it.each([1161, 1164])(
    "reads real legacy cards, including the empty auxiliary list: %s",
    (operation) => {
      const models = parseZhipuPricingDom(
        parseZhipuPricingConfig(fixture(operation)),
      );
      expect(models.map((model) => model.id)).toEqual(
        operation === 1161
          ? ["glm-5.3-flashx"]
          : ["glm-5.2", "glm-4.6v", "glm-ocr"],
      );
      expect(models[0]!.prices[0]).toEqual(
        operation === 1161
          ? { input: 2, cacheHit: 0.57, output: 7 }
          : { input: 1.4, cacheHit: 0.26, output: 4.4 },
      );
    },
  );

  it("uses declared codes after codes and row order change", () => {
    const data = fixture(1160);
    const content = JSON.parse(data.data[0].content);
    const table = content.list[0].table;
    const oldCodes = table.fieldList.map((field: any) => field.code);
    table.fieldList.forEach((field: any, i: number) => {
      field.code = `new-${i}`;
    });
    table.modelList.reverse().forEach((row: any) =>
      oldCodes.forEach((code: string, i: number) => {
        row[`new-${i}`] = row[code];
        delete row[code];
      }),
    );
    data.data[0].content = JSON.stringify(content);
    expect(
      parseZhipuPricingDom(parseZhipuPricingConfig(data))[0]!.prices[0],
    ).toEqual({ input: 8, cacheHit: 2, output: 28 });
  });

  it.each(["codes", "labels", "empty", "missing-cell"])(
    "rejects malformed flagship data even alongside valid legacy cards: %s",
    (kind) => {
      const data = fixture(1160);
      const content = JSON.parse(data.data[0].content);
      const table = content.list[0].table;
      if (kind === "codes") table.fieldList[0].code = "not-present";
      if (kind === "labels")
        table.modelList[1][table.fieldList[0].code].value = "Unknown input";
      if (kind === "empty") content.list = [];
      if (kind === "missing-cell")
        delete table.modelList[1][table.fieldList[1].code];
      data.data[0].content = JSON.stringify(content);
      data.data.push(...fixture(1161).data);
      expect(() => parseZhipuPricingConfig(data)).toThrow(/Zhipu/);
    },
  );

  it("rejects a config with no supported token pricing", () => {
    expect(() => parseZhipuPricingConfig({ data: [] })).toThrow(
      "contains no token-priced models",
    );
  });
});

describe("Zhipu international pricing parser", () => {
  const PRICING = `# Pricing

## Models

### Text Models

Prices per 1M tokens.

| Model | Input | Cached Input | Cached Input Storage | Output |
| :-- | :-- | :-- | :-- | :-- |
| GLM-5.3 | $1.4 | $0.26 | Limited-time Free | $4.4 |
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
    expect(prices.get("glm-5.3")).toMatchObject({
      market: "international",
      currency: "USD",
      input: { standard: 1.4, cacheHit: 0.26 },
      output: 4.4,
    });
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

  it("reads flagship models moved into the Latest Models section", () => {
    const PRICING_LATEST = `# Pricing

## Models

### Latest Models

Prices per 1M tokens.

| Model | Input | Cached Input | Cached Input Storage | Output |
| :-- | :-- | :-- | :-- | :-- |
| GLM-5.3 | $1.4 | $0.26 | Limited-time Free | $4.4 |
| GLM-5.2 | $1.4 | $0.26 | Limited-time Free | $4.4 |

### Text Models

| Model | Input | Cached Input | Cached Input Storage | Output |
| :-- | :-- | :-- | :-- | :-- |
| GLM-5.1 | $1.4 | $0.26 | Limited-time Free | $4.4 |
| GLM-4.7-Flash | Free | Free | Free | Free |

### Vision Models
`;
    const prices = parseZhipuInternationalPricing(PRICING_LATEST);
    expect(prices.get("glm-5.3")).toMatchObject({
      input: { standard: 1.4, cacheHit: 0.26 },
      output: 4.4,
    });
    expect(prices.get("glm-5.2")).toMatchObject({
      input: { standard: 1.4, cacheHit: 0.26 },
      output: 4.4,
    });
    expect(prices.get("glm-5.1")).toMatchObject({ output: 4.4 });
    expect(prices.get("glm-4.7-flash")).toMatchObject({
      input: { standard: 0, cacheHit: 0 },
      output: 0,
    });
  });

  it("reads models moved into the nested Other Pricing accordion", () => {
    // 线上真实结构：旧模型表被整段收进 <Accordion>，标题缩进成 `    ### Text Models`，
    // 于是同一个标题在文档里出现两次，只取第一次会漏掉折叠里的全部模型。
    const markdown = `# Pricing

## Models

### Latest Models

Prices per 1M tokens.

| Model | Input | Cached Input | Cached Input Storage | Output |
| :- | :- | :- | :- | :- |
| GLM-5.3 | $1.4 | $0.26 | Limited-time Free | $4.4 |

### Text Models

Prices per 1M tokens.

| Model | Input | Cached Input | Cached Input Storage | Output |
| :- | :- | :- | :- | :- |
| GLM-5.1 | $1.4 | $0.26 | Limited-time Free | $4.4 |
| GLM-4.6 | $0.6 | $0.11 | Limited-time Free | $2.2 |

### Built-in Tools

| Tool | Cost |
| :- | :- |
| Web Search | $0.01 / use |

<AccordionGroup>
  <Accordion title="Other Pricing">
    ### Text Models

    Prices per 1M tokens.

    | Model | Input | Cached Input | Cached Input Storage | Output |
    | :- | :- | :- | :- | :- |
    | GLM-4.7-FlashX | $0.07 | $0.01 | Limited-time Free | $0.4 |
    | GLM-4.5-Air | $0.2 | $0.03 | Limited-time Free | $1.1 |
    | GLM-4.5-AirX | $1.1 | $0.22 | Limited-time Free | $4.5 |
    | GLM-4.7-Flash | Free | Free | Free | Free |
    | GLM-4.5-Flash | Free | Free | Free | Free |

    ### Vision Models

    | Model | Input | Cached Input | Cached Input Storage | Output |
    | :- | :- | :- | :- | :- |
    | GLM-5V-Turbo | $1.2 | $0.24 | Limited-time Free | $4 |
  </Accordion>
</AccordionGroup>
`;
    const prices = parseZhipuInternationalPricing(markdown);
    expect(prices.get("glm-4.7-flashx")).toMatchObject({
      input: { standard: 0.07, cacheHit: 0.01 },
      output: 0.4,
    });
    expect(prices.get("glm-4.5-air")).toMatchObject({
      input: { standard: 0.2, cacheHit: 0.03 },
      output: 1.1,
    });
    expect(prices.get("glm-4.5-airx")).toMatchObject({
      input: { standard: 1.1, cacheHit: 0.22 },
      output: 4.5,
    });
    expect(prices.get("glm-4.7-flash")).toMatchObject({
      input: { standard: 0, cacheHit: 0 },
      output: 0,
    });
    expect(prices.get("glm-4.5-flash")).toMatchObject({
      input: { standard: 0, cacheHit: 0 },
      output: 0,
    });
    // 折叠面板外的表仍要解析到，且视觉模型依旧不收录。
    expect(prices.get("glm-5.3")).toMatchObject({ output: 4.4 });
    expect(prices.get("glm-4.6")).toMatchObject({ output: 2.2 });
    expect(prices.has("glm-5v-turbo")).toBe(false);
  });

  it("uses the non-strikethrough effective price for discounted models", () => {
    const markdown = `# Pricing

### Latest Models

| Model | Input | Cached Input | Cached Input Storage | Output |
| :-- | :-- | :-- | :-- | :-- |
| GLM-5.3-Flash | ~~$0.15~~ $0.075 | ~~$0.03~~ $0.015 | Limited-time Free | ~~$0.50~~ $0.25 |
`;
    const prices = parseZhipuInternationalPricing(markdown);
    expect(prices.get("glm-5.3-flash")).toMatchObject({
      input: { standard: 0.075, cacheHit: 0.015 },
      output: 0.25,
    });
  });
});

describe("Zhipu model overview parser", () => {
  const OVERVIEW = `# 模型概览

## 推荐模型

| 模型 | 特点 | 上下文 | 最大输出 |
| :-- | :-- | :-- | :-- |
| [GLM-5.3](/cn/guide/models/text/glm-5.3) | 最新旗舰 | 1M | 128K |
| [GLM-5.3-Flash](/cn/guide/models/vlm/glm-5.3-flash) | 原生多模态 | 1M | 128K |
| [GLM-5.2](/cn/guide/models/text/glm-5.2) | 1M 上下文 | 1M | 128K |
| [GLM-Image](/cn/guide/models/image-generation/glm-image) | 图像生成 |  |  |
| [Embedding-3](/cn/guide/models/embedding/embedding-3) | 向量化模型 | 8K | - |

<Accordion title="全部模型">
  ### 文本模型

  | 模型 | 特点 | 上下文 | 最大输出 |
  | :-- | :-- | :-- | :-- |
  | [GLM-5.1](/cn/guide/models/text/glm-5.1) | 长程任务 | 200K | 128K |
  | [GLM-5-Turbo](/cn/guide/models/text/glm-5-turbo) | 龙虾优化 | 200K | 128K |
  | [GLM-4.5-Air](/cn/guide/models/text/glm-4.5) | 高性价比 | 128K | 96K |
  | [GLM-4.7-Flash](/cn/guide/models/free/glm-4.7-flash) | 免费模型 | 200K | 128K |

  ### 视觉理解模型
`;

  it("parses context and output token limits across both tables", () => {
    const models = parseZhipuOverview(OVERVIEW);
    expect(models).toEqual([
      {
        id: "glm-5.3",
        name: "GLM-5.3",
        url: "/cn/guide/models/text/glm-5.3",
        contextTokens: 1_000_000,
        maxOutputTokens: 131_072,
      },
      {
        id: "glm-5.3-flash",
        name: "GLM-5.3-Flash",
        url: "/cn/guide/models/vlm/glm-5.3-flash",
        contextTokens: 1_000_000,
        maxOutputTokens: 131_072,
      },
      {
        id: "glm-5.2",
        name: "GLM-5.2",
        url: "/cn/guide/models/text/glm-5.2",
        contextTokens: 1_000_000,
        maxOutputTokens: 131_072,
      },
      {
        id: "glm-5.1",
        name: "GLM-5.1",
        url: "/cn/guide/models/text/glm-5.1",
        contextTokens: 204_800,
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

  it.each([
    "## 能力支持\n\n<empty>\n",
    "# 无能力区块",
    "## 能力支持\n* [未知能力](/unknown)",
  ])("rejects unreadable capability fields: %s", (markdown) => {
    expect(() => parseZhipuCapabilities(markdown)).toThrow(/capability/);
  });

  it("能力区存在但没列某项 → 判为不支持（白名单），并记录 parsed/defaulted", () => {
    const parsed = parseZhipuCapabilitiesWithEvidence(
      "## 能力支持\n* [思考模式](/thinking)",
    );
    expect(parsed.capabilities).toEqual({
      thinking: true,
      toolCalls: false,
      jsonOutput: false,
    });
    expect(parsed.parsedFields).toEqual(["thinking"]);
    expect(parsed.defaultedFields).toEqual(["toolCalls", "jsonOutput"]);
  });

  it("only writes false when the source explicitly says unsupported", () => {
    expect(
      parseZhipuCapabilities(
        '## 能力支持\n<Card title="不支持思考模式">否</Card>\n<Card title="Function Calling">是</Card>\n<Card title="结构化输出">是</Card>',
      ),
    ).toEqual({ thinking: false, toolCalls: true, jsonOutput: true });
  });

  it.each(["capabilities-list.md", "capabilities-quote.md"])(
    "reads real capability markdown: %s",
    (name) => {
      expect(parseZhipuCapabilities(readFixture(name))).toEqual({
        thinking: true,
        toolCalls: true,
        jsonOutput: true,
      });
    },
  );

  it("parses the bullet-list template used by GLM-5.3", () => {
    const markdown = `## 能力支持

* [思考模式](/cn/guide/capabilities/thinking-mode)：提供多种思考模式
* [流式输出](/cn/guide/capabilities/streaming)：支持实时流式响应
* [Function Calling](/cn/guide/capabilities/function-calling)：强大的工具调用能力
* [上下文缓存](/cn/guide/capabilities/cache)：智能缓存机制
* [结构化输出](/cn/guide/capabilities/struct-output)：支持 JSON 输出

## 详细介绍
`;
    expect(parseZhipuCapabilities(markdown)).toEqual({
      thinking: true,
      toolCalls: true,
      jsonOutput: true,
    });
  });
});

describe("Zhipu release notes parser", () => {
  const RELEASES = `# 新品发布

<Update label="2026-8-19" description="GLM-5.3 新一代旗舰模型上线">
  💬 [**GLM-5.3**](/cn/guide/models/text/glm-5.3)
</Update>

<Update label="2026-06-16" description="GLM-5.2 新一代旗舰模型上线">
  💬 [**GLM-5.2**](/cn/guide/models/text/glm-5.2)
</Update>

<Update label="2026-03-15" description="GLM-5-Turbo">
  💬 [**GLM-5-Turbo**](/cn/guide/models/text/glm-5-turbo)
</Update>

<Update label="2026-01-19" description="GLM-4.7-Flash 开源">
  💬 [**GLM-4.7-Flash**](/cn/guide/models/free/glm-4.7-flash)
</Update>

<Update label="2026-01-14" description="GLM-Image">
  📷 [**GLM-Image**](/cn/guide/models/text/glm-4.7)
</Update>

<Update label="2025-12-22" description="GLM-4.7 新一代旗舰模型上线">
  💬 [**GLM-4.7**](/cn/guide/models/text/glm-4.7)
</Update>

<Update label="2025-07-28" description="GLM-4.5 上线">
  💬 [**GLM-4.5**](/cn/guide/models/text/glm-4.5)
</Update>
`;

  it("maps each model to its earliest release date", () => {
    const dates = parseZhipuReleaseNotes(RELEASES);
    // 官方公告日期不带前导零（`2026-8-19`），应归一化为 ISO 日期。
    expect(dates.get("glm-5.3")).toBe("2026-08-19T00:00:00.000+08:00");
    expect(dates.get("glm-5.2")).toBe("2026-06-16T00:00:00.000+08:00");
    expect(dates.get("glm-5-turbo")).toBe("2026-03-15T00:00:00.000+08:00");
    expect(dates.get("glm-4.7-flash")).toBe("2026-01-19T00:00:00.000+08:00");
    expect(dates.get("glm-4.7")).toBe("2025-12-22T00:00:00.000+08:00");
    // GLM-Image 公告链接指向 glm-4.7，但按显示名提取，不污染 glm-4.7 日期。
    expect(dates.get("glm-4.7")).toBe("2025-12-22T00:00:00.000+08:00");
    // 解析器不再依赖硬编码清单，凡公告中出现的 GLM 模型都会提取日期。
    expect(dates.get("glm-4.5")).toBe("2025-07-28T00:00:00.000+08:00");
    expect(dates.get("glm-image")).toBe("2026-01-14T00:00:00.000+08:00");
  });

  it.each([
    "# no updates",
    "[**GLM-5.3**](/cn/guide/models/text/glm-5.3)",
    "**2026-02-30**\n[**GLM-5.3**](/model)",
  ])("rejects missing or invalid dates: %s", (markdown) => {
    expect(() => parseZhipuReleaseNotes(markdown)).toThrow(/date/);
  });

  it("reads the real markdown release notes, including non-padded dates", () => {
    const dates = parseZhipuReleaseNotes(readFixture("new-releases.md"));
    expect(dates.get("glm-5.3-flash")).toBe("2026-08-26T00:00:00.000+08:00");
    expect(dates.get("glm-5.3")).toBe("2026-08-19T00:00:00.000+08:00");
    expect(dates.get("glm-5.2")).toBe("2026-06-16T00:00:00.000+08:00");
  });

  it("keeps the earliest date across both formats", () => {
    expect(
      parseZhipuReleaseNotes(
        `**2026-8-20**\n[**GLM-5.3**](/model)\n${RELEASES}`,
      ).get("glm-5.3"),
    ).toBe("2026-08-19T00:00:00.000+08:00");
  });
});

describe("Zhipu collectors derive the model set from official sources", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const metadata = new Map<string, any>([
    [
      "glm-5.3",
      {
        id: "glm-5.3",
        name: "GLM-5.3",
        url: "/cn/guide/models/text/glm-5.3",
        contextTokens: 1_000_000,
        maxOutputTokens: 131_072,
        ...resolveZhipuCapabilities(readFixture("capabilities-list.md")),
        createdAtSource: "release-notes",
        createdAtEvidence: { releaseNotesMentioned: true },
        createdAt: "2026-08-19T00:00:00.000+08:00",
      },
    ],
    [
      "glm-5.3-flash",
      {
        id: "glm-5.3-flash",
        createdAtSource: "release-notes",
        createdAtEvidence: { releaseNotesMentioned: true },
        createdAt: "2026-08-26T00:00:00.000+08:00",
        name: "GLM-5.3-Flash",
        url: "/cn/guide/models/vlm/glm-5.3-flash",
        contextTokens: 1_000_000,
        maxOutputTokens: 131_072,
        ...resolveZhipuCapabilities(readFixture("capabilities-list.md")),
      },
    ],
    [
      "glm-4.6",
      {
        id: "glm-4.6",
        createdAtSource: "release-notes",
        createdAtEvidence: { releaseNotesMentioned: true },
        createdAt: "2025-09-30T00:00:00.000+08:00",
        name: "GLM-4.6",
        url: "/cn/guide/models/text/glm-4.6",
        contextTokens: 204_800,
        maxOutputTokens: 131_072,
        ...resolveZhipuCapabilities(readFixture("capabilities-list.md")),
      },
    ],
  ]);

  it.each(["createdAt", "capabilities"])(
    "rejects missing selected-model metadata: %s",
    async (field) => {
      const broken = structuredClone(metadata);
      delete broken.get("glm-5.3")[field];
      await expect(
        collectZhipuInternational(
          now,
          async () =>
            "### Text Models\n| GLM-5.3 | $1.4 | $0.26 | Free | $4.4 |",
          async () => broken,
        ),
      ).rejects.toThrow(/missing/);
    },
  );

  it("includes new models present in both metadata and CN pricing", async () => {
    const rows: ZhipuDomCell[][] = [
      [
        cell(1, "GLM-5.3 新品"),
        cell(2, "1M"),
        cell(3, "8元"),
        cell(4, "28元"),
        cell(5, "限时免费"),
        cell(6, "2元"),
      ],
      [
        cell(1, "GLM-5.3-Flash 5折限时两周"),
        cell(2, "1M"),
        cell(3, "0.4元 0.8元"),
        cell(4, "1.4元 2.8元"),
        cell(5, "限时免费"),
        cell(6, "0.115元 0.23元"),
      ],
    ];
    const provider = await collectZhipuChina(
      now,
      () => Promise.resolve(rows),
      () => Promise.resolve(metadata),
    );
    // glm-4.6 元数据中存在但没有国内按量价，应被跳过而非报错。
    expect(provider.models.map((model) => model.id)).toEqual([
      "glm-5.3",
      "glm-5.3-flash",
    ]);
    expect(
      provider.models.find((model) => model.id === "glm-5.3-flash")!.prices[0],
    ).toMatchObject({
      market: "china",
      currency: "CNY",
      input: { standard: 0.4, cacheHit: 0.115 },
      output: 1.4,
    });
  });

  it("includes new models with effective international pricing", async () => {
    const markdown = `# Pricing
### Latest Models

| Model | Input | Cached Input | Cached Input Storage | Output |
| :-- | :-- | :-- | :-- | :-- |
| GLM-5.3 | $1.4 | $0.26 | Limited-time Free | $4.4 |
| GLM-5.3-Flash | ~~$0.15~~ $0.075 | ~~$0.03~~ $0.015 | Limited-time Free | ~~$0.50~~ $0.25 |
`;
    const provider = await collectZhipuInternational(
      now,
      () => Promise.resolve(markdown),
      () => Promise.resolve(metadata),
    );
    expect(provider.models.map((model) => model.id)).toEqual([
      "glm-5.3",
      "glm-5.3-flash",
    ]);
    expect(
      provider.models.find((model) => model.id === "glm-5.3-flash")!.prices[0],
    ).toMatchObject({
      market: "international",
      currency: "USD",
      input: { standard: 0.075, cacheHit: 0.015 },
      output: 0.25,
    });
  });
});

describe("真实完整定价文档回归", () => {
  it("恢复国内 GLM-5.2 以及输入/输出分档", () => {
    const models = parseZhipuPricingDom(
      parseZhipuChinaPricingMarkdown(readFixture("cn-pricing.md")),
    );
    expect(models.find((model) => model.id === "glm-5.2")!.prices).toEqual([
      { input: 8, cacheHit: 2, output: 28 },
    ]);
    expect(models.find((model) => model.id === "glm-5.1")!.prices).toEqual([
      {
        input: 6,
        cacheHit: 1.3,
        output: 24,
        inputTokenRange: { label: "输入长度 [0, 32)", maxInclusive: 32000 },
      },
      {
        input: 8,
        cacheHit: 2,
        output: 28,
        inputTokenRange: { label: "输入长度 [32+)", minExclusive: 32000 },
      },
    ]);
    expect(
      models.find((model) => model.id === "glm-4.7")!.prices[1]!
        .outputTokenRange,
    ).toEqual({ label: "输出长度 [0.2+)", minExclusive: 200 });
  });

  it("恢复引用块中的全部五个国际站模型", () => {
    const prices = parseZhipuInternationalPricing(
      readFixture("intl-pricing.md"),
    );
    for (const id of [
      "glm-4.7-flashx",
      "glm-4.5-air",
      "glm-4.5-airx",
      "glm-4.7-flash",
      "glm-4.5-flash",
    ])
      expect(prices.has(id)).toBe(true);
    expect(prices.get("glm-4.5-air")!.input.standard).toBe(0.2);
    expect(prices.get("glm-4.5-flash")!.output).toBe(0);
  });
});

describe("发布日期二分（真实官方 fixture）", () => {
  const notes = [
    readFixture("new-releases.md"),
    readFixture("intl-new-released.md"),
  ];
  const dates = parseZhipuReleaseNotes(notes[0]!);
  const pricing = readFixture("intl-pricing.md");
  const unknownIds = [
    "glm-5.3-flashx",
    "glm-4.7-flashx",
    "glm-4.5-air",
    "glm-4.5-airx",
    "glm-4.5-flash",
  ];
  const collect = async (texts = notes, overrides = {}) => {
    const prices = parseZhipuInternationalPricing(pricing);
    const metadata = new Map(
      parseZhipuOverview(readFixture("model-overview.md"))
        .filter((model) => prices.has(model.id))
        .map((model) => [
          model.id,
          {
            ...model,
            ...resolveZhipuCreatedAt(
              model.id,
              texts,
              dates,
              prices.has(model.id),
            ),
            ...resolveZhipuCapabilities(readFixture("capabilities-quote.md")),
            ...(model.id === "glm-5.3" ? overrides : {}),
          },
        ]),
    );
    return collectZhipuInternational(
      new Date("2026-10-21T00:00:00Z"),
      async () => pricing,
      async () => metadata,
    );
  };

  it("发布页有日期 → release-notes，且通过 provider 校验", async () => {
    const provider = await collect();
    expect(
      provider.models.find((model) => model.id === "glm-5.3"),
    ).toMatchObject({
      createdAt: "2026-08-19T00:00:00.000+08:00",
      createdAtSource: "release-notes",
      createdAtEvidence: { releaseNotesMentioned: true },
    });
    await validateProvider(provider);
  });

  it("仅有定价引用块 → null + not-documented，health 显式列出五个 warning 模型", async () => {
    const provider = await collect();
    expect(provider.health.status).toBe("healthy");
    expect(provider.health.warnings).toEqual([
      { code: "createdAt-not-documented", modelIds: unknownIds },
    ]);
    for (const id of unknownIds) {
      expect(provider.models.find((model) => model.id === id)).toMatchObject({
        createdAt: null,
        createdAtSource: "not-documented",
        createdAtEvidence: { releaseNotesMentioned: false },
      });
      expect(
        formatHealthWarnings(provider.id, provider.health).join("\n"),
      ).toContain(id);
    }
  });

  it("发布页出现过完整模型名但日期无法解析 → 必须抛错", async () => {
    // 真实文档的一个模型链接改为普通正文，日期仍存在、其它模型仍能解析。
    const broken = notes[0]!.replaceAll("[**GLM-5.3**]", "GLM-5.3");
    const brokenDates = parseZhipuReleaseNotes(broken);
    expect(brokenDates.has("glm-5.3")).toBe(false);
    expect(() =>
      resolveZhipuCreatedAt("glm-5.3", [broken, notes[1]!], brokenDates, true),
    ).toThrow(/parsing failure/);
    // 只在另一渠道正文出现也不能放行，不能把变体和基座做子串匹配。
    expect(() =>
      resolveZhipuCreatedAt(
        "glm-5.3-flashx",
        [notes[0]!, `${notes[1]}\nGLM-5.3-FlashX`],
        dates,
        true,
      ),
    ).toThrow(/parsing failure/);
  });

  it("给解析失败模型强打 not-documented → 采集断言与 provider 校验均拒绝", async () => {
    const forged = {
      createdAt: null,
      createdAtSource: "not-documented",
      createdAtEvidence: { releaseNotesMentioned: true },
    };
    await expect(collect(notes, forged)).rejects.toThrow(
      /invalid not-documented/,
    );
    const provider = await collect();
    Object.assign(
      provider.models.find((model) => model.id === "glm-5.3")!,
      forged,
    );
    await expect(validateProvider(provider)).rejects.toThrow(
      /invalid not-documented/,
    );
  });

  it("失败保留成功快照时仍保留 warning 名单并通过校验", async () => {
    const provider = await collect();
    provider.health = failedHealth(provider.health, new Error("fetch failed"));
    expect(provider.health.status).toBe("error");
    expect(provider.health.warnings?.[0]?.modelIds).toEqual(unknownIds);
    await validateProvider(provider);
  });

  it("没有官方定价证据时也不能标记 not-documented", () => {
    expect(() =>
      resolveZhipuCreatedAt("glm-4.5-air", notes, dates, false),
    ).toThrow(/invalid not-documented/);
  });
});

describe("能力二分（真实官方 fixture）", () => {
  const present = readFixture("capabilities-list.md");
  const absent = readFixture("glm-4-long.md");
  const collect = async (
    capabilityMetadata = resolveZhipuCapabilities(absent),
  ) =>
    collectZhipuChina(
      new Date("2026-10-21T00:00:00Z"),
      async () => parseZhipuChinaPricingMarkdown(readFixture("cn-pricing.md")),
      async () =>
        new Map([
          [
            "glm-4-long",
            {
              id: "glm-4-long",
              name: "GLM-4-Long",
              url: "/cn/guide/models/text/glm-4-long",
              contextTokens: 1_000_000,
              maxOutputTokens: 4096,
              ...resolveZhipuCreatedAt(
                "glm-4-long",
                [
                  readFixture("new-releases.md"),
                  readFixture("intl-new-released.md"),
                ],
                parseZhipuReleaseNotes(readFixture("new-releases.md")),
                true,
              ),
              ...capabilityMetadata,
            },
          ],
        ]),
    );

  it("有能力区且解析成功 → docs，通过采集及 provider 校验", async () => {
    const provider = await collect(resolveZhipuCapabilities(present));
    expect(provider.models[0]).toMatchObject({
      capabilitiesSource: "docs",
      capabilitiesEvidence: { sectionPresent: true },
      capabilities: { thinking: true, toolCalls: true, jsonOutput: true },
    });
    await validateProvider(provider);
  });

  it("完全没有能力区 → null，warning 点名 glm-4-long", async () => {
    const provider = await collect();
    expect(provider.models[0]).toMatchObject({
      capabilities: null,
      capabilitiesSource: "not-documented",
      capabilitiesEvidence: { sectionPresent: false },
    });
    expect(provider.health.status).toBe("healthy");
    expect(provider.health.warnings).toContainEqual({
      code: "capabilities-not-documented",
      modelIds: ["glm-4-long"],
    });
    expect(
      formatHealthWarnings(provider.id, provider.health).join("\n"),
    ).toContain("capabilities-not-documented (1): glm-4-long");
    await validateProvider(provider);
  });

  it("GLM-4 页面没有「思考」→ thinking=false，evidence 标明 defaulted", () => {
    const resolved = resolveZhipuCapabilities(readFixture("glm-4.md"));
    expect(resolved.capabilitiesSource).toBe("docs");
    expect(resolved.capabilities).toEqual({
      thinking: false,
      toolCalls: true,
      jsonOutput: true,
    });
    expect(resolved.capabilitiesEvidence).toMatchObject({
      sectionPresent: true,
      defaultedFields: ["thinking"],
    });
    expect(validateProvider.length).toBeGreaterThan(0);
  });

  it("有能力区但 0 项可识别 → 必须抛错（模板漂移不算不支持）", () => {
    const unknown = present.replace(/^- .*$/gm, "未知模板");
    for (const text of [
      unknown,
      present.replace("## 能力支持", "## 模型能力"),
      present.replace("## 能力支持", "## 能力"),
      present.replace("## 能力支持", ""),
    ])
      expect(() => resolveZhipuCapabilities(text)).toThrow(/capability/);
  });

  it("给解析失败强打 not-documented → 采集断言与 provider 校验均拒绝", async () => {
    const forged = {
      capabilities: null,
      capabilitiesSource: "not-documented" as const,
      capabilitiesEvidence: { sectionPresent: true },
    };
    await expect(collect(forged)).rejects.toThrow(
      /invalid not-documented capabilities/,
    );
    const provider = await collect();
    Object.assign(provider.models[0]!, forged);
    await expect(validateProvider(provider)).rejects.toThrow(
      /invalid not-documented capabilities/,
    );
  });

  it("来源/字段/证据矛盾、漏 warning 和伪造空能力均拒绝", async () => {
    for (const overrides of [
      { capabilitiesEvidence: undefined },
      {
        capabilities: { thinking: false, toolCalls: false, jsonOutput: false },
      },
      { capabilitiesSource: "docs" },
    ]) {
      const provider = await collect();
      Object.assign(provider.models[0]!, overrides);
      await expect(validateProvider(provider)).rejects.toThrow(
        /capability|capabilities/,
      );
    }
    const provider = await collect();
    provider.health.warnings = provider.health.warnings!.filter(
      (warning) => warning.code !== "capabilities-not-documented",
    );
    await expect(validateProvider(provider)).rejects.toThrow(
      /capabilities warnings/,
    );
  });
});

describe("Zhipu model overview detail URL normalization", () => {
  it("strips an existing .md suffix so the collector does not request .md.md", () => {
    // 上游 model-overview 自 2026-10 起把部分详情链接写成 glm-5.3.md，
    // collector 会再拼一次 .md；这里钉住归一化行为。
    const overview = `# 模型概览

## 推荐模型

| 模型 | 特点 | 上下文 | 最大输出 |
| :-- | :-- | :-- | :-- |
| [GLM-5.3](/cn/guide/models/text/glm-5.3.md) | 最新旗舰 | 1M | 128K |
| [GLM-5.2](/cn/guide/models/text/glm-5.2) | 1M 上下文 | 1M | 128K |
`;
    const models = parseZhipuOverview(overview);
    expect(models.map((model) => model.url)).toEqual([
      "/cn/guide/models/text/glm-5.3",
      "/cn/guide/models/text/glm-5.2",
    ]);
  });
});
