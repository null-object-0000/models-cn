import { describe, expect, it } from "vitest";
import {
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
