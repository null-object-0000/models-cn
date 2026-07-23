import { createHash } from "node:crypto";
import type {
  InventoryModel,
  ProviderData,
  ProviderInventory,
} from "../types.js";
import { healthyHealth } from "../health.js";

interface ModelsResponse {
  data: Array<{
    id: string;
    owned_by: string;
    display_name?: string;
    context_length?: number;
    context_window?: number;
    max_output_tokens?: number;
    supports_image_in?: boolean;
    supports_video_in?: boolean;
    supports_reasoning?: boolean;
  }>;
}

export const INVENTORY_PROVIDERS = [
  {
    provider: "deepseek",
    env: "DEEPSEEK_API_KEY",
    url: "https://api.deepseek.com/models",
  },
  {
    provider: "longcat",
    env: "LONGCAT_API_KEY",
    url: "https://api.longcat.chat/openai/v1/models",
  },
  {
    provider: "moonshot-cn",
    env: "MOONSHOT_CHINA_API_KEY",
    legacyEnv: "MOONSHOT_API_KEY",
    url: "https://api.moonshot.cn/v1/models",
    modelIdPrefix: "kimi-",
  },
  {
    provider: "moonshot-intl",
    env: "MOONSHOT_INTERNATIONAL_API_KEY",
    url: "https://api.moonshot.ai/v1/models",
    modelIdPrefix: "kimi-",
  },
] as const;

export type InventoryProviderConfig = (typeof INVENTORY_PROVIDERS)[number];

function compareInventory(
  provider: ProviderData,
  models: InventoryModel[],
  now: Date,
): ProviderInventory["comparison"] {
  const listed = new Set(models.map((model) => model.id));
  const priced = new Set(provider.models.map((model) => model.id));
  const aliases = provider.models.flatMap((model) => model.aliases);
  const aliasIds = new Set(aliases.map((alias) => alias.id));
  const activeAliasIds = new Set(
    aliases
      .filter(
        (alias) =>
          !alias.deprecatedAt ||
          new Date(alias.deprecatedAt).getTime() > now.getTime(),
      )
      .map((alias) => alias.id),
  );
  const sort = (values: string[]) =>
    values.sort((left, right) => left.localeCompare(right));
  const pricedAndListed = sort([...priced].filter((id) => listed.has(id)));
  const aliasesAndListed = sort([...aliasIds].filter((id) => listed.has(id)));
  const listedWithoutPricing = sort(
    [...listed].filter((id) => !priced.has(id) && !aliasIds.has(id)),
  );
  const pricedButNotListed = sort([...priced].filter((id) => !listed.has(id)));
  const activeAliasesNotListed = sort(
    [...activeAliasIds].filter((id) => !listed.has(id)),
  );
  const status =
    listedWithoutPricing.length ||
    pricedButNotListed.length ||
    activeAliasesNotListed.length
      ? "mismatch"
      : "match";
  return {
    status,
    pricedAndListed,
    aliasesAndListed,
    listedWithoutPricing,
    pricedButNotListed,
    activeAliasesNotListed,
  };
}

export function buildProviderInventory(
  config: InventoryProviderConfig,
  provider: ProviderData,
  response: ModelsResponse,
  previous?: ProviderInventory,
  now = new Date(),
): ProviderInventory {
  const modelIdPrefix =
    "modelIdPrefix" in config ? config.modelIdPrefix : undefined;
  const models = response.data
    .filter((model) => !modelIdPrefix || model.id.startsWith(modelIdPrefix))
    .map((model) => ({
      id: model.id,
      ownedBy: model.owned_by,
      ...(model.display_name ? { displayName: model.display_name } : {}),
      ...((model.context_length ?? model.context_window)
        ? { contextTokens: model.context_length ?? model.context_window }
        : {}),
      ...(model.max_output_tokens
        ? { maxOutputTokens: model.max_output_tokens }
        : {}),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const contentHash = `sha256:${createHash("sha256").update(JSON.stringify(models)).digest("hex")}`;
  const retrievedAt =
    previous?.source.contentHash === contentHash
      ? previous.source.retrievedAt
      : now.toISOString();
  return {
    schemaVersion: "1.0",
    provider: config.provider,
    health: healthyHealth(now),
    source: { url: config.url, retrievedAt, contentHash },
    models,
    comparison: compareInventory(provider, models, now),
  };
}

export async function fetchProviderInventory(
  config: InventoryProviderConfig,
  apiKey: string,
  provider: ProviderData,
  previous?: ProviderInventory,
  now = new Date(),
): Promise<ProviderInventory> {
  const response = await fetch(config.url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "user-agent":
        "models-cn/0.1 (+https://github.com/null-object-0000/models-cn)",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `Failed to fetch ${config.provider} model inventory: HTTP ${response.status}`,
    );
  return buildProviderInventory(
    config,
    provider,
    (await response.json()) as ModelsResponse,
    previous,
    now,
  );
}
