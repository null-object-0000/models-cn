import { describe, expect, it } from "vitest";
import {
  collectModelsDevCalibration,
  type ModelsDevApi,
} from "../src/calibration/models-dev.js";
import type { ProviderData } from "../src/types.js";

const longcat: ProviderData = {
  schemaVersion: "1.0",
  id: "longcat",
  name: "LongCat",
  ownedBy: "longcat",
  baseUrls: { openai: "https://api.longcat.chat/openai" },
  models: [
    {
      id: "LongCat-2.0",
      name: "LongCat-2.0",
      aliases: [],
      capabilities: {
        thinking: true,
        toolCalls: true,
        inputModalities: ["text"],
        outputModalities: ["text"],
      },
      limits: { contextTokens: 1_048_576, maxOutputTokens: 131_072 },
      prices: [
        {
          market: "international",
          currency: "USD",
          unit: "1M_tokens",
          rateType: "standard",
          input: { cacheHit: 0.015, cacheMiss: 0.75 },
          output: 2.95,
          sourceUrl: "https://longcat.chat/platform/docs/pricing/long-cat-2.0",
        },
      ],
    },
  ],
  sources: [],
};

describe("models.dev calibration", () => {
  it("reports differences without overwriting official values", async () => {
    const api: ModelsDevApi = {
      longcat: {
        models: {
          "LongCat-2.0": {
            id: "LongCat-2.0",
            reasoning: true,
            tool_call: true,
            modalities: { input: ["text"], output: ["text"] },
            limit: { context: 1_000_000, output: 131_072 },
            cost: { input: 0.75, cache_read: 0.015, output: 2.95 },
          },
        },
      },
    };
    const report = await collectModelsDevCalibration(
      [longcat],
      undefined,
      new Date("2026-07-22T00:00:00Z"),
      async () => api,
    );
    const result = report.models.find((model) => model.provider === "longcat");
    expect(result?.status).toBe("mismatch");
    expect(
      result?.checks.find((item) => item.field === "limits.contextTokens"),
    ).toEqual({
      field: "limits.contextTokens",
      official: 1_048_576,
      reference: 1_000_000,
      status: "mismatch",
    });
    expect(
      result?.checks.find((item) => item.field === "prices.USD.output")?.status,
    ).toBe("match");
  });
});
