import { describe, expect, it } from "vitest";
import {
  collectMoonshotInternational,
  parseMoonshotOutputLimits,
  parseMoonshotPricingPage,
} from "../src/collectors/moonshot.js";

describe("Kimi collector parser", () => {
  it("parses cached-input pricing independently from output-limit metadata", () => {
    const markdown = `
<DocTable
  rows={[
["kimi-k3", "1M tokens", "¥2.00", "¥20.00", "¥100.00", "1,048,576 tokens"],
]}
/>`;
    const parsed = parseMoonshotPricingPage(
      markdown,
      "https://platform.kimi.com/docs/pricing/chat-k3",
    );
    expect(parsed.models[0]).toMatchObject({
      id: "kimi-k3",
      capabilities: {
        thinking: true,
        jsonOutput: true,
        toolCalls: true,
        inputModalities: ["text", "image", "video"],
      },
      limits: { contextTokens: 1_048_576 },
      prices: [
        {
          market: "china",
          currency: "CNY",
          input: { cacheHit: 2, standard: 20 },
          output: 100,
        },
      ],
    });
    expect(parsed.models[0]?.limits.maxOutputTokens).toBeUndefined();
  });

  it("parses international MDX currency cells", () => {
    const markdown = `
<DocTable
  rows={[
["kimi-k3", "1M tokens", <>{"$"}0.30</>, <>{"$"}3.00</>, <>{"$"}15.00</>, "1,048,576 tokens"],
]}
/>`;
    const parsed = parseMoonshotPricingPage(
      markdown,
      "https://platform.kimi.ai/docs/pricing/chat-k3",
      "international",
      "USD",
    );
    expect(parsed.models[0]?.prices[0]).toMatchObject({
      market: "international",
      currency: "USD",
      input: { cacheHit: 0.3, standard: 3 },
      output: 15,
    });
  });

  it("parses official context-minus-prompt output limits", () => {
    const markdown = `
## Kimi 大模型的输出长度是多少

* 对于 \`kimi-k3\` 模型而言，最大输出长度是 \`1024*1024 - prompt_tokens\`；
* 对于 \`kimi-k2.6\`、\`kimi-k2.5\` 模型而言，最大输出长度是 \`256*1024 - prompt_tokens\`；

## Kimi 大模型支持的汉字数量是多少
`;
    const limits = parseMoonshotOutputLimits(markdown);
    expect(limits.get("kimi-k3")).toBe(1_048_576);
    expect(limits.get("kimi-k2.6")).toBe(262_144);
    expect(limits.get("kimi-k2.5")).toBe(262_144);
    expect(limits.get("kimi-k2.7-code")).toBeUndefined();
  });

  it("parses the English output-limit section", () => {
    const markdown = `
## What is the output length of the Kimi model?

* For \`kimi-k3\`, the maximum output length is \`1024*1024 - prompt_tokens\`.
* For \`kimi-k2.6\` and \`kimi-k2.5\`, the maximum output length is \`256*1024 - prompt_tokens\`.

## How many Chinese characters does the Kimi model support?
`;
    const limits = parseMoonshotOutputLimits(markdown);
    expect(limits.get("kimi-k3")).toBe(1_048_576);
    expect(limits.get("kimi-k2.6")).toBe(262_144);
    expect(limits.get("kimi-k2.5")).toBe(262_144);
  });

  it("collects the international channel with USD metadata", async () => {
    const pricing = (id: string) => `
<DocTable
  rows={[
["${id}", "1M tokens", "$0.30", "$3.00", "$15.00", "${id === "kimi-k3" ? "1,048,576" : "262,144"} tokens"],
]}
/>`;
    const overview = "kimi-k3 kimi-k2.7-code kimi-k2.6 kimi-k2.5";
    const troubleshooting = `
## What is the output length of the Kimi model?
* For \`kimi-k3\`, the maximum output length is \`1024*1024 - prompt_tokens\`.
* For \`kimi-k2.6\` and \`kimi-k2.5\`, the maximum output length is \`256*1024 - prompt_tokens\`.
## How many Chinese characters does the Kimi model support?
`;
    const provider = await collectMoonshotInternational(
      new Date("2026-07-23T00:00:00Z"),
      async (url) => {
        if (url.endsWith("chat-k3")) return pricing("kimi-k3");
        if (url.endsWith("chat-k27-code")) {
          return `
<DocTable
  rows={[
["kimi-k2.7-code", "1M tokens", "$0.19", "$0.95", "$4.00", "262,144 tokens"],
["kimi-k2.7-code-highspeed", "1M tokens", "$0.38", "$1.90", "$8.00", "262,144 tokens"],
]}
/>`;
        }
        if (url.endsWith("chat-k26")) return pricing("kimi-k2.6");
        if (url.endsWith("chat-k25")) return pricing("kimi-k2.5");
        if (url.includes("models-overview")) return overview;
        return troubleshooting;
      },
    );
    expect(provider).toMatchObject({
      id: "moonshot-intl",
      name: "Kimi International",
      baseUrls: { openai: "https://api.moonshot.ai/v1" },
    });
    expect(
      provider.models.every((model) =>
        model.prices.every(
          (price) =>
            price.market === "international" && price.currency === "USD",
        ),
      ),
    ).toBe(true);
    expect(provider.sources.every((source) => source.locale === "en")).toBe(
      true,
    );
  });

  it("rejects Moonshot V1 rows outside the selected Kimi scope", () => {
    const markdown = `
<DocTable
  rows={[
["moonshot-v1-8k", "1M tokens", "¥2.00", "¥2.00", "¥10.00", "8,192 tokens"],
]}
/>`;
    expect(() =>
      parseMoonshotPricingPage(
        markdown,
        "https://platform.kimi.com/docs/pricing/chat-v1",
      ),
    ).toThrow("Unsupported non-Kimi model in Kimi collector: moonshot-v1-8k");
  });
});
