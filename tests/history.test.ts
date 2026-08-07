import { describe, expect, it } from "vitest";
import { applyPriceHistory, priceKey } from "../src/history.js";
import { validateProvider } from "../src/validation.js";
import type { ModelData, ModelPrice, ProviderData } from "../src/types.js";

const AS_OF = "2026-08-04T09:00:00.000Z";
const RETRIEVED_AT = "2026-07-20T03:00:00.000Z";

function price(
  standard: number,
  output: number,
  extra: Partial<ModelPrice> = {},
): ModelPrice {
  return {
    market: "china",
    currency: "CNY",
    unit: "1M_tokens",
    rateType: "standard",
    input: { standard },
    output,
    sourceUrl: "https://example.com/pricing",
    ...extra,
  };
}

function model(id: string, prices: ModelPrice[]): ModelData {
  return {
    id,
    name: id,
    aliases: [],
    capabilities: { thinking: true },
    limits: { contextTokens: 128_000 },
    prices,
  };
}

function provider(
  models: ModelData[],
  sources: ProviderData["sources"] = [],
): ProviderData {
  return {
    schemaVersion: "1.0",
    id: "example-cn",
    name: "Example China",
    ownedBy: "example",
    baseUrls: { openai: "https://api.example.cn/v1" },
    health: {
      status: "healthy",
      lastSuccessfulAt: RETRIEVED_AT,
      lastAttemptAt: RETRIEVED_AT,
      consecutiveFailures: 0,
    },
    models,
    sources,
  };
}

function pricingSource(retrievedAt = RETRIEVED_AT): ProviderData["sources"] {
  return [
    {
      url: "https://example.com/pricing",
      kind: "pricing",
      locale: "zh-CN",
      currency: "CNY",
      retrievedAt,
      contentHash: "sha256:" + "a".repeat(64),
    },
  ];
}

describe("priceKey", () => {
  it("distinguishes billing dimensions by market, currency, rateType and token range", () => {
    expect(priceKey(price(1, 2))).toBe(priceKey(price(9, 9)));
    expect(priceKey(price(1, 2))).not.toBe(
      priceKey(price(1, 2, { rateType: "promotional" })),
    );
    expect(
      priceKey(price(1, 2, { inputTokenRange: { label: "输入<=256k" } })),
    ).not.toBe(
      priceKey(price(1, 2, { inputTokenRange: { label: "输入>256k" } })),
    );
    expect(
      priceKey(
        price(1, 2, { outputTokenRange: { label: "输出长度 [0, 0.2)" } }),
      ),
    ).not.toBe(
      priceKey(price(1, 2, { outputTokenRange: { label: "输出长度 [0.2+)" } })),
    );
    expect(
      priceKey(
        price(1, 2, { outputTokenRange: { label: "输出长度 [0, 0.2)" } }),
      ),
    ).not.toBe(priceKey(price(1, 2)));
  });
});

