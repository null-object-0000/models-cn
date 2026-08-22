import { describe, expect, it } from "vitest";
import {
  collectModelsDevCalibration,
  type ModelsDevApi,
} from "../src/calibration/models-dev.js";
import type { ProviderData } from "../src/types.js";
import { healthyHealth } from "../src/health.js";

const longcat: ProviderData = {
  schemaVersion: "1.0",
  health: healthyHealth(new Date("2026-07-22T00:00:00Z")),
  id: "longcat",
  name: "LongCat",
  ownedBy: "longcat",
  baseUrls: { openai: "https://api.longcat.chat/openai" },
  models: [
    {
      id: "LongCat-2.0",
      name: "LongCat-2.0",
      createdAt: "2026-03-12T16:00:00.000Z",
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
  schemaVersion: "1.0",
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
  schemaVersion: "1.0",
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
            release_date: "2026-03-12",
            reasoning: true,
            tool_call: true,
            modalities: { input: ["text"], output: ["text"] },
            // 500000 与 1048576 的差距远超单位约定容差，构成真实差异
            limit: { context: 500_000, output: 131_072 },
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
      reference: 500_000,
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

  it("maps Zhipu models to the zai and zhipuai namespaces", async () => {
    const zhipuIntl: ProviderData = {
      schemaVersion: "1.0",
      health: healthyHealth(new Date("2026-07-22T00:00:00Z")),
      id: "zhipu-intl",
      name: "Zhipu International",
      ownedBy: "zhipu",
      baseUrls: { openai: "https://api.z.ai/api/paas/v4" },
      models: [
        {
          id: "glm-4.7",
          name: "GLM-4.7",
          aliases: [],
          capabilities: { thinking: true },
          limits: { contextTokens: 204_800, maxOutputTokens: 131_072 },
          prices: [
            {
              market: "international",
              currency: "USD",
              unit: "1M_tokens",
              rateType: "standard",
              input: { standard: 0.6, cacheHit: 0.11 },
              output: 2.2,
              sourceUrl: "https://docs.z.ai/guides/overview/pricing",
            },
          ],
        },
      ],
      sources: [],
    };
    const api: ModelsDevApi = {
      zai: {
        models: {
          "glm-4.7": {
            id: "glm-4.7",
            release_date: "2025-12-22",
            reasoning: true,
            tool_call: true,
            modalities: { input: ["text"], output: ["text"] },
            limit: { context: 204_800, output: 131_072 },
            cost: { input: 0.6, cache_read: 0.11, output: 2.2 },
          },
        },
      },
    };
    const report = await collectModelsDevCalibration(
      [zhipuIntl],
      undefined,
      new Date("2026-07-22T00:00:00Z"),
      async () => api,
    );
    const result = report.models.find(
      (model) => model.provider === "zhipu-intl" && model.model === "glm-4.7",
    );
    expect(result).toMatchObject({
      referenceProvider: "zai",
      referenceModel: "glm-4.7",
      referenceUrl: "https://models.dev/models/zai/glm-4.7/",
      // 官方 createdAt 缺失使 createdAt 检查为 missing，整体为 partial
      status: "partial",
    });
    // 官方 createdAt 缺失 → createdAt 校准为 missing（partial 状态的一部分）
    expect(
      result?.checks.find((check) => check.field === "createdAt")?.status,
    ).toBe("missing");
  });

  it("maps Zhipu China glm-5-turbo to zai and other models to zhipuai", async () => {
    const zhipuChina: ProviderData = {
      schemaVersion: "1.0",
      health: healthyHealth(new Date("2026-07-22T00:00:00Z")),
      id: "zhipu-cn",
      name: "Zhipu China",
      ownedBy: "zhipu",
      baseUrls: { openai: "https://open.bigmodel.cn/api/paas/v4" },
      models: ["glm-5-turbo", "glm-4.7"].map((id) => ({
        id,
        name: id,
        aliases: [],
        capabilities: { thinking: true },
        limits: { contextTokens: 204_800 },
        prices: [],
      })),
      sources: [],
    };
    const report = await collectModelsDevCalibration(
      [zhipuChina],
      undefined,
      new Date("2026-07-22T00:00:00Z"),
      async () => ({}),
    );
    const glm57 = report.models.find(
      (model) => model.model === "glm-5-turbo" && model.provider === "zhipu-cn",
    );
    const glm47 = report.models.find(
      (model) => model.model === "glm-4.7" && model.provider === "zhipu-cn",
    );
    expect(glm57).toMatchObject({
      referenceProvider: "zai",
      referenceModel: "glm-5-turbo",
    });
    expect(glm47?.referenceProvider).toBe("zhipuai");
  });
});

describe("models.dev calibration tolerances", () => {
  function longcatWith(
    createdAt: string | undefined,
    contextTokens: number,
  ): ProviderData {
    return {
      schemaVersion: "1.0",
      health: healthyHealth(new Date("2026-07-22T00:00:00Z")),
      id: "longcat",
      name: "LongCat",
      ownedBy: "longcat",
      baseUrls: { openai: "https://api.longcat.chat/openai" },
      models: [
        {
          id: "LongCat-2.0",
          name: "LongCat-2.0",
          ...(createdAt ? { createdAt } : {}),
          aliases: [],
          capabilities: {},
          limits: { contextTokens },
          prices: [],
        },
      ],
      sources: [],
    };
  }

  async function calibrateLongcat(
    createdAt: string | undefined,
    contextTokens: number,
    releaseDate: string,
    referenceContext: number,
  ) {
    const api: ModelsDevApi = {
      longcat: {
        models: {
          "LongCat-2.0": {
            id: "LongCat-2.0",
            release_date: releaseDate,
            limit: { context: referenceContext },
          },
        },
      },
    };
    const report = await collectModelsDevCalibration(
      [longcatWith(createdAt, contextTokens)],
      undefined,
      new Date("2026-07-22T00:00:00Z"),
      async () => api,
    );
    const result = report.models.find((model) => model.provider === "longcat");
    if (!result) throw new Error("missing longcat calibration entry");
    const byField = (field: string) =>
      result.checks.find((check) => check.field === field)!;
    return {
      createdAt: byField("createdAt"),
      context: byField("limits.contextTokens"),
    };
  }

  it("treats one-day createdAt drift as match", async () => {
    const nextDay = await calibrateLongcat(
      "2026-08-02",
      1_000_000,
      "2026-08-03",
      1_000_000,
    );
    expect(nextDay.createdAt.status).toBe("match");
    expect(nextDay.createdAt).toMatchObject({
      official: "2026-08-02",
      reference: "2026-08-03",
    });
    const sameDay = await calibrateLongcat(
      "2026-08-02",
      1_000_000,
      "2026-08-02",
      1_000_000,
    );
    expect(sameDay.createdAt.status).toBe("match");
  });

  it("keeps larger createdAt gaps as mismatch", async () => {
    const drift = await calibrateLongcat(
      "2026-03-12",
      1_000_000,
      "2026-06-30",
      1_000_000,
    );
    expect(drift.createdAt.status).toBe("mismatch");
  });

  it("absorbs binary-vs-decimal context conventions but keeps real gaps", async () => {
    // 官方 204800 = 200×1024，models.dev 记 200000（十进制取整）
    const kib = await calibrateLongcat(undefined, 204_800, "", 200_000);
    expect(kib.context.status).toBe("match");
    // 1048576 = 1M×1024 vs 1000000
    const mega = await calibrateLongcat(undefined, 1_048_576, "", 1_000_000);
    expect(mega.context.status).toBe("match");
    // 超出相对容差的真实差异仍然暴露
    const realGap = await calibrateLongcat(undefined, 1_000_000, "", 500_000);
    expect(realGap.context.status).toBe("mismatch");
  });
});
