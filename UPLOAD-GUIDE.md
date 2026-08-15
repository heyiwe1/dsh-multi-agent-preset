# GitHub 上传教程（简略版）

> 目标：把 `publish/`（发布物 = preset + 按钮 + 一键启动 + 协议 + 配置 + 文档）上传为 GitHub 仓库。
> 前提：您需要一个 GitHub 账号 + 已登录（浏览器或 gh CLI 均可）。
> 全程不需要您懂 git 原理，照步骤做即可。**遇到不懂的问我，我逐步教。**

---

## 方式 A：用 GitHub 网页 + 本地 git（推荐新手）

### 第 1 步：确认 publish/ 是干净的发布物
- `publish/` 目录应包含：`README.md`、`RELEASE-NOTES.md`、`RELEASE-CHECKLIST.md`、`UPLOAD-GUIDE.md`、`TRI-MODEL-PROTOCOL.md`、`tri-model-agent-preset/`、`tri-model-ui/`（按钮，等您改好）
- 确认按钮改好后，再上传（发布需要按钮）

### 第 2 步：GitHub 网页建仓
1. 浏览器打开 `https://github.com/new`
2. 仓库名：如 `dsh-tri-model-preset`
3. 选 **Private**（先私有，确认没问题再公开）或 **Public**
4. **不要**勾选 "Add a README"、"Add .gitignore"、"Add a license"（避免冲突）
5. 点 **Create repository**
6. 页面会显示一段命令，先别关

### 第 3 步：本地把 publish/ 变 git 仓库
在 **PowerShell** 里执行（我会帮您敲，或您复制）：
```powershell
cd <你的 publish 目录>   # 本项目的发布目录（publish/），克隆后即你的路径
git init
git add .
git commit -m "initial publish: tri-model preset + button + one-click start"
```

### 第 4 步：关联远程并推送
回到 GitHub 建仓成功的页面，复制它给的 remote 命令（形如）：
```powershell
git remote add origin https://github.com/<您的用户名>/dsh-tri-model-preset.git
git branch -M main
git push -u origin main
```
（把 `<您的用户名>` 换成您的，或直接用页面给的原样命令）

### 第 5 步：验证
- 浏览器打开仓库页，确认文件都在、README 渲染正常
- 点进去看 `tri-model-agent-preset/`、`tri-model-ui/` 是否齐全

---

## 方式 B：用 gh CLI（更快，若已装）

```powershell
cd <你的 publish 目录>   # 本项目的发布目录（publish/）
gh repo create dsh-tri-model-preset --private --source . --push
```
一条命令建仓+推送（gh 需已登录：`gh auth login`）。

---

## 上传前自检（发布准备已做，按钮改好后复核）
- [ ] 按钮已改好（`publish/tri-model-ui/` 是最新版）
- [ ] `publish/README.md` 的按钮描述与最终按钮一致
- [ ] 历史文档已归档（`docs/archive/`），顶层不裸露
- [ ] TRI-MODEL-PROTOCOL canonical 明确（根目录为准，副本已标注）
- [ ] RELEASE-CHECKLIST 核对项都过

## 上传后
- 把仓库链接给我，我帮您核对 README 渲染、补 release note、处理 issue 模板等。

---

## 常见问题
- **push 报 "rejected"**：仓库里已有文件 → 用 `git pull --rebase origin main` 后再 push（或重建空仓库）
- **push 要求登录**：网页版会让你浏览器授权一次；或 `gh auth login`
- **想改回私有/公开**：GitHub 仓库 Settings → Danger Zone → Change visibility
- **以后更新**：改完 publish/ 后 `git add . && git commit -m "说明" && git push`
