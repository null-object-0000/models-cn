# 任务：修 Kimi 定价采集（上游改版：markdown 表格变空壳，数据搬进 RSC 流）

## 现状（已定位，别重复摸索）

- CI 失败：`moonshot-cn` / `moonshot-intl` → **`Kimi pricing page is missing its rows table`**
- 根因：`https://platform.kimi.com|.ai/docs/pricing/chat` 的 **markdown 端点现在只给空表** ——
  `<table><thead><tr /></thead><tbody /></table>`，**行数据整块没了**（HTML 版同样是 Next.js 客户端渲染，没有 `<td>`）。
- **数据还在，搬进了 RSC flight 流**：
  ```
  curl -H 'RSC: 1' -H 'Accept: */*' -H 'User-Agent: Mozilla/5.0' <url>
  ```
  流里有表格对象：`columns:[{title:`模型`,width:`16%`},...],rows:[[`kimi-k3`,`1M tokens`,`¥20.00`,...],...]`
  （字符串用**反引号**包，不是 JSON 双引号）。

## 原始样本已存好（直接读，别自己再猜结构）

- `docs/kimi-rsc-samples/cn-rsc.txt`（platform.kimi.com，中文）
- `docs/kimi-rsc-samples/intl-rsc.txt`（platform.kimi.ai，英文）

**已核实的结构差异（关键，必须分别处理）：**

|           | 表一（K3 系列）                                                                                                                       | 表二（K2 系列）                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| CN 列数   | **8 列**：模型 / 计费单位 / 缓存写入(TTL 5min) / 缓存写入(TTL 1h) / 输入价格(缓存命中) / 输入价格(缓存未命中) / 输出价格 / 上下文窗口 | **6 列**：模型 / 计费单位 / 输入价格(缓存命中) / 输入价格(缓存未命中) / 输出价格 / 上下文窗口 |
| CN 行示例 | `kimi-k3, 1M tokens, ¥20.00, ¥40.00, ¥2.00, ¥20.00, ¥100.00, 1,048,576 tokens`                                                        | `kimi-k2.7-code, 1M tokens, ¥1.30, ¥6.50, ¥27.00, 262,144 tokens`                             |

- **国际站（intl）货币被拆成两个单元格**：`['$','3.00']`、`['$','6.00']` ——
  解析时要把「只有一个货币符号的单元格」与**紧随其后的数字**合并成 `$3.00`（这是历史坑，MDX 的 `<>{"$"}3.00</>`）。
- 国际站列名：`Model / Unit / Cache Write Price (TTL 5min) / Cache Write Price (TTL 1h) / Cached Input Price / Input Price / Output Price / Context Window`。

## 要做的

1. **改 `src/collectors/moonshot.ts`**：
   - 取数改为 **RSC 请求**（`RSC: 1` + `Accept: */*`），保留现有 markdown 抓取作为**兜底**；
   - **按列标题解析，不写死列序**（现有 `COLUMN_PATTERNS` 的模式是对的，扩展中英文列名即可）；
   - 支持同一页**两张表、列数不同**（K3 8 列 / K2 6 列），各自按自己的 columns 定位；
   - 处理国际站「货币符号独立单元格」的合并；
   - **解析失败必须报错，不能被静默当成"模型下线"**（这正是这次假 PR #56 的成因）。
2. **更新 fixture 与测试**：`tests/moonshot.test.ts` 用**真实 RSC 片段**做 fixture（不要手写简化到掩盖问题），
   正例覆盖两张表 + 国际站拆列；反例覆盖"表格为空壳 → 必须报错"。
3. **本地实测**：对 cn / intl 两个渠道各跑一次真实采集，确认 healthy，
   并把采集到的模型 id 列表写进报告（对比修复前"下线 6 个"的假象）。
4. 验证链：`npx vitest run` → `npm run validate` → `npm run build` → `npx prettier --check .`（必要时 `--write`）。
5. **`git checkout -- data/`** 丢掉本地 collect 产生的数据改动（CI 自己产），只提交 `src` + `tests` + `docs/kimi-rsc-samples/`。
6. 开 PR → `gh pr checks` 等绿 → 合并 → **`gh workflow run update-prices.yml --ref main`** 手动跑一次，
   确认：**全绿**、**没有开出新的"下线模型"PR**。
7. 报告 `docs/KIMI-RSC修复.md`：根因、结构差异、改了哪些文件、采集验证输出、不确定项（≥3 条）。

## 红线

- 不许为了"让 health 变绿"去放宽断言或跳过 provider；
- 不许把"解析失败"记成"模型下线/价格为空"；
- 不许引入新的依赖（用现有 fetch + 正则即可）。
