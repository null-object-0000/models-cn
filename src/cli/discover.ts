import { mkdir } from "node:fs/promises";
import path from "node:path";
import "../env.js";
import {
  fetchProviderInventory,
  INVENTORY_PROVIDERS,
} from "../inventory/provider-inventory.js";
import {
  inventoryDir,
  providersDir,
  readJson,
  readProvider,
  writeJson,
} from "../io.js";
import type { ProviderInventory } from "../types.js";
import { validateInventory } from "../validation.js";
import { failedHealth } from "../health.js";

await mkdir(inventoryDir, { recursive: true });
let refreshed = 0;
for (const config of INVENTORY_PROVIDERS) {
  const apiKey = process.env[config.env];
  if (!apiKey) {
    const output = path.join(inventoryDir, `${config.provider}.json`);
    const previous = await readJson<ProviderInventory>(output);
    if (previous) {
      const error = new Error(`${config.env} is not configured`);
      const fallback = {
        ...previous,
        health: failedHealth(previous.health, error),
      };
      await validateInventory(fallback);
      await writeJson(output, fallback);
    }
    console.error(
      `${config.provider} inventory skipped: ${config.env} is not configured`,
    );
    continue;
  }
  const provider = await readProvider(
    path.join(providersDir, `${config.provider}.json`),
  );
  if (!provider)
    throw new Error(
      `Provider data is missing for ${config.provider}; run npm run collect first`,
    );
  const output = path.join(inventoryDir, `${config.provider}.json`);
  const previous = await readJson<ProviderInventory>(output);
  try {
    const inventory = await fetchProviderInventory(
      config,
      apiKey,
      provider,
      previous,
    );
    await validateInventory(inventory);
    await writeJson(output, inventory);
    console.log(
      `Discovered ${inventory.models.length} live ${provider.name} models (${inventory.comparison.status})`,
    );
    refreshed += 1;
  } catch (error) {
    if (!previous) throw error;
    const fallback = {
      ...previous,
      health: failedHealth(previous.health, error),
    };
    await validateInventory(fallback);
    await writeJson(output, fallback);
    console.error(
      `${config.provider} inventory failed: ${(error as Error).message}`,
    );
  }
}
console.log(`Refreshed ${refreshed} provider model inventories`);
