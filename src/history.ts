import type {
  ModelData,
  ModelPrice,
  PriceSnapshot,
  ProviderData,
} from "./types.js";

/**
 * Stable identity for a price entry. Two price entries are considered the
 * same billing dimension when this key is equal.
 */
export function priceKey(price: ModelPrice): string {
  return JSON.stringify({
    market: price.market,
    currency: price.currency,
    rateType: price.rateType,
    inputTokenRange: price.inputTokenRange ?? null,
    outputTokenRange: price.outputTokenRange ?? null,
    dailyTimeRange: price.dailyTimeRange ?? null,
    effectiveFrom: price.effectiveFrom ?? null,
  });
}

/**
 * Whether two prices describe the same billing values. `validFrom` and
 * `sourceUrl` are metadata, not part of the price itself.
 */
function samePriceValue(left: ModelPrice, right: ModelPrice): boolean {
  return (
    left.market === right.market &&
    left.currency === right.currency &&
    left.unit === right.unit &&
    left.rateType === right.rateType &&
    JSON.stringify(left.inputTokenRange ?? null) ===
      JSON.stringify(right.inputTokenRange ?? null) &&
    JSON.stringify(left.outputTokenRange ?? null) ===
      JSON.stringify(right.outputTokenRange ?? null) &&
    JSON.stringify(left.dailyTimeRange ?? null) ===
      JSON.stringify(right.dailyTimeRange ?? null) &&
    left.effectiveFrom === right.effectiveFrom &&
    JSON.stringify(left.input) === JSON.stringify(right.input) &&
    left.output === right.output
  );
}

function backfillFrom(previous?: ProviderData): string | undefined {
  return (
    previous?.sources.find((source) => source.kind === "pricing")
      ?.retrievedAt ?? previous?.health.lastSuccessfulAt
  );
}

/**
 * Merge a freshly collected provider snapshot with the previously committed
 * one so that replaced prices are archived into `model.priceHistory`.
 *
 * Rules:
 * - A price entry whose values are unchanged keeps its `validFrom` (carried
 *   forward), and never produces a history record on its own.
 * - A price entry whose values changed (or that disappeared) is archived with
 *   `validTo = asOf`; the new values are stamped with `validFrom = asOf`.
 * - A brand-new price entry gets `validFrom = asOf`.
 * - When a previous price has no `validFrom` yet (pre-history data), it is
 *   backfilled from the previous pricing source's `retrievedAt` so the first
 *   migration run still records meaningful windows.
 * - Existing `priceHistory` is preserved; new snapshots are prepended.
 *
 * Pure timestamp refreshes (content unchanged) do not change `validFrom` and
 * do not append history.
 */
export function applyPriceHistory(
  previous: ProviderData | undefined,
  next: ProviderData,
  asOf = new Date().toISOString(),
): ProviderData {
  const backfill = backfillFrom(previous);
  const models: ModelData[] = next.models.map((model) => {
    const prevModel = previous?.models.find(
      (candidate) => candidate.id === model.id,
    );
    const prevPrices = new Map(
      (prevModel?.prices ?? []).map((price) => [priceKey(price), price]),
    );
    const nextPrices = model.prices.map((price) => {
      const key = priceKey(price);
      const previousPrice = prevPrices.get(key);
      if (!previousPrice) {
        return price.validFrom ? price : { ...price, validFrom: asOf };
      }
      if (samePriceValue(previousPrice, price)) {
        const validFrom = previousPrice.validFrom ?? backfill ?? asOf;
        return validFrom === price.validFrom ? price : { ...price, validFrom };
      }
      return price.validFrom ? price : { ...price, validFrom: asOf };
    });

    const addedHistory: PriceSnapshot[] = [];
    for (const previousPrice of prevModel?.prices ?? []) {
      const current = nextPrices.find(
        (price) => priceKey(price) === priceKey(previousPrice),
      );
      if (current && samePriceValue(previousPrice, current)) {
        continue;
      }
      addedHistory.push({
        ...previousPrice,
        validFrom: previousPrice.validFrom ?? backfill ?? asOf,
        validTo: asOf,
      });
    }

    const existingHistory = prevModel?.priceHistory ?? [];
    const priceHistory =
      addedHistory.length || existingHistory.length
        ? [...addedHistory, ...existingHistory]
        : undefined;
    return priceHistory
      ? { ...model, prices: nextPrices, priceHistory }
      : { ...model, prices: nextPrices };
  });
  return { ...next, models };
}