describe("applyPriceHistory", () => {
  it("sets validFrom and leaves no history on the first observation", () => {
    const next = provider([model("m1", [price(1, 2)])], pricingSource());
    const result = applyPriceHistory(undefined, next, AS_OF);
    const current = result.models[0]?.prices[0];
    expect(current).toMatchObject({
      input: { standard: 1 },
      output: 2,
      validFrom: AS_OF,
    });
    expect(result.models[0]?.priceHistory).toBeUndefined();
  });

  it("carries validFrom forward and never appends history when prices are unchanged", () => {
    const previous = provider(
      [model("m1", [price(1, 2, { validFrom: "2026-07-01T00:00:00.000Z" })])],
      pricingSource(),
    );
    const next = provider([model("m1", [price(1, 2)])], pricingSource());
    const result = applyPriceHistory(previous, next, AS_OF);
    expect(result.models[0]?.prices[0]?.validFrom).toBe(
      "2026-07-01T00:00:00.000Z",
    );
    expect(result.models[0]?.priceHistory).toBeUndefined();
  });

  it("archives the replaced price with validTo and stamps the new one", () => {
    const previous = provider(
      [model("m1", [price(1, 2, { validFrom: "2026-07-01T00:00:00.000Z" })])],
      pricingSource(),
    );
    const next = provider([model("m1", [price(1, 6)])], pricingSource());
    const result = applyPriceHistory(previous, next, AS_OF);
    const current = result.models[0]?.prices[0];
    expect(current).toMatchObject({
      input: { standard: 1 },
      output: 6,
      validFrom: AS_OF,
    });
    const history = result.models[0]?.priceHistory;
    expect(history).toHaveLength(1);
    expect(history?.[0]).toMatchObject({
      input: { standard: 1 },
      output: 2,
      validFrom: "2026-07-01T00:00:00.000Z",
      validTo: AS_OF,
    });
  });

  it("archives a removed billing dimension (e.g. cacheHit dropped)", () => {
    const previous = provider(
      [
        model("m1", [
          price(1, 2, {
            input: { standard: 1, cacheHit: 0.2 },
            validFrom: "2026-07-01T00:00:00.000Z",
          }),
        ]),
      ],
      pricingSource(),
    );
    const next = provider([model("m1", [price(1, 2)])], pricingSource());
    const result = applyPriceHistory(previous, next, AS_OF);
    expect(result.models[0]?.prices[0]?.input.cacheHit).toBeUndefined();
    const history = result.models[0]?.priceHistory;
    expect(history).toHaveLength(1);
    expect(history?.[0]?.input.cacheHit).toBe(0.2);
    expect(history?.[0]?.validTo).toBe(AS_OF);
  });

  it("stamps a brand-new price entry without touching existing history", () => {
    const previous = provider(
      [model("m1", [price(1, 2, { validFrom: "2026-07-01T00:00:00.000Z" })])],
      pricingSource(),
    );
    const next = provider([
      model("m1", [
        price(1, 2),
        price(1, 2, {
          rateType: "promotional",
          input: { standard: 0.5 },
        }),
      ]),
    ]);
    const result = applyPriceHistory(previous, next, AS_OF);
    const prices = result.models[0]?.prices ?? [];
    expect(prices).toHaveLength(2);
    const standard = prices.find((item) => item.rateType === "standard");
    const promotional = prices.find((item) => item.rateType === "promotional");
    expect(standard?.validFrom).toBe("2026-07-01T00:00:00.000Z");
    expect(promotional?.validFrom).toBe(AS_OF);
    expect(result.models[0]?.priceHistory).toBeUndefined();
  });

  it("treats output token ranges as distinct billing dimensions", () => {
    const previous = provider(
      [
        model("m1", [
          price(1, 2, {
            outputTokenRange: { label: "输出长度 [0, 0.2)", maxInclusive: 200 },
            validFrom: "2026-07-01T00:00:00.000Z",
          }),
          price(1, 6, {
            outputTokenRange: { label: "输出长度 [0.2+)", minExclusive: 200 },
            validFrom: "2026-07-01T00:00:00.000Z",
          }),
        ]),
      ],
      pricingSource(),
    );
    const next = provider([
      model("m1", [
        price(1, 2, {
          outputTokenRange: { label: "输出长度 [0, 0.2)", maxInclusive: 200 },
        }),
        price(1, 8, {
          outputTokenRange: { label: "输出长度 [0.2+)", minExclusive: 200 },
        }),
      ]),
    ]);
    const result = applyPriceHistory(previous, next, AS_OF);
    const prices = result.models[0]?.prices ?? [];
    expect(prices).toHaveLength(2);
    const shortOutput = prices.find(
      (item) => item.outputTokenRange?.label === "输出长度 [0, 0.2)",
    );
    const longOutput = prices.find(
      (item) => item.outputTokenRange?.label === "输出长度 [0.2+)",
    );
    // 未变化的输出档保留原 validFrom；变化的输出档产生历史快照。
    expect(shortOutput?.validFrom).toBe("2026-07-01T00:00:00.000Z");
    expect(longOutput?.output).toBe(8);
    const history = result.models[0]?.priceHistory;
    expect(history).toHaveLength(1);
    expect(history?.[0]).toMatchObject({
      output: 6,
      outputTokenRange: { label: "输出长度 [0.2+)", minExclusive: 200 },
      validTo: AS_OF,
    });
  });

  it("backfills validFrom from the previous pricing source when missing", () => {
    const previous = provider(
      [model("m1", [price(1, 2)])],
      pricingSource(RETRIEVED_AT),
    );
    const next = provider([model("m1", [price(1, 2)])], pricingSource());
    const result = applyPriceHistory(previous, next, AS_OF);
    expect(result.models[0]?.prices[0]?.validFrom).toBe(RETRIEVED_AT);
    expect(result.models[0]?.priceHistory).toBeUndefined();
  });

  it("keeps accumulating history newest-first across successive changes", () => {
    const first = provider(
      [model("m1", [price(1, 2, { validFrom: "2026-07-01T00:00:00.000Z" })])],
      pricingSource(),
    );
    const second = applyPriceHistory(
      first,
      provider([model("m1", [price(1, 4)])], pricingSource()),
      "2026-07-25T00:00:00.000Z",
    );
    const third = applyPriceHistory(
      second,
      provider([model("m1", [price(1, 6)])], pricingSource()),
      AS_OF,
    );
    const history = third.models[0]?.priceHistory;
    expect(history).toHaveLength(2);
    expect(history?.[0]).toMatchObject({
      output: 4,
      validTo: AS_OF,
    });
    expect(history?.[1]).toMatchObject({
      output: 2,
      validTo: "2026-07-25T00:00:00.000Z",
    });
    expect(third.models[0]?.prices[0]).toMatchObject({
      output: 6,
      validFrom: AS_OF,
    });
  });

  it("produces data that passes the provider schema with priceHistory", async () => {
    const previous = provider(
      [model("m1", [price(1, 2, { validFrom: "2026-07-01T00:00:00.000Z" })])],
      pricingSource(),
    );
    const next = provider([model("m1", [price(1, 6)])], pricingSource());
    const result = applyPriceHistory(previous, next, AS_OF);
    await expect(validateProvider(result)).resolves.toBeUndefined();
  });
});
