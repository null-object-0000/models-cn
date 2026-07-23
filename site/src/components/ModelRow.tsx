import { Fragment, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  capabilityLabels,
  compactTokens,
  formatPrice,
  formatPriceRange,
  isPriceRange,
  modelDomId,
  modelKey,
  numberFormatter,
  providerName,
  type MergedGroup,
  type MergedModel,
  type RegionModel,
} from "../lib/catalog";
import type { CalibrationModel, Currency, Model, Provider } from "../types";
import { CalibrationBadge } from "./CalibrationBadge";

type GroupProps = {
  group: MergedGroup;
  groupIndex: number;
  currency: Currency;
  expanded: string | null;
  onToggle: (key: string) => void;
};

function Group({
  group,
  groupIndex,
  currency,
  expanded,
  onToggle,
}: GroupProps) {
  return (
    <>
      <tr className="provider-row">
        <td colSpan={8}>
          <div className="provider-head">
            <div>
              <div className="provider-kicker">
                {String(groupIndex + 1).padStart(2, "0")} / PROVIDER
              </div>
              <div className="provider-name">{group.displayName}</div>
            </div>
            <div className="provider-count">{group.models.length} 个模型</div>
          </div>
        </td>
      </tr>
      {group.models.map((mergedModel) => {
        const key = `${group.id}/${mergedModel.id}`;
        const active = selectRegionModel(mergedModel, currency);
        return (
          <ModelRows
            key={key}
            mergedModel={mergedModel}
            active={active}
            group={group}
            currency={currency}
            expanded={expanded === key}
            onToggle={onToggle}
          />
        );
      })}
    </>
  );
}

function selectRegionModel(
  merged: MergedModel,
  currency: Currency,
): RegionModel | undefined {
  if (currency === "CNY") {
    return merged.cn ?? merged.intl;
  }
  return merged.intl ?? merged.cn;
}

