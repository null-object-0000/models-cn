import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ProviderData } from "./types.js";
import type { ModelsDevCalibration, ProviderInventory } from "./types.js";
import {
  assertCapabilitiesProvenance,
  assertCreatedAtProvenance,
} from "./health.js";
import { rootDir } from "./io.js";

export async function validateProvider(data: ProviderData): Promise<void> {
  // 旧成功快照没有来源字段；新采集写出的证据必须严格自洽。
  for (const model of data.models) {
    if (
      model.capabilitiesSource !== undefined ||
      model.capabilitiesEvidence !== undefined ||
      model.capabilities === null
    )
      assertCapabilitiesProvenance(model);
    if (
      model.createdAtSource !== undefined ||
      model.createdAtEvidence !== undefined ||
      model.createdAt === null
    )
      assertCreatedAtProvenance(model);
  }

  for (const field of ["createdAt", "capabilities"] as const) {
    if (!data.models.some((model) => model[`${field}Source`] !== undefined))
      continue;
    const expected = data.models
      .filter((model) => model[`${field}Source`] === "not-documented")
      .map((model) => model.id)
      .sort();
    const actual = (data.health.warnings ?? [])
      .filter((warning) => warning.code === `${field}-not-documented`)
      .flatMap((warning) => warning.modelIds)
      .sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual))
      throw new Error(
        `Provider ${data.id}: ${field} warnings do not match undocumented models`,
      );
  }
  const schema = JSON.parse(
    await readFile(
      path.join(rootDir, "schema", "provider.schema.json"),
      "utf8",
    ),
  );
  const ajv = new Ajv2020({ allErrors: true });
  const require = createRequire(import.meta.url);
  const addFormats = require("ajv-formats") as (instance: Ajv2020) => Ajv2020;
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    throw new Error(
      `Provider schema validation failed:\n${JSON.stringify(validate.errors, null, 2)}`,
    );
  }
}

export async function validateCalibration(
  data: ModelsDevCalibration,
): Promise<void> {
  const schema = JSON.parse(
    await readFile(
      path.join(rootDir, "schema", "calibration.schema.json"),
      "utf8",
    ),
  );
  const ajv = new Ajv2020({ allErrors: true });
  const require = createRequire(import.meta.url);
  const addFormats = require("ajv-formats") as (instance: Ajv2020) => Ajv2020;
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    throw new Error(
      `Calibration schema validation failed:\n${JSON.stringify(validate.errors, null, 2)}`,
    );
  }
}

export async function validateInventory(
  data: ProviderInventory,
): Promise<void> {
  const schema = JSON.parse(
    await readFile(
      path.join(rootDir, "schema", "inventory.schema.json"),
      "utf8",
    ),
  );
  const ajv = new Ajv2020({ allErrors: true });
  const require = createRequire(import.meta.url);
  const addFormats = require("ajv-formats") as (instance: Ajv2020) => Ajv2020;
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    throw new Error(
      `Inventory schema validation failed:\n${JSON.stringify(validate.errors, null, 2)}`,
    );
  }
}
