# Changelog

本项目遵循语义化版本，并在 [API 兼容性与版本策略](COMPATIBILITY.md) 中单独定义数据 API 的兼容性承诺。

## [0.1.0] - 2026-07-22

首个公开稳定版本。

### Added

- 中国大陆厂商官方人民币 API 定价、模型能力和来源追溯数据。
- 官方 Models API 可用清单与 models.dev 逐字段校准。
- `/api.json` 最新版入口、`/v1/api.json` 稳定入口和 `/schema/v1/*.json` Schema。
- 当前成熟数据结构正式确立为 `schemaVersion: "1.0"`，作为首个公开数据契约。
- 厂商、清单和校准采集健康状态，包括最近成功、最近尝试与连续失败次数。
- 自动更新 PR 的模型、价格、元数据、校准变化和数据源健康报告。

### Compatibility

- v1 同一 major 内只增加可选字段，不删除字段、不改变字段含义或枚举既有值的语义。
- 破坏性变更使用新 major；旧 major 至少保留 6 个月。

[0.1.0]: https://github.com/null-object-0000/models-cn/releases/tag/v0.1.0
