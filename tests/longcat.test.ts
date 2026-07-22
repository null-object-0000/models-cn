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

  it("extracts the documented model API response", () => {
    const detail = parseLongCatModelDocs(modelDocsHtml);
    expect(detail).toMatchObject({
      id: "LongCat-2.0",
      context_length: 1_048_576,
      supported_parameters: ["max_tokens", "stream", "tools", "thinking"],
    });
  });

  it("converts the documented binary 128K output limit exactly", () => {
    const html =
      "LongCat-2.0: 1M token context window with a maximum output length of 128K tokens";
    expect(parseLongCatMaxOutput(html)).toBe(131_072);
  });
});
