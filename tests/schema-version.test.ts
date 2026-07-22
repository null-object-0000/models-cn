import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../src/types.js";

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("public schema v1 contract", () => {
  it("uses the shared v1 version in providers and generated catalogs", async () => {
    const providerFiles = ["deepseek", "longcat", "moonshot-cn", "qwen-cn"];
    const providers = await Promise.all(
      providerFiles.map((provider) => json(`data/providers/${provider}.json`)),
    );
    const latest = await json("api.json");
    const stable = await json("v1/api.json");

    expect(SCHEMA_VERSION).toBe("1.0");
    expect(
      providers.every((provider) => provider.schemaVersion === "1.0"),
    ).toBe(true);
    expect(latest.schemaVersion).toBe(SCHEMA_VERSION);
    expect(stable).toEqual(latest);
  });

  it("keeps schema/v1 authoritative and root schemas equivalent", async () => {
    for (const name of ["provider", "inventory", "calibration"]) {
      const latest = await json(`schema/${name}.schema.json`);
      const stable = await json(`schema/v1/${name}.schema.json`);
      expect(stable).toEqual({
        ...latest,
        $id: `https://models-cn.dev/schema/v1/${name}.schema.json`,
      });
    }
    const provider = await json("schema/v1/provider.schema.json");
    expect(
      (provider.properties as Record<string, { const: string }>).schemaVersion
        ?.const,
    ).toBe(SCHEMA_VERSION);
  });
});
