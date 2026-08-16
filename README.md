# Tri-Model Agent Preset（三模协同）

> **为 DeepSeek Harness 量身定制的多 agent 协同 preset**——方向师定方向、架构师设计方案、执行者落地实现，配以可交互的三模工具栏与一键启动，把"决策 → 设计 → 执行 → 独立复审 → 终审"的完整协同链路变成开箱即用的能力。

## ✨ 特性一览

- **三角色协同**：方向师（目标/优先级/验收，**不可代行**）+ 架构师（方案设计）+ 执行者（落地实现）；角色**热插拔**——改 `tri-model-config.json` 即换模型，角色不绑定模型。
- **完整审阅链**：独立复审 → 方向师终审，**两级闸门**防漏报；应急代行模式、决策门禁、长对话复核、权限与沙箱处理链一应俱全（见 `TRI-MODEL-PROTOCOL.md`）。
- **可交互按钮**：`tri-model-ui` 在 DSH 对话工具栏提供 **●三模协同 / ⚙设置 / 映射摘要**，overlay 设置面板 7 项配置（模型/角色/合并/审阅/澄清/冒泡/安全），实时读写配置文件，4 个后端路由（get-state/set-config/reset-config/build-command）。
- **一键启动**：`start-dsh.*` 拉起 DSH web 服务并自动打开网页（服务端+网页端合一）。
- **随包文档齐全**：协议总则、发布说明、核对清单、上传教程、按钮交付文档，开箱可读。

## 🚀 快速开始

```powershell
# 1. 复制 preset（或按 README「安装」节手动放）
#    - 用 DSH agentPresets.copy(from, id) 复制到用户根
# 2. 放配置：config/tri-model-config.json → 你的工作区，按需改 roles
# 3. 挂载校验：standingKeyFor('<id>') 应返回 OK
# 4. 新建会话选该 preset，确认工具列表
# 5.（可选）安装按钮 tri-model-ui + 一键启动 start-dsh
```

> 🔴 **安装后第一件事：读 `TRI-MODEL-PROTOCOL.md`（协议总则，入口必读）**——三角色定义（方向师不可代行）、应急代行边界、顶层决策规则、流程铁律、经验教训。
>
> 版本：2026-08-15（发布物 = preset + 按钮组件 + 一键启动 + 协议文件）
> 状态：**#3 MCP 互通、#5 权限意图 真落地（实证）；#1 expected_output 真落地（前会话 config 生效）；#2 能力路由 / #4 变更租约 / #6 备选韧性 为设计草案（enabled=false，未接线，真实需求时按需启用）**；并发编排规范见 `concurrency-guide.md`（先规范后实战）
> 配套：`tri-model-config.json`（热插拔配置）+ `workflow-template.md`（编排模板）+ `TRI-MODEL-PROTOCOL.md`（协议总则）

## 目录

```
README.md                                # 本文件：安装/启动/按钮/风险
RELEASE-NOTES.md                         # 发布说明（版本/包含/已知限制/兼容性）
RELEASE-CHECKLIST.md                     # 发布核对清单
UPLOAD-GUIDE.md                          # GitHub 上传教程（建仓/推送）
TRI-MODEL-PROTOCOL.md                    # 协议总则（副本，canonical 在工作区根）
tri-model-agent-preset/
├── agent.cordis.yml                    # preset 组合（可复制到 .agent-presets/）
├── preset.yml                          # 元数据（name/description）
├── start-dsh.cmd / start-dsh.mjs       # 一键启动：DSH web 服务 + 自动打开网页（服务端+网页端合一）
├── skills/tri-model-coordination/      # 协同协议技能（SKILL.md）
└── config/
    ├── tri-model-config.json           # 热插拔配置（角色/计费/能力路由/变更租约/权限意图）
    ├── workflow-template.md            # 编排脚本模板
    └── TRI-MODEL-PROTOCOL.md           # 协议总则副本（copied from canonical）
tri-model-ui/                           # 三模按钮组件（客户端插件包，见下文"安装三模按钮"）
├── package.json / lib/                 # 按钮包（dock 工具栏 + overlay 设置面板 + 4 路由）
└── TRI-MODEL-UI-MILESTONE.md           # 按钮里程碑交付文档（功能规格/验收记录/复现方法）
```

