# 新增渠道指南

本文说明如何为 models-cn 接入一个新的模型渠道。当前项目已经接入 DeepSeek、LongCat、Kimi 国内版和千问国内版；新增渠道应复用现有的数据结构、校验、校准和自动更新流程。

## 1. 明确渠道边界

这里的“渠道”不是单纯的厂商名称，而是一套独立的 API 地址、市场区域、币种、模型范围和定价规则。例如：

- `moonshot-cn` 表示 Kimi 国内版。
- `qwen-cn` 表示千问国内版。
- 同一厂商的国际版应使用独立 Provider ID，不能混入国内渠道。

开始实现前应明确：

- Provider ID，建议使用小写字母和短横线，例如 `example-cn`。
- `ownedBy` 和中国大陆 API Base URL。
- 收录哪些自研模型系列。
- 是否排除第三方、开源、快照、旧版本或专项模型。
- 是否存在标准价、优惠价、缓存价和按 Token 数分档的价格。
- 是否提供官方 Models API。

项目范围是中国大陆官方渠道和人民币 API 定价。不得把聚合平台、第三方托管模型、会员订阅或汇率换算价格作为官方人民币价格。

## 2. 实现采集器

在 `src/collectors/` 下新增采集器，例如：

```text
src/collectors/example.ts
```

采集器应导出：

```ts
import { SCHEMA_VERSION, type ProviderData } from "../types.js";

export async function collectExample(): Promise<ProviderData>;
```

返回值必须符合 `src/types.ts` 中的 `ProviderData` 和 `schema/provider.schema.json`：

```ts
return {
  schemaVersion: SCHEMA_VERSION,
  id: "example-cn",
  name: "Example China",
  displayNames: {
    "zh-CN": "示例国内版",
    en: "Example China",
  },
  ownedBy: "example",
  baseUrls: {
    openai: "https://api.example.cn/v1",
  },
  models,
  sources,
};
```

按照官网的数据形态选择采集方式：

- 静态 HTML：参考 `src/collectors/deepseek.ts`。
- Markdown 或文档表格：参考 `src/collectors/moonshot.ts`。
- 官方 JSON API：优先直接请求结构化数据。
- 页面运行后动态请求：参考 `src/collectors/qwen.ts`，通过浏览器捕获官方接口。
- 文档与认证 API 双重核验：参考 `src/collectors/longcat.ts`。

优先读取官方结构化字段，不要依赖页面视觉位置或复制浏览器生成后的 HTML。

### 来源与更新时间

每个来源必须包含：

- `url`
- `kind`
- `locale`
- `currency`（适用时）
- `retrievedAt`
- `contentHash`

采集器应对规范化后的官方内容计算稳定哈希。内容没有变化时，公共采集流程会保留原来的 `retrievedAt`。

## 3. 规范化模型

模型 ID 和外显名称必须分开：

```ts
{
  id: "qwen3.7-max",
  name: "Qwen3.7-Max"
}
```

- `id` 是真实 API 模型 ID。
- `name` 是面向用户的外显名称。
- API 别名放入 `aliases`，不要伪装成独立模型。
- 同名模型不能因为外显名称相同而丢失真实 ID。
- 稳定版与 `-preview` 同时存在且外显名称相同时，保留稳定版。

模型范围过滤应优先使用官方字段。例如千问使用官方外显名称中的“开源模型”分类。只有官网没有结构化标识时，才使用经过测试的 ID 规则。

建议明确测试以下过滤场景：

- 平台托管的第三方模型。
- 开源或开放权重模型。
- 带日期后缀的快照版本。
- 已有同名稳定版本的 preview。
- 项目暂不支持的专项类别。
- 已明确停止维护的旧型号。

## 4. 规范化价格

价格统一为每百万 Token：

```json
{
  "market": "china",
  "currency": "CNY",
  "unit": "1M_tokens",
  "rateType": "standard",
  "input": {
    "standard": 12
  },
  "output": 36,
  "sourceUrl": "https://provider.example/pricing"
}
```

字段规则：

- `input.standard` 是普通输入价格。
- `input.cacheHit` 仅在厂商明确设置独立缓存命中计费规则时提供。
- 没有缓存计费维度时，不得生成 `cacheHit`，也不得显示为“未公开”。
- `input.explicitCacheCreation` 和 `input.explicitCacheHit` 仅在厂商明确区分显式缓存创建、命中价格时提供；不要与 `input.cacheHit` 合并或重复计费。
- 官方给出固定的模型级 RPM/TPM 时，分别写入 `limits.requestsPerMinute`、`limits.tokensPerMinute`。若限额随账号等级或套餐变化，则保留缺失，不把某一档账号限额写成模型固有限额。
- 厂商明确标注的优惠价格使用独立的 `rateType: "promotional"`。
- 按输入长度分档时使用 `inputTokenRange`。
- 不得通过汇率换算生成官方人民币价格。

