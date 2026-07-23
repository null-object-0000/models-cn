import { Fragment, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  capabilityLabels,
  compactTokens,
  formatPrice,
  formatPriceRange,
  modelDomId,
  modelKey,
  numberFormatter,
  providerName,
} from "../lib/catalog";
import type {
  CalibrationModel,
  Currency,
  Model,
  Provider,
  RateType,
} from "../types";
import { CalibrationBadge } from "./CalibrationBadge";

type ModelItem = { model: Model; calibration: CalibrationModel | undefined };
type GroupProps = {
  provider: Provider;
  models: ModelItem[];
  groupIndex: number;
  currency: Currency;
  rateType: RateType;
  expanded: string | null;
  onToggle: (key: string) => void;
};

function Group({
  provider,
  models,
  groupIndex,
  currency,
  rateType,
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
              <div className="provider-name">{providerName(provider)}</div>
            </div>
            <div className="provider-count">{models.length} 个模型</div>
          </div>
        </td>
      </tr>
      {models.map(({ model, calibration }) => (
        <ModelRows
          key={modelKey(provider.id, model.id)}
          provider={provider}
          model={model}
          calibration={calibration}
          currency={currency}
          rateType={rateType}
          expanded={expanded === modelKey(provider.id, model.id)}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

function ModelRows({
  provider,
  model,
  calibration,
  currency,
  rateType,
  expanded,
  onToggle,
}: {
  provider: Provider;
  model: Model;
  calibration: CalibrationModel | undefined;
  currency: Currency;
  rateType: RateType;
  expanded: boolean;
  onToggle: (key: string) => void;
}) {
  const selected = model.prices.filter((price) => price.currency === currency);
  const preferredRate: RateType = selected.some(
    (price) => price.rateType === rateType,
  )
    ? rateType
    : "standard";
  const summaryPrices = selected.filter(
    (price) => price.rateType === preferredRate,
  );
  const capabilities = capabilityLabels(model.capabilities);
  const source =
    summaryPrices[0]?.sourceUrl ??
    selected[0]?.sourceUrl ??
    model.prices[0]?.sourceUrl;
  const retrievedAt =
    provider.sources
      .filter((item) => !source || item.url === source)
      .map((item) => item.retrievedAt)
      .sort()
      .at(-1) ??
    provider.sources
      .map((item) => item.retrievedAt)
      .sort()
      .at(-1);
  const priceUnit = currency === "CNY" ? "人民币 / 1M" : "美元 / 1M";
  const key = modelKey(provider.id, model.id);

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
        id={modelDomId(provider.id, model.id)}
        className="model-row"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={activate}
        onKeyDown={onKeyDown}
      >
        <td className="model-main">
          <div className="model-title">{model.name}</div>
          <div className="model-id">{model.id}</div>
        </td>
        <td>
          <strong>{compactTokens(model.limits.contextTokens)}</strong>
          <div className="model-id">
            输出 {compactTokens(model.limits.maxOutputTokens)}
          </div>
        </td>
        <PriceCell
          values={summaryPrices.map((price) => price.input.standard)}
          currency={currency}
          unit={priceUnit}
        />
        <PriceCell
          values={summaryPrices.map((price) => price.input.cacheHit)}
          fallbackValues={summaryPrices.map(
            (price) =>
              price.input.explicitCacheCreation ??
              price.input.explicitCacheHit,
          )}
          fallbackLabel="显式缓存"
          currency={currency}
          unit={priceUnit}
        />
        <PriceCell
          values={summaryPrices.map((price) => price.output)}
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
          <CalibrationBadge calibration={calibration} />
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
                    <CalibrationBadge calibration={calibration} />
                  </dd>
                </dl>
                <CalibrationNote calibration={calibration} />
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
  fallbackValues,
  fallbackLabel,
  currency,
  unit,
}: {
  values: Array<number | undefined>;
  fallbackValues?: Array<number | undefined>;
  fallbackLabel?: string;
  currency: Currency;
  unit: string;
}) {
  const displayPrice = formatPriceRange(values, currency);
  let fallbackPrice: string | undefined;
  if (!displayPrice && fallbackValues) {
    fallbackPrice = formatPriceRange(fallbackValues, currency);
  }
  const label = displayPrice
    ? unit
    : fallbackPrice
      ? fallbackLabel ?? unit
      : "未公开官方价";
  return (
    <td className="num">
      <span className="price">
        {displayPrice ?? fallbackPrice ?? "—"}
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
  const sorted = [...prices].sort((a, b) =>
    a.rateType.localeCompare(b.rateType),
  );
  const hasExplicitCacheCreation = sorted.some(
    (price) => price.input.explicitCacheCreation !== undefined,
  );
  const hasExplicitCacheHit = sorted.some(
    (price) => price.input.explicitCacheHit !== undefined,
  );
  const hasExplicitCache = hasExplicitCacheCreation || hasExplicitCacheHit;
  const hasImplicitCache = sorted.some(
    (price) => price.input.cacheHit !== undefined,
  );
  const [cacheMode, setCacheMode] = useState<"implicit" | "explicit">(() =>
    hasImplicitCache ? "implicit" : "explicit",
  );
  return (
    <>
      {hasExplicitCache ? (
        <div className="cache-mode-toolbar">
          <span>缓存计费</span>
          <div className="cache-mode-switch" aria-label="缓存价格类型">
            <button
              type="button"
              aria-pressed={cacheMode === "implicit"}
              onClick={() => setCacheMode("implicit")}
            >
              隐式缓存
            </button>
            <button
              type="button"
              aria-pressed={cacheMode === "explicit"}
              onClick={() => setCacheMode("explicit")}
            >
              显式缓存
            </button>
          </div>
        </div>
      ) : null}
      <div
        className="price-table"
        aria-label={`${cacheMode === "explicit" ? "显式" : "隐式"}缓存价格详情`}
      >
        <div className="head">价格类型</div>
        <div className="head">输入</div>
        <div className="head">
          {cacheMode === "explicit" ? "显式缓存" : "缓存命中"}
        </div>
        <div className="head">输出</div>
        {sorted.map((price, index) => (
          <Fragment key={`${price.sourceUrl}-${price.rateType}-${index}`}>
            <div className="row-label">
              {price.rateType === "promotional" ? "当前价格" : "标准价格"}
              {price.inputTokenRange ? (
                <small>{price.inputTokenRange.label}</small>
              ) : null}
            </div>
            <div>
              <strong>{formatPrice(price.input.standard, currency)}</strong>
            </div>
            {cacheMode === "implicit" ? (
              <div>
                <strong>
                  {price.input.cacheHit === undefined
                    ? "—"
                    : formatPrice(price.input.cacheHit, currency)}
                </strong>
              </div>
            ) : (
              <div className="explicit-cache-prices">
                <span>
                  <small>创建</small>
                  <strong>
                    {price.input.explicitCacheCreation === undefined
                      ? "—"
                      : formatPrice(
                          price.input.explicitCacheCreation,
                          currency,
                        )}
                  </strong>
                </span>
                <span>
                  <small>命中</small>
                  <strong>
                    {price.input.explicitCacheHit === undefined
                      ? "—"
                      : formatPrice(price.input.explicitCacheHit, currency)}
                  </strong>
                </span>
              </div>
            )}
            <div>
              <strong>{formatPrice(price.output, currency)}</strong>
            </div>
          </Fragment>
        ))}
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
