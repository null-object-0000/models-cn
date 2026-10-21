# Kimi RSC 定价采集修复

## 根因与真实结构

2026-10-21，Kimi 定价页的 markdown/HTML 表格已成为 `<tbody />` 空壳。真实定价仍在 `RSC: 1` 请求返回的 Flight 流中，位于编译后 MDX 的 `DocTable` 参数，而非 JSON 表格。

解析依据为 `docs/kimi-rsc-samples/cn-rsc.txt`、`intl-rsc.txt` 原始样本。通过 `mdxSource.compiledSource` 的 `$记录号` 引用定位 `记录号:T十六进制字节长度,正文`；长度按 UTF-8 字节计算。只读正常 MDX：CN 的 `mdxSourceWithNoJs` 重复携带定价，国际站的对应版本只有列头，混读会造成重复模型或空表误判。

| 结构   | CN                                  | 国际站                                                                          |
| ------ | ----------------------------------- | ------------------------------------------------------------------------------- |
| K3 表  | 8 列，含 5min / 1h 两种缓存写入价格 | 8 列，同样按 TTL 分价                                                           |
| K2 表  | 6 列，无缓存写入价格                | 6 列，命中/未命中列名与 K3 不同                                                 |
| 字符串 | 反引号，金额如 `¥20.00`             | 反引号，金额是 `_jsxs(_Fragment,{children:[` + 反引号包围的 `$`、`3.00` + `]})` |

各表分别按中英文列标题定位价格、单位和上下文。Fragment 的货币符号与数字先合并；平铺的独立符号单元与紧随数字也合并，再校验行宽。

## 修改文件

- `src/collectors/moonshot.ts`：定价优先 RSC，元数据仍请求 markdown；RSC 请求或解析失败后尝试原 markdown 路径，两者都失败时包含两路原因并抛错。保留网络层重试，解析本身不重试；不执行上游 JavaScript，不引入依赖。
- `tests/fixtures/kimi-cn-rsc.txt`、`kimi-intl-rsc.txt`：直接截取原样本的正常 MDX 文本记录与实际引用行，保留国际站 Fragment 表达式。
- `tests/fixtures/kimi-intl-markdown.mdx`：保留原测试中的旧 MDX 格式，仅用于兜底回归。
- `tests/moonshot.test.ts`：真实多表、多列数、全模型价格、列重排、完整 Flight 去重、拆币种单元、RSC 请求头、markdown 兜底成功/失败，以及空壳、缺行、坏金额、截断、行宽不符反例。
- `tests/collector-retry.test.ts`：改用真实 RSC fixture；解析失败时断言 4 次请求，即 RSC、markdown 兜底和两个元数据来源各一次，未放宽重试行为。
- `docs/kimi-rsc-samples/`：提交用户提供的原样本；本报告记录取证和验证。

空表、局部坏表、缺列、异常单元、非百万 token 单位均抛错，不能返回空模型集。现有 CLI 捕获失败后保留旧模型并标记源错误；没有修改健康断言或跳过 provider。

## 本地真实采集

执行：

```sh
npm run collect -- --provider moonshot-cn
npm run collect -- --provider moonshot-intl
```

| 渠道          | 最近成功时间（UTC）      | 状态    | 连续失败数 | 模型数 |
| ------------- | ------------------------ | ------- | ---------- | ------ |
| moonshot-cn   | 2026-10-21T06:14:06.323Z | healthy | 0          | 4      |
| moonshot-intl | 2026-10-21T06:14:24.916Z | healthy | 0          | 4      |

两渠道模型 ID 均为：`kimi-k3`、`kimi-k2.7-code`、`kimi-k2.7-code-highspeed`、`kimi-k2.6`。

| 模型                     | CN 命中 / 未命中 / 输出（CNY / 1M tokens） | 国际站命中 / 未命中 / 输出（USD / 1M tokens） |
| ------------------------ | ------------------------------------------ | --------------------------------------------- |
| kimi-k3                  | 2 / 20 / 100                               | 0.30 / 3 / 15                                 |
| kimi-k2.7-code           | 1.30 / 6.50 / 27                           | 0.19 / 0.95 / 4                               |
| kimi-k2.7-code-highspeed | 2.60 / 13 / 54                             | 0.38 / 1.90 / 8                               |
| kimi-k2.6                | 1.10 / 6.50 / 27                           | 0.16 / 0.95 / 4                               |

K3 的 5min / 1h 缓存写入价格为 CN 20 / 40、国际站 3 / 6。国际站实采经历短暂连接失败，网络层重试后成功。

对照已关闭的 [假 PR #56](https://github.com/null-object-0000/models-cn/pull/56)：其中 Kimi 两个价格源显示错误，但报告中的“下线 6 个”全部属于智谱（CN 1 个、国际站 5 个），不能把这 6 个计为本修复恢复的 Kimi 模型。本修复明确恢复的是两个 Kimi 价格源与各 4 个在售模型的有效定价。

## 验证与提交边界

验证链：`npx vitest run` → `npm run validate` → `npm run build` → `npx prettier --check .`，另运行 `npm run typecheck`。全量测试覆盖全部 provider。采集及构建生成的数据用 `git checkout -- data/` 恢复；构建产物 `api.json` / `v1/api.json` 同样恢复，不随代码 PR 提交。

远端验收在代码 PR 检查通过并合并后，执行 `gh workflow run update-prices.yml --ref main`；检查该次运行的每一步和自动 PR 中的模型清单。运行链接与最终结果记录在交付说明中，不将本地验证等同于远端全绿。

## 不确定项与边界

1. Flight / MDX 编译格式不是稳定公开的数据协议；未来记录引用、字符串转义、Fragment 形式或组件名称变化可能需要适配。当前遇到不支持的表达式明确报错，保留 markdown 兜底。
2. 缓存 TTL 以当前官方表头为依据；新 TTL、新币种或非 `1M tokens` 单位不能直接沿用现有含义，当前异常会触发失败。
3. 采集结果是上述时间点的官方在售列表，不证明历史模型全部永久下线；模型移除必须结合官方来源核实。
4. #56 的智谱模型减少及能力字段变化与本次 Kimi 根因独立；修复 Kimi 不能证明那些智谱变化为真，也不能保证自动工作流不会因其他 provider 的实质变化创建 PR。
5. 外部网络、GitHub 密钥和其他 provider 的可用性由合并后的完整工作流实测；本地两渠道成功不能替代该项验收。
