import { describe, expect, it } from "vitest";
import {
  buildProviderInventory,
  INVENTORY_PROVIDERS,
} from "../src/inventory/provider-inventory.js";
import type { ProviderData } from "../src/types.js";

const deepseek: ProviderData = {
  schemaVersion: "1.0",
  id: "deepseek",
  name: "DeepSeek",
  ownedBy: "deepseek",
  baseUrls: { openai: "https://api.deepseek.com" },
  models: [
    {
      id: "deepseek-v4-flash",
      name: "DeepSeek-V4-Flash",
      aliases: [
        {
          id: "deepseek-chat",
          mode: "non-thinking",
          deprecatedAt: "2026-07-24T23:59:00+08:00",
        },
        {
          id: "deepseek-reasoner",
          mode: "thinking",
          deprecatedAt: "2026-07-24T23:59:00+08:00",
        },
      ],
      capabilities: { thinking: true },
      limits: { contextTokens: 1_000_000, maxOutputTokens: 384_000 },
      prices: [],
    },
    {
      id: "deepseek-v4-pro",
      name: "DeepSeek-V4-Pro",
      aliases: [],
      capabilities: { thinking: true },
      limits: { contextTokens: 1_000_000, maxOutputTokens: 384_000 },
      prices: [],
    },
  ],
  sources: [],
};

describe("provider model inventory", () => {
  it("recognizes live canonical models and active aliases", () => {
    const inventory = buildProviderInventory(
      INVENTORY_PROVIDERS[0],
      deepseek,
      {
        data: [
          { id: "deepseek-v4-flash", owned_by: "deepseek" },
          { id: "deepseek-v4-pro", owned_by: "deepseek" },
          { id: "deepseek-chat", owned_by: "deepseek" },
          { id: "deepseek-reasoner", owned_by: "deepseek" },
        ],
      },
      undefined,
      new Date("2026-07-22T00:00:00Z"),
    );
    expect(inventory.comparison).toMatchObject({
      status: "match",
      pricedAndListed: ["deepseek-v4-flash", "deepseek-v4-pro"],
      aliasesAndListed: ["deepseek-chat", "deepseek-reasoner"],
      listedWithoutPricing: [],
      pricedButNotListed: [],
      activeAliasesNotListed: [],
    });
  });

  it("flags newly listed models that have no pricing record", () => {
    const inventory = buildProviderInventory(
      INVENTORY_PROVIDERS[0],
      deepseek,
      {
        data: [
          { id: "deepseek-v4-flash", owned_by: "deepseek" },
          { id: "deepseek-v4-pro", owned_by: "deepseek" },
          { id: "deepseek-new", owned_by: "deepseek" },
        ],
      },
      undefined,
      new Date("2026-07-25T00:00:00Z"),
    );
    expect(inventory.comparison.status).toBe("mismatch");
    expect(inventory.comparison.listedWithoutPricing).toEqual(["deepseek-new"]);
    expect(inventory.comparison.activeAliasesNotListed).toEqual([]);
  });
});