function ModelRows({
  mergedModel,
  active,
  group,
  currency,
  expanded,
  onToggle,
}: {
  mergedModel: MergedModel;
  active: RegionModel | undefined;
  group: MergedGroup;
  currency: Currency;
  expanded: boolean;
  onToggle: (key: string) => void;
}) {
  const model =
    active?.model ?? mergedModel.cn?.model ?? mergedModel.intl?.model;
  if (!model) return null;

  const selected = model.prices.filter((price) => price.currency === currency);
  const promotionalPrices = selected.filter(
    (price) => price.rateType === "promotional",
  );
  const standardPrices = selected.filter(
    (price) => price.rateType === "standard",
  );
  const hasPromotional = promotionalPrices.length > 0;
  const summaryPrices = hasPromotional ? promotionalPrices : standardPrices;
  const referencePrices = hasPromotional ? standardPrices : [];
  const capabilities = capabilityLabels(model.capabilities);
  const source =
    summaryPrices[0]?.sourceUrl ??
    selected[0]?.sourceUrl ??
    model.prices[0]?.sourceUrl;
  const provider = active?.provider ?? group.cn ?? group.intl;
  const retrievedAt = provider
    ? (provider.sources
        .filter((item) => !source || item.url === source)
        .map((item) => item.retrievedAt)
        .sort()
        .at(-1) ??
      provider.sources
        .map((item) => item.retrievedAt)
        .sort()
        .at(-1))
    : undefined;
  const priceUnit = currency === "CNY" ? "人民币 / 1M" : "美元 / 1M";
  const key = `${group.id}/${mergedModel.id}`;
  const regionLabel = active
    ? active.region === "cn"
      ? "国内版"
      : "国际版"
    : null;
  const showDifferenceWarning =
    group.merged &&
    mergedModel.cn &&
    mergedModel.intl &&
    !mergedModel.mergeable;

  const activate = (event: MouseEvent<HTMLTableRowElement>) => {
    if ((event.target as HTMLElement).closest("a, button")) return;
    onToggle(key);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggle(key);
    }
  };

  return (
    <Fragment>
      <tr
        id={modelDomId(group.id, mergedModel.id)}
        className="model-row"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={activate}
        onKeyDown={onKeyDown}
      >
        <td className="model-main">
          <div className="model-title">{model.name}</div>
          <div className="model-id">
            {model.id}
            {regionLabel ? (
              <span className="region-tag">{regionLabel}</span>
            ) : null}
            {hasPromotional ? <span className="promo-tag">优惠</span> : null}
          </div>
          {showDifferenceWarning ? (
            <div className="merge-warning">国内版 / 国际版存在差异</div>
          ) : null}
        </td>
        <td>
          <strong>{compactTokens(model.limits.contextTokens)}</strong>
          <div className="model-id">
            输出 {compactTokens(model.limits.maxOutputTokens)}
          </div>
        </td>
        <PriceCell
          values={summaryPrices.map((price) => price.input.standard)}
          referenceValues={referencePrices.map((price) => price.input.standard)}
          currency={currency}
          unit={priceUnit}
        />
        <PriceCell
          values={summaryPrices.map((price) => price.input.cacheHit)}
          referenceValues={referencePrices.map((price) => price.input.cacheHit)}
          fallbackValues={summaryPrices.map(
            (price) =>
              price.input.explicitCacheCreation ?? price.input.explicitCacheHit,
          )}
          fallbackLabel="显式缓存"
          currency={currency}
          unit={priceUnit}
        />
        <PriceCell
          values={summaryPrices.map((price) => price.output)}
          referenceValues={referencePrices.map((price) => price.output)}
          currency={currency}
          unit={priceUnit}
        />
        <td>
          <div className="tags">
            {capabilities.slice(0, 4).map((label) => (
              <span className="tag" key={label}>
                {label}
              </span>
            ))}
          </div>
        </td>
        <td>
          <CalibrationBadge calibration={active?.calibration} />
        </td>
        <td className="num">
          <button
            className="expand-button"
            type="button"
            aria-label={`${expanded ? "收起" : "展开"} ${model.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(key);
            }}
          >
            +
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr className="details-row">
          <td colSpan={8}>
            <div className="details-panel">
              <section className="detail-block">
                <h3 className="detail-title">
                  Pricing · {currency === "CNY" ? "人民币" : "美元"} / 1M Tokens
                </h3>
                {selected.length ? (
                  <PriceDetails prices={selected} currency={currency} />
                ) : (
                  <div className="calibration">
                    该厂商没有公开的官方{currency === "CNY" ? "人民币" : "美元"}
                    价，因此不使用汇率换算结果填充。
                  </div>
                )}
              </section>
              <section className="detail-block">
                <h3 className="detail-title">Model information</h3>
                <dl className="kv">
                  <dt>模型 ID</dt>
                  <dd>
                    <code>{model.id}</code>
                  </dd>
                  <dt>上下文</dt>
                  <dd>{compactTokens(model.limits.contextTokens)}</dd>
                  <dt>最大输出</dt>
                  <dd>{compactTokens(model.limits.maxOutputTokens)}</dd>
                  <dt>并发</dt>
                  <dd>
                    {model.limits.concurrency
                      ? numberFormatter.format(model.limits.concurrency)
                      : "—"}
                  </dd>
                  {model.limits.requestsPerMinute ? (
                    <>
                      <dt>RPM</dt>
                      <dd>
                        {numberFormatter.format(model.limits.requestsPerMinute)}
                      </dd>
                    </>
                  ) : null}
                  {model.limits.tokensPerMinute ? (
                    <>
                      <dt>TPM</dt>
                      <dd>
                        {numberFormatter.format(model.limits.tokensPerMinute)}
                      </dd>
                    </>
                  ) : null}
                  <dt>兼容别名</dt>
                  <dd>
                    {model.aliases.length
                      ? model.aliases.map((alias) => alias.id).join("、")
                      : "—"}
                  </dd>
                </dl>
                <div className="cap-list">
                  {capabilities.map((label) => (
                    <span className="tag" key={label}>
                      {label}
                    </span>
                  ))}
                </div>
              </section>
              <section className="detail-block">
                <h3 className="detail-title">Source & calibration</h3>
                <dl className="kv">
                  {group.merged ? (
                    <>
                      <dt>渠道版本</dt>
                      <dd>{regionLabel ?? "—"}</dd>
                      <dt>计价币种</dt>
                      <dd>{currency === "CNY" ? "CNY 人民币" : "USD 美元"}</dd>
                    </>
                  ) : null}
                  <dt>数据来源</dt>
                  <dd>
                    {source ? (
                      <a
                        className="source-link"
                        href={source}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看厂商官方来源 ↗
                      </a>
                    ) : (
                      "—"
                    )}
                  </dd>
                  <dt>采集时间</dt>
                  <dd>
                    {retrievedAt
                      ? new Date(retrievedAt).toLocaleString("zh-CN", {
                          timeZone: "Asia/Shanghai",
                        })
                      : "—"}
                  </dd>
                  <dt>校准状态</dt>
                  <dd>
                    <CalibrationBadge calibration={active?.calibration} />
                  </dd>
                </dl>
                <CalibrationNote calibration={active?.calibration} />
              </section>
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function PriceCell({
  values,
  referenceValues,
  fallbackValues,
  fallbackLabel,
  currency,
  unit,
}: {
  values: Array<number | undefined>;
  referenceValues?: Array<number | undefined>;
  fallbackValues?: Array<number | undefined>;
  fallbackLabel?: string;
  currency: Currency;
  unit: string;
}) {
  const displayPrice = formatPriceRange(values, currency);
  const referencePrice = referenceValues
    ? formatPriceRange(referenceValues, currency)
    : undefined;
  let fallbackPrice: string | undefined;
  if (!displayPrice && fallbackValues) {
    fallbackPrice = formatPriceRange(fallbackValues, currency);
  }
  const label = displayPrice
    ? unit
    : fallbackPrice
      ? (fallbackLabel ?? unit)
      : "未公开官方价";
  const displayIsRange = isPriceRange(values);
  const referenceIsRange = referenceValues
    ? isPriceRange(referenceValues)
    : false;
  const stackPrices = displayIsRange || referenceIsRange;
  return (
    <td className="num">
      <span className="price">
        {displayPrice && referencePrice && stackPrices ? (
          <span className="reference-price">{referencePrice}</span>
        ) : null}
        {displayPrice && referencePrice && !stackPrices ? (
          <span className="price-inline">
            <span className="reference-price-inline">{referencePrice}</span>
            <span>{displayPrice}</span>
          </span>
        ) : (
          <span>{displayPrice ?? fallbackPrice ?? "—"}</span>
        )}
        <small>{label}</small>
      </span>
    </td>
  );
}

function PriceDetails({
  prices,
  currency,
}: {
  prices: Model["prices"];
  currency: Currency;
}) {
  const hasExplicitCacheCreation = prices.some(
    (price) => price.input.explicitCacheCreation !== undefined,
  );
  const hasExplicitCacheHit = prices.some(
    (price) => price.input.explicitCacheHit !== undefined,
  );
  const hasExplicitCache = hasExplicitCacheCreation || hasExplicitCacheHit;
  const hasImplicitCache = prices.some(
    (price) => price.input.cacheHit !== undefined,
  );
  const [cacheMode, setCacheMode] = useState<"implicit" | "explicit">(() =>
    hasImplicitCache ? "implicit" : "explicit",
  );

  const grouped = new Map<string, Model["prices"]>();
  for (const price of prices) {
    const key = price.inputTokenRange?.label ?? "";
    const existing = grouped.get(key) ?? [];
    existing.push(price);
    grouped.set(key, existing);
  }

  const renderWithReference = (
    value: number | undefined,
    referenceValue: number | undefined,
  ) => {
    if (value === undefined) return <span>—</span>;
    const formatted = formatPrice(value, currency);
    if (referenceValue === undefined) {
      return <strong>{formatted}</strong>;
    }
    return (
      <div className="price-with-reference">
        <span className="reference-price-inline">
          {formatPrice(referenceValue, currency)}
        </span>
        <strong>{formatted}</strong>
      </div>
    );
  };

  const renderRow = (groupPrices: Model["prices"], label: string) => {
    const promotional = groupPrices.find((p) => p.rateType === "promotional");
    const standard = groupPrices.find((p) => p.rateType === "standard");
    const primary = promotional ?? standard;
    if (!primary) return null;

    return (
      <Fragment key={label}>
        <div className="row-label">{label || "—"}</div>
        <div>
          {renderWithReference(
            primary.input.standard,
            promotional ? standard?.input.standard : undefined,
          )}
        </div>
        {cacheMode === "implicit" ? (
          <div>
            {renderWithReference(
              primary.input.cacheHit,
              promotional ? standard?.input.cacheHit : undefined,
            )}
          </div>
        ) : (
          <div className="explicit-cache-prices">
            <span>
              <small>创建</small>
              {renderWithReference(
                primary.input.explicitCacheCreation,
                promotional ? standard?.input.explicitCacheCreation : undefined,
              )}
            </span>
            <span>
              <small>命中</small>
              {renderWithReference(
                primary.input.explicitCacheHit,
                promotional ? standard?.input.explicitCacheHit : undefined,
              )}
            </span>
          </div>
        )}
        <div>
          {renderWithReference(
            primary.output,
            promotional ? standard?.output : undefined,
          )}
        </div>
      </Fragment>
    );
  };

  return (
    <>
      {hasExplicitCache ? (
        <div className="price-toolbar">
          <label className="price-toolbar-field">
            <span>缓存计费</span>
            <select
              value={cacheMode}
              onChange={(event) =>
                setCacheMode(event.target.value as "implicit" | "explicit")
              }
              aria-label="缓存价格类型"
            >
              {hasImplicitCache ? (
                <option value="implicit">隐式缓存</option>
              ) : null}
              <option value="explicit">显式缓存</option>
            </select>
          </label>
        </div>
      ) : null}
      <div
        className="price-table"
        aria-label={`${cacheMode === "explicit" ? "显式" : "隐式"}缓存价格详情`}
      >
        <div className="head">输入区间</div>
        <div className="head">输入</div>
        <div className="head">
          {cacheMode === "explicit" ? "显式缓存" : "缓存命中"}
        </div>
        <div className="head">输出</div>
        {Array.from(grouped.entries()).map(([label, groupPrices]) =>
          renderRow(groupPrices, label),
        )}
      </div>
    </>
  );
}

function CalibrationNote({
  calibration,
}: {
  calibration: CalibrationModel | undefined;
}) {
  if (!calibration)
    return (
      <div className="calibration neutral">暂无 models.dev 校准记录。</div>
    );
  const differences = calibration.checks.filter(
    (check) => check.status === "mismatch",
  );
  if (!differences.length)
    return (
      <div className="calibration neutral">
        当前可比字段一致；未公开字段不使用推断值补齐。
      </div>
    );
  return (
    <div className="calibration">
      {differences
        .map(
          (check) =>
            `${check.field}：官方 ${String(check.official)} / models.dev ${String(check.reference)}`,
        )
        .join("；")}
    </div>
  );
}

export const ModelRow = { Group };
