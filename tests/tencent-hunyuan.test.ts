import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectTencentHunyuan,
  isTencentHunyuanModel,
  parseHunyuanCapabilities,
  parsePriceCell,
  parseTencentHunyuanModels,
  parseTencentHunyuanPricing,
  parseTokenCount,
  TENCENT_HUNYUAN_MODELS_URL,
  TENCENT_HUNYUAN_PRICING_URL,
} from "../src/collectors/tencent-hunyuan.js";

const fixtures = path.join(import.meta.dirname, "fixtures");

async function fixture(name: string): Promise<string> {
  return readFile(path.join(fixtures, name), "utf8");
}

describe("Tencent Hunyuan collector", () => {
  it("parses the TokenHub price table", async () => {
    const rows = parseTencentHunyuanPricing(
      await fixture("tencent-hunyuan-pricing.html"),
    );
    const hy4 = rows.find((row) => row.id === "hy4");
    expect(hy4).toMatchObject({
      name: "Hy4",
      condition: "-",
      peak: "-",
      input: 6,
      output: 18,
      cacheHit: 0.3,
    });
    const hy3 = rows.find((row) => row.id === "hy3");
    expect(hy3).toMatchObject({ input: 1, output: 4 });
    // 第三方模型也在同一张表里，靠 id 前缀在 collect 阶段排除
    expect(rows.some((row) => row.id === "kimi-k3")).toBe(true);
  });

  it("parses the TokenHub model list with real limits", async () => {
    const rows = parseTencentHunyuanModels(
      await fixture("tencent-hunyuan-models.html"),
    );
    const hy4 = rows.find((row) => row.id === "hy4");
    expect(hy4).toMatchObject({
      name: "Hy4",
      contextTokens: 1_048_576,
      maxOutputTokens: 65_536,
    });
    expect(hy4?.capabilitiesText).toContain("Function Calling");
    const role = rows.find((row) => row.id === "hunyuan-role-latest");
    expect(role).toMatchObject({
      contextTokens: 32_768,
      maxOutputTokens: 4_096,
    });
  });

  it("collects only Tencent self-hosted models", async () => {
    const [pricing, models] = await Promise.all([
      fixture("tencent-hunyuan-pricing.html"),
      fixture("tencent-hunyuan-models.html"),
    ]);
    const provider = await collectTencentHunyuan(
      new Date("2026-11-14T00:00:00Z"),
      async (url) => (url === TENCENT_HUNYUAN_PRICING_URL ? pricing : models),
    );

    expect(provider.id).toBe("tencent-hunyuan");
    expect(provider.health.status).toBe("healthy");
    expect(provider.models.map((model) => model.id)).toEqual([
      "hy4",
      "hy4-preview",
      "hy3",
      "hy-mt2-pro",
      "hy-mt2-plus",
      "hy-mt2-lite",
      "hunyuan-role-latest",
      "hy-role",
    ]);
    expect(
      provider.models.some((model) =>
        /deepseek|kimi|glm|minimax|mimo|step/i.test(model.id),
      ),
    ).toBe(false);

    const hy4 = provider.models.find((model) => model.id === "hy4");
    expect(hy4?.prices[0]).toMatchObject({
      market: "china",
      currency: "CNY",
      unit: "1M_tokens",
      rateType: "standard",
      input: { standard: 6, cacheHit: 0.3 },
      output: 18,
      sourceUrl: TENCENT_HUNYUAN_PRICING_URL,
    });
    expect(hy4?.limits).toEqual({
      contextTokens: 1_048_576,
      maxOutputTokens: 65_536,
    });
    expect(hy4?.capabilities).toMatchObject({
      thinking: true,
      toolCalls: true,
      jsonOutput: true,
      inputModalities: ["text", "image"],
    });

    expect(provider.sources.map((source) => source.url)).toEqual([
      TENCENT_HUNYUAN_PRICING_URL,
      TENCENT_HUNYUAN_MODELS_URL,
    ]);
  });

  it("throws when the price table is gone", async () => {
    const models = await fixture("tencent-hunyuan-models.html");
    await expect(
      collectTencentHunyuan(new Date(), async (url) =>
        url === TENCENT_HUNYUAN_PRICING_URL ? "<html>改版了</html>" : models,
      ),
    ).rejects.toThrow(/missing the inference price table/);
  });

  it("keeps translation models as text-only capabilities", () => {
    expect(parseHunyuanCapabilities("混元翻译旗舰模型，适合专业领域")).toEqual({
      thinking: false,
      jsonOutput: false,
      toolCalls: false,
      inputModalities: ["text"],
      outputModalities: ["text"],
    });
  });

  it("parses token counts and price cells", () => {
    expect(parseTokenCount("1M")).toBe(1_048_576);
    expect(parseTokenCount("960k")).toBe(983_040);
    expect(parseTokenCount("32k")).toBe(32_768);
    expect(parseTokenCount("-")).toBeUndefined();
    expect(parsePriceCell("0.3")).toBe(0.3);
    expect(parsePriceCell("-")).toBeUndefined();
  });

  it("only treats hy/hunyuan ids as self-hosted", () => {
    for (const id of ["hy4", "hy3", "hy-mt2-pro", "hunyuan-role-latest"]) {
      expect(isTencentHunyuanModel(id)).toBe(true);
    }
    for (const id of [
      "deepseek/deepseek-flash",
      "glm-5.3",
      "kimi-k3",
      "minimax-m3",
      "step-5-preview",
    ]) {
      expect(isTencentHunyuanModel(id)).toBe(false);
    }
  });
});