采集器应在以下情况直接失败，不能生成不可信数据：

- 没有解析到任何有效模型。
- 价格单位未知或无法归一化。
- 必填的上下文、输入价或输出价缺失。
- 官网关键结构发生无法解释的变化。

## 5. 注册采集器

在 `src/cli/collect.ts` 中导入并注册：

```ts
import { collectExample } from "../collectors/example.js";

const collectors = [
  // Existing collectors...
  { id: "example-cn", collect: collectExample },
];
```

之后可以单独运行：

```bash
npm run collect -- --provider example-cn
```

采集结果写入：

```text
data/providers/example-cn.json
```

`npm run build` 会自动读取所有 Provider 文件并重新生成统一的 `api.json`，不需要手工拼接。

## 6. 添加测试

新增：

```text
tests/example.test.ts
```

测试使用固定 fixture，不应访问真实官网或真实厂商密钥。至少覆盖：

- 模型 ID 与外显名称。
- 标准价格与优惠价格。
- 缓存价格存在和不存在两种情况。
- Token 价格分档。
- 上下文、最大输出和能力字段。
- 第三方、开源、快照、旧模型和不支持类别的过滤。
- 重复 ID 或同名 preview 去重。
- 空数据失败。
- 未知价格单位失败。

如果采集器包含文档与 API 双重来源，还应测试两者不一致时会明确失败。

## 7. 接入 models.dev 校准（可选）

models.dev 有同一模型时，在 `src/calibration/models-dev.ts` 增加精确映射：

```ts
{
  provider: "example-cn",
  model: "example-model",
  referenceProvider: "example",
  referenceModel: "example-model",
  referenceUrl: "https://models.dev/models/example/example-model/",
}
```

要求：

- 只有确认是同一型号时才能映射。
- 不要把 preview 映射到相似的稳定版本。
- models.dev 只能校准或补充官方缺失字段，不能覆盖官方数据。
- 没有准确参考时保持未校准，不要猜测映射。

校准状态：

- `match`：全部检查字段一致。
- `mismatch`：至少一个已比较字段存在差异。
- `partial`：部分字段缺失，无法完成全部比较。
- 没有映射记录：未校准。

新增映射时，应在 `tests/models-dev.test.ts` 中验证 Provider、模型 ID 和参考 URL。

## 8. 接入官方 Models API 清单（可选）

渠道提供 OpenAI 兼容的 Models API 时，在 `src/inventory/provider-inventory.ts` 注册：

```ts
{
  provider: "example-cn",
  env: "EXAMPLE_API_KEY",
  url: "https://api.example.cn/v1/models",
}
```

同时：

- 在 `.env.example` 中声明环境变量名。
- 在 GitHub Repository Secrets 中配置 CI 使用的密钥。
- 在 `.github/workflows/update-prices.yml` 的 `npm run discover` 步骤传入该密钥。
- 在 `tests/inventory.test.ts` 中覆盖模型与别名的比较规则。

Inventory 只用于发现模型新增、下线和别名变化，不能自动覆盖定价数据。

## 9. 更新文档和 CI

README 至少需要更新：

- 当前覆盖表。
- 国内版或其他渠道边界。
- 模型收录与过滤规则。
- 官方来源链接。
- 动态页面或特殊采集方式。
- 单渠道采集命令。
- 可选 API Key。

站点默认直接读取 `api.json`，通常不需要为新 Provider 增加专用页面。只有新增数据字段或展示语义时，才需要同步修改 `site/src/types.ts` 和相关组件。

如果采集器依赖 Playwright、额外系统包或新的密钥，需要同步更新 `.github/workflows/update-prices.yml`。

## 10. 验收流程

依次运行：

```bash
npm run collect -- --provider example-cn
npm run discover
npm run build
npm run check
npm run site:build
npm run format:check
```

没有 Models API 密钥时，可以跳过该渠道的 Inventory 请求，但已有清单快照不能被删除或清空。

最终应确认：

- Provider JSON 通过 Schema 校验。
- `api.json` 包含新渠道。
- 模型和价格都能追溯到官方来源。
- 过滤规则不会混入范围外模型。
- 不存在伪造的缓存价、币种或缺失字段。
- models.dev 和 Inventory 不会覆盖官方数据。
- 类型检查、测试、格式检查和站点构建全部通过。

## 提交前检查清单

- [ ] 已明确 Provider ID、渠道区域、币种和 API Base URL。
- [ ] 已明确收录和排除的模型范围。
- [ ] 已实现并注册采集器。
- [ ] 已生成 `data/providers/{provider}.json`。
- [ ] 已覆盖价格、模型元数据、过滤和失败场景测试。
- [ ] 已按需添加 models.dev 精确映射。
- [ ] 已按需添加 Models API Inventory。
- [ ] 已更新 README、环境变量和 CI。
- [ ] 已重新生成 `api.json`。
- [ ] 已运行完整验收命令。
