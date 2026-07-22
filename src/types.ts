export type Currency = "CNY" | "USD";
export type Market = "china" | "international";

export interface Source {
  url: string;
  kind: "pricing" | "model-metadata";
  locale: "zh-CN" | "en";
  currency?: Currency;
  retrievedAt: string;
  contentHash: string;
}

export interface ModelAlias {
  id: string;
  mode: "thinking" | "non-thinking";
  deprecatedAt?: string;
}

export interface ModelPrice {
  market: Market;
  currency: Currency;
  unit: "1M_tokens";
  rateType: "standard" | "promotional";
  input: {
    cacheHit: number;
    cacheMiss: number;
  };
  output: number;
  sourceUrl: string;
}

export interface ModelData {
  id: string;
  name: string;
  createdAt?: string;
  tokenizer?: string;
  aliases: ModelAlias[];
  capabilities: {
    thinking?: boolean;
    thinkingModes?: string[];
    reasoningEfforts?: string[];
    dynamicTools?: boolean;
    jsonOutput?: boolean;
    toolCalls?: boolean;
    chatPrefixCompletion?: boolean;
    fimCompletion?: "non-thinking-only" | "supported" | "unsupported";
    inputModalities?: string[];
    outputModalities?: string[];
    supportedParameters?: string[];
  };
  limits: {
    contextTokens: number;
    maxOutputTokens?: number;
    concurrency?: number;
  };
  prices: ModelPrice[];
}

export interface ProviderData {
  schemaVersion: "1.0";
  id: string;
  name: string;
  ownedBy: string;
  baseUrls: {
    openai: string;
    anthropic?: string;
  };
  models: ModelData[];
  sources: Source[];
}

export interface Catalog {
  schemaVersion: "1.0";
  providers: ProviderData[];
  inventories?: ProviderInventory[];
  calibration?: {
    modelsDev: ModelsDevCalibration;
  };
}

export interface InventoryModel {
  id: string;
  ownedBy: string;
  displayName?: string;
  contextTokens?: number;
  maxOutputTokens?: number;
}

export interface ProviderInventory {
  schemaVersion: "1.0";
  provider: string;
  source: {
    url: string;
    retrievedAt: string;
    contentHash: string;
  };
  models: InventoryModel[];
  comparison: {
    status: "match" | "mismatch";
    pricedAndListed: string[];
    aliasesAndListed: string[];
    listedWithoutPricing: string[];
    pricedButNotListed: string[];
    activeAliasesNotListed: string[];
  };
}

export type CalibrationValue = string | number | boolean | string[] | null;

export interface CalibrationCheck {
  field: string;
  official: CalibrationValue;
  reference: CalibrationValue;
  status: "match" | "mismatch" | "missing";
}

export interface ModelCalibration {
  provider: string;
  model: string;
  referenceProvider: string;
  referenceModel: string;
  referenceUrl: string;
  status: "match" | "mismatch" | "partial" | "missing";
  checks: CalibrationCheck[];
}

export interface ModelsDevCalibration {
  schemaVersion: "1.0";
  source: {
    url: "https://models.dev/api.json";
    retrievedAt: string;
    contentHash: string;
  };
  models: ModelCalibration[];
}
