export interface HeroStats {
  providers: number;
  models: number;
  mismatches: number;
  inventoryMatches: number;
  inventories: number;
  latest?: string;
  health: "healthy" | "stale" | "error";
  failedSources: number;
}

export function Hero({ stats }: { stats: HeroStats }) {
  return (
    <section className="hero">
      <div className="shell hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">
            <span /> Official pricing · Mainland China
          </p>
          <h1>
            中国大模型，
            <br />
            <em>价格说清楚。</em>
          </h1>
          <p className="lede">
            汇总中国大陆模型厂商的官方 API
            定价、模型能力与可用清单。人民币来自厂商中文渠道，美元保留官方国际价格。
          </p>
          <div className="hero-actions">
            <a className="primary-action" href="#models">
              浏览模型价格
            </a>
            <a className="secondary-action" href="./api.json">
              获取 JSON 数据
            </a>
          </div>
        </div>
        <div className="signal-panel" aria-label="数据状态">
          <div className="signal-head">
            <span>DATA SIGNAL</span>
            <i className={`signal-${stats.health}`}>
              {stats.health === "healthy"
                ? "LIVE"
                : stats.health === "stale"
                  ? "STALE"
                  : "ERROR"}
            </i>
          </div>
          <dl>
            <div>
              <dt>厂商</dt>
              <dd>{stats.providers}</dd>
            </div>
            <div>
              <dt>模型</dt>
              <dd>{stats.models}</dd>
            </div>
            <div>
              <dt>校准差异</dt>
              <dd className={stats.mismatches ? "warn" : undefined}>
                {stats.mismatches}
              </dd>
            </div>
            <div>
              <dt>清单一致</dt>
              <dd>
                {stats.inventoryMatches}
                <small> / {stats.inventories}</small>
              </dd>
            </div>
          </dl>
          <p>
            {stats.failedSources
              ? `${stats.failedSources} 条采集链路异常 · 最近尝试 `
              : "全部采集链路正常 · 最近尝试 "}
            <time>
              {stats.latest
                ? new Date(stats.latest).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : "未知"}
            </time>
          </p>
        </div>
      </div>
    </section>
  );
}
