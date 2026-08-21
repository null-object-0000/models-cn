import path from "node:path";
import { readJson, rootDir } from "./io.js";
import type { ProviderData } from "./types.js";

/**
 * 手工维护的「附加能力信息」。官方来源（定价页 / 元数据接口）解析不到的能力
 * 字段（例如模态 inputModalities / outputModalities）统一维护在这里，而不是
 * 散落在采集器代码里。合并语义：官方字段优先，仅当官方没有时才用手工值补充，
 * 因此动态来源（千问、长猫）永远不会被手工值掩盖。
 */
export interface ManualCapabilitiesEntry {
  provider: string;
  model: string;
  capabilities: Record<string, unknown>;
  note?: string;
}

export interface ManualCapabilities {
  schemaVersion: "1.0";
  entries: ManualCapabilitiesEntry[];
}

export const MANUAL_CAPABILITIES_VERSION = "1.0" as const;

export const manualCapabilitiesPath = path.join(
  rootDir,
  "data",
  "manual",
  "capabilities.json",
);

const BOOLEAN_FIELDS = [
  "thinking",
  "dynamicTools",
  "jsonOutput",
  "toolCalls",
  "chatPrefixCompletion",
] as const;

const STRING_ARRAY_FIELDS = [
  "thinkingModes",
  "reasoningEfforts",
  "inputModalities",
  "outputModalities",
  "supportedParameters",
] as const;

const FIM_VALUES = [
  "non-thinking-only",
  "supported",
  "unsupported",
] as const satisfies readonly string[];

const ALLOWED_KEYS = new Set<string>([
  ...BOOLEAN_FIELDS,
  ...STRING_ARRAY_FIELDS,
  "fimCompletion",
]);

function assertStringArray(
  value: unknown,
  provider: string,
  model: string,
  field: string,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new Error(
      `Manual capabilities ${provider}/${model} field ${field} must be a non-empty string array`,
    );
  }
  return value as string[];
}

function validateEntry(entry: ManualCapabilitiesEntry): void {
  const { provider, model, capabilities } = entry;
  if (!/^[a-z0-9-]+$/.test(provider)) {
    throw new Error(
      `Manual capabilities entry has invalid provider "${provider}"`,
    );
  }
  if (!model) {
    throw new Error(
      `Manual capabilities entry for provider "${provider}" is missing model`,
    );
  }
  if (
    typeof capabilities !== "object" ||
    capabilities === null ||
    Array.isArray(capabilities) ||
    !Object.keys(capabilities).length
  ) {
    throw new Error(
      `Manual capabilities entry ${provider}/${model} must have a non-empty capabilities object`,
    );
  }
  for (const [key, value] of Object.entries(capabilities)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(
        `Manual capabilities ${provider}/${model} has unknown capability key "${key}"`,
      );
    }
    if ((BOOLEAN_FIELDS as readonly string[]).includes(key)) {
      if (typeof value !== "boolean") {
        throw new Error(
          `Manual capabilities ${provider}/${model} field ${key} must be a boolean`,
        );
      }
    } else if ((STRING_ARRAY_FIELDS as readonly string[]).includes(key)) {
      assertStringArray(value, provider, model, key);
    } else if (key === "fimCompletion") {
      if (
        typeof value !== "string" ||
        !(FIM_VALUES as readonly string[]).includes(value)
      ) {
        throw new Error(
          `Manual capabilities ${provider}/${model} field fimCompletion must be one of ${FIM_VALUES.join(" / ")}`,
        );
      }
    }
  }
}

export function validateManualCapabilities(manual: ManualCapabilities): void {
  if (manual.schemaVersion !== MANUAL_CAPABILITIES_VERSION) {
    throw new Error(
      `Unsupported manual capabilities schemaVersion ${manual.schemaVersion}`,
    );
  }
  if (!Array.isArray(manual.entries)) {
    throw new Error("Manual capabilities file is missing its entries array");
  }
  const seen = new Set<string>();
  for (const entry of manual.entries) {
    validateEntry(entry);
    const key = `${entry.provider}/${entry.model}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate manual capabilities entry ${key}`);
    }
    seen.add(key);
  }
}

export async function loadManualCapabilities(): Promise<ManualCapabilities> {
  const manual = await readJson<ManualCapabilities>(manualCapabilitiesPath);
  if (!manual) {
    throw new Error(
      `Missing manual capabilities file ${manualCapabilitiesPath}`,
    );
  }
  validateManualCapabilities(manual);
  return manual;
}

/**
 * 把手工能力条目合并进采集到的 ProviderData。每个字段以官方采集值为准，
 * 仅当官方没有该字段时才用手工值补充。返回新对象，不修改入参。
 */
export function applyManualCapabilities(
  provider: ProviderData,
  manual: ManualCapabilities,
): ProviderData {
  const byModel = new Map<string, ManualCapabilitiesEntry>();
  for (const entry of manual.entries) {
    if (entry.provider === provider.id) byModel.set(entry.model, entry);
  }
  if (!byModel.size) return provider;
  const models = provider.models.map((model) => {
    const entry = byModel.get(model.id);
    if (!entry) return model;
    const capabilities = { ...model.capabilities };
    const target = capabilities as Record<string, unknown>;
    for (const [key, value] of Object.entries(entry.capabilities)) {
      if (target[key] === undefined) target[key] = value;
    }
    return { ...model, capabilities };
  });
  return { ...provider, models };
}
