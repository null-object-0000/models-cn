import type {
  Catalog,
  ModelData,
  ModelPrice,
  ProviderHealth,
} from "./types.js";

export type Change = {
  provider: string;
  model: string;
  field: string;
  before: unknown;
  after: unknown;
  currency?: ModelPrice["currency"];
};

function modelMap(
  catalog: Catalog,
): Map<string, { provider: string; model: ModelData }> {
  return new Map(
    catalog.providers.flatMap((provider) =>
      provider.models.map((model) => [
        `${provider.id}/${model.id}`,
        { provider: provider.id, model },
      ]),
    ),
  );
}

function priceKey(price: ModelPrice): string {
  return JSON.stringify({
    market: price.market,
    currency: price.currency,
    rateType: price.rateType,
    inputTokenRange: price.inputTokenRange ?? null,
  });
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function display(value: unknown, currency?: ModelPrice["currency"]): string {
  if (value === undefined) return "—";
  if (typeof value === "number" && currency) {
    return `${currency === "CNY" ? "¥" : "$"}${value}`;
  }
  if (typeof value === "string") return value;
  return `\`${JSON.stringify(value)}\``;
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

type SourceHealth = {
  key: string;
  name: string;
  health: ProviderHealth | undefined;
};

function sourceHealthRows(catalog: Catalog): SourceHealth[] {
  const providerNames = new Map(
    catalog.providers.map((provider) => [provider.id, provider.name]),
  );
  return [
    ...catalog.providers.map((provider) => ({
      key: `pricing/${provider.id}`,
      name: `${provider.name} 价格页`,
      health: provider.health,
    })),
    ...(catalog.inventories ?? []).map((inventory) => ({
      key: `inventory/${inventory.provider}`,
      name: `${providerNames.get(inventory.provider) ?? inventory.provider} Models API`,
      health: inventory.health,
    })),
    {
      key: "calibration/models.dev",
      name: "models.dev",
      health: catalog.calibration?.modelsDev.health,
    },
  ];
}

function percentageChange(change: Change): number | undefined {
  if (
    typeof change.before !== "number" ||
    typeof change.after !== "number" ||
    change.before === 0
  ) {
    return undefined;
  }
  return ((change.after - change.before) / change.before) * 100;
}

function formatPercentage(value: number | undefined): string {
  if (value === undefined) return "—";
  const formatted = value.toLocaleString("zh-CN", {
    maximumFractionDigits: 2,
  });
  return `${value > 0 ? "+" : ""}${formatted}%`;
}

function schemaVersions(catalog: Catalog): Map<string, string> {
  return new Map([
    ["api.json", catalog.schemaVersion],
    ...catalog.providers.map(
      (provider) =>
        [`provider/${provider.id}`, provider.schemaVersion] as const,
    ),
    ...(catalog.inventories ?? []).map(
      (inventory) =>
        [`inventory/${inventory.provider}`, inventory.schemaVersion] as const,
    ),
    ...(catalog.calibration?.modelsDev
      ? [
          [
            "calibration/models.dev",
            catalog.calibration.modelsDev.schemaVersion,
          ] as const,
        ]
      : []),
  ]);
}

function sourceUrls(catalog: Catalog): Map<string, string[]> {
  const urls = new Map<string, string[]>();
  for (const provider of catalog.providers) {
    urls.set(
      `provider/${provider.id}`,
      provider.sources.map((source) => source.url).sort(),
    );
  }
  for (const inventory of catalog.inventories ?? []) {
    urls.set(`inventory/${inventory.provider}`, [inventory.source.url]);
  }
  if (catalog.calibration?.modelsDev) {
    urls.set("calibration/models.dev", [
      catalog.calibration.modelsDev.source.url,
    ]);
  }
  return urls;
}

export function highRiskWarnings(
  before: Catalog,
  after: Catalog,
  diff = diffCatalog(before, after),
): string[] {
  const warnings: string[] = [];
  for (const change of diff.prices) {
    const percentage = percentageChange(change);
    if (percentage !== undefined && Math.abs(percentage) > 50) {
      warnings.push(
        `单项价格变化超过 50%：\`${change.provider}/${change.model}\` ${change.field} ${formatPercentage(percentage)}`,
      );
    }
  }

  const oldCounts = new Map(
    before.providers.map((provider) => [provider.id, provider.models.length]),
  );
  const newCounts = new Map(
    after.providers.map((provider) => [provider.id, provider.models.length]),
  );
  for (const [providerId, oldCount] of oldCounts) {
    const newCount = newCounts.get(providerId) ?? 0;
    if ((oldCount - newCount) / oldCount > 0.2) {
      warnings.push(
        `厂商模型数量减少超过 20%：\`${providerId}\` ${oldCount} → ${newCount}`,
      );
    }
  }

  const oldHealth = new Map(
    sourceHealthRows(before).map((source) => [source.key, source]),
  );
  for (const source of sourceHealthRows(after)) {
    if (
      oldHealth.get(source.key)?.health?.status === "healthy" &&
      source.health?.status === "error"
    ) {
      warnings.push(`数据源从 healthy 变为 error：${source.name}`);
    }
  }

  const oldSchemas = schemaVersions(before);
  const newSchemas = schemaVersions(after);
  for (const key of new Set([...oldSchemas.keys(), ...newSchemas.keys()])) {
    if (oldSchemas.get(key) !== newSchemas.get(key)) {
      warnings.push(
        `Schema 版本发生变化：${key} ${oldSchemas.get(key) ?? "无"} → ${newSchemas.get(key) ?? "无"}`,
      );
    }
  }

  const oldUrls = sourceUrls(before);
  const newUrls = sourceUrls(after);
  for (const key of new Set([...oldUrls.keys(), ...newUrls.keys()])) {
    if (!same(oldUrls.get(key), newUrls.get(key))) {
      warnings.push(`官方来源 URL 发生变化：${key}`);
    }
  }
  return warnings;
}

export interface CatalogDiff {
  added: Array<{ provider: string; model: string }>;
  removed: Array<{ provider: string; model: string }>;
  prices: Change[];
  modelInfo: Change[];
  calibration: Change[];
}

function omitVolatileCollectionFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitVolatileCollectionFields);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record)
      .filter(
        ([key]) =>
          ![
            "lastAttemptAt",
            "lastSuccessfulAt",
            "retrievedAt",
            "contentHash",
          ].includes(key),
      )
      .map(([key, child]) => [key, omitVolatileCollectionFields(child)]),
  );
}

