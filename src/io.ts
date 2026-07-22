import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderData } from "./types.js";

export const rootDir = process.cwd();
export const providersDir = path.join(rootDir, "data", "providers");
export const calibrationDir = path.join(rootDir, "data", "calibration");
export const inventoryDir = path.join(rootDir, "data", "inventory");

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function readProvider(file: string): Promise<ProviderData | undefined> {
  return readJson<ProviderData>(file);
}

export function preserveUnchangedSourceTimestamps(
  next: ProviderData,
  previous?: ProviderData,
): ProviderData {
  if (!previous) return next;
  for (const source of next.sources) {
    const old = previous.sources.find(
      (candidate) => candidate.url === source.url,
    );
    if (old?.contentHash === source.contentHash)
      source.retrievedAt = old.retrievedAt;
  }
  return next;
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
