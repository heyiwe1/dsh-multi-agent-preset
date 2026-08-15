# 发布清单（GitHub 发布用）

> 本清单供发布者（用户）执行 push 前的核对与操作。push 由用户完成（子代理无 GitHub 认证）。
> 更新：2026-08-15 — 发布物 = 三模协同 preset + **三模按钮组件 `tri-model-ui`** + 一键启动脚本。暗色模式用 DSH 自带，本项目不提供自定义黑主题。

## 一、发布前核对（发布者）

- [ ] `agent.cordis.yml` 与当前 preset 一致（含 mcp-fs disabled 处置）
- [ ] `preset.yml` 名称/描述准确（当前角色 gpt+deepseek+haiku）
- [ ] `SKILL.md` 与当前协议一致（两级闸门/能力路由/变更租约/权限意图/禁 npx）
- [ ] `tri-model-config.json` JSON 合法（`node -e "JSON.parse(...)"` 通过）
- [ ] `workflow-template.md` 与工作区最新版一致（含 #2/#4/#6 草案函数定义 + 并发规范引用）；注意 #2/#4/#6 为**设计草案（enabled=false）**，非已启用功能
- [ ] `tri-model-ui/`（按钮包）自检：`package.json` 含 `dsh.client`、exports 含 `"."` 主入口与 `"./client"` 与 `"./package.json"`；`lib/client.js` 语法（`node --check`）通过；从部署 `profiles\web` 跑 `import('tri-model-ui')` 输出 `OK function`
- [ ] `start-dsh.cmd` / `start-dsh.mjs` 存在且命令正确（`dsh --profile web` + 打开网页）
- [ ] **发布物仅含 preset + 按钮 + 一键启动**（暗色模式用 DSH 自带）
- [ ] `TRI-MODEL-PROTOCOL.md` canonical 明确（工作区根为准，publish 内两份为副本已标注）
- [ ] 发布文档齐全：`README.md` / `RELEASE-NOTES.md`（含已知限制）/ `RELEASE-CHECKLIST.md` / `UPLOAD-GUIDE.md`
- [ ] git 快照已提交（在项目仓库 `git log --oneline -5` 可见发布相关提交）
- [ ] 按钮包 `tri-model-ui/` 自检：`node --check` 双文件通过、部署副本与 publish 一致（若本机已部署）

## 二、GitHub 操作步骤（发布者执行，以 UPLOAD-GUIDE.md 为准）

> **口径：`publish/` 作独立仓库**。**全程在发布目录（本仓库的 `publish/`）下操作，不从项目根 push**——项目根含 `personal/`（个人主题）、`docs/archive/`（历史）等不应进发布仓库的内容。

1. **进入发布目录**：`cd <项目根>/publish`
2. 新建仓库并推送（二选一，详见 UPLOAD-GUIDE.md）：
   ```bash
   # 方式 B（gh CLI，一条命令）：
   gh repo create dsh-tri-model-preset --private --source . --push
   # 或方式 A（网页建仓 + 本地 git）：
   git init && git add . && git commit -m "initial publish"
   git remote add origin https://github.com/<owner>/dsh-tri-model-preset.git
   git branch -M main
   git push -u origin main
   ```
3. **push 内容 = `publish/` 目录全部**（preset + `tri-model-ui/` + 一键启动 + 协议 + config + 模板 + README/RELEASE-NOTES/CHECKLIST/UPLOAD-GUIDE）。**工作区根历史/过程文件一律不推**。
4. push 前确认 publish 内无垃圾（`node_modules/`、`*.log`、`.trash/`、`.DS_Store` 等；publish 当前无此问题）。

## 三、发布包内容核对（当前已就绪）

