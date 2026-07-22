# API 兼容性与版本策略

models-cn 的公开 API 主版本与 JSON 文档内部的 `schemaVersion` 分别管理。首个公开 API 和当前数据契约均为 v1，因此 URL 使用 `/v1/`，JSON 文档使用 `schemaVersion: "1.0"`；项目软件版本则独立记录在 `package.json` 中。

## 稳定地址

- `/api.json`：始终指向最新公开版本，适合希望自动跟进升级的使用者。
- `/v1/api.json`：v1 稳定数据入口，遵守本文的 v1 兼容性规则。
- `/schema/v1/*.json`：v1 对应的 Provider、Inventory 与 Calibration JSON Schema。

## 同一 API major 版本

在 v1 生命周期内，项目可以：

- 增加可选字段。
- 增加厂商、模型、价格档位和数据源记录。
- 修正错误数据或更新随厂商变化的价格、能力和可用状态。

项目不会：

- 删除或重命名既有字段。
- 改变既有字段的含义或类型。
- 改变枚举既有值的语义。
- 将原本可选的字段改为调用方必须提供或必须处理的字段。

模型下线和价格变化属于数据变化，不属于 API 结构破坏性变更；调用方不应假设任一模型永久存在或价格固定。

## 破坏性变更

任何删除字段、改变字段类型或语义、收紧调用方必须满足的约束，都会发布新的 API major 版本。旧 major 版本自新版正式发布之日起至少保留 6 个月，并在 README、CHANGELOG 和 GitHub Release 中公布停止维护日期。

## 弃用字段

字段弃用遵循以下规则：

1. 先在 Schema 的 `deprecated: true`、CHANGELOG 和 Release Notes 中标记。
2. 在当前 major 版本内继续提供该字段，且保持原有语义。
3. 提供替代字段和迁移示例。
4. 仅在下一个 major 版本删除；旧 major 版本仍按至少 6 个月的保留期提供。

v1 数据契约从首次公开发布起使用 `input.standard` 表示普通输入价格，并仅在厂商明确提供缓存命中价格时提供 `input.cacheHit`。

## 数据健康语义

`health.status: "healthy"` 表示最近一次采集成功；`"error"` 表示最近一次尝试失败且正在提供上一份成功快照；`"stale"` 表示数据超过新鲜度窗口。官网和 CI 采用 36 小时窗口，确保每天一次的任务有合理延迟余量，同时不会让长期未运行的任务继续显示 `LIVE`。调用方也应结合 `lastAttemptAt` 判断时效性。
