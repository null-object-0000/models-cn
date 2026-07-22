import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ProviderData } from "./types.js";
import type { ModelsDevCalibration, ProviderInventory } from "./types.js";
import { rootDir } from "./io.js";

export async function validateProvider(data: ProviderData): Promise<void> {
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
