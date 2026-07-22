import { describe, expect, it } from "vitest";
import {
  collectModelsDevCalibration,
  type ModelsDevApi,
} from "../src/calibration/models-dev.js";
import type { ProviderData } from "../src/types.js";
import { healthyHealth } from "../src/health.js";

const longcat: ProviderData = {
  schemaVersion: "2.0",
  health: healthyHealth(new Date("2026-07-22T00:00:00Z")),
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
          input: { cacheHit: 0.015, standard: 0.75 },
          output: 2.95,
          sourceUrl: "https://longcat.chat/platform/docs/pricing/long-cat-2.0",
        },
      ],
    },
  ],
  sources: [],
};

const kimiChina: ProviderData = {
  schemaVersion: "2.0",
  health: healthyHealth(new Date("2026-07-22T00:00:00Z")),
  id: "moonshot-cn",
  name: "Kimi China",
  ownedBy: "moonshot",
  baseUrls: { openai: "https://api.moonshot.cn/v1" },
  models: [
    {
      id: "kimi-k3",
      name: "Kimi K3",
      aliases: [],
      capabilities: { thinking: true },
      limits: { contextTokens: 1_048_576, maxOutputTokens: 1_048_576 },
      prices: [],
    },
  ],
  sources: [],
};

const qwenChina: ProviderData = {
  schemaVersion: "2.0",
  health: healthyHealth(new Date("2026-07-22T00:00:00Z")),
  id: "qwen-cn",
  name: "Qwen China",
  ownedBy: "qwen",
  baseUrls: {
    openai: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  models: [
    {
      id: "qwen3.7-plus",
      name: "Qwen3.7-Plus",
      createdAt: "2026-06-01T12:46:50.000+00:00",
      aliases: [],
      capabilities: {
        thinking: true,
        toolCalls: true,
        inputModalities: ["text"],
        outputModalities: ["text"],
      },
      limits: { contextTokens: 1_000_000, maxOutputTokens: 65_536 },
      prices: [],
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

  it("uses the shared moonshotai namespace for Kimi references", async () => {
    const api: ModelsDevApi = {
      moonshotai: {
        models: {
          "kimi-k3": {
            id: "kimi-k3",
            release_date: "2026-07-16",
            reasoning: true,
            limit: { context: 1_048_576, output: 131_072 },
          },
        },
      },
    };
    const report = await collectModelsDevCalibration(
      [kimiChina],
      undefined,
      new Date("2026-07-22T00:00:00Z"),
      async () => api,
    );
    const result = report.models.find(
      (model) => model.provider === "moonshot-cn" && model.model === "kimi-k3",
    );
    expect(result).toMatchObject({
      referenceProvider: "moonshotai",
      referenceModel: "kimi-k3",
      referenceUrl: "https://models.dev/models/moonshotai/kimi-k3/",
    });
    expect(result?.checks.find((check) => check.field === "createdAt")).toEqual(
      {
        field: "createdAt",
        official: null,
        reference: "2026-07-16",
        status: "missing",
      },
    );
  });

  it("maps Qwen China models to the Alibaba namespace", async () => {
    const api: ModelsDevApi = {
      alibaba: {
        models: {
          "qwen3.7-plus": {
            id: "qwen3.7-plus",
            release_date: "2026-06-01",
            reasoning: true,
            tool_call: true,
            modalities: { input: ["text"], output: ["text"] },
            limit: { context: 1_000_000, output: 65_536 },
          },
        },
      },
    };
    const report = await collectModelsDevCalibration(
      [qwenChina],
      undefined,
      new Date("2026-07-22T00:00:00Z"),
      async () => api,
    );
    const result = report.models.find(
      (model) => model.provider === "qwen-cn" && model.model === "qwen3.7-plus",
    );
    expect(result).toMatchObject({
      referenceProvider: "alibaba",
      referenceModel: "qwen3.7-plus",
      referenceUrl: "https://models.dev/models/alibaba/qwen3.7-plus/",
      status: "partial",
    });
    expect(
      result?.checks.find((check) => check.field === "limits.contextTokens"),
    ).toMatchObject({ status: "match", reference: 1_000_000 });
  });
});
