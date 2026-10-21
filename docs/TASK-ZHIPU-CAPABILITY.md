# 任务：把「能力未公布」与「能力解析失败」分开（最后一个阻塞，收尾转绿）

## 现状

日期二分已合并（#63 / #64），INTL 5 个模型的 `not-documented` 路径已生效。
**main workflow 仍 failure，唯一阻塞**：CN 的 `glm-4-long` 缺官方能力证据，原断言直接报错。

**已核实（别再查）**：`https://docs.bigmodel.cn/cn/guide/models/text/glm-4-long.md` 全文 6115 字节，
只有：概览 / 价格（1 元每百万 tokens）/ 输入模态（文本）/ 输出模态（文本）/ 上下文窗口（1M）/ 最大输出（4K）/ 推荐场景。
**没有能力区**（无 工具调用 / 思考 / JSON / 函数调用 等任何条目）。这是官方未公布，不是漏读。

## 要做的（与日期二分同一套原则，属**加严**）

把「缺能力」拆成两种情形，只有第一种报错：

| 情形           | 判据                                                                  | 处理                                                                                                           |
| -------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **解析失败**   | 页面**存在能力区**（能力区块标题/模板命中），但字段读不出或模板不认识 | **报错**（红线，防漏读回归）                                                                                   |
| **官方未公布** | 页面**完全没有能力区**（连区块标题都没有）                            | `capabilities: null` + `capabilitiesSource: "not-documented"`；health 里以 **warnings** 单独计数并**点名模型** |

约束：

- `not-documented` **只允许**在"页面完全没有能力区"时出现；有区块但解析失败必须抛错，不许打标记绕过；
- 有能力区且解析成功的模型写 `capabilitiesSource: "docs"`（或等价值）；
- 不许把 `capabilities` 写成全 `false`（那是"不支持"的谎言，也是上次假 PR 的症状之一）；
- health 摘要必须能看见 `glm-4-long` 这个名字。

## 展示层要同步（别留坑）

`site/` 依赖 `capabilities` 做标签与筛选（`site/src/lib/catalog.ts` 一带）：

- 类型改为可空；**筛选不能把 null 当 false**（应归入"未知"，不参与"支持/不支持"筛选）；
- 页面展示写「未公布」而不是空白或"不支持"。

## 验收

1. 测试（真实 fixture）：正例 = 页面有能力区且解析成功（`docs`）/ 页面无能力区（null + `not-documented`）；
   反例 = 有能力区但字段缺失或模板不认识 → **必须抛错**；给解析失败的模型打 `not-documented` → **必须被拒绝**；
2. 本地实采 `zhipu-cn` + `zhipu-intl` → 两渠道 healthy，warnings 里能看到 `glm-4-long` 和 INTL 那 5 个日期缺项；
3. 验证链：`npx vitest run` → `npm run validate` → `npm run build` → `npx prettier --check .`；
4. `git checkout -- data/`，只提交 `src` + `site` + `tests` + 文档；
5. PR → checks 绿 → 合并 → `gh workflow run update-prices.yml --ref main` →
   **必须 conclusion=success**；若开出自动 PR，逐字段确认没有误下线 / 日期清空 / 能力变 false；
6. 更新 `docs/ZHIPU-STRUCT修复.md`：写清判据、为什么是加严、最终 run id 与 conclusion。

## 红线

- 不许打 `not-documented` 掩盖解析失败；
- 不许跳过 provider、不许删断言、不许把 null 记成 false。
