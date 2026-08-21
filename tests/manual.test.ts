import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseDeepSeekPage,
  DEEPSEEK_SOURCES,
} from "../src/collectors/deepseek.js";
import { parseMoonshotPricingPage } from "../src/collectors/moonshot.js";
import {
  applyManualCapabilities,
  loadManualCapabilities,
  validateManualCapabilities,
  type ManualCapabilities,
  type ManualCapabilitiesEntry,
} from "../src/manual.js";
import type { ModelData, ProviderData } from "../src/types.js";

const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

function provider(models: ModelData[], id = "test"): ProviderData {
  return {
    schemaVersion: "1.0",
    id,
    name: "Test",
    ownedBy: id,
    baseUrls: { openai: "https://example.com/v1" },
    health: {
      status: "healthy",
      lastSuccessfulAt: "2026-08-01T00:00:00.000Z",
      lastAttemptAt: "2026-08-01T00:00:00.000Z",
      consecutiveFailures: 0,
    },
    models,
    sources: [],
  };
}

function model(id: string, capabilities: Record<string, unknown>): ModelData {
  return {
    id,
    name: id,
    aliases: [],
    capabilities,
    limits: { contextTokens: 1000 },
    prices: [
      {
        market: "china",
        currency: "CNY",
        unit: "1M_tokens",
        rateType: "standard",
        input: { standard: 1 },
        output: 2,
        sourceUrl: "https://example.com",
      },
    ],
  };
}

const entry = (
  provider: string,
  modelId: string,
  capabilities: Record<string, unknown>,
): ManualCapabilitiesEntry => ({ provider, model: modelId, capabilities });

function manual(entries: ManualCapabilitiesEntry[]): ManualCapabilities {
  return { schemaVersion: "1.0", entries };
}

describe("manual capabilities validation", () => {
  it("accepts a valid file", () => {
    expect(() =>
      validateManualCapabilities(
        manual([
          entry("test", "m1", {
            inputModalities: ["text", "image"],
            outputModalities: ["text"],
            thinking: true,
          }),
        ]),
      ),
    ).not.toThrow();
  });

  it("rejects unknown capability keys", () => {
    expect(() =>
      validateManualCapabilities(
        manual([entry("test", "m1", { contexteTokens: 1000 })]),
      ),
    ).toThrow(/unknown capability key "contexteTokens"/);
  });

  it("rejects duplicate provider/model entries", () => {
    expect(() =>
      validateManualCapabilities(
        manual([
          entry("test", "m1", { inputModalities: ["text"] }),
          entry("test", "m1", { inputModalities: ["image"] }),
        ]),
      ),
    ).toThrow(/Duplicate manual capabilities entry test\/m1/);
  });

  it("rejects invalid field types and providers", () => {
    expect(() =>
      validateManualCapabilities(
        manual([entry("test", "m1", { thinking: "yes" })]),
      ),
    ).toThrow(/field thinking must be a boolean/);
    expect(() =>
      validateManualCapabilities(
        manual([entry("Test Provider", "m1", { inputModalities: ["text"] })]),
      ),
    ).toThrow(/invalid provider "Test Provider"/);
    expect(() =>
      validateManualCapabilities(
        manual([entry("test", "m1", { inputModalities: [] })]),
      ),
    ).toThrow(/must be a non-empty string array/);
  });
});

describe("manual capabilities merge", () => {
  it("fills fields the collector did not provide and keeps official values", () => {
    const data = provider([
      model("m1", { thinking: true }),
      model("m2", { inputModalities: ["image", "text"] }),
      model("m3", {}),
    ]);
    const merged = applyManualCapabilities(
      data,
      manual([
        entry("test", "m1", {
          inputModalities: ["image"],
          outputModalities: ["text"],
        }),
        entry("test", "m2", { inputModalities: ["text"] }),
        entry("test", "m4", { inputModalities: ["image"] }),
      ]),
    );
    expect(merged.models[0]?.capabilities).toEqual({
      thinking: true,
      inputModalities: ["image"],
      outputModalities: ["text"],
    });
    // 官方已有 inputModalities，手工值不覆盖
    expect(merged.models[1]?.capabilities.inputModalities).toEqual([
      "image",
      "text",
    ]);
    // 无条目的模型不受影响
    expect(merged.models[2]?.capabilities).toEqual({});
    // 不修改入参
    expect(data.models[0]?.capabilities).toEqual({ thinking: true });
  });
});

describe("manual capabilities end-to-end", () => {
  it("loads the committed manual file", async () => {
    const loaded = await loadManualCapabilities();
    expect(loaded.entries.length).toBeGreaterThan(0);
  });

  it("gives DeepSeek models their curated modalities after merge", async () => {
    const manualData = await loadManualCapabilities();
    const html = readFileSync(
      path.join(fixtureDir, "deepseek-final-zh.html"),
      "utf8",
    );
    const parsed = parseDeepSeekPage(html, DEEPSEEK_SOURCES[0]);
    const models: ModelData[] = parsed.models.map((m) => ({
      id: m.id,
      name: m.name,
      aliases: [],
      capabilities: m.capabilities,
      limits: m.limits,
      prices: [],
    }));
    const merged = applyManualCapabilities(
      provider(models, "deepseek"),
      manualData,
    );
    const byId = new Map(merged.models.map((m) => [m.id, m]));
    expect(byId.get("deepseek-v4-flash")?.capabilities).toMatchObject({
      inputModalities: ["text"],
      outputModalities: ["text"],
    });
    expect(byId.get("deepseek-v4-pro")?.capabilities).toMatchObject({
      inputModalities: ["text"],
      outputModalities: ["text"],
    });
  });

  it("gives Kimi models their curated capabilities after merge", async () => {
    const manualData = await loadManualCapabilities();
    const markdown = `
<DocTable
  rows={[
["kimi-k3", "1M tokens", "¥2.00", "¥20.00", "¥100.00", "1,048,576 tokens"],
]}/>`;
    const parsed = parseMoonshotPricingPage(
      markdown,
      "https://platform.kimi.com/docs/pricing/chat-k3",
    );
    const merged = applyManualCapabilities(
      provider(parsed.models, "moonshot-cn"),
      manualData,
    );
    expect(merged.models[0]?.capabilities).toMatchObject({
      thinking: true,
      jsonOutput: true,
      toolCalls: true,
      inputModalities: ["text", "image", "video"],
      outputModalities: ["text"],
    });
  });
});
