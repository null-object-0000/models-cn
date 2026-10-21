# 任务：修正「能力区存在但没列某项」的判据（最后一改，收尾转绿）

## 现状

#65/#66 已把「无能力区 → null + not-documented」做完。
main workflow 现在唯一失败：**GLM-4 页有能力区，但两个 Flash 模型缺 `thinking`**（`glm-4-flashx-250414`、`glm-4-flash-250414`）。

**已核实**：`https://docs.bigmodel.cn/cn/guide/models/text/glm-4.md` 的「## 能力支持」区只列了：

```
流式输出 / Function Calling / 上下文缓存 / 结构化输出 / MCP
```

**整页「思考」出现 0 次** —— 老模型本来就不支持思考。

## 结论：现在的判据错了

"能力区存在但缺某个字段 → 报错" 这个规则，把 **"页面明确没列 = 不支持"** 误判成 **"解析失败"**。
正确语义：**能力区是"该模型支持什么"的白名单** —— 列了就 true，没列就 false。

## 要改成的规则（三分）

| 情形                         | 判据                                          | 结果                                                                                                         |
| ---------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 有能力区，解析出 **≥1 项**   | 白名单里有该能力 → `true`；没有 → **`false`** | 写 `capabilitiesSource: "docs"`，并在 `capabilitiesEvidence` 里区分 **parsed** 与 **defaulted-false** 的字段 |
| 有能力区，但 **0 项** 能识别 | 模板漂移                                      | **报错**（保留，防漏读回归）                                                                                 |
| **完全没有能力区**           | 官方未公布                                    | `capabilities: null` + `capabilitiesSource: "not-documented"` + health warning（已实现，别动）               |

关键：

- **不许**把"有能力区但 0 项识别"也当成 false —— 那才是真漏读；
- `capabilitiesEvidence` 必须能看出每个字段是"页面明确列了"还是"按白名单默认 false"（可审计）；
- 已有的 `not-documented` 相关断言、日期二分、Kimi 相关逻辑**一律不动**。

## 验收

1. 测试（真实 fixture，用真实 glm-4 页面片段）：
   - 正例：能力区有 `流式输出/Function Calling/上下文缓存/结构化输出/MCP`、无 `思考` → `thinking: false`，evidence 标明 defaulted；
   - 正例：能力区列出 `思考` → `thinking: true`，evidence 标明 parsed；
   - **反例**：能力区 0 项可识别 → 必须抛错；
   - 反例：无能力区 → 仍是 null + not-documented（回归保护）；
2. 本地实采 `zhipu-cn` + `zhipu-intl` → 两渠道 healthy；
3. 验证链：`npx vitest run` → `npm run validate` → `npm run build` → `npx prettier --check .`；
4. `git checkout -- data/`，只提交 `src` + `tests` + 文档；
5. PR → checks 绿 → 合并 → `gh workflow run update-prices.yml --ref main` →
   **必须 conclusion=success**；若有自动 PR，逐字段确认无误下线 / 日期清空 / 能力变 false；
6. 报告补一段：为什么"没列 = false"是对的（能力区是白名单）、以及 evidence 怎么区分 parsed / defaulted。

## 红线

- 不许把"0 项识别"当 false；
- 不许动已完成的日期二分与 not-documented 逻辑；
- 不许跳过 provider、不许删断言。
