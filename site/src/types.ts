export type Currency = "CNY" | "USD";
export type RateType = "standard" | "promotional";
export type ThemePreference = "system" | "light" | "dark";

export interface Price {
  market: string;
  currency: Currency;
  unit: string;
  rateType: RateType;
  inputTokenRange?: {
    label: string;
    minExclusive?: number;
    maxInclusive?: number;
  };
  input: { cacheHit?: number; standard: number };
  output: number;
  sourceUrl: string;
}

export interface Model {
  id: string;
  name: string;
  createdAt?: string;
  aliases: Array<{ id: string; deprecatedAt?: string }>;
  capabilities: Record<string, unknown>;
  limits: {
    contextTokens: number;
    maxOutputTokens?: number;
    concurrency?: number;
  };
  prices: Price[];
}

export interface Provider {
  id: string;
  name: string;
  displayNames?: { "zh-CN": string; en: string };
  models: Model[];
  sources: Array<{ url: string; retrievedAt: string; kind: string }>;
}

export interface CalibrationModel {
  provider: string;
  model: string;
  status: "match" | "mismatch" | "partial" | "missing";
  referenceUrl: string;
  checks: Array<{
    field: string;
    official: unknown;
    reference: unknown;
    status: string;
  }>;
}

export interface Inventory {
  provider: string;
  source: { retrievedAt: string };
  comparison: {
    status: "match" | "mismatch";
    listedWithoutPricing: string[];
    pricedButNotListed: string[];
  };
}

export interface Catalog {
  providers: Provider[];
  inventories?: Inventory[];
  calibration?: { modelsDev: { models: CalibrationModel[] } };
}
