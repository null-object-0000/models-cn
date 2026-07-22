# models-cn

中国大陆大模型厂商官方 API 定价数据。

本项目采集厂商在中国大陆官方渠道提供的自研模型价格，不收录聚合平台或厂商托管的第三方模型。人民币价格来自中文官方定价页；厂商同时提供独立国际价格时，也会原样保留官方美元价格，不做汇率换算。

## 当前支持

| 厂商     | 自研模型      | CNY | USD | 基础信息 |
| -------- | ------------- | --- | --- | -------- |
| DeepSeek | DeepSeek 系列 | ✅  | ✅  | ✅       |
| LongCat  | LongCat 系列  | ✅  | ✅  | ✅       |
| Kimi     | Kimi 系列     | ✅  | —   | ✅       |

DeepSeek 数据源：

- [中文模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)
- [英文 Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)

LongCat 数据源：

- [中文模型与价格](https://longcat.chat/platform/docs/zh/pricing/long-cat-2.0)
- [英文 Models & Pricing](https://longcat.chat/platform/docs/pricing/long-cat-2.0)
- [模型详情接口文档](https://longcat.chat/platform/docs/zh/api/model)

Kimi 数据源：

- [模型推理价格说明](https://platform.kimi.com/docs/pricing/chat)
- [模型参数参考](https://platform.kimi.com/docs/api/models-overview)
- [官方模型列表接口](https://platform.kimi.com/docs/api/list-models)

## 数据文件

- `data/providers/deepseek.json`：DeepSeek 的规范化数据
- `data/providers/longcat.json`：LongCat 的规范化数据
- `data/providers/moonshot.json`：Kimi 的规范化数据
- `data/calibration/models-dev.json`：与 models.dev 的逐字段校准结果
- `data/inventory/{provider}.json`：官方模型列表接口返回的实时可用模型基准
- `api.json`：所有厂商合并后的统一入口
- `schema/provider.schema.json`：厂商数据 JSON Schema

价格统一使用每百万 Token，`market` 和 `currency` 明确区分中国区人民币价与国际美元价：

```json
{
  "market": "china",
  "currency": "CNY",
  "unit": "1M_tokens",
  "rateType": "standard",
  "input": {
    "cacheHit": 0.02,
    "cacheMiss": 1
  },
  "output": 2
}
```

## 本地开发

需要 Node.js 22+ 和 npm 10+：

```powershell
npm install
Copy-Item .env.example .env
# 编辑 .env，填入新生成的 API Key
npm run collect
npm run discover
npm run build
npm run check
```

LongCat 的公开文档足以完成基础采集。若希望同时调用官方模型接口校验元数据和当前价格，可在 `.env` 中设置：

```dotenv
DEEPSEEK_API_KEY=your-new-key
LONGCAT_API_KEY=your-new-key
MOONSHOT_API_KEY=your-new-key
```

GitHub Actions 中请将新 Key 配置为对应名称的 Repository Secret。不要将 Key 写入代码、数据文件或 Actions YAML。

模型清单发现需要各厂商的 API Key，`npm run collect` 和 `npm run discover` 会自动读取项目根目录的 `.env`。系统环境变量或 GitHub Actions 注入的变量优先于 `.env`。

GitHub Actions 对应使用 `DEEPSEEK_API_KEY`、`LONGCAT_API_KEY` 和 `MOONSHOT_API_KEY` 三个 Repository Secrets。未配置某个 Key 时会跳过该厂商并保留已有清单。

采集器会校验官方页面结构。关键表格消失、字段缺失或价格无法解析时会直接失败，不会用空数据覆盖已有结果。标准价和限时优惠价分别以 `standard`、`promotional` 保存。只有规范化后的官方数据发生变化时，数据源的 `retrievedAt` 才会更新。

## 自动更新

GitHub Actions 每天检查一次官方价格。检测到数据变化后会更新 `bot/update-model-prices` 分支并创建 Pull Request，等待人工核对后合并。

## 官网

官网是读取 `api.json` 的纯静态页面，支持模型搜索、人民币/美元切换、标准价/优惠价切换，以及校准和模型清单状态展示。

本地预览：

```powershell
npm run update
npm run site:dev
```

生产构建：

```powershell
npm run site:build
```

构建产物位于 `dist/site`。`.github/workflows/deploy-pages.yml` 会在 `main` 分支更新后自动构建并发布到 GitHub Pages。首次使用时，在仓库的 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。

## models.dev 校准

采集完成后会从 [models.dev API](https://models.dev/api.json) 获取对应模型的美元价格、上下文、输出上限、模态和能力信息，生成逐字段的 `match`、`mismatch` 或 `missing` 结果；模型级的 `partial` 表示部分字段因官方未披露而无法比较。校准数据只作为参考，不会覆盖厂商官方数据；models.dev 暂时不可用时，也不会阻止官方价格采集。

## 模型清单基准

每个厂商通过官方模型列表接口维护当前可调用模型基准，并与价格采集结果比较：

- `listedWithoutPricing`：API 已出现，但项目尚无价格
- `pricedButNotListed`：价格页仍存在，但 API 已不再列出
- `aliasesAndListed`：仍可调用的兼容别名
- `activeAliasesNotListed`：尚未到弃用时间，但 API 已提前移除的别名

清单差异用于触发人工检查，不会自动新增、删除或改写价格记录。

## License

MIT
