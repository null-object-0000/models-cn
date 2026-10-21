# 任务：修智谱采集（定价接口结构变更 + 发布记录格式变更）

## 现状（已定位，别重复摸索）

CI 的 update 步骤**是绿的**（数据源异常 0），但数据里出现：6 个模型"下线"、`createdAt` 全变 null、`capabilities` 全变 false。
**这些多数是解析失败，不是真下架** —— 判据：真下架不会让官方字段变 null。

### 故障一：定价接口「旗舰模型」结构变了

`https://bigmodel.cn/api/biz/operation/query?ids=1160,1161`（国际站对应 1163,1164）：

| operation                    | 渠道 | 现在的结构                                                   |
| ---------------------------- | ---- | ------------------------------------------------------------ |
| **1160** 旗舰模型            | CN   | **`content.list[]`（新）**，2 项                             |
| 1161 其它模型和服务          | CN   | `content.tabs[].cards[]`（老，仍可用）                       |
| **1163** Flagship Models     | INTL | **`content.list[]`（新）**，2 项                             |
| 1164 Other Models & Services | INTL | `content.tabs[].cards[]`（老；该对象同时带一个空 `list` 键） |

**新 `list[]` 的形状（真实样本）：**

```json
"list": [{
  "title": "GLM-5.3", "tag": "最新旗舰", "desc": "...",
  "table": {
    "fieldList": [{"code":"c5180"},{"code":"c6039"}],     // 动态字段码
    "modelList": [
      {"c5180":{"value":"上下文"},     "c6039":{"value":"1M"}},
      {"c5180":{"value":"输入单价"},   "c6039":{"value":"8元 / M"}},
      {"c5180":{"value":"输出单价"},   "c6039":{"value":"28元 / M"}},
      {"c5180":{"value":"缓存命中"},   "c6039":{"value":"2元 / M"}},
      {"c5180":{"value":"缓存存储"},   "c6039":{"value":"限时免费"}},
      {"c5180":{"value":"输入模态"},   "c6039":{"value":"文本"}}
    ]
  }
}]
```

> 字段码**每次都可能变**（c5180/c6039/c6522/c8012…），所以必须**按 modelList 行里的中文/英文标签取值**，不能写死 code。
> 国际站同一结构，值为 `$0.3 / M` 之类。

**真实样本已存**：`docs/zhipu-fixtures/op-1160.json`、`op-1161.json`、`op-1163.json`、`op-1164.json`。

### 故障二：发布记录页（createdAt 来源）格式变了

`https://docs.bigmodel.cn/cn/update/new-releases.md` 以前是 MDX 组件：

```
<Update label="2026-06-16" description="...">...</Update>
```

**现在是纯 markdown：**

```
## 公告通知

**2026-08-26**

👀 [**GLM-5.3-Flash**](/cn/guide/models/vlm/glm-5.3-flash)

* 原生融入视觉能力，……
```

→ 日期在 `**2026-08-26**` 独立一行，紧跟着的 bullet 里 `[**模型名**](链接)` 才是模型。

## 要做的

1. **改 `src/collectors/zhipu.ts`**：
   - 定价解析**同时支持两种结构**：老的 `tabs[].cards[]`、新的 `list[].table.modelList[]`；
   - 新结构按 `modelList` 行里的标签取值（`上下文 / 输入单价 / 输出单价 / 缓存命中 / 缓存存储 / 输入模态`；国际站英文标签）；
     标签集合对不上就**报错**，不许静默产出空价格；
   - `createdAt` 解析新 markdown 格式，**保留老 `<Update>` 作为兜底**；
   - 任何"读不到字段"的情况**必须报错或计入 health 异常**，**绝不**写成 `null` / `false` 混进数据
     （这正是这次假 PR 的成因）。
2. **测试**：`tests/zhipu.test.ts` 用上面四个真实样本 + 真实 markdown 片段做 fixture；
   正例：新 `list` 结构（CN 元 / INTL 美元）、老 `tabs` 结构、两种 createdAt 格式；
   反例：字段码对不上、`list` 为空、markdown 无日期 → 必须报错。
3. **本地实测** `--provider zhipu-cn` 与 `--provider zhipu-intl`，把采集到的模型清单 + 首个模型的价格写进报告。
4. **逐个核实"下线"的 6 个模型是真下架还是漏读**：用浏览器打开 `https://bigmodel.cn/pricing`（国际站 `https://docs.z.ai/guides/overview/pricing`），
   在渲染后的页面文本里搜模型名；**页面上确实没有 → 真下架**；有 → 我们漏读，必须修。结论逐条写进报告。
5. 验证链：`npx vitest run` → `npm run validate` → `npm run build` → `npx prettier --check .`。
6. `git checkout -- data/` 丢掉本地采集产生的数据改动，只提交 `src` + `tests` + `docs/`。
7. 开 PR → checks 绿 → 合并 → `gh workflow run update-prices.yml --ref main` → 确认全绿，且**新开的自动 PR 里不再有 createdAt/capabilities 变 null 的条目**。

## 红线

- 不许放宽 health 断言、不许跳过 provider 来"变绿"；
- 不许把解析失败写成"模型下线/字段为 null"；
- 不许引入新依赖。
