import { describe, expect, it, vi, afterEach } from "vitest";
import {
  collectLongCat,
  LONGCAT_PRICING_SOURCES,
  parseLongCatMaxOutput,
  parseLongCatModelDocs,
  parseLongCatPricingPage,
} from "../src/collectors/longcat.js";

const pricingHtml = `
<table>
  <tr><th>计费项</th><th>原价 / 百万 Tokens</th><th>折扣价 / 百万 Tokens（限时）</th></tr>
  <tr><td>输入（未命中缓存）</td><td>¥5</td><td>¥2</td></tr>
  <tr><td>输入（命中缓存）</td><td>¥0.10</td><td>¥0.04</td></tr>
  <tr><td>输出</td><td>¥20</td><td>¥8</td></tr>
</table>`;

const modelDocsHtml = `
<pre>curl --location example</pre>
<pre>{
  "id": "LongCat-2.0",
  "name": "LongCat-2.0",
  "created": 1773331200,
  "context_length": 1048576,
  "architecture": {
    "input_modalities": ["text"],
    "output_modalities": ["text"],
    "tokenizer": "Other"
  },
  "supported_parameters": ["max_tokens", "stream", "tools", "thinking"],
  "pricing": { "prompt": "2", "completion": "8", "cached_tokens": "0.04" }
}</pre>`;

describe("LongCat collector parsers", () => {
  it("keeps standard and limited-time CNY prices separate", () => {
    const parsed = parseLongCatPricingPage(
      pricingHtml,
      LONGCAT_PRICING_SOURCES[0],
    );
    expect(parsed.prices).toEqual([
      {
        market: "china",
        currency: "CNY",
        unit: "1M_tokens",
        rateType: "standard",
        input: { cacheHit: 0.1, standard: 5 },
        output: 20,
      },
      {
        market: "china",
        currency: "CNY",
        unit: "1M_tokens",
        rateType: "promotional",
        input: { cacheHit: 0.04, standard: 2 },
        output: 8,
      },
    ]);
  });

  // 上游 2.5 定价页只有「折扣价」一列（尚无原价）。旧解析器要求 ≥2 列，
  // 遇到这种页面会直接抛错，把整个 longcat 采集判成 unhealthy。
  it("parses a single-column (discounted-only) pricing table", () => {
    const singleColumnHtml = `
<table>
  <tr><th>计费项</th><th>折扣价 / 百万 Tokens（限时）</th></tr>
  <tr><td>输入（未命中缓存）</td><td>¥2</td></tr>
  <tr><td>输入（命中缓存）</td><td>¥0.04</td></tr>
  <tr><td>输出</td><td>¥8</td></tr>
</table>`;
    const parsed = parseLongCatPricingPage(
      singleColumnHtml,
      LONGCAT_PRICING_SOURCES[2],
    );
    expect(parsed.prices).toEqual([
      {
        market: "china",
        currency: "CNY",
        unit: "1M_tokens",
        rateType: "promotional",
        input: { cacheHit: 0.04, standard: 2 },
        output: 8,
      },
    ]);
  });

  it("extracts the documented model API response", () => {
    const detail = parseLongCatModelDocs(modelDocsHtml);
    expect(detail).toMatchObject({
      id: "LongCat-2.0",
      context_length: 1_048_576,
      supported_parameters: ["max_tokens", "stream", "tools", "thinking"],
    });
  });

  // 上游 2026-09 把文档示例换成了 LongCat-2.5-Preview。旧代码写死
  // id === "LongCat-2.0"，整个采集因此失败（生产事故）。示例里的任何一个
  // 模型都应当被接受，模型身份由定价页决定。
  it("accepts a renamed model in the documentation example", () => {
    const renamed = modelDocsHtml.replaceAll(
      "LongCat-2.0",
      "LongCat-2.5-Preview",
    );
    const detail = parseLongCatModelDocs(renamed);
    expect(detail.id).toBe("LongCat-2.5-Preview");
    expect(detail.context_length).toBe(1_048_576);
  });

  it("converts the documented binary 128K output limit exactly", () => {
    const html =
      "LongCat-2.0: 1M token context window with a maximum output length of 128K tokens";
    expect(parseLongCatMaxOutput(html)).toBe(131_072);
  });

  // quickstart 现在同时列出多个模型，各自一行。不带模型名取第一个匹配会
  // 「碰巧」拿到别的模型的额度；必须按模型名精确定位。
  it("reads the max output limit of the requested model only", () => {
    const html =
      "LongCat-2.5-Preview: 1M token context window with a maximum output length of 256K tokens " +
      "LongCat-2.0: 1M token context window with a maximum output length of 128K tokens";
    expect(parseLongCatMaxOutput(html, "LongCat-2.0")).toBe(131_072);
    expect(parseLongCatMaxOutput(html, "LongCat-2.5-Preview")).toBe(262_144);
  });

  it("fails loudly when the requested model is absent", () => {
    const html =
      "LongCat-2.0: 1M token context window with a maximum output length of 128K tokens";
    expect(() => parseLongCatMaxOutput(html, "LongCat-9.9")).toThrow(
      /maximum output length/,
    );
  });
});