export function hasMaterialCatalogChanges(
  before: Catalog,
  after: Catalog,
): boolean {
  return !same(
    omitVolatileCollectionFields(before),
    omitVolatileCollectionFields(after),
  );
}

export function diffCatalog(before: Catalog, after: Catalog): CatalogDiff {
  const oldModels = modelMap(before);
  const newModels = modelMap(after);
  const added = [...newModels]
    .filter(([key]) => !oldModels.has(key))
    .map(([, value]) => ({ provider: value.provider, model: value.model.id }));
  const removed = [...oldModels]
    .filter(([key]) => !newModels.has(key))
    .map(([, value]) => ({ provider: value.provider, model: value.model.id }));
  const prices: Change[] = [];
  const modelInfo: Change[] = [];

  for (const [key, next] of newModels) {
    const previous = oldModels.get(key);
    if (!previous) continue;
    const oldPrices = new Map(
      previous.model.prices.map((price) => [priceKey(price), price]),
    );
    const newPrices = new Map(
      next.model.prices.map((price) => [priceKey(price), price]),
    );
    for (const priceId of new Set([...oldPrices.keys(), ...newPrices.keys()])) {
      const oldPrice = oldPrices.get(priceId);
      const newPrice = newPrices.get(priceId);
      for (const field of [
        "input.standard",
        "input.cacheHit",
        "input.explicitCacheCreation",
        "input.explicitCacheHit",
        "output",
      ] as const) {
        const read = (price: ModelPrice | undefined) => {
          if (field === "output") return price?.output;
          if (field === "input.standard") return price?.input.standard;
          if (field === "input.cacheHit") return price?.input.cacheHit;
          if (field === "input.explicitCacheCreation")
            return price?.input.explicitCacheCreation;
          return price?.input.explicitCacheHit;
        };
        if (!same(read(oldPrice), read(newPrice))) {
          const currency = newPrice?.currency ?? oldPrice?.currency;
          prices.push({
            provider: next.provider,
            model: next.model.id,
            field,
            before: read(oldPrice),
            after: read(newPrice),
            ...(currency ? { currency } : {}),
          });
        }
      }
    }
    for (const field of [
      "name",
      "createdAt",
      "tokenizer",
      "aliases",
      "capabilities",
      "limits",
    ] as const) {
      const oldValue = previous.model[field];
      const newValue = next.model[field];
      if (!same(oldValue, newValue)) {
        modelInfo.push({
          provider: next.provider,
          model: next.model.id,
          field,
          before: oldValue,
          after: newValue,
        });
      }
    }
  }

  const calibrationRows = (catalog: Catalog) =>
    new Map(
      (catalog.calibration?.modelsDev.models ?? []).flatMap((model) =>
        model.checks.map((check) => [
          `${model.provider}/${model.model}/${check.field}`,
          { provider: model.provider, model: model.model, check },
        ]),
      ),
    );
  const oldCalibration = calibrationRows(before);
  const newCalibration = calibrationRows(after);
  const calibration: Change[] = [];
  for (const key of new Set([
    ...oldCalibration.keys(),
    ...newCalibration.keys(),
  ])) {
    const oldValue = oldCalibration.get(key);
    const newValue = newCalibration.get(key);
    if (!same(oldValue?.check, newValue?.check)) {
      calibration.push({
        provider: newValue?.provider ?? oldValue!.provider,
        model: newValue?.model ?? oldValue!.model,
        field: newValue?.check.field ?? oldValue!.check.field,
        before: oldValue?.check,
        after: newValue?.check,
      });
    }
  }

  return { added, removed, prices, modelInfo, calibration };
}

