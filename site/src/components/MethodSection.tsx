export function MethodSection() {
  return (
    <section className="method-section" id="method">
      <div className="section-heading">
        <div>
          <p className="section-index">02 / METHODOLOGY</p>
          <h2>三层数据，互不覆盖</h2>
        </div>
      </div>
      <div className="method-grid">
        <article>
          <span>01</span>
          <h3>官方定价</h3>
          <p>
            中文官网维护人民币价格；英文官网存在独立美元价时原样保留，不进行汇率换算。
          </p>
        </article>
        <article>
          <span>02</span>
          <h3>模型清单</h3>
          <p>
            通过厂商官方模型列表接口确认当前可调用模型，发现新增、下线和兼容别名变化。
          </p>
        </article>
        <article>
          <span>03</span>
          <h3>交叉校准</h3>
          <p>
            使用 models.dev
            对照美元价格、上下文和能力。差异公开展示，但不覆盖厂商原始信息。
          </p>
        </article>
      </div>
    </section>
  );
}
