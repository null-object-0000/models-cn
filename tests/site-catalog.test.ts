import { describe, expect, it } from "vitest";
import {
  activePricesAt,
  capabilityLabels,
  compareModelsByReleaseDate,
  formatPriceRange,
  inputModalityOptions,
  modalityLabel,
  modelDomId,
  modelHash,
  modelHasInputModality,
  modelKey,
  modelReleaseDate,
  nextPricesAt,
} from "../site/src/lib/catalog.js";
import type { CalibrationModel, Model } from "../site/src/types.js";

function model(id: string, createdAt?: string): Model {
  return {
    id,
    name: id,
    ...(createdAt ? { createdAt } : {}),
    aliases: [],
    capabilities: {},
    limits: { contextTokens: 1 },
    prices: [],
  };
}

function withInputModalities(model: Model, values: string[]): Model {
  return {
    ...model,
    capabilities: { ...model.capabilities, inputModalities: values },
  };
}

function calibration(modelId: string, releaseDate: string): CalibrationModel {
  return {
    provider: "test",
    model: modelId,
    status: "partial",
    referenceUrl: "https://models.dev/",
    checks: [
      {
        field: "createdAt",
        official: null,
        reference: releaseDate,
        status: "missing",
      },
    ],
  };
}

describe("site catalog release ordering", () => {
  it("prefers official dates and falls back to models.dev dates", () => {
    const official = model("official", "2026-07-20T00:00:00Z");
    const referenced = model("referenced");
    const reference = calibration("referenced", "2026-07-16");
    const unknown = model("unknown");

    expect(modelReleaseDate(official, reference)).toBe("2026-07-20T00:00:00Z");
    expect(modelReleaseDate(referenced, reference)).toBe("2026-07-16");
    expect(
      [
        { model: unknown, calibration: undefined },
        { model: referenced, calibration: reference },
        { model: official, calibration: undefined },
      ]
        .sort(compareModelsByReleaseDate)
        .map((item) => item.model.id),
    ).toEqual(["official", "referenced", "unknown"]);
  });
});

describe("site model identity", () => {
  it("uses provider and model IDs for state, DOM and hash identity", () => {
    expect(modelKey("deepseek", "shared-model")).toBe("deepseek/shared-model");
    expect(modelKey("moonshot-cn", "shared-model")).not.toBe(
      modelKey("deepseek", "shared-model"),
    );
    expect(modelDomId("moonshot-cn", "kimi-k3")).toBe(
      "model-moonshot-cn-kimi-k3",
    );
    expect(modelHash("moonshot-cn", "kimi-k3")).toBe("moonshot-cn/kimi-k3");
  });
});

describe("site catalog price summaries", () => {
  it("selects provider-announced prices by effective time", () => {
    const prices = [
      { effectiveTo: "2026-08-17T00:00:00+08:00", output: 2 },
      { effectiveFrom: "2026-08-17T00:00:00+08:00", output: 4.5 },
    ] as never[];
    expect(activePricesAt(prices, new Date("2026-08-16T15:59:59Z"))).toEqual([
      prices[0],
    ]);
    expect(activePricesAt(prices, new Date("2026-08-16T16:00:00Z"))).toEqual([
      prices[1],
    ]);
  });

  it("selects the nearest upcoming price schedule", () => {
    const prices = [
      { effectiveFrom: "2026-08-17T00:00:00+08:00", output: 4.5 },
      { effectiveFrom: "2026-08-17T00:00:00+08:00", output: 9 },
      { effectiveFrom: "2026-09-01T00:00:00+08:00", output: 10 },
    ] as never[];
    expect(nextPricesAt(prices, new Date("2026-08-13T00:00:00Z"))).toEqual([
      prices[0],
      prices[1],
    ]);
  });

  it("shows a range for tiered prices and a single value otherwise", () => {
    expect(formatPriceRange([1.6, 4.8], "CNY")).toBe("¥1.6 - 4.8");
    expect(formatPriceRange([6.4, 6.4], "CNY")).toBe("¥6.4");
    expect(formatPriceRange([undefined, 0.32, 0.96], "CNY")).toBe(
      "¥0.32 - 0.96",
    );
    expect(formatPriceRange([undefined], "USD")).toBeUndefined();
  });
});

describe("site capability modality labels", () => {
  it("translates common modality values to Chinese labels", () => {
    expect(modalityLabel("text")).toBe("文本");
    expect(modalityLabel("IMAGE")).toBe("图片");
    expect(modalityLabel("Video")).toBe("视频");
    expect(modalityLabel("audio")).toBe("音频");
    expect(modalityLabel("unknown-modality")).toBe("unknown-modality");
  });

  it("keeps modalities out of capability tags (single source in Model information)", () => {
    expect(
      capabilityLabels({
        thinking: true,
        inputModalities: ["image", "text", "video"],
        outputModalities: ["text"],
      }),
    ).toEqual(["思考"]);
  });

  it("omits modality tags when no modalities are collected", () => {
    expect(capabilityLabels({ jsonOutput: true })).toEqual(["JSON"]);
  });
});

describe("site input modality filter", () => {
  it("lists distinct input modalities in preferred order", () => {
    const models = [
      withInputModalities(model("a"), ["video", "text"]),
      withInputModalities(model("b"), ["image", "text", "video"]),
      withInputModalities(model("c"), ["audio"]),
      withInputModalities(model("d"), ["hologram"]),
      model("e"),
    ];
    expect(inputModalityOptions(models)).toEqual([
      "text",
      "image",
      "video",
      "audio",
      "hologram",
    ]);
    expect(inputModalityOptions([])).toEqual([]);
  });

  it("matches models whose input modalities include the filter value", () => {
    const textImage = withInputModalities(model("ti"), ["text", "image"]);
    const textOnly = withInputModalities(model("t"), ["text"]);
    expect(modelHasInputModality(textImage, "image")).toBe(true);
    expect(modelHasInputModality(textOnly, "image")).toBe(false);
    expect(modelHasInputModality(model("none"), "image")).toBe(false);
  });
});