> 暗色模式用 DSH 自带，本项目不提供自定义黑主题。

## 安装

1. **复制 preset**（三选一）：
   - 用 DSH 原生 `agentPresets.copy(from, id)` 复制到用户根（推荐，自动校验 id、免权限问题）；
   - 或手动把 `agent.cordis.yml` + `preset.yml` + `skills/` 放进 `${DSH_HOME:-~/.dsh}/.agent-presets/<id>/`；
2. **放配置**：把 `config/tri-model-config.json` 放到你的工作区（默认 `<工作区>/tri-model-config.json`），并按需改 `roles` 指向你的模型；
3. **放模板**：`config/workflow-template.md` 放同一工作区，供 workflow 编排参考；
4. **挂载校验**：`standingKeyFor('<id>')` 应返回 OK；然后新建会话选该 preset，确认工具列表。

## 启用

- 新对话选 preset "三模协同"，加载 `tri-model-coordination` skill；
- 直接给任务，编排层（父 agent）按 `tri-model-config.json` 路由方向/架构/执行。

## 一键启动（服务端 + 网页端合一）

双击 `start-dsh.cmd`（Windows）或运行 `node start-dsh.mjs`（跨平台）：

1. 若网页已运行 → 直接打开 `http://127.0.0.1:3080`；
2. 否则后台启动 `dsh --profile web`（新窗口，最小化），轮询就绪后自动打开网页；
3. 要求：`dsh` 在 PATH 中；`start-dsh.mjs` 另支持设 `DSH_BIN` 指向 `node_modules\.bin\dsh.cmd`（`start-dsh.cmd` 仅走 PATH），curl 可用（Win10 自带）。

## 安装三模按钮（下载者）

> **为什么按钮不装在 preset 里**：DSH 的 preset 是 agent 平面（宿主进程内），浏览器 UI 只能由宿主组合里的 `dsh.client` 行提供——所以按钮必须以独立客户端插件包 + 一行 patch 的形式分发。这是 2026-08-15 实测确认的架构事实（原"preset client 组件"设想在本架构中不存在）。

### patch 行配置

在部署的 `profiles/web/cordis.patch.yml` 末尾追加：
```yaml
- insert:
    - id: tri-model-ui
      name: tri-model-ui
      config:
        configPath: tri-model-config.json
        resetBaseline: tri-model-agent-preset/config/tri-model-config.json
```

其中：
- `configPath`（可选）：配置文件相对工作区的路径；缺失时读 `DSH_TRI_MODEL_CONFIG` 环境变量，再缺失用默认工作区 `tri-model-config.json`。
- `resetBaseline`（可选）：重置基线文件路径；缺失时读 `DSH_TRI_MODEL_RESET_BASELINE` 环境变量，再缺失用发布仓内 `tri-model-agent-preset/config/tri-model-config.json`。

### 安装步骤