function changeTable(changes: Change[]): string {
  if (!changes.length) return "无。";
  const rows = changes.map(
    (change) =>
      `| ${cell(change.provider)} | ${cell(change.model)} | ${cell(change.field)} | ${cell(display(change.before, change.currency))} | ${cell(display(change.after, change.currency))} |`,
  );
  return [
    "| 厂商 | 模型 | 字段 | 旧值 | 新值 |",
    "|---|---|---|---:|---:|",
    ...rows,
  ].join("\n");
}

function priceChangeTable(changes: Change[]): string {
  if (!changes.length) return "无。";
  const rows = changes.map(
    (change) =>
      `| ${cell(change.provider)} | ${cell(change.model)} | ${cell(change.field)} | ${cell(display(change.before, change.currency))} | ${cell(display(change.after, change.currency))} | ${formatPercentage(percentageChange(change))} |`,
  );
  return [
    "| 厂商 | 模型 | 字段 | 原值 | 新值 | 变化 |",
    "|---|---|---|---:|---:|---:|",
    ...rows,
  ].join("\n");
}

function sourceHealthTable(catalog: Catalog): string {
  return [
    "| 数据源 | 状态 | 最近成功时间 |",
    "|---|---|---|",
    ...sourceHealthRows(catalog).map((source) => {
      const status = source.health?.status ?? "missing";
      const message = source.health?.message
        ? ` — ${source.health.message}`
        : "";
      return `| ${cell(source.name)} | ${cell(`${status}${message}`)} | ${source.health?.lastSuccessfulAt ?? "—"} |`;
    }),
  ].join("\n");
}

export function renderUpdateReport(before: Catalog, after: Catalog): string {
  const diff = diffCatalog(before, after);
  const changedModels = new Set(
    diff.modelInfo.map((change) => `${change.provider}/${change.model}`),
  ).size;
  const sources = sourceHealthRows(after);
  const sourceAnomalies = sources.filter(
    (source) => source.health?.status !== "healthy",
  ).length;
  const risks = highRiskWarnings(before, after, diff);
  return `## 数据更新摘要

- 新增模型：${diff.added.length}
- 下线模型：${diff.removed.length}
- 价格变化：${diff.prices.length}
- 模型信息变化：${changedModels}
- 校准差异：${diff.calibration.length}
- 数据源异常：${sourceAnomalies}

### 价格变化

${priceChangeTable(diff.prices)}

### 模型清单

- 新增：${diff.added.length ? diff.added.map((item) => `\`${item.provider}/${item.model}\``).join("、") : "无"}
- 下线：${diff.removed.length ? diff.removed.map((item) => `\`${item.provider}/${item.model}\``).join("、") : "无"}

### 模型信息变化

${changeTable(diff.modelInfo)}

### 校准变化

${changeTable(diff.calibration)}

### 数据源状态

${sourceHealthTable(after)}

### 高风险提示

${risks.length ? risks.map((risk) => `- ⚠️ ${risk}`).join("\n") : "- 无。"}

> 此报告由自动更新工作流生成。健康状态记录最近一次尝试、最近一次成功和连续失败次数。
`;
}
