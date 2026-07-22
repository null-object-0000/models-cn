import {
  capabilityLabels,
  compactTokens,
  formatPrice,
  numberFormatter,
} from "../lib/catalog";
import type { CalibrationModel, Currency, Model, RateType } from "../types";
import { CalibrationBadge } from "./CalibrationBadge";

export function ModelRow({
  model,
  calibration,
  currency,
  rateType,
}: {
  model: Model;
  calibration: CalibrationModel | undefined;
  currency: Currency;
  rateType: RateType;
}) {
  const selectedPrices = model.prices.filter(
    (price) => price.currency === currency,
  );
  const preferredRate = selectedPrices.some(
    (price) => price.rateType === rateType,
  )
    ? rateType
    : "standard";
  const prices = selectedPrices.filter(
    (price) => price.rateType === preferredRate,
  );
  const mismatch = calibration?.checks.find(
    (check) => check.status === "mismatch",
  );
  const capabilities = capabilityLabels(model.capabilities);

  return (
    <article className="model-row">
      <div className="model-heading">
        <div>
          <h3>
            {prices[0] ? (
              <a href={prices[0].sourceUrl} target="_blank" rel="noreferrer">
                {model.name}
              </a>
            ) : (
              model.name
            )}
          </h3>
          <code>{model.id}</code>
        </div>
        <CalibrationBadge calibration={calibration} />
      </div>
      <div className="limits" aria-label="模型限制">
        <div>
          <span>上下文</span>
          <strong>{compactTokens(model.limits.contextTokens)}</strong>
        </div>
        <div>
          <span>最大输出</span>
          <strong>{compactTokens(model.limits.maxOutputTokens)}</strong>
        </div>
        {model.limits.concurrency ? (
          <div>
            <span>并发</span>
            <strong>{numberFormatter.format(model.limits.concurrency)}</strong>
          </div>
        ) : null}
      </div>
      <div className="price-panel">
        <div className="price-label">
          <span>{currency === "CNY" ? "人民币" : "美元"} · 每百万 Tokens</span>
          {preferredRate === "promotional" && prices.length ? (
            <em>限时优惠</em>
          ) : null}
        </div>
        {prices.length ? (
          <>
            {prices.map((price, index) => (
              <div className="price-tier" key={`${price.sourceUrl}-${index}`}>
                {price.inputTokenRange ? (
                  <p className="price-range">{price.inputTokenRange.label}</p>
                ) : null}
                <div className="price-grid">
                  <div>
                    <span>输入</span>
                    <strong>
                      {formatPrice(price.input.standard, currency)}
                    </strong>
                  </div>
                  {price.input.cacheHit !== undefined ? (
                    <div>
                      <span>缓存命中</span>
                      <strong>
                        {formatPrice(price.input.cacheHit, currency)}
                      </strong>
                    </div>
                  ) : null}
                  <div>
                    <span>输出</span>
                    <strong>{formatPrice(price.output, currency)}</strong>
                  </div>
                </div>
              </div>
            ))}
            <a
              className="source-link"
              href={prices[0]!.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              查看官方来源 ↗
            </a>
          </>
        ) : (
          <p className="no-price">该市场暂无官方价格</p>
        )}
      </div>
      <div className="card-footer">
        <div className="capabilities">
          {capabilities.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        {model.aliases.length ? (
          <p className="aliases">
            兼容别名：
            {model.aliases.map((alias) => (
              <code key={alias.id}>{alias.id} </code>
            ))}
          </p>
        ) : null}
        {mismatch ? (
          <p className="difference">
            校准差异：{mismatch.field} · 官方 {String(mismatch.official)} /
            models.dev {String(mismatch.reference)}
          </p>
        ) : null}
      </div>
    </article>
  );
}
