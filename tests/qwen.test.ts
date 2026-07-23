import { describe, expect, it } from "vitest";
import {
  collectQwen,
  isExcludedQwenCategory,
  isLegacyQwenModel,
  isQwenDatedSnapshot,
  isQwenOpenSourceModel,
  parseQwenDetails,
  type QwenCapturedData,
} from "../src/collectors/qwen.js";

const qwenDetail = {
  code: "200",
  data: {
    Data: [
      {
        GroupModel: "Qwen3.7-Plus",
        Name: "Qwen3.7-Plus Internal Name",
        ModelAlias: "qwen3.7-plus",
        LatestOnlineAt: "2026-06-01T12:46:50.000+00:00",
        ModelInfo: {
          ContextWindow: 1_000_000,
          MaxOutputTokens: 65_536,
          ReasoningMaxInputTokens: 983_616,
        },
        Features: [
          "function-calling",
          "prefix-completion",
          "structured-outputs",
        ],
        InferenceMetadata: {
          RequestModality: ["Image", "Text", "Video"],
          ResponseModality: ["Text"],
        },
        QpmInfo: {
          ModelDefault: {
            CountLimit: 1200,
            CountLimitPeriod: 6,
            UsageLimit: 1_500_000,
            UsageLimitPeriod: 30,
          },
          ModelDefaultActual: {
            CountLimit: 3000,
            CountLimitPeriod: 6,
            UsageLimit: 2_500_000,
            UsageLimitPeriod: 30,
          },
        },
        MultiPrices: [
          {
            RangeName: "输入<=256k",
            Prices: [
              {
                Type: "input_token",
                PriceUnit: "每百万tokens",
                Price: "2",
                Discount: "0.8",
              },
              {
                Type: "output_token",
                PriceUnit: "每百万tokens",
                Price: "8",
                Discount: "0.8",
              },
              {
                Type: "input_token_cache",
                PriceUnit: "每百万tokens",
                Price: "0.4",
                Discount: "0.8",
              },
              {
                Type: "input_token_cache_creation_5m",
                PriceUnit: "每百万tokens",
                Price: "2.5",
                Discount: "0.8",
              },
              {
                Type: "input_token_cache_read",
                PriceUnit: "每百万tokens",
                Price: "0.2",
                Discount: "0.8",
              },
            ],
          },
          {
            RangeName: "256k<输入<=1m",
            Prices: [
              {
                Type: "input_token",
                PriceUnit: "每百万tokens",
                Price: "6",
                Discount: "0.8",
              },
              {
                Type: "output_token",
                PriceUnit: "每百万tokens",
                Price: "24",
                Discount: "0.8",
              },
              {
                Type: "input_token_cache",
                PriceUnit: "每百万tokens",
                Price: "1.2",
                Discount: "0.8",
              },
              {
                Type: "input_token_cache_creation_5m",
                PriceUnit: "每百万tokens",
                Price: "7.5",
                Discount: "0.8",
              },
              {
                Type: "input_token_cache_read",
                PriceUnit: "每百万tokens",
                Price: "0.6",
                Discount: "0.8",
              },
            ],
          },
        ],
      },
      {
        GroupModel: "Qwen3.7-Max",
        Name: "Qwen3.7-Max",
        ModelAlias: "",
        Model: "qwen3.7-max",
        ModelInfo: {
          ContextWindow: 1_000_000,
          MaxOutputTokens: 65_536,
          ReasoningMaxInputTokens: 983_616,
        },
        InferenceMetadata: {
          RequestModality: ["Text"],
          ResponseModality: ["Text"],
        },
        Prices: [
          {
            Type: "input_token",
            PriceUnit: "每百万tokens",
            Price: "12",
            Discount: "0.5",
          },
          {
            Type: "output_token",
            PriceUnit: "每百万tokens",
            Price: "36",
            Discount: "0.5",
          },
        ],
      },
      {
        GroupModel: "Qwen3.7-Max",
        Name: "Qwen3.7-Max Preview",
        ModelAlias: "qwen3.7-max-preview",
        ModelInfo: {
          ContextWindow: 1_000_000,
          MaxOutputTokens: 65_536,
        },
        InferenceMetadata: {
          RequestModality: ["Text"],
          ResponseModality: ["Text"],
        },
        Prices: [
          {
            Type: "input_token",
            PriceUnit: "每百万tokens",
            Price: "12",
          },
          {
            Type: "output_token",
            PriceUnit: "每百万tokens",
            Price: "36",
          },
        ],
      },
      {
        Name: "Third-party model",
        ModelAlias: "third-party-model",
        ModelInfo: { ContextWindow: 32_000 },
        MultiPrices: [],
      },
      {
        Name: "Qwen3.7-Plus Snapshot",
        ModelAlias: "qwen3.7-plus-0526",
        ModelInfo: { ContextWindow: 1_000_000 },
        MultiPrices: [
          {
            Prices: [
              {
                Type: "input_token",
                PriceUnit: "每百万tokens",
                Price: "2",
              },
              {
                Type: "output_token",
                PriceUnit: "每百万tokens",
                Price: "8",
              },
            ],
          },
        ],
      },
      {
        GroupModel: "Qwen Open Source",
        ModelAlias: "",
        Model: "qwen-open-source",
        OpenSource: true,
        ModelInfo: { ContextWindow: 32_000 },
        Prices: [
          {
            Type: "input_token",
            PriceUnit: "每百万tokens",
            Price: "1",
          },
          {
            Type: "output_token",
            PriceUnit: "每百万tokens",
            Price: "2",
          },
        ],
      },
      {
        GroupModel: "Qwen3.6开源模型",
        Model: "qwen3.6-27b",
        OpenSource: false,
        ModelInfo: { ContextWindow: 262_144 },
        Prices: [
          {
            Type: "input_token",
            PriceUnit: "每百万tokens",
            Price: "0.5",
          },
          {
            Type: "output_token",
            PriceUnit: "每百万tokens",
            Price: "2",
          },
        ],
      },
      {
        GroupModel: "Qwen3-Coder开源模型",
        Model: "qwen3-coder-next",
        ModelInfo: { ContextWindow: 262_144 },
        Prices: [
          {
            Type: "input_token",
            PriceUnit: "每百万tokens",
            Price: "0.5",
          },
          {
            Type: "output_token",
            PriceUnit: "每百万tokens",
            Price: "2",
          },
        ],
      },
    ],
  },
};

