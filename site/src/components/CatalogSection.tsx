import { useDeferredValue, useMemo, useState } from "react";
import { compareModelsByReleaseDate, providerName } from "../lib/catalog";
import type { CalibrationModel, Catalog, Currency, RateType } from "../types";
import { ModelRow } from "./ModelRow";

export function CatalogSection({ catalog }: { catalog: Catalog }) {
  const [currency, setCurrency] = useState<Currency>("CNY");
  const [rateType, setRateType] = useState<RateType>("promotional");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const models = useMemo(
    () =>
      catalog.providers.flatMap((provider) =>
        provider.models.map((model) => ({ provider, model })),
      ),
    [catalog],
  );
  const calibrationMap = useMemo(
    () =>
      new Map<string, CalibrationModel>(
        catalog.calibration?.modelsDev.models.map((item) => [
          `${item.provider}/${item.model}`,
          item,
        ]) ?? [],
      ),
    [catalog],
  );
  const filtered = useMemo(
    () =>
      models.filter(({ provider, model }) =>
        `${providerName(provider)} ${provider.name} ${provider.displayNames?.en ?? ""} ${provider.id} ${model.name} ${model.id}`
          .toLowerCase()
          .includes(deferredSearch),
      ),
    [deferredSearch, models],
  );
  const groups = catalog.providers
    .map((provider) => ({
      provider,
      models: filtered
        .filter((item) => item.provider.id === provider.id)
        .map((item) => ({
          model: item.model,
          calibration: calibrationMap.get(`${provider.id}/${item.model.id}`),
        }))
        .sort(compareModelsByReleaseDate),
    }))
    .filter((group) => group.models.length > 0);

  return (
    <section className="catalog-section" id="models">
      <div className="section-heading">
        <div>
          <p className="section-index">01 / CATALOG</p>
          <h2>官方模型与定价</h2>
        </div>
        <p>
          价格单位统一为每百万 Tokens。官方数据优先，models.dev
          仅用于逐字段校准。
        </p>
      </div>
      <div className="toolbar">
        <label className="search-box">
          <span>搜索</span>
          <input
            id="model-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="厂商或模型名称"
          />
        </label>
        <div className="segment" aria-label="货币">
          <button
            aria-pressed={currency === "CNY"}
            onClick={() => setCurrency("CNY")}
          >
            CNY 人民币
          </button>
          <button
            aria-pressed={currency === "USD"}
            onClick={() => setCurrency("USD")}
          >
            USD 美元
          </button>
        </div>
        <div className="segment" aria-label="价格类型">
          <button
            aria-pressed={rateType === "promotional"}
            onClick={() => setRateType("promotional")}
          >
            当前优惠
          </button>
          <button
            aria-pressed={rateType === "standard"}
            onClick={() => setRateType("standard")}
          >
            标准价格
          </button>
        </div>
      </div>
      <p className="result-count">
        显示 {filtered.length} / {models.length} 个模型
      </p>
      <div className="provider-groups">
        {groups.length ? (
          groups.map(({ provider, models: providerModels }, index) => (
            <section
              className="provider-group"
              aria-labelledby={`provider-${provider.id}`}
              key={provider.id}
            >
              <div className="provider-heading">
                <div>
                  <p>{String(index + 1).padStart(2, "0")} / PROVIDER</p>
                  <h3 id={`provider-${provider.id}`}>
                    {providerName(provider)}
                  </h3>
                </div>
                <span>{providerModels.length} 个模型</span>
              </div>
              <div className="model-list">
                {providerModels.map(({ model, calibration }) => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    currency={currency}
                    rateType={rateType}
                    calibration={calibration}
                  />
                ))}
              </div>
            </section>
          ))
        ) : (
          <p className="empty-state">没有匹配的模型。</p>
        )}
      </div>
    </section>
  );
}