// 端到端（打桩认证端点 + 真实页面形状）。这一层才能抓到「字段缺失」类缺陷：
// 上游 2.5-Preview 的详情接口不返回 created，`new Date(undefined*1000)` 会抛
// "Invalid time value"，把整条采集判成 unhealthy（真实 CI 事故）。
describe("collectLongCat", () => {
  const pages: Record<string, string> = {
    "https://longcat.chat/platform/docs/zh/pricing/long-cat-2.0": pricingHtml,
    "https://longcat.chat/platform/docs/pricing/long-cat-2.0": `
<table>
  <tr><th>Item</th><th>Price $/1M Tokens</th><th>Discounted Price $/1M Tokens (limited-time)</th></tr>
  <tr><td>Uncached Input</td><td>$0.75</td><td>$0.30</td></tr>
  <tr><td>Cached Input</td><td>$0.015</td><td>$0.006</td></tr>
  <tr><td>Output</td><td>$2.95</td><td>$1.20</td></tr>
</table>`,
    "https://longcat.chat/platform/docs/zh/pricing/longcat-2.5": `
<table>
  <tr><th>计费项</th><th>折扣价 / 百万 Tokens（限时）</th></tr>
  <tr><td>输入（未命中缓存）</td><td>¥2</td></tr>
  <tr><td>输入（命中缓存）</td><td>¥0.04</td></tr>
  <tr><td>输出</td><td>¥8</td></tr>
</table>`,
    "https://longcat.chat/platform/docs/pricing/longcat-2.5": `
<table>
  <tr><th>Item</th><th>Discounted Price $/1M Tokens (limited-time)</th></tr>
  <tr><td>Uncached Input</td><td>$0.30</td></tr>
  <tr><td>Cached Input</td><td>$0.006</td></tr>
  <tr><td>Output</td><td>$1.20</td></tr>
</table>`,
    "https://longcat.chat/platform/docs/": `
      LongCat-2.5-Preview: 1M token context window with a maximum output length of 128K tokens
      LongCat-2.0: 1M token context window with a maximum output length of 128K tokens`,
    "https://longcat.chat/platform/docs/zh/api/model": modelDocsHtml,
  };

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  afterEach(() => vi.unstubAllGlobals());

  it("emits both models with per-model pricing, tolerating a missing created", async () => {
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url.includes("api.longcat.chat")) {
        if (url.endsWith("/models"))
          return json({
            object: "list",
            data: [
              {
                id: "LongCat-2.5-Preview",
                object: "model",
                owned_by: "LongCat",
                context_window: 1_048_576,
                max_output_tokens: 131_072,
              },
              {
                id: "LongCat-2.0",
                object: "model",
                owned_by: "LongCat",
                context_window: 1_048_576,
                max_output_tokens: 131_072,
              },
            ],
          });
        const id = url.split("/").at(-1)!;
        return json({
          id,
          name: id,
          // 2.5-Preview 的真实详情**没有** created —— 这正是崩溃触发点
          ...(id === "LongCat-2.0" ? { created: 1_773_331_200 } : {}),
          context_length: 1_048_576,
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
            tokenizer: "Other",
          },
          supported_parameters: ["max_tokens", "stream", "tools", "thinking"],
          pricing: { prompt: "2", completion: "8", cached_tokens: "0.04" },
        });
      }
      const page = pages[url];
      if (!page) throw new Error(`unexpected fetch: ${url}`);
      return new Response(page, { status: 200 });
    });

    const data = await collectLongCat(
      new Date("2026-09-26T00:00:00Z"),
      "test-key",
    );

    expect(data.health.status).toBe("healthy");
    expect(data.models.map((m) => m.id)).toEqual([
      "LongCat-2.0",
      "LongCat-2.5-Preview",
    ]);

    const [older, newer] = data.models;
    // 价格必须各归各的：2.0 有原价+折扣价，2.5 目前只有折扣价
    expect(
      older!.prices.map((p) => `${p.market}/${p.rateType}`).sort(),
    ).toEqual([
      "china/promotional",
      "china/standard",
      "international/promotional",
      "international/standard",
    ]);
    expect(
      newer!.prices.map((p) => `${p.market}/${p.rateType}`).sort(),
    ).toEqual(["china/promotional", "international/promotional"]);
    // 2.0 原价：CNY 5 / USD 0.75；2.5 折扣价：CNY 2 / USD 0.30
    expect(
      older!.prices
        .filter((p) => p.rateType === "standard")
        .map((p) => p.input.standard)
        .sort(),
    ).toEqual([0.75, 5]);
    expect(newer!.prices.map((p) => p.input.standard).sort()).toEqual([0.3, 2]);
    // 2.5 绝不能出现 2.0 的原价
    expect(newer!.prices.some((p) => p.rateType === "standard")).toBe(false);

    // created 缺失 → 省略 createdAt，而不是抛 "Invalid time value"
    expect(older!.createdAt).toBe("2026-03-12T16:00:00.000Z");
    expect(newer!.createdAt).toBeUndefined();
  });
});