describe("Qwen China collector", () => {
  it("recognizes the official open-source display-name category", () => {
    expect(isQwenOpenSourceModel("Qwen3.6开源模型", false)).toBe(true);
    expect(isQwenOpenSourceModel("Qwen3开源模型")).toBe(true);
    expect(isQwenOpenSourceModel("Qwen3.7-Max")).toBe(false);
    expect(isQwenOpenSourceModel("Qwen3.6-Plus")).toBe(false);
    expect(isQwenOpenSourceModel(undefined, true)).toBe(true);
  });

  it("excludes model categories that are outside the current scope", () => {
    expect(isExcludedQwenCategory("qwen3.5-ocr")).toBe(true);
    expect(isExcludedQwenCategory("qwen-flash-character")).toBe(true);
    expect(isExcludedQwenCategory("qwen-tts-realtime-latest")).toBe(true);
    expect(isExcludedQwenCategory("qwen3-vl-plus")).toBe(true);
    expect(isExcludedQwenCategory("qwen-math-plus")).toBe(true);
    expect(isExcludedQwenCategory("qwen3-coder-plus")).toBe(false);
    expect(isExcludedQwenCategory("qwen3.7-max-preview")).toBe(false);
  });

  it("excludes legacy Qwen models without a generation number", () => {
    expect(isLegacyQwenModel("qwen-flash")).toBe(true);
    expect(isLegacyQwenModel("qwen-plus-latest")).toBe(true);
    expect(isLegacyQwenModel("qwen-long")).toBe(true);
    expect(isLegacyQwenModel("qwen-coder-plus")).toBe(true);
    expect(isLegacyQwenModel("qwen3-coder-plus")).toBe(false);
    expect(isLegacyQwenModel("qwen3.7-plus")).toBe(false);
  });

  it("parses official tiered CNY prices and model metadata", () => {
    const parsed = parseQwenDetails([qwenDetail]);
    expect(parsed.models).toHaveLength(2);
    expect(parsed.models[0]).toMatchObject({
      id: "qwen3.7-plus",
      name: "Qwen3.7-Plus",
      createdAt: "2026-06-01T12:46:50.000+00:00",
      capabilities: {
        thinking: true,
        jsonOutput: true,
        toolCalls: true,
        chatPrefixCompletion: true,
        inputModalities: ["image", "text", "video"],
        outputModalities: ["text"],
      },
      limits: {
        contextTokens: 1_000_000,
        maxOutputTokens: 65_536,
        requestsPerMinute: 30_000,
        tokensPerMinute: 5_000_000,
      },
    });
    expect(parsed.models[0]?.prices).toEqual([
      expect.objectContaining({
        market: "china",
        currency: "CNY",
        rateType: "standard",
        inputTokenRange: {
          label: "输入<=256k",
          maxInclusive: 256_000,
        },
        input: {
          cacheHit: 0.4,
          explicitCacheCreation: 2.5,
          explicitCacheHit: 0.2,
          standard: 2,
        },
        output: 8,
      }),
      expect.objectContaining({
        rateType: "promotional",
        input: {
          cacheHit: 0.32,
          explicitCacheCreation: 2,
          explicitCacheHit: 0.16,
          standard: 1.6,
        },
        output: 6.4,
      }),
      expect.objectContaining({
        rateType: "standard",
        inputTokenRange: {
          label: "256k<输入<=1m",
          minExclusive: 256_000,
          maxInclusive: 1_000_000,
        },
        input: {
          cacheHit: 1.2,
          explicitCacheCreation: 7.5,
          explicitCacheHit: 0.6,
          standard: 6,
        },
        output: 24,
      }),
      expect.objectContaining({
        rateType: "promotional",
        input: {
          cacheHit: 0.96,
          explicitCacheCreation: 6,
          explicitCacheHit: 0.48,
          standard: 4.8,
        },
        output: 19.2,
      }),
    ]);
    expect(parsed.models[1]).toMatchObject({
      id: "qwen3.7-max",
      name: "Qwen3.7-Max",
      prices: [
        {
          rateType: "standard",
          input: { standard: 12 },
          output: 36,
        },
        {
          rateType: "promotional",
          input: { standard: 6 },
          output: 18,
        },
      ],
    });
  });

  it("builds a China-only provider and keeps third-party models out", async () => {
    const captured: QwenCapturedData = {
      list: {
        code: "200",
        data: {
          Success: true,
          Data: [{ DataId: "qwen-series", Provider: "qwen" }],
        },
      },
      details: [qwenDetail],
    };
    const provider = await collectQwen(
      new Date("2026-07-22T00:00:00.000Z"),
      async () => captured,
    );
    expect(provider).toMatchObject({
      id: "qwen-cn",
      name: "Qwen China",
      displayNames: { "zh-CN": "阿里巴巴", en: "Alibaba" },
      ownedBy: "alibaba",
      baseUrls: {
        openai: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      },
    });
    expect(provider.models.map((model) => model.id)).toEqual([
      "qwen3.7-plus",
      "qwen3.7-max",
    ]);
    expect(provider.models.flatMap((model) => model.prices)).toSatisfy(
      (prices: Array<{ market: string; currency: string }>) =>
        prices.every(
          (price) => price.market === "china" && price.currency === "CNY",
        ),
    );
  });

  it("fails instead of writing an empty provider", () => {
    expect(() =>
      parseQwenDetails([{ code: "200", data: { Data: [] } }]),
    ).toThrow("no token-priced Qwen models");
  });

  it("recognizes dated snapshot model IDs", () => {
    expect(isQwenDatedSnapshot("qwen3.7-plus-0526")).toBe(true);
    expect(isQwenDatedSnapshot("qwen-plus-20250526")).toBe(true);
    expect(isQwenDatedSnapshot("qwen-plus-2025-05-26")).toBe(true);
    expect(isQwenDatedSnapshot("qwen3.7-plus")).toBe(false);
    expect(isQwenDatedSnapshot("qwen3.6-max-preview")).toBe(false);
  });
});