| 文件 | 状态 |
|---|---|
| `publish/tri-model-agent-preset/agent.cordis.yml` | ✅ 与工作区源一致（含 mcp-fs disabled） |
| `publish/tri-model-agent-preset/preset.yml` | ✅ 当前角色描述 |
| `publish/tri-model-agent-preset/skills/tri-model-coordination/SKILL.md` | ✅ 重写为当前协议 |
| `publish/tri-model-agent-preset/config/tri-model-config.json` | ✅ 与工作区一致（含 #2/#4/#5/#6 全部节） |
| `publish/tri-model-agent-preset/config/concurrency-guide.md` | ✅ 与工作区根目录版一致（并发规范） |
| `publish/tri-model-agent-preset/config/workflow-template.md` | ✅ 与工作区最新版一致（发布前 diff 校验，不写死字节数） |
| `publish/tri-model-agent-preset/start-dsh.cmd` | ✅ 一键启动（服务+网页合一，Windows） |
| `publish/tri-model-agent-preset/start-dsh.mjs` | ✅ 一键启动（Node 版，跨平台） |
| `publish/tri-model-ui/package.json` | ✅ `dsh.client` 声明 + exports 含 `.`/`./client`/`./package.json` |
| `publish/tri-model-ui/lib/index.js` | ✅ 宿主半：4 条路由实现（/tri-model/get-state、set-config、reset-config、build-command） |
| `publish/tri-model-ui/lib/client.js` | ✅ 浏览器半：conversation.input.dock 工具栏（角色状态+kickoff按钮+设置切换）+ shell.overlay 设置面板（7项配置+生成命令） |
| `publish/README.md` | ✅ 安装/启用/配置/风险/按钮安装步骤 |
| 暗色模式 | ✅ **用 DSH 自带**（本项目不提供自定义黑主题） |

## 四、下载者安装三模按钮（写入 README，发布前对照）

1. 把 `tri-model-ui/` 复制进部署的 `profiles\node_modules\`（或 `pnpm add ./tri-model-ui`）；
2. 在部署的 `profiles/web/cordis.patch.yml`（或等价 patch 层）加：
   ```yaml
   - insert:
       - id: tri-model-ui
         name: tri-model-ui
         config:
           configPath: tri-model-config.json
           resetBaseline: tri-model-agent-preset/config/tri-model-config.json
   ```
   其中：
   - `configPath`（可选）：配置文件相对路径；缺失时读 `DSH_TRI_MODEL_CONFIG` 环境变量，再缺失用默认工作区 `tri-model-config.json`。
   - `resetBaseline`（可选）：重置基线路径；缺失时读 `DSH_TRI_MODEL_RESET_BASELINE` 环境变量。
3. 重启 DSH web → 对话工具栏出现"● 三模协同"按钮（dock 工具栏）+⚙设置按钮 → 打开 shell.overlay 设置面板（7项配置+生成命令）。

## 五、发布后自检（用户或新会话）

- [ ] 新机器/新会话复制 preset → `standingKeyFor` 挂载 OK
- [ ] 新会话工具列表符合预期（无 mcp__filesystem__*——disabled 是预期的）
- [ ] 装按钮包 + patch 行 + 重启后，对话输入区上方出现三模工具栏（●三模协同 / ⚙设置 / 映射摘要），⚙可打开设置面板（下载者视角闭环）
- [ ] **一键启动实测（Windows 用户终端）**：`node start-dsh.mjs` 与 `start-dsh.cmd` 各跑两路径——①服务已运行→直接开页；②服务未运行→拉起 dsh→轮询就绪→自动开页
- [ ] 跑一个简单三模任务（方向→架构→执行→复审→终审）确认流水线可用

## 六、已知风险提示（务必阅读）

- **MCP 默认禁用**是安全处置：直接启用 `npx` 行会被杀软报毒（Trojan:Win32/PowhidSubExec.B）。发布 README 已写明启用步骤与本地 vendored 替代。
- **preset 不能携带浏览器 UI**：按钮必须作为宿主组合的 `dsh.client` 行（客户端包 + patch 行）分发，这是本架构的落地点，README 已写清。
- **不信任整个目录**：如遇杀软，按文件级指纹（SHA256/integrity）加白，勿整目录加白。
- **运行时 MCP 证据缺失**：属受沙箱/安全限制的已知待办，不影响 preset 组合挂载与流水线。
