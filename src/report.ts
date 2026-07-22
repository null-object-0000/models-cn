import type {
  Catalog,
  ModelData,
  ModelPrice,
  ProviderHealth,
} from "./types.js";

type Change = {
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

function statusLabel(health: ProviderHealth | undefined): string {
  if (!health) return "❌ 缺少健康状态";
  if (health.status === "healthy") return "✅ 成功";
  const message = health.message ? `：${health.message}` : "";
  return `${health.status === "stale" ? "⚠️ 过期" : "❌ 失败"}${message}`;
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
        "output",
      ] as const) {
        const read = (price: ModelPrice | undefined) =>
          field === "output"
            ? price?.output
            : field === "input.standard"
              ? price?.input.standard
              : price?.input.cacheHit;
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

export function renderUpdateReport(before: Catalog, after: Catalog): string {
  const diff = diffCatalog(before, after);
  const pricingHealth = after.providers
    .map((provider) => `${provider.id} ${statusLabel(provider.health)}`)
    .join("；");
  const inventoryHealth = (after.inventories ?? [])
    .map(
      (inventory) => `${inventory.provider} ${statusLabel(inventory.health)}`,
    )
    .join("；");
  return `## 更新摘要

- 新增模型：${diff.added.length}
- 下线模型：${diff.removed.length}
- 价格变化：${diff.prices.length}
- 模型信息变化：${diff.modelInfo.length}
- 校准差异：${diff.calibration.length}

### 新增与下线

${diff.added.length ? diff.added.map((item) => `- 新增 \`${item.provider}/${item.model}\``).join("\n") : "- 新增：无"}
${diff.removed.length ? diff.removed.map((item) => `- 下线 \`${item.provider}/${item.model}\``).join("\n") : "- 下线：无"}

### 价格变化

${changeTable(diff.prices)}

### 模型信息变化

${changeTable(diff.modelInfo)}

### 校准变化

${changeTable(diff.calibration)}

### 数据源

- 官方价格页：${pricingHealth || "❌ 无采集记录"}
- Models API：${inventoryHealth || "⚠️ 未配置"}
- models.dev 校准：${statusLabel(after.calibration?.modelsDev.health)}

> 此报告由自动更新工作流生成。健康状态记录最近一次尝试、最近一次成功和连续失败次数。
`;
}
