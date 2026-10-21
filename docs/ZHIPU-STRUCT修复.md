# 智谱结构变更修复与验收记录

核验日期：2026-10-21（北京时间）。本报告区分解析恢复、完整采集和远端验收；发现的缺项不视为下线，也不填造日期或能力。

## 修复内容

- `1160/1163`：支持 `list[].table`，从 `fieldList[].code` 动态取出每行标签与值，再匹配中英文标签。要求上下文、输入、输出、缓存命中、缓存存储、输入模态六类标签齐全。字段码失配、缺单元格、空旗舰列表、标签失配均抛错，即使另一个 operation 仍有有效卡片也不能掩盖错误。
- `1161/1164`：保留 `tabs[].cards[].fieldList`，允许 1164 在有效 tabs 之外携带空 list。明确的非 token 服务不作为文本模型采集。未声明缓存能力的纯图片/PDF OCR 卡片不虚构缓存价格。
- 国内首页只展示部分模型；补读该页“详细价格”实际指向的[官方完整价表](https://docs.bigmodel.cn/cn/guide/start/pricing)，按模型合并，首页配置优先。支持输入/输出多维分档及引用块中的旧模型，补记价表来源。
- 发布日期：支持独立 `**YYYY-M-D**` 行及随后模型链接，保留旧 `<Update label="...">`；归一化日期并取最早公告，非法日期和完全没有可用日期均报错。逐个已选模型必须有日期，不能让全局解析成功掩盖某个模型缺失。
- 能力：兼容旧 Card、普通列表、引用块中的粗体链接。缺能力区块、没有可识别标题、单个能力字段缺失均报错；只有官方明确写“不支持”才允许 false。
- 只为有定价的概览模型读取详情。已选模型的日期、上下文、最大输出和三个能力布尔字段均在输出前校验；错误交给现有 collect CLI，保留上次成功数据并将 health 标成 error。
- 没有新增依赖，没有修改 health 断言，也没有跳过任何 provider。

## 真实 fixture 与测试

`docs/zhipu-fixtures/op-1160.json`、`op-1161.json`、`op-1163.json`、`op-1164.json` 是任务提供的真实 operation 响应；JSON 仅做格式化，content 字符串保留原始字段结构。补存当日官方 `new-releases.md`、国内/国际完整定价 markdown、两种能力区块片段。旧 MDX 日期正例保留已有历史测试片段。

正例覆盖四个真实 operation、中英文价格、动态字段码替换及乱序行、新旧发布日期格式、两种日期补零形式、能力三种模板、国内分档、国际引用块中的五个模型。反例覆盖字段码与单元格不匹配、字段标签改名、空 list、缺单元格、无日期、非法日期、空/未知/部分缺失能力区块、已选模型缺元数据。原“空能力区块返回全 false”和“无日期返回空 Map”断言改为必须抛错。

## 六个“下线”模型逐项核查

原始名单来自[已关闭的假 PR #58](https://github.com/null-object-0000/models-cn/pull/58)。

| 渠道 / 模型             | 核查证据                                                                                                                                                                          | 结论与验收状态                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| CN / `glm-5.2`          | 浏览器打开 `https://bigmodel.cn/pricing`，渲染后的常见问题文本明确列出 GLM-5.2：输入 8 元、缓存命中 2 元、输出 28 元；点击“详细价格”打开官方价表，markdown 文本模型表亦有相同价格 | 首页配置没列全，属于漏读，不能算真下架；已补完整价表       |
| INTL / `glm-4.7-flashx` | 官方 pricing.md 的 Other Pricing 引用块仍有一行：输入 0.07、缓存 0.01、输出 0.4 美元                                                                                              | 解析器漏读引用块；fixture 回归已恢复，浏览器渲染核验未完成 |
| INTL / `glm-4.5-air`    | 同一官方引用块：输入 0.2、缓存 0.03、输出 1.1 美元                                                                                                                                | 解析器漏读引用块；fixture 回归已恢复，浏览器渲染核验未完成 |
| INTL / `glm-4.5-airx`   | 同一官方引用块：输入 1.1、缓存 0.22、输出 4.5 美元                                                                                                                                | 解析器漏读引用块；fixture 回归已恢复，浏览器渲染核验未完成 |
| INTL / `glm-4.7-flash`  | 同一官方引用块：输入、缓存、输出均 Free                                                                                                                                           | 解析器漏读引用块；fixture 回归已恢复，浏览器渲染核验未完成 |
| INTL / `glm-4.5-flash`  | 同一官方引用块：输入、缓存、输出均 Free                                                                                                                                           | 解析器漏读引用块；fixture 回归已恢复，浏览器渲染核验未完成 |

国内页的浏览器可访问性树已成功读取，包含上述 GLM-5.2 的实际渲染文本。随后读取新开的完整价表标签时浏览器连接超时，之后 CUA 返回连接关闭，重连及重置均失败。因此不能把国际站 markdown 证据冒充“浏览器已核验”，也不能把这五个模型认定为真下架。尚需在浏览器展开国际站 Other Pricing，逐项完成渲染文本核对。[国际官方定价页](https://docs.z.ai/guides/overview/pricing)。

## 本地实测

实际执行：

```sh
npm run collect -- --provider zhipu-cn
npm run collect -- --provider zhipu-intl
```

最终两条命令均进入真实网络采集，再因官方发布记录缺少部分已选模型的独立日期而明确失败。CLI 按既有机制退出码为 0，但 provider health 为 error；这不是采集成功，必须继续查看 health。原数据完整保留，未生成日期清空、能力全 false 或模型误下线的新数据。

真实完整价表与概览交叉解析的候选结果如下，**这些是价格解析结果，不是通过全部元数据校验的已发布采集结果**：

- CN（14）：`glm-5.3`、`glm-5.3-flash`、`glm-5.3-flashx`、`glm-5.2`、`glm-5.1`、`glm-5`、`glm-5-turbo`、`glm-4.7`、`glm-4.7-flashx`、`glm-4.5-air`、`glm-4-long`、`glm-4-flashx-250414`、`glm-4.7-flash`、`glm-4-flash-250414`。
- INTL（13）：`glm-5.3`、`glm-5.3-flash`、`glm-5.3-flashx`、`glm-5.2`、`glm-5.1`、`glm-5`、`glm-4.7`、`glm-4.7-flashx`、`glm-4.6`、`glm-4.5-air`、`glm-4.5-airx`、`glm-4.7-flash`、`glm-4.5-flash`。
- 首个模型 GLM-5.3：CN 输入 8、缓存命中 2、输出 28 CNY / 百万 tokens；INTL 输入 1.4、缓存命中 0.26、输出 4.4 USD / 百万 tokens。

真实 health 错误：

```text
CN: Zhipu release notes missing createdAt: glm-5.3-flashx, glm-4.7-flashx, glm-4.5-air, glm-4-long, glm-4-flashx-250414
INTL: Zhipu release notes missing createdAt: glm-5.3-flashx, glm-4.7-flashx, glm-4.5-air, glm-4.5-airx, glm-4.5-flash
```

当前[官方发布记录](https://docs.bigmodel.cn/cn/update/new-releases.md)没有这些模型各自的独立发布日期，不能直接把基座模型日期继承给变体；模型共享详情页也不等于共享发布日期。已向用户询问认可的官方补充来源，未获得前保持严格报错。GLM-4-Long 详情目前也没有可识别的能力支持区块，不能造出 false；补齐日期后仍需解决其能力来源。

## 验证与远端验收

本地最终验证链全部通过：`npx vitest run`（15 个文件、155 个测试）→ `npm run validate`（7 个 provider、6 个 inventory、manual 与 calibration）→ `npm run build` → `npx prettier --check .`；另 `npm run typecheck` 通过。Schema validate 允许数据源携带 error 状态，所以 validate/build 成功不代表 health 成功。

按任务执行 `git checkout -- data/`，同时恢复本次 build 生成的 `api.json`、`v1/api.json`，仅提交 src、tests 与 docs。远端验收待执行后补记。

### main 远端实际结果

[修复 PR #60](https://github.com/null-object-0000/models-cn/pull/60) 的 GitGuardian、CodeQL 两语言分析及汇总检查全部通过，已于北京时间 2026-10-21 14:49:37 合并，main 提交为 `5660b6c7bdbc75b5593bbb24890bf65f5b3c264d`。

随后实际执行 `gh workflow run update-prices.yml --ref main`，得到[运行 39557859020](https://github.com/null-object-0000/models-cn/actions/runs/39557859020)。该运行完成了全量 collect、discover、build、check（含类型检查、155 个测试、validate）、format:check、报告生成和自动 PR 创建；最终在 **Assert collection health** 失败。只有 `zhipu-cn`、`zhipu-intl` 两个价格源为 error，日志逐个列出了上面的缺失发布日期名单。没有放宽该断言，也没有跳过 provider；这次远端运行不是全绿。

运行生成[自动 PR #61](https://github.com/null-object-0000/models-cn/pull/61)：新增模型 0、下线模型 0、价格变化 0、模型信息变化 0、数据源异常 2。除阅读 PR 报告外，还 fetch 了 bot 分支并将两个智谱 provider 的整个 `models` 数组与 main 逐字段比较，二者均完全一致（CN 3 个、INTL 13 个，均为上次成功快照）；智谱 provider 的实质变化仅为 health 报错。因此这次没有再产出“日期被清空／能力变 false／六模型假下线”的智谱数据变更，但这是**失败后保留成功快照**的结果，不能算 14/13 个候选已完整采集成功。#61 未合并。

未通过的验收项：补齐有官方依据的独立日期与缺失能力来源，使两个价格源恢复 healthy；恢复浏览器连接并完成国际五模型的渲染文本核对；之后重新运行 main 工作流并确认全绿。当前证据不支持将这六个模型标作真实下架。

## 发布日期健康二分（2026-10-21）

本节更新此前“每个已选模型必须有日期”的规则，不覆盖上文历史运行结果。日期不再用一个缺值表示所有情况，而是分别断言：

- 在任一官方发布记录的完整文本（正文、标题或链接）出现过该完整模型名，但没有解析出日期：必须抛错，沿用失败后保留成功快照的处理。基座与变体按完整模型名区分，不能用基座日期填补变体。
- 两个官方发布记录都没有出现该模型名，且模型存在已解析的官方定价：必须显式输出 `createdAt: null`、`createdAtSource: "not-documented"`、`createdAtEvidence.releaseNotesMentioned: false`。有日期则必须输出 `createdAtSource: "release-notes"` 和出现证据。

这是加严而非放宽：原来只有“日期有无”断言，现在还要求来源、发布记录出现证据、官方定价和 warning 名单自洽。解析失败不因其他模型有日期而通过，也不能靠标注 `not-documented` 绕过；缺定价、证据缺失或矛盾同样拒绝。保留上下文、最大输出、三个能力布尔值的全部原断言，不缩减采集范围。旧成功快照没有新字段仍能读取，新采集的每个已选模型均经过严格断言。

两个真实发布记录 fixture、真实概览及完整国际价表用于回归：有日期正例；仅有价格正例；将真实发布链接改为普通正文导致日期漏读的反例；给出现过却漏读日期的模型伪标来源的反例（采集断言和 provider 校验都拒绝）；另覆盖无价格不可标记。另覆盖采集失败保留快照时保留 warnings。总计 15 个测试文件、161 个测试通过。同步修改主 schema 和 v1 schema 以及站点日期类型，允许明确的 null 与新增证据；未提交生成数据。

本地通过 Node 的环境代理实采，INTL 为 healthy（13 个模型），摘要如下，CI health 日志和自动 PR 数据源状态表均显示名单：

```text
Collection warnings: 5 model(s)
zhipu-intl: createdAt-not-documented (5): glm-5.3-flashx, glm-4.7-flashx, glm-4.5-air, glm-4.5-airx, glm-4.5-flash
```

注意：任务背景称 CN 只有 3 个且齐全，但当前 main 采集器已从完整国内价表选择 14 个模型。实采在原能力断言处失败：`Zhipu glm-4-long: Zhipu capability section has no recognized capability titles`。其详情页没有“能力支持”区块，不能凭文本中泛称的“推理能力”推断 thinking/toolCalls/jsonOutput，也不能造出 false。因此本次日期二分已使 INTL 恢复，CN 的另一项能力证据缺失仍如实为 error，尚不能声称两渠道 healthy。

本地验证链已执行：`npx vitest run` → `npm run validate` → `npm run build` → `npx prettier --check .`，另运行 `npm run typecheck`。实采后的逐模型比较确认 CN/INTL 没有误下线、原有日期清空或能力 true 变 false（CN 为失败保留快照）。提交前恢复 `data/`、`api.json` 和 `v1/api.json`。远端 PR 与 main 运行结果将在实际完成后补记。

### 日期二分修复的远端最终验收

[PR #63](https://github.com/null-object-0000/models-cn/pull/63) 的 GitGuardian、两项 CodeQL 分析及汇总检查全部通过并已合并，main 提交为 `e135ff2`。随后实际执行 `gh workflow run update-prices.yml --ref main`，得到[运行 39560675057](https://github.com/null-object-0000/models-cn/actions/runs/39560675057)，最终 `conclusion=failure`，**未达到任务要求的 success**。

该运行的 collect、discover、build、check（含 161 个测试）、format:check、报告与自动 PR 更新全部成功；唯一失败步骤为 Assert collection health。日志逐字列出上面的 5 个 INTL warnings，唯一 error 为 `official pricing: zhipu-cn (error)`，collect 日志明确归因为 `glm-4-long` 缺能力支持区块。INTL 采集 healthy、13 个模型；CN 采集失败后保留此前 3 个模型快照，不能误称它们就是本次采集范围。

运行更新了现有[自动 PR #61](https://github.com/null-object-0000/models-cn/pull/61)，bot 提交为 `f5c92b9`。已 fetch 此提交并与 `e135ff2` 逐字段核对所有 7 个 provider：下线模型 0、原有非空日期清空 0、能力 true 变 false 0；价格变化 0。两个智谱的整个 models 数组在排除新日期来源/证据字段、将显式 null 归一到原先缺省后完全一致。五项 createdAt 变化均为原先字段缺省 → 明确 null，**不是将已有日期清空**。其余智谱差异为新增来源、来源哈希、抓取时间、INTL 的 5 项 warning，以及 CN 如实记录的失败状态。其余自动数据差异包括时间戳和 models.dev 的 14 项校准变化（LongCat 参考价格/模型变化）；没有将参考价格覆盖到官方价表。#61 保持未合并。

最终未完成项：两个渠道同时 healthy、main workflow `conclusion=success`。要继续必须补上 GLM-4-Long 三个能力字段的官方依据或已有独立修复；不能删除该模型、改采集范围、继承其他模型能力、将未知能力填成 false，或跳过 health 门禁来制造成功。

## 能力健康二分（2026-10-21）

能力缺值现在按官方详情全文的证据分流：命中“能力支持／模型能力／能力介绍／功能支持”等区块标题、独立“能力／功能”标题、能力 Card/Accordion 模板或能力文档链接时，必须严格解析思考、工具调用、结构化输出三个字段。标题存在但模板不认识、某个字段缺失，均抛错；不会捕获解析错误后降级。只有这些区块及模板完全不存在，才输出 `capabilities: null`、`capabilitiesSource: "not-documented"`、`capabilitiesEvidence.sectionPresent: false`。介绍正文或“推理能力”等叙述性小标题不作为能力支持区。有区块且全部解析成功则写 `docs` 和 `sectionPresent: true`。

这是加严：原来的能力字段类型断言保留在有能力区的分支，新增来源、区块存在证据和 warning 名单的交叉校验；采集元数据断言与 provider 校验都会拒绝有区块却强打 `not-documented`、缺证据、null/来源矛盾和 warning 缺漏。`capabilities-not-documented` 与日期 warning 分开计数、逐一列名；失败保留快照机制不变。手工能力补充保留明确的 null，不将其转换成对象。没有新增默认 false，也没有继承同系列模型能力。

site 的能力类型同步可空，标签与展开详情显示“未公布”，搜索可匹配“未知／未公布”；模态筛选提供“未知（未公布）”，null 不命中已知模态。跨渠道合并比较保留 null 与明确 false 的区别，不再用布尔强制转换把未知等同于不支持。同步两个 provider schema，以及 CLI、手工补充、校准的 null 处理。

真实 fixture：已有能力列表和引用块正例；新增 [GLM-4-Long 官方全文](https://docs.bigmodel.cn/cn/guide/models/text/glm-4-long.md) 无能力区正例 `docs/zhipu-fixtures/glm-4-long.md`；新增 [GLM-4 官方全文](https://docs.bigmodel.cn/cn/guide/models/text/glm-4.md) 反例 `docs/zhipu-fixtures/glm-4.md`。后者有能力区但没有思考模式，必须抛 `missing capability thinking`；另将真实列表删字段、替换模板，以及对有区块模型伪造 `not-documented`，分别验证解析器、采集断言和 provider 校验不能放行。无区块正例的 health 输出明确包含 `capabilities-not-documented (1): glm-4-long`。

### 实采暴露的新阻塞

本地实际执行两个渠道采集，INTL 成功采到 13 个模型，health 为 healthy，仍显式列出此前的 5 个日期 warning：`glm-5.3-flashx`、`glm-4.7-flashx`、`glm-4.5-air`、`glm-4.5-airx`、`glm-4.5-flash`。CN 越过 GLM-4-Long 后，失败于 `Zhipu glm-4-flashx-250414: Zhipu missing capability thinking`。概览中它与 `glm-4-flash-250414` 都链接到 GLM-4 详情；该真实页面“能力支持”列出了流式输出、Function Calling、上下文缓存、结构化输出、MCP，缺少思考模式字段。

因此，“main 唯一阻塞是 GLM-4-Long”这一背景假设在完整实采后不成立。按本任务“有能力区但字段缺失必须报错”的红线，CN 仍必须 error；不能把这两个模型归入未公布整区、补 false、删模型或跳过 provider。CLI 如实保留之前成功快照，所以 CN 的失败快照摘要也不能冒充包含 GLM-4-Long 的成功采集结果。本地一次 models.dev 校准另有网络错误，独立于此能力判据。

本地验证：15 个测试文件、169 项测试通过；validate、build 通过；另检查 typecheck、site build 和格式。提交前按要求还原 data 和两个生成 API 文件；施工前已有 data 改动已备份在 `/tmp/models-cn-capability-backup/preexisting-data.patch`，未混入代码提交。两个 schema 是新增 null 和证据字段能够发布的必要同步，随代码提交。
