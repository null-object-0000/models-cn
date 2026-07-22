import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  calibrationDir,
  inventoryDir,
  providersDir,
  readJson,
  readProvider,
} from "../io.js";
import type { ModelsDevCalibration, ProviderInventory } from "../types.js";
import {
  validateCalibration,
  validateInventory,
  validateProvider,
} from "../validation.js";

const files = (await readdir(providersDir)).filter((file) =>
  file.endsWith(".json"),
);
for (const file of files) {
  const provider = await readProvider(path.join(providersDir, file));
  if (!provider) continue;
  await validateProvider(provider);
}
console.log(`Validated ${files.length} provider file(s)`);

const calibration = await readJson<ModelsDevCalibration>(
  path.join(calibrationDir, "models-dev.json"),
);
if (calibration) {
  await validateCalibration(calibration);
  console.log("Validated models.dev calibration report");
}

try {
  const inventoryFiles = (await readdir(inventoryDir)).filter((file) =>
    file.endsWith(".json"),
  );
  for (const file of inventoryFiles) {
    const inventory = await readJson<ProviderInventory>(
      path.join(inventoryDir, file),
    );
    if (inventory) await validateInventory(inventory);
  }
  console.log(`Validated ${inventoryFiles.length} provider inventory file(s)`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
