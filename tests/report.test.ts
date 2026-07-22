import { describe, expect, it } from "vitest";
import {
  diffCatalog,
  hasMaterialCatalogChanges,
  renderUpdateReport,
} from "../src/report.js";
import type { Catalog, ProviderData } from "../src/types.js";
import { healthyHealth } from "../src/health.js";

function provider(output: number): ProviderData {
  return {
    schemaVersion: "2.0",
    id: "moonshot-cn",
    name: "Kimi China",
    ownedBy: "moonshot",
    baseUrls: { openai: "https://api.moonshot.cn/v1" },
    health: healthyHealth(new Date("2026-07-22T01:17:00Z")),
    models: [
      {
        id: "kimi-k3",
        name: "Kimi K3",
        aliases: [],
        capabilities: { thinking: true },
        limits: { contextTokens: 1_000_000 },
        prices: [
          {
            market: "china",
            currency: "CNY",
            unit: "1M_tokens",
            rateType: "standard",
            input: { standard: 10 },
            output,
            sourceUrl: "https://platform.kimi.com/docs/pricing/chat",
          },
        ],
      },
    ],
    sources: [
      {
        url: "https://platform.kimi.com/docs/pricing/chat",
        kind: "pricing",
        locale: "zh-CN",
        currency: "CNY",
        retrievedAt: "2026-07-22T01:17:00Z",
        contentHash: `sha256:${"a".repeat(64)}`,
      },
    ],
  };
}

describe("automated update report", () => {
  it("reports field-level price changes and source health", () => {
    const before: Catalog = {
      schemaVersion: "2.0",
      providers: [provider(100)],
    };
    const after: Catalog = { schemaVersion: "2.0", providers: [provider(80)] };
    expect(diffCatalog(before, after).prices).toHaveLength(1);
    const report = renderUpdateReport(before, after);
    expect(report).toContain("- 价格变化：1");
    expect(report).toContain("| moonshot-cn | kimi-k3 | output | ¥100 | ¥80 |");
    expect(report).toContain("moonshot-cn ✅ 成功");
  });

  it("ignores successful timestamp-only refreshes", () => {
    const before: Catalog = {
      schemaVersion: "2.0",
      providers: [provider(80)],
    };
    const refreshed = provider(80);
    refreshed.health.lastAttemptAt = "2026-07-22T07:17:00Z";
    refreshed.health.lastSuccessfulAt = "2026-07-22T07:17:00Z";
    refreshed.sources[0]!.retrievedAt = "2026-07-22T07:17:00Z";
    const after: Catalog = { schemaVersion: "2.0", providers: [refreshed] };
    expect(hasMaterialCatalogChanges(before, after)).toBe(false);
  });

  it("treats health state changes as material", () => {
    const before: Catalog = {
      schemaVersion: "2.0",
      providers: [provider(80)],
    };
    const failed = provider(80);
    failed.health = {
      ...failed.health,
      status: "error",
      consecutiveFailures: 1,
      message: "HTTP 503",
    };
    const after: Catalog = { schemaVersion: "2.0", providers: [failed] };
    expect(hasMaterialCatalogChanges(before, after)).toBe(true);
  });
});
