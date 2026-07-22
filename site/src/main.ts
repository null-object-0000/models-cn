import "./styles.css";

type Currency = "CNY" | "USD";
type RateType = "standard" | "promotional";

interface Price {
  market: string;
  currency: Currency;
  unit: string;
  rateType: RateType;
  input: { cacheHit: number; cacheMiss: number };
  output: number;
  sourceUrl: string;
}

interface Model {
  id: string;
  name: string;
  aliases: Array<{ id: string; deprecatedAt?: string }>;
  capabilities: Record<string, unknown>;
  limits: {
    contextTokens: number;
    maxOutputTokens?: number;
    concurrency?: number;
  };
  prices: Price[];
}

interface Provider {
  id: string;
  name: string;
  models: Model[];
  sources: Array<{ url: string; retrievedAt: string; kind: string }>;
}

interface CalibrationModel {
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

interface Inventory {
  provider: string;
  source: { retrievedAt: string };
  comparison: {
    status: "match" | "mismatch";
    listedWithoutPricing: string[];
    pricedButNotListed: string[];
  };
}

interface Catalog {
  providers: Provider[];
  inventories?: Inventory[];
  calibration?: { modelsDev: { models: CalibrationModel[] } };
}

const app = document.querySelector<HTMLDivElement>("#app")!;
let currency: Currency = "CNY";
let rateType: RateType = "promotional";
let search = "";

const number = new Intl.NumberFormat("zh-CN");

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatPrice(value: number, selectedCurrency: Currency): string {
  const symbol = selectedCurrency === "CNY" ? "¥" : "$";
  return `${symbol}${value.toLocaleString("zh-CN", { maximumFractionDigits: 6 })}`;
}

function compactTokens(value?: number): string {
  if (value === undefined) return "未公开";
  if (value >= 1_000_000)
    return `${(value / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}M`;
  if (value >= 1_000)
    return `${(value / 1_000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}K`;
  return number.format(value);
}

function capabilityLabels(capabilities: Record<string, unknown>): string[] {
  const labels: string[] = [];
  if (capabilities.thinking) labels.push("思考");
  if (capabilities.dynamicTools) labels.push("动态工具");
  if (capabilities.toolCalls) labels.push("工具调用");
  if (capabilities.jsonOutput) labels.push("JSON");
  if (capabilities.chatPrefixCompletion) labels.push("前缀续写");
  const inputs = capabilities.inputModalities as string[] | undefined;
  if (inputs?.length) labels.push(inputs.join(" / "));
  const efforts = capabilities.reasoningEfforts as string[] | undefined;
  if (efforts?.length) labels.push(`effort: ${efforts.join(" / ")}`);
  return labels;
}

function calibrationFor(
  catalog: Catalog,
  provider: string,
  model: string,
): CalibrationModel | undefined {
  return catalog.calibration?.modelsDev.models.find(
    (item) => item.provider === provider && item.model === model,
  );
}

function calibrationBadge(calibration?: CalibrationModel): string {
  if (!calibration) return '<span class="status status-neutral">未校准</span>';
  const labels = {
    match: "校准一致",
    mismatch: "存在差异",
    partial: "部分可比",
    missing: "参考缺失",
  };
  return `<a class="status status-${calibration.status}" href="${escapeHtml(calibration.referenceUrl)}" target="_blank" rel="noreferrer">${labels[calibration.status]}</a>`;
}

function modelCard(catalog: Catalog, provider: Provider, model: Model): string {
  const selectedPrices = model.prices.filter(
    (price) => price.currency === currency,
  );
  const preferred =
    selectedPrices.find((price) => price.rateType === rateType) ??
    selectedPrices.find((price) => price.rateType === "standard");
  const calibration = calibrationFor(catalog, provider.id, model.id);
  const mismatch = calibration?.checks.find(
    (check) => check.status === "mismatch",
  );
  const capabilities = capabilityLabels(model.capabilities);
  return `
    <article class="model-card">
      <div class="model-heading">
        <div>
          <p class="provider-label">${escapeHtml(provider.name)}</p>
          <h3>${escapeHtml(model.name)}</h3>
          <code>${escapeHtml(model.id)}</code>
        </div>
        ${calibrationBadge(calibration)}
      </div>

      <div class="limits" aria-label="模型限制">
        <div><span>上下文</span><strong>${compactTokens(model.limits.contextTokens)}</strong></div>
        <div><span>最大输出</span><strong>${compactTokens(model.limits.maxOutputTokens)}</strong></div>
        ${model.limits.concurrency ? `<div><span>并发</span><strong>${number.format(model.limits.concurrency)}</strong></div>` : ""}
      </div>

      <div class="price-panel">
        <div class="price-label">
          <span>${currency === "CNY" ? "人民币" : "美元"} · 每百万 Tokens</span>
          ${preferred?.rateType === "promotional" ? "<em>限时优惠</em>" : ""}
        </div>
        ${
          preferred
            ? `<div class="price-grid">
                <div><span>输入</span><strong>${formatPrice(preferred.input.cacheMiss, currency)}</strong></div>
                <div><span>缓存命中</span><strong>${formatPrice(preferred.input.cacheHit, currency)}</strong></div>
                <div><span>输出</span><strong>${formatPrice(preferred.output, currency)}</strong></div>
              </div>
              <a class="source-link" href="${escapeHtml(preferred.sourceUrl)}" target="_blank" rel="noreferrer">查看官方来源 ↗</a>`
            : '<p class="no-price">该市场暂无官方价格</p>'
        }
      </div>

      <div class="card-footer">
        <div class="capabilities">${capabilities.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>
        ${model.aliases.length ? `<p class="aliases">兼容别名：${model.aliases.map((alias) => `<code>${escapeHtml(alias.id)}</code>`).join(" ")}</p>` : ""}
        ${mismatch ? `<p class="difference">校准差异：${escapeHtml(mismatch.field)} · 官方 ${escapeHtml(mismatch.official)} / models.dev ${escapeHtml(mismatch.reference)}</p>` : ""}
      </div>
    </article>`;
}

function render(catalog: Catalog): void {
  const models = catalog.providers.flatMap((provider) =>
    provider.models.map((model) => ({ provider, model })),
  );
  const filtered = models.filter(({ provider, model }) =>
    `${provider.name} ${provider.id} ${model.name} ${model.id}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const updatedDates = catalog.providers.flatMap((provider) =>
    provider.sources.map((source) => source.retrievedAt),
  );
  const latest = updatedDates.sort().at(-1);
  const mismatchCount =
    catalog.calibration?.modelsDev.models.filter(
      (item) => item.status === "mismatch",
    ).length ?? 0;
  const inventoryMatches =
    catalog.inventories?.filter(
      (inventory) => inventory.comparison.status === "match",
    ).length ?? 0;

  app.innerHTML = `
    <header class="site-header">
      <a class="brand" href="#top" aria-label="models-cn 首页"><span class="brand-mark"></span>models-cn</a>
      <nav aria-label="主导航">
        <a href="#models">模型</a>
        <a href="#method">数据说明</a>
        <a href="https://github.com/null-object-0000/models-cn" target="_blank" rel="noreferrer">GitHub ↗</a>
      </nav>
    </header>

    <main id="top">
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow"><span></span> Official pricing · Mainland China</p>
          <h1>中国大模型，<br /><em>价格说清楚。</em></h1>
          <p class="lede">汇总中国大陆模型厂商的官方 API 定价、模型能力与可用清单。人民币来自厂商中文渠道，美元保留官方国际价格。</p>
          <div class="hero-actions">
            <a class="primary-action" href="#models">浏览模型价格</a>
            <a class="secondary-action" href="./api.json">获取 JSON 数据</a>
          </div>
        </div>
        <div class="signal-panel" aria-label="数据状态">
          <div class="signal-head"><span>DATA SIGNAL</span><i>LIVE</i></div>
          <dl>
            <div><dt>厂商</dt><dd>${catalog.providers.length}</dd></div>
            <div><dt>模型</dt><dd>${models.length}</dd></div>
            <div><dt>校准差异</dt><dd class="${mismatchCount ? "warn" : ""}">${mismatchCount}</dd></div>
            <div><dt>清单一致</dt><dd>${inventoryMatches}<small> / ${catalog.inventories?.length ?? 0}</small></dd></div>
          </dl>
          <p>最近数据变化 <time>${latest ? new Date(latest).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }) : "未知"}</time></p>
        </div>
      </section>

