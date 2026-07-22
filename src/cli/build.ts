import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  calibrationDir,
  inventoryDir,
  providersDir,
  readJson,
  readProvider,
  rootDir,
  writeJson,
} from "../io.js";
import type {
  Catalog,
  ModelsDevCalibration,
  ProviderData,
  ProviderInventory,
} from "../types.js";
import {
  validateCalibration,
  validateInventory,
  validateProvider,
} from "../validation.js";

const files = (await readdir(providersDir))
  .filter((file) => file.endsWith(".json"))
  .sort();
const providers: ProviderData[] = [];
for (const file of files) {
  const provider = await readProvider(path.join(providersDir, file));
  if (!provider) continue;
  await validateProvider(provider);
  providers.push(provider);
}
const modelsDev = await readJson<ModelsDevCalibration>(
  path.join(calibrationDir, "models-dev.json"),
);
if (modelsDev) await validateCalibration(modelsDev);
let inventories: ProviderInventory[] | undefined;
try {
  const inventoryFiles = (await readdir(inventoryDir))
    .filter((file) => file.endsWith(".json"))
    .sort();
  inventories = [];
  for (const file of inventoryFiles) {
    const inventory = await readJson<ProviderInventory>(
      path.join(inventoryDir, file),
    );
    if (!inventory) continue;
    await validateInventory(inventory);
    inventories.push(inventory);
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const catalog: Catalog = {
  schemaVersion: "1.0",
  providers,
  ...(inventories?.length ? { inventories } : {}),
  ...(modelsDev ? { calibration: { modelsDev } } : {}),
};
await writeJson(path.join(rootDir, "api.json"), catalog);
console.log(`Built api.json with ${providers.length} provider(s)`);