1. 把 `tri-model-ui/` 复制进部署的 `profiles\node_modules\`（或 `pnpm add ./tri-model-ui`）；要求 Node ≥ 20.17（严格 exports 需要 package.json exports 含 `"."` 主入口；随包已带，勿手工删改）。
2. 编辑部署的 `profiles/web/cordis.patch.yml`，按上述 patch 行配置追加。
3. **重启 DSH web** → 对话工具栏左侧 dock 区出现"● 三模协同"按钮（显示角色分工）+ 右侧⚙设置按钮。
4. 点击⚙打开设置面板（shell.overlay），包含 7 项：
   - 1. 模型成本（每模型选 cheap/low/medium/high/per-call）
   - 2. 角色分配（方向师/架构师/执行者 各选一个模型）
   - 3. 合并模式（启用后选择 none/architecture+execution/direction+architecture/direction+architecture+execution）
   - 4. 审阅（选 none/low/medium/high）
   - 5. 澄清（启用/禁用）
   - 6. 冒泡（启用/禁用）
   - 7. 安全（git 快照 启用/禁用）
   - 生成命令：点击"生成"输出 tri-model 命令行，可复制到终端执行。
5. 点击"● 三模协同"按钮在输入框填入启动文本；点击"保存"、"重置"分别保存配置或恢复到基线。

## 配置说明（tri-model-config.json）

| 节 | 作用 | 关键项 |
|---|---|---|
| `roles` | 角色→模型映射 | direction/architecture/execution |
| `models` | 每模型计费档位 | cheap/low/medium/high/per-call |
| `billingPolicy` | 重试/探测/预算 | per-call 0 重试绝不探测 |
| `expectedOutput` | 机械校验契约 | advisory 只记录不阻断 |
| `review` | 审阅强度 | none/low/medium/high |
| `capabilityRouting` | 能力路由(#2) ⚠️草案 | 角色能力画像/任务域/MCP 工具域；**enabled=false 未接线** |
| `changeManagement` | 变更租约/仲裁(#4) ⚠️草案 | 变更域/租约/仲裁优先级；**enabled=false 未接线** |
| `permissionIntents` | 权限意图(#5) ✅实证 | 角色↔permissionPresets 映射；perm_inspect 实测对齐 |
| `modelResilience` | 备选韧性(#6) ⚠️草案 | 升级链/触发/难度路由；**enabled=false 未接线** |
| `clarify/bounce` | 人机交互 | 启动澄清 / NEED_USER 冒泡 |
| `safety/escalation` | 安全/超时 | git 快照/.trash/分层空闲超时 |

## 风险与注意

1. **三模协议是会话级，不是全局插件**：新建会话**必须选 `tri-model` preset** 才会启用三角色协同（方向师/架构师/执行者）；**全局按钮（`tri-model-ui`）≠ 已启用三模协议**——未选 preset 的会话点击按钮，AI 没有三角色 persona/协议上下文。此时按钮会引导读取工作区的 `TRI-MODEL-PROTOCOL.md` 与 `tri-model-config.json`；若两者都不可用，AI 会报告缺失而非自行模拟三模流程。**正确用法**：新会话选 tri-model preset（或明确说"用三模协同"），再配合按钮使用。
2. **MCP 互通默认禁用**：`agent.cordis.yml` 的 `mcp-fs` 行 `disabled:true`——`npx` 下载即执行会触发 Windows Defender/卡巴斯基启发式报毒（实测 `Trojan:Win32/PowhidSubExec.B`）。启用请删 `disabled: true` 并**改用本地 vendored server**（零下载），否则发布用户可能被杀软拦截。
3. **角色模型可换**：direction 当前是 gpt-5.4（high），换模型改 `roles` 即可；per-call 模型只可做方向/终审。
4. **运行验证**：MCP 的运行时工具调用证据需在宿主侧/用户终端执行（沙箱内 spawn 受限 EPERM），preset 仅保证组合可挂载。
5. **不信任整个目录**：如遇杀软，只按文件级指纹（SHA256/integrity）添加信任，勿整目录加白。
6. **EN（English notice）**：This project has **only been tested in a Chinese-language environment**, and the agent prompts / UI copy are **in Chinese**. If you encounter issues in a non-Chinese locale, please **open a GitHub Issue** with a detailed reproduction — we will respond and fix. Non-Chinese speakers are welcome to report problems via Issues even if you cannot describe them in Chinese.

## 演进

- 发布形态：当前为"可复制 agent preset + 独立按钮组件"（最小可行）；后续可 npm 包化（`@deepseek-ai/dsh-*` 风格 + peerDependencies + README）。
- **按钮缺陷已修复（2026-08-15）**：旧按钮是动态插件（不随包分发、重启即丢）；现以 `tri-model-ui` 客户端包随发布分发，装 patch 行 + 重启后常驻。
- **发布前必须**：先跑真实项目验证（本包正处验证中），再 push；一键启动需在 Windows 上实测两路径（已运行 / 未运行→启动→就绪→开页）。
- 按钮为**可交互工具栏**：`conversation.input.dock` 的 ●三模协同 / ⚙设置 / 映射摘要 + `shell.overlay` 设置面板（7 项），配置实时读写 `tri-model-config.json`（详见"安装三模按钮"节）。

## License

MIT（跟随 DSH 生态约定；具体以发布时声明为准）。
