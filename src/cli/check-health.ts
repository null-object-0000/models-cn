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

const failures: string[] = [];
const staleAfterMs = 36 * 60 * 60 * 1000;
const unhealthy = (
  status: string | undefined,
  lastAttemptAt: string | undefined,
) =>
  status !== "healthy" ||
  !lastAttemptAt ||
  Date.now() - Date.parse(lastAttemptAt) > staleAfterMs;
for (const file of await readdir(providersDir)) {
  if (!file.endsWith(".json")) continue;
  const provider = await readProvider(path.join(providersDir, file));
  if (unhealthy(provider?.health.status, provider?.health.lastAttemptAt)) {
    failures.push(
      `official pricing: ${provider?.id ?? file} (${provider?.health.status ?? "missing"})`,
    );
  }
}
for (const file of await readdir(inventoryDir)) {
  if (!file.endsWith(".json")) continue;
  const inventory = await readJson<ProviderInventory>(
    path.join(inventoryDir, file),
  );
  if (unhealthy(inventory?.health.status, inventory?.health.lastAttemptAt)) {
    failures.push(
      `Models API: ${inventory?.provider ?? file} (${inventory?.health.status ?? "missing"})`,
    );
  }
}
const calibration = await readJson<ModelsDevCalibration>(
  path.join(calibrationDir, "models-dev.json"),
);
if (unhealthy(calibration?.health.status, calibration?.health.lastAttemptAt)) {
  failures.push(`models.dev: ${calibration?.health.status ?? "missing"}`);
}

if (failures.length) {
  throw new Error(`Unhealthy collection sources:\n- ${failures.join("\n- ")}`);
}
console.log("All configured collection sources are healthy");
