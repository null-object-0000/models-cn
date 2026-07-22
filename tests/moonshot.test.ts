import { describe, expect, it } from "vitest";
import { parseMoonshotPricingPage } from "../src/collectors/moonshot.js";

describe("Kimi collector parser", () => {
  it("parses cached-input pricing and leaves undisclosed output limits empty", () => {
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
