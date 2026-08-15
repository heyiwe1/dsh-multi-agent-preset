# Release Notes · dsh-tri-model-preset

> 版本：v0.1.0（候选发布 · 2026-08-15）
> 状态：**候选**（发布路径验证 + 按钮定稿后转正式）
> 配套：`README.md`（安装/启动/目录）+ `RELEASE-CHECKLIST.md`（核对清单）+ `UPLOAD-GUIDE.md`（上传教程）

---

## 这是什么

DeepSeek Harness 的三模型协同 agent preset + 三模按钮组件 + 一键启动：
- **方向师 / 架构师 / 执行者** 三角色（热插拔，由 `tri-model-config.json` 指派模型，方向师不可代行）
- 审阅链 = 独立复审 + 方向师终审（两级闸门）；应急代行模式；决策门禁；长对话复核
- 协议总则：`TRI-MODEL-PROTOCOL.md`（canonical 在工作区根，随包带副本）

## 包含

| 项 | 位置 | 说明 |
|---|---|---|
| agent preset | `tri-model-agent-preset/` | persona/技能/配置/模板/协议 |
| 三模按钮 | `tri-model-ui/` | conversation.input.dock 工具栏 + shell.overlay 设置面板（可交互，实时读写 tri-model-config.json） |
| 一键启动 | `tri-model-agent-preset/start-dsh.*` | 服务端+网页端合一 |
| 协议 | `TRI-MODEL-PROTOCOL.md` | 三角色/决策门禁/长对话复核/权限链/澄清/备份 |
| 配置 | `config/tri-model-config.json` | 热插拔角色/计费/审阅 |

## 不包含
- 历史调查/过程文档（已归档至 `docs/archive/`）
- 自定义黑主题（暗色模式用 DSH 自带）

## 已知限制（正式声明）
1. **三模工具栏与设置面板**：实时读写 `tri-model-config.json`，支持角色分配/模型计费/合并模式/审阅/澄清/冒泡/安全等设置。
2. **#2 能力路由 / #4 变更租约 / #6 备选韧性为设计草案**（config enabled=false，未接线；真实需求时按需启用）。
3. **MCP 互通默认禁用**（disabled:true，安全处置——npx 下载即执行触发杀软报毒；启用需用户删 disabled 并建议换本地 vendored server）。
4. **未完成真实中型项目验证**：并发扇出 / 架构合一复审设计尚未实战（见 README 演进）。

## 兼容性
- DSH：0.1.0-rc.6 系列（配置/模板基于该版本）
- Node：≥ 20.17（严格 exports 需要）
- 平台：Windows（start-dsh 与按钮 patch 为 Windows 路径；Linux/macOS 需调整路径）

## 变更历史
- v0.1.0（2026-08-15）：候选发布。preset + 按钮 + 一键启动 + 协议；5 缝合点（2 实证落地 + 3 草案）；决策门禁/长对话复核/权限链/澄清/备份规范。
