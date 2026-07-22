import { describe, expect, it } from "vitest";
import {
  compareModelsByReleaseDate,
  modelReleaseDate,
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
