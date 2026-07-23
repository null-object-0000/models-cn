import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  buildMergedGroups,
  compareModelsByReleaseDate,
  modelDomId,
  modelHash,
  modelKey,
  providerName,
  type MergedGroup,
  type VersionViewMode,
} from "../lib/catalog";
import type { CalibrationModel, Catalog, Currency } from "../types";
import { ModelRow } from "./ModelRow";

export function CatalogSection({ catalog }: { catalog: Catalog }) {
  const [currency, setCurrency] = useState<Currency>("CNY");
  const [providerFilter, setProviderFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [versionView, setVersionView] = useState<VersionViewMode>("merged");
  const [expanded, setExpanded] = useState<string | null>(
    () => decodeURIComponent(window.location.hash.slice(1)) || null,
  );
  const searchRef = useRef<HTMLInputElement>(null);
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
          modelKey(item.provider, item.model),
          item,
        ]) ?? [],
      ),
    [catalog],
  );
  const matchesSearch = useMemo(() => {
    return (
      provider: (typeof models)[0]["provider"],
      model: (typeof models)[0]["model"],
    ) => {
      const capabilities = Object.values(model.capabilities).flat().join(" ");
      const aliases = model.aliases.map((alias) => alias.id).join(" ");
      return `${providerName(provider)} ${provider.name} ${provider.displayNames?.en ?? ""} ${provider.id} ${model.name} ${model.id} ${aliases} ${capabilities}`
        .toLowerCase()
        .includes(deferredSearch);
    };
  }, [deferredSearch]);

  const filtered = useMemo(
    () =>
      models.filter(({ provider, model }) => matchesSearch(provider, model)),
    [models, matchesSearch],
  );

  const providerPassesFilter = useMemo(() => {
    return (providerId: string) => {
      if (providerFilter === "all") return true;
      if (versionView === "merged") {
        return (
          providerId === providerFilter ||
          providerId.startsWith(`${providerFilter}-`)
        );
      }
      return providerId === providerFilter;
    };
  }, [providerFilter, versionView]);

  const groups: MergedGroup[] = useMemo(
    () =>
      buildMergedGroups(
        catalog.providers,
        calibrationMap,
        (provider, model) =>
          providerPassesFilter(provider.id) && matchesSearch(provider, model),
        versionView,
      ).filter((group) => group.models.length > 0),
    [
      catalog.providers,
      calibrationMap,
      providerPassesFilter,
      matchesSearch,
      versionView,
    ],
  );

  const providerSelectOptions = useMemo(() => {
    if (versionView === "merged") {
      const seen = new Set<string>();
      return catalog.providers
        .map((provider) => {
          const match = provider.id.match(/^(.+)-(cn|intl)$/);
          return match?.[1] ?? provider.id;
        })
        .filter((base) => {
          if (seen.has(base)) return false;
          seen.add(base);
          return true;
        })
        .map((base) => {
          const representative = catalog.providers.find(
            (p) =>
              p.id === `${base}-cn` || p.id === `${base}-intl` || p.id === base,
          );
          return {
            value: base,
            label: representative ? providerName(representative) : base,
          };
        });
    }
    return catalog.providers.map((provider) => ({
      value: provider.id,
      label: providerName(provider),
    }));
  }, [catalog.providers, versionView]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "/" && document.activeElement !== searchRef.current) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape" && expanded) setExpanded(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  useEffect(() => {
    const [providerId, modelId] = expanded?.split("/", 2) ?? [];
    const nextUrl = expanded
      ? `${window.location.pathname}${window.location.search}#${modelHash(providerId!, modelId!)}`
      : `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", nextUrl);
  }, [expanded]);

  const toggleModel = (key: string) => {
    const willExpand = expanded !== key;
    setExpanded(willExpand ? key : null);
    if (willExpand) {
      const [providerId, modelId] = key.split("/", 2);
      window.requestAnimationFrame(() =>
        document
          .getElementById(modelDomId(providerId!, modelId!))
          ?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          }),
      );
    }
  };

  return (
    <section className="catalog-section" id="models">
      <div className="shell">
        <div className="section-heading">
          <div>
            <p className="section-index">01 / CATALOG</p>
            <h2>官方模型与定价</h2>
          </div>
          <p>
            默认一行展示关键价格；点击模型行即可在当前位置展开完整定价、能力、来源和校准信息。
          </p>
        </div>
        <div className="catalog-wrap">
          <div className="toolbar" aria-label="模型筛选">
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input
                ref={searchRef}
                id="model-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索厂商或模型名称，按 / 聚焦"
                autoComplete="off"
                aria-label="搜索厂商或模型名称"
              />
            </label>
            <select
              className="provider-select"
              value={providerFilter}
              onChange={(event) => {
                setProviderFilter(event.target.value);
                setExpanded(null);
              }}
              aria-label="筛选厂商"
            >
              <option value="all">全部厂商</option>
              {providerSelectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="provider-select"
              value={versionView}
              onChange={(event) =>
                setVersionView(event.target.value as VersionViewMode)
              }
              aria-label="版本展示"
            >
              <option value="merged">合并区域版本</option>
              <option value="separate">分开显示版本</option>
            </select>
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
          </div>
          <div className="result-meta">
            <span>
              显示 <strong>{filtered.length}</strong> / {models.length} 个模型
            </span>
            <span>官方实时数据 · 不使用汇率换算填补缺失价格</span>
          </div>
          <div className="table-shell">
            {groups.length ? (
              <div className="table-scroll">
                <table aria-label="模型目录">
                  <thead>
                    <tr>
                      <th>模型</th>
                      <th>上下文</th>
                      <th className="num">输入</th>
                      <th className="num">缓存命中</th>
                      <th className="num">输出</th>
                      <th>能力</th>
                      <th>校准</th>
                      <th aria-label="展开详情" />
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group, index) => (
                      <ModelRow.Group
                        key={group.id}
                        group={group}
                        groupIndex={index}
                        currency={currency}
                        expanded={expanded}
                        onToggle={toggleModel}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-state">没有找到符合条件的模型。</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
