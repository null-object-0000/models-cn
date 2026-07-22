# models-cn Agent 接入提示词

这份提示词适用于 Codex、Claude Code、Cursor、GitHub Copilot 等能够读取和修改代码仓库的 AI Agent。它会引导 Agent 根据当前项目技术栈接入 models-cn，而不是复制一份很快过期的价格表。

## 快速版

直接复制以下提示词：

```text
请将 models-cn 接入当前项目。

统一数据地址：https://null-object-0000.github.io/models-cn/api.json
项目仓库：https://github.com/null-object-0000/models-cn
Provider Schema：https://raw.githubusercontent.com/null-object-0000/models-cn/main/schema/provider.schema.json

目标：读取中国大陆模型厂商的官方 API 价格、模型能力和可用清单，实现模型查询与费用估算。

必须遵守：
1. 不得把价格硬编码进业务代码，价格必须来自 models-cn 数据。
2. 以 provider.id + model.id 作为联合标识，不能只按模型名称匹配。
3. 优先使用 market=china、currency=CNY、rateType=standard 的官方人民币标准价。
4. 只有调用方明确允许优惠价时，才能选择 rateType=promotional，并清楚标注它可能是限时价格。
5. 不得通过汇率补造缺失的人民币或美元价格；没有对应币种时返回 unavailable。
6. 正确区分 input.cacheHit、input.cacheMiss 和 output，单位均为每 1M Tokens。
7. maxOutputTokens 等字段缺失时返回 null 或“未公开”，不得自行推断。
8. models.dev calibration 仅用于提示差异，不能覆盖 providers 中的官方数据。
9. inventory 仅用于判断模型是否仍在官方列表中，清单差异不能自动改写价格。
10. 不得在前端、日志或仓库中写入厂商 API Key；读取 models-cn 的公开 api.json 不需要密钥。

请先检查当前项目的语言、框架、模型配置、缓存方式和测试体系，然后：
- 增加与 JSON Schema 对应的类型定义；
- 实现带超时、错误处理和合理缓存的数据加载器；
- 实现按 provider、model、currency、market、rateType 查询价格的方法；
- 实现输入未命中、输入缓存命中、输出三部分的费用估算；
- 对未知模型、缺失价格、非 1M_tokens 单位和校准差异进行显式处理；
- 添加覆盖标准价、优惠价、缓存命中、缺失币种和未知模型的测试；
- 更新项目文档，说明数据来源、刷新策略和降级行为。

完成后运行项目现有的类型检查、测试和构建，并汇报：修改文件、公开接口、缓存策略、测试结果和仍然存在的限制。
```

## 可定制版

需要 Agent 针对具体项目做出更准确的实现时，复制下面的提示词并替换花括号：

```text
你正在为一个现有项目接入 models-cn，请直接检查代码并完成实现。

项目背景：
- 项目路径：{{PROJECT_PATH}}
- 技术栈：{{LANGUAGE_AND_FRAMEWORK}}
- 使用场景：{{MODEL_SELECTOR | COST_ESTIMATOR | BILLING_DASHBOARD | DOCUMENTATION}}
- 首选币种：{{CNY | USD}}
- 更新策略：{{RUNTIME_FETCH | BUILD_TIME_SNAPSHOT | SCHEDULED_SYNC}}

数据源：
- Catalog：https://null-object-0000.github.io/models-cn/api.json
- Repository：https://github.com/null-object-0000/models-cn
- Provider Schema：https://raw.githubusercontent.com/null-object-0000/models-cn/main/schema/provider.schema.json
- Inventory Schema：https://raw.githubusercontent.com/null-object-0000/models-cn/main/schema/inventory.schema.json
- Calibration Schema：https://raw.githubusercontent.com/null-object-0000/models-cn/main/schema/calibration.schema.json

数据解释规则：
- providers 是官方数据，拥有最高优先级。
- inventories 是官方 Models API 清单和对比结果，只用于可用性提示。
- calibration.modelsDev 是交叉校准结果，只用于展示 match、mismatch、partial、missing。
- 每条价格必须同时按 market、currency、rateType 选择。
- unit=1M_tokens 表示价格已经按一百万 Token 归一化。
- input.cacheMiss 用于普通输入，input.cacheHit 用于缓存命中输入，output 用于输出。
- promotional 可能限时，不得静默替代 standard。
- 官方未提供目标币种、最大输出或其他字段时，必须保留缺失状态。
- 禁止汇率换算后冒充官方价格，禁止将 models.dev 或聚合平台数据覆盖到官方字段。

费用估算公式：
inputCost = uncachedInputTokens / 1_000_000 * input.cacheMiss
cacheCost = cachedInputTokens / 1_000_000 * input.cacheHit
outputCost = outputTokens / 1_000_000 * output
totalCost = inputCost + cacheCost + outputCost

实施要求：
1. 先阅读当前仓库，不要替换既有架构或包管理器。
2. 创建最小、明确、可复用的类型和数据访问层。
3. 为远程请求增加超时、HTTP 状态检查、JSON 解析错误处理和缓存。
4. 缓存失效时优先保留最后一次通过校验的数据，并把陈旧状态暴露给调用方。
5. 如果项目已有 Schema 校验设施，请接入 models-cn Schema；否则至少进行关键字段运行时校验。
6. 查询 API 应返回价格来源 URL、retrievedAt、币种、市场和价格类型，方便界面向用户解释。
7. 对 inventory mismatch 或 calibration mismatch 提供 warning，不要把它们当作价格自动修正指令。
8. 添加单元测试和至少一个真实数据结构的 fixture，不要在测试中访问真实厂商密钥。
9. 更新 README 或接入文档，给出最短可运行示例。
10. 运行现有检查并修复由本次改动造成的问题。

验收场景：
- 能按 provider + model 找到 CNY 标准价。
- 能区分普通输入、缓存输入和输出费用。
- 用户明确选择时才能使用优惠价。
- 目标币种不存在时返回 unavailable，不做换算。
- 模型或字段不存在时不会抛出无法理解的空指针错误。
- 数据源暂时不可用时有明确的缓存或失败策略。
- 返回结果包含来源与更新时间，便于审计。

请完成代码修改后，说明设计选择、公开接口、缓存与降级策略、测试结果，以及需要调用方决定的事项。
```

## 推荐的费用估算返回值

Agent 可以根据项目语言调整名称，但建议保留这些语义：

```ts
type CostEstimate = {
  provider: string;
  model: string;
  currency: "CNY" | "USD";
  market: "china" | "international";
  rateType: "standard" | "promotional";
  uncachedInputCost: number;
  cachedInputCost: number;
  outputCost: number;
  totalCost: number;
  sourceUrl: string;
  retrievedAt: string;
  warnings: string[];
};
```

金额展示时可以四舍五入，但内部计算应保留足够精度，避免在每个分项过早舍入。