      <section class="catalog-section" id="models">
        <div class="section-heading">
          <div><p class="section-index">01 / CATALOG</p><h2>官方模型与定价</h2></div>
          <p>价格单位统一为每百万 Tokens。官方数据优先，models.dev 仅用于逐字段校准。</p>
        </div>

        <div class="toolbar">
          <label class="search-box"><span>搜索</span><input id="model-search" type="search" value="${escapeHtml(search)}" placeholder="厂商或模型名称" /></label>
          <div class="segment" aria-label="货币">
            <button data-currency="CNY" aria-pressed="${currency === "CNY"}">CNY 人民币</button>
            <button data-currency="USD" aria-pressed="${currency === "USD"}">USD 美元</button>
          </div>
          <div class="segment" aria-label="价格类型">
            <button data-rate="promotional" aria-pressed="${rateType === "promotional"}">当前优惠</button>
            <button data-rate="standard" aria-pressed="${rateType === "standard"}">标准价格</button>
          </div>
        </div>

        <p class="result-count">显示 ${filtered.length} / ${models.length} 个模型</p>
        <div class="model-grid">
          ${filtered.length ? filtered.map(({ provider, model }) => modelCard(catalog, provider, model)).join("") : '<p class="empty-state">没有匹配的模型。</p>'}
        </div>
      </section>

