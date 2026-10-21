# 任务：把 createdAt 缺失拆成「解析失败」与「官方未公布」两种情形（收尾让 pipeline 转绿）

## 现状

智谱解析已修好（#60 / #62），CN 3 个模型齐全。**但 main workflow 仍 health 失败**，原因：
INTL 有 5 个模型没有 `createdAt`：

```
glm-5.3-flashx, glm-4.7-flashx, glm-4.5-air, glm-4.5-airx, glm-4.5-flash
```

**已核实（别再查一遍）**：这 5 个在官方页面**确实没有发布日期** ——

- `https://docs.z.ai/release-notes`（= `/release-notes/new-released`，4955 字节）搜不到任何一个；
- `https://docs.bigmodel.cn/cn/update/new-releases.md` 也搜不到；
- 它们只出现在 `https://docs.z.ai/guides/overview/pricing` 的 **Other Pricing 引用块**里（有价格、无日期）；
- 各模型文档页（`/guides/llm/glm-4.6` 等）也没有 release date 字段。

所以这是**官方未公布**，不是我们漏读。但现在的门禁要求"每个已选模型必须有 createdAt"，于是永远红。

## 要做的（这是**加严**，不是放宽 —— 说明理由）

把"缺 createdAt"拆成两种情形，**只有第一种报错**：

| 情形           | 判据                                                               | 处理                                                                                                                              |
| -------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **解析失败**   | 模型名**在发布记录页文本里出现过**（哪怕只是一次），但没解析出日期 | **报错**（保持现有严格性，防漏读回归）                                                                                            |
| **官方未公布** | 模型名**从未在发布记录页出现**，但有官方定价                       | 允许 `createdAt: null`，**必须**写 `createdAtSource: "not-documented"`；health 里以 **warnings 单独计数并列出模型名**，不判 error |

关键约束（防滥用）：

- `createdAtSource: "not-documented"` **只允许**在上述第二种情形出现；解析失败的情形一律报错，不许打这个标记绕过；
- 有日期的模型必须写 `createdAtSource: "release-notes"`（或等价值）；
- **health 摘要里必须能看见这 5 个模型名**，不能悄悄通过；
- 不许删掉原来"已选模型必须有日期"的断言 —— 而是把它**改写为按上面两种情形分别断言**（解析失败仍必须抛错）。

## 实现与验收

1. 改 `src/collectors/zhipu.ts`（及 `src/health.ts` 或等价位置）：实现上面的二分逻辑与 `createdAtSource` 字段；
2. 类型/校验（`src/types.ts`、`src/cli/validate.ts` 等）如需要同步；
3. 测试（真实 fixture）：
   - 正例：模型在发布记录里出现且有日期 → `release-notes`
   - 正例：模型只在定价引用块出现、发布记录里完全没有 → `createdAt: null` + `not-documented`，health 记 warning
   - **反例**：模型**在发布记录文本里出现**但日期解析失败 → **必须抛错**
   - 反例：给"解析失败"的模型打 `not-documented` → 必须被校验拒绝
4. 本地实采 `zhipu-cn` + `zhipu-intl`，确认两渠道 health = healthy（warnings 里能看到那 5 个）；
5. 验证链：`npx vitest run` → `npm run validate` → `npm run build` → `npx prettier --check .`；
6. `git checkout -- data/`，只提交 `src` + `tests` + 文档；
7. 开 PR → checks 绿 → 合并 → `gh workflow run update-prices.yml --ref main` →
   **必须看到该 run 全绿（conclusion=success）**，并确认新开的自动 PR 里：
   - 没有模型误下线、没有 createdAt 被清空、没有 capabilities 变 false；
   - 若开 PR：diff 只有合理的时间戳/校准变化。
8. 更新 `docs/ZHIPU-STRUCT修复.md`：写清"为什么这是加严而非放宽"、两种情形判据、warning 长什么样、最终 run id 与结论。

## 红线

- 不许打 `not-documented` 掩盖解析失败；
- 不许跳过 provider、不许降低其它断言；
- 不许为了让 CI 绿而改动采集范围。
