import { describe, expect, it } from "vitest";
import {
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
          input: { cacheHit: 2, cacheMiss: 20 },
          output: 100,
        },
      ],
    });
    expect(parsed.models[0]?.limits.maxOutputTokens).toBeUndefined();
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
