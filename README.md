# models-cn

> 中国大陆大模型厂商及其官方国内、国际渠道的 API 定价与模型信息，一份 JSON 即可接入。

[![Update prices](https://github.com/null-object-0000/models-cn/actions/workflows/update-prices.yml/badge.svg)](https://github.com/null-object-0000/models-cn/actions/workflows/update-prices.yml)
[![GitHub Pages](https://github.com/null-object-0000/models-cn/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/null-object-0000/models-cn/actions/workflows/deploy-pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-087f5b.svg)](LICENSE)

models-cn 只关注**中国大陆模型厂商及其官方渠道**，核心目标是提供可信、可追溯的官方 API 定价；人民币渠道优先，已经单独接入的国际渠道保留官方美元价格。项目同时维护模型能力、上下文限制、官方可用清单，并使用 models.dev 补充厂商未披露的信息。

> **项目边界**：国内模型厂商、官方渠道、人民币优先。不同区域的渠道使用独立 Provider ID，保留各自官方币种。厂商官方数据拥有最高优先级；官方缺失的字段可以使用 models.dev 作为补充来源，但必须明确标记为参考数据，不能覆盖或冒充官方数据。

- **官方币种**：重点维护中国大陆官方人民币价格；已接入的国际渠道保留官方美元价格，不做汇率换算。
- **缺失可补全**：模型能力、上下文、输出限制或其他缺失信息可回退到 models.dev，并保留来源与校准状态。
- **机器友好**：统一 JSON、JSON Schema、稳定字段和可追溯来源。
- **持续更新**：GitHub Actions 定期采集，数据变化通过 Pull Request 审核。
- **Agent 友好**：提供可直接交给 Codex、Claude Code、Cursor 等工具的接入提示词。

[浏览官网](https://null-object-0000.github.io/models-cn/) · [获取 api.json](https://null-object-0000.github.io/models-cn/api.json) · [v1 稳定接口](https://null-object-0000.github.io/models-cn/v1/api.json) · [查看 JSON Schema](schema/v1/provider.schema.json) · [兼容性承诺](COMPATIBILITY.md) · [复制 Agent 接入提示词](docs/agent-integration-prompt.md)

## 30 秒开始使用

无需安装依赖，直接读取统一数据接口：

```bash
curl -L https://null-object-0000.github.io/models-cn/api.json
```

生产集成建议固定使用 `https://null-object-0000.github.io/models-cn/v1/api.json`；无版本地址适合主动跟进最新版的使用者。

在 JavaScript / TypeScript 中使用：

```ts
const response = await fetch(
  "https://null-object-0000.github.io/models-cn/api.json",
);
const catalog = await response.json();

const provider = catalog.providers.find(
  (item: { id: string }) => item.id === "moonshot-cn",
);
const model = provider?.models.find(
  (item: { id: string }) => item.id === "kimi-k3",
);
const cnyPrice = model?.prices.find(
  (price: { currency: string; rateType: string }) =>
    price.currency === "CNY" && price.rateType === "standard",
);

console.log(cnyPrice);
// input.standard / input.cacheHit（可选）
// input.explicitCacheCreation / input.explicitCacheHit（可选）/ output
// 单位：人民币 / 1M Tokens
```

推荐使用 `provider.id + model.id` 作为模型价格的联合标识，不要只用模型名称。

官方字段缺失时，可以从校准报告读取 models.dev 参考值：

```ts
const calibration = catalog.calibration?.modelsDev.models.find(
  (item: { provider: string; model: string }) =>
    item.provider === provider.id && item.model === model.id,
);

const outputLimit =
  model.limits.maxOutputTokens ??
  calibration?.checks.find(
    (item: { field: string }) => item.field === "limits.maxOutputTokens",
  )?.reference;
```

使用回退值时，应同时向调用方返回 `referenceUrl` 和 `status`，并标注为 models.dev 参考数据。

## 当前覆盖

| 厂商        | 收录范围      | 人民币 | 官方美元 | 模型信息 | 官方清单 |
| ----------- | ------------- | :----: | :------: | :------: | :------: |
| DeepSeek    | DeepSeek 系列 |   ✅   |    ✅    |    ✅    |    ✅    |
| LongCat     | LongCat 系列  |   ✅   |    ✅    |    ✅    |    ✅    |
| Kimi 国内版 | `kimi-*` 系列 |   ✅   |    —     |    ✅    |    ✅    |
| Kimi 国际版 | `kimi-*` 系列 |   —    |    ✅    |    ✅    |    ✅    |
| 千问国内版  | `qwen*` 系列  |   ✅   |    —     |    ✅    |    —     |

项目只收录厂商自研模型。`moonshot-cn` 表示 **Kimi 国内版（Kimi China）**，`moonshot-intl` 表示 **Kimi 国际版（Kimi International）**；两个渠道使用独立的 API 地址、密钥和官方币种价格，同时都会过滤不在当前范围内的 `moonshot-v1-*`。`qwen-cn` 明确表示 **千问国内版（Qwen China）**，只保留千问模型市场中 `Provider=qwen` 的闭源稳定模型、国内 DashScope 地址和人民币价格；官方外显名称包含“开源模型”、官方开源标记为真的模型、带日期后缀的快照版本、已有同名稳定 ID 的 `*-preview`、没有代际版本号的旧 `qwen-*` 型号，以及 OCR、Character、TTS、VL、Math 类模型均不收录。平台托管的第三方模型、尚未单独接入的国际版和聚合平台价格都不在范围内。

限流信息只收录能归属到具体模型的固定官方数值。目前千问模型页提供模型级 RPM/TPM，因此已写入数据；[Kimi 限流](https://platform.kimi.com/docs/pricing/limits)随账号充值等级变化，[DeepSeek](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit)与 [LongCat](https://longcat.chat/platform/docs/zh/APIDocs.html)当前官方文档也未公开可直接复用的固定模型级 RPM/TPM，因此这些渠道暂不生成对应字段。

## Agent 快速接入

把下面这段话交给你的 Coding Agent，即可让它先分析项目，再完成类型定义、数据读取、价格选择、容错和测试：

```text
请按照 docs/agent-integration-prompt.md 的规则，将 models-cn 接入当前项目。
数据地址：https://null-object-0000.github.io/models-cn/api.json
目标：读取中国大陆模型厂商的官方价格和模型信息，并实现可测试的模型查询与费用估算能力。
要求：人民币官方价格优先；不得硬编码价格或用汇率伪造人民币官方价；官方字段缺失时允许使用 models.dev 补全，但必须保留参考来源，不能覆盖官方值；正确处理币种、市场、标准价/优惠价及可选的普通缓存、显式缓存价格。
请先检查当前项目技术栈和已有模型配置，再实施修改、运行测试，并说明改动文件及使用方式。
```

完整的可定制提示词、字段规则和验收清单见 [Agent 接入提示词](docs/agent-integration-prompt.md)。

## 数据约定

价格统一为每百万 Token：

```json
{
  "market": "china",
  "currency": "CNY",
  "unit": "1M_tokens",
  "rateType": "standard",
  "inputTokenRange": {
    "label": "输入<=256k",
    "maxInclusive": 256000
  },
  "input": {
    "standard": 1,
    "cacheHit": 0.2,
    "explicitCacheCreation": 1.25,
    "explicitCacheHit": 0.1
  },
  "output": 2,
  "sourceUrl": "https://provider.example/pricing"
}
```

使用时请注意：

- `CNY + china` 表示中国大陆官方人民币价格。
- `USD + international` 表示厂商独立国际渠道的官方美元价格，不是人民币换算价。
- `standard` 是标准价；`promotional` 是厂商明确标注的优惠价。
- `inputTokenRange` 表示按输入 Token 数分档的价格；缺失时表示该价格不分输入长度档位。
- `input.standard` 是普通输入价格；没有独立缓存计费规则时，它适用于全部输入 Token。
- `input.cacheHit` 仅在厂商明确设置缓存命中计费规则时提供。字段缺失表示“不存在该计费维度”，不是价格未公开。
- `input.explicitCacheCreation`、`input.explicitCacheHit` 分别表示显式缓存创建和命中的输入 Token 价格；同一批 Token 应按实际命中的一种计费路径计算，不能与普通输入或其他缓存价格重复相加。
- `limits.requestsPerMinute`、`limits.tokensPerMinute` 分别是厂商公开的模型级 RPM、TPM；按账号等级动态变化或未给出确定数值时不生成字段。
- 当前数据契约版本为 `schemaVersion: "1.0"`。
- 官网模型默认按发布时间倒序排列：优先使用厂商官方 `createdAt`，缺失时读取 models.dev 校准数据中的 `release_date`，仍缺失的排在最后。
- `maxOutputTokens` 等非必填字段缺失时，可使用 models.dev 对应参考值补全；models.dev 也没有时应显示“未公开”，不能自行推断。
- `sourceUrl`、`retrievedAt` 和 `contentHash` 用于追溯数据来源与变化。

## 官方优先，缺失补全

项目将三类数据分开保存，并按照明确的优先级使用：

1. **官方定价**：厂商中文或英文定价页，是价格的事实来源。
2. **官方模型清单**：通过厂商 Models API 检查新增、下线和别名变化。
3. **models.dev 补全与校准**：对比并补充美元价格、上下文、输出限制、模态和能力。

推荐的字段解析顺序：

```text
厂商官方字段
→ 官方字段缺失时使用 models.dev reference
→ 两者都缺失时保留 unavailable / 未公开
```

models.dev 补充值必须携带 `referenceUrl` 和校准状态，并在界面或 API 返回中标记为 `reference`。它不能覆盖已有官方字段，也不能通过汇率换算后标成官方人民币价格。

模型级校准状态包括 `match`、`mismatch`、`partial` 和 `missing`。其中 `partial` 通常表示厂商未公开某些可比字段，不代表官方数据错误。

<details>
<summary>查看官方数据源</summary>

### DeepSeek

- [中文模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)
- [英文 Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)

### LongCat

- [中文模型与价格](https://longcat.chat/platform/docs/zh/pricing/long-cat-2.0)
- [英文 Models & Pricing](https://longcat.chat/platform/docs/pricing/long-cat-2.0)
- [模型详情接口文档](https://longcat.chat/platform/docs/zh/api/model)

### Kimi

- 国内版：[模型推理价格](https://platform.kimi.com/docs/pricing/chat)、[模型参数](https://platform.kimi.com/docs/api/models-overview)、[输出长度](https://platform.kimi.com/docs/guide/troubleshooting#kimi)、[模型列表接口](https://platform.kimi.com/docs/api/list-models)
- 国际版：[Model Pricing](https://platform.kimi.ai/docs/pricing/chat)、[Model Parameters](https://platform.kimi.ai/docs/api/models-overview)、[Output Limits](https://platform.kimi.ai/docs/guide/troubleshooting#kimi)、[List Models](https://platform.kimi.ai/docs/api/list-models)

两个 Kimi 渠道的最大输出长度均与输入共享上下文窗口：K3 为 `1,048,576 - prompt_tokens`，K2.6/K2.5 为 `262,144 - prompt_tokens`。数据中的 `maxOutputTokens` 保存输入为空时的理论上限；K2.7 Code 暂无该文档中的明确说明，因此不自行推断。

### 千问

- [国内版模型市场](https://www.qianwenai.com/models)
- [Qwen3.7-Plus 模型详情](https://www.qianwenai.com/models/qwen3.7-plus)

千问模型市场的数据由页面运行后动态加载。采集器使用浏览器拦截官方模型列表请求，再读取 `Provider=qwen` 系列的详情和人民币分档价格；不采集市场中的第三方模型、开源模型、带日期后缀的快照版本、已有同名稳定 ID 的 `*-preview`、没有代际版本号的旧 `qwen-*` 型号，以及 OCR、Character、TTS、VL、Math 类模型。

</details>

## 数据文件

| 路径                               | 内容                                   |
| ---------------------------------- | -------------------------------------- |
| `api.json`                         | 所有厂商、模型、价格、清单和校准的入口 |
| `v1/api.json`                      | v1 稳定 API 入口                       |
| `data/providers/{provider}.json`   | 单个厂商的规范化官方数据               |
| `data/inventory/{provider}.json`   | 官方 Models API 可用清单及差异         |
| `data/calibration/models-dev.json` | models.dev 逐字段校准报告              |
| `schema/provider.schema.json`      | 厂商数据 JSON Schema                   |
| `schema/inventory.schema.json`     | 模型清单 JSON Schema                   |
| `schema/calibration.schema.json`   | 校准报告 JSON Schema                   |
| `schema/v1/*.json`                 | v1 稳定 API 对应的版本化 Schema        |

## 本地运行

需要 Node.js 22+ 和 npm 10+：

```powershell
npm install
npx playwright install chromium
Copy-Item .env.example .env
# 编辑 .env，填入你自己新生成的 API Key

npm run collect
npm run discover
npm run build
npm run check
```

本地预览官网：

```powershell
npm run site:dev
```

只采集单个厂商时可以使用：

```powershell
npm run collect -- --provider moonshot-cn
npm run collect -- --provider moonshot-intl
npm run collect -- --provider qwen-cn
```

### 可选密钥

公开定价页不需要密钥；千问采集使用 Playwright Chromium 读取动态页面。官方模型清单校准需要在 `.env` 或 GitHub Repository Secrets 中配置：

```dotenv
DEEPSEEK_API_KEY=
LONGCAT_API_KEY=
MOONSHOT_CHINA_API_KEY=
MOONSHOT_INTERNATIONAL_API_KEY=
```

`MOONSHOT_API_KEY` 暂时作为 `MOONSHOT_CHINA_API_KEY` 的兼容别名。不要把真实密钥写入代码、数据文件、日志或 Actions YAML。缺少某个密钥时，清单发现会跳过该渠道并保留已有快照。

## 自动更新

定时任务执行以下流程：

```text
官方页面采集 → 模型清单发现 → Schema 校验 → models.dev 校准
→ 生成 api.json → 创建更新 PR → 人工审核 → GitHub Pages 发布
```

采集器在关键表格消失、字段缺失或价格无法解析时会直接失败，不会用空数据覆盖已有结果。只有规范化内容发生变化时，对应来源的 `retrievedAt` 才会更新。

每条采集链路同时记录 `health.status`、`lastSuccessfulAt`、`lastAttemptAt` 和 `consecutiveFailures`。官网仅在所有官方价格采集均为 `healthy` 时显示 `LIVE`；失败时继续提供上一份已验证快照并明确显示异常。自动任务每天在上海时间 09:17、15:17 和 21:17 执行，所有运行都会把完整报告写入 GitHub Actions Summary。机器人 PR 会列出新增/下线模型、逐字段价格与模型信息变化、校准变化，以及官方价格页、Models API 和 models.dev 的采集状态；纯成功时间戳刷新不会更新 PR，模型、价格、清单、校准或健康状态变化才会更新。

公开接口的兼容性、Schema 变更和字段弃用规则见 [COMPATIBILITY.md](COMPATIBILITY.md)，版本历史见 [CHANGELOG.md](CHANGELOG.md)。

## 参与贡献

欢迎提交新的中国大陆模型厂商采集器、页面解析修复、Schema 改进和数据校验规则。新增厂商应满足：

- 中国大陆模型厂商及其自研模型。
- 官方公开 API 或官方定价页面。
- 中国大陆人民币按量价格。
- 可追溯的来源链接与采集时间。
- 不混入聚合平台、第三方托管模型、会员订阅或无法验证的换算价格。

完整的采集器结构、模型和价格规范、注册位置、校准、Inventory、测试与验收流程，参见 [新增渠道指南](docs/adding-provider.md)。

## License

[MIT](LICENSE)