      <section class="method-section" id="method">
        <div class="section-heading">
          <div><p class="section-index">02 / METHODOLOGY</p><h2>三层数据，互不覆盖</h2></div>
        </div>
        <div class="method-grid">
          <article><span>01</span><h3>官方定价</h3><p>中文官网维护人民币价格；英文官网存在独立美元价时原样保留，不进行汇率换算。</p></article>
          <article><span>02</span><h3>模型清单</h3><p>通过厂商官方模型列表接口确认当前可调用模型，发现新增、下线和兼容别名变化。</p></article>
          <article><span>03</span><h3>交叉校准</h3><p>使用 models.dev 对照美元价格、上下文和能力。差异公开展示，但不覆盖厂商原始信息。</p></article>
        </div>
      </section>
    </main>

    <footer>
      <div class="brand"><span class="brand-mark"></span>models-cn</div>
      <p>开放数据 · 官方来源 · 可追溯更新</p>
      <a href="https://github.com/null-object-0000/models-cn" target="_blank" rel="noreferrer">MIT License · GitHub</a>
    </footer>`;

  document
    .querySelectorAll<HTMLButtonElement>("[data-currency]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        currency = button.dataset.currency as Currency;
        render(catalog);
        document.querySelector("#models")?.scrollIntoView({ block: "start" });
      });
    });
  document
    .querySelectorAll<HTMLButtonElement>("[data-rate]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        rateType = button.dataset.rate as RateType;
        render(catalog);
        document.querySelector("#models")?.scrollIntoView({ block: "start" });
      });
    });
  document
    .querySelector<HTMLInputElement>("#model-search")
    ?.addEventListener("input", (event) => {
      search = (event.target as HTMLInputElement).value;
      render(catalog);
      const input = document.querySelector<HTMLInputElement>("#model-search");
      input?.focus();
      input?.setSelectionRange(search.length, search.length);
    });
}

async function start(): Promise<void> {
  try {
    const response = await fetch("./api.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render((await response.json()) as Catalog);
  } catch (error) {
    app.innerHTML = `<main class="error-shell"><p>DATA UNAVAILABLE</p><h1>暂时无法载入模型数据</h1><span>${escapeHtml((error as Error).message)}</span></main>`;
  }
}

void start();
