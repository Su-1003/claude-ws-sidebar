# Claude Workspace Sidebar / Claude 工作空间

[中文文档](#中文文档) | [English Docs](#english-documentation)

---

## 中文文档

像 DSH 一样，按「工作区」分组显示 Claude Code 的本地会话，并支持快速切换。

### 功能

- **侧边栏工作区树** — 活动栏出现图标，里面是工作区列表：
  - 工作区名 + 会话数，**当前工作区**标 `· 当前` 且图标变为 `folder-active`
  - 展开显示最近会话：标题（取自第一条用户消息）、相对时间
- **状态栏** — 常驻显示当前工作区，点击可切换
- **一键恢复会话** — 点击会话优先用官方 Claude Code 扩展打开编辑器标签页（`claude-vscode.editor.open`）；官方扩展未安装或调用失败时，回退为「在该会话目录开终端 + `claude --resume <id>`」
- **右键菜单** — 恢复会话 / 终端打开 / 重命名 / 复制会话 ID / 在文件夹中显示 / 删除会话
  - 重命名仅保存在侧栏（扩展 globalState），不修改 Claude 的 jsonl 文件
  - 删除是**移入** `<projects>/.trash/`（文件名加时间戳前缀），不真删，搬回原目录即可恢复
- **新建会话** — 可在任意工作区下新建，支持终端模式或官方对话面板
- **工作区操作** — 点击工作区弹出菜单：新建会话 / 新窗口打开 / 当前窗口打开 / 资源管理器定位 / 复制路径
- **标题栏按钮** — 新建会话、切换工作区、刷新、从回收站恢复

### 数据来源

- **工作区列表**：读取多根工作区文件（`*.code-workspace`），可在设置中指定路径；为空时自动扫描 `workspaceRoot` 目录
- **会话列表**：扫描 `~/.claude/projects/*/*.jsonl`，取第一条用户文本作为标题、`environment.snapshot.workingDirectory` 作为所属目录
- **分组规则**：按「会话目录位于哪个工作区目录下」归组（取最长路径前缀匹配）
- 不属于任何工作区的会话可收在 **其他位置** 分组（默认隐藏）
- 会话记录的目录被改名/删除时，行尾标注 `· 原目录已不存在`

### 安装

#### 方式一：从本地文件夹安装（开发/自用）

1. 克隆本仓库到任意位置
2. VS Code 中 `Ctrl+Shift+P` → 输入并执行 `Developer: Install Extension from Location...`
3. 选择克隆后的文件夹
4. `Developer: Reload Window` 重新加载
5. 活动栏底部出现新图标

#### 方式二：从 VSIX 安装

```bash
npm install -g @vscode/vsce   # 首次需要
cd claude-ws-sidebar
vsce package                   # 生成 .vsix 文件
```

然后在 VS Code 中 `Extensions` → `⋯` → `Install from VSIX...`，选择生成的 `.vsix` 文件。

卸载：扩展视图找到 `Claude 工作空间` → 卸载。

### 设置项

| 键 | 默认值 | 说明 |
|---|---|---|
| `claudeWs.workspaceFile` | `""` | 多根工作区文件路径；为空时自动扫描 `workspaceRoot` |
| `claudeWs.workspaceRoot` | `""` | 工作区文件为空时的回退扫描目录；为空则使用当前工作区根目录 |
| `claudeWs.hiddenWorkspaces` | `[]` | 不显示的目录名（大小写不敏感） |
| `claudeWs.showOtherSessions` | `false` | 显示「其他位置」分组 |
| `claudeWs.projectsDir` | `""` | Claude Code 会话目录，留空 = `~/.claude/projects` |
| `claudeWs.maxSessionsPerWorkspace` | `8` | 每个工作区最多显示的会话数 |
| `claudeWs.preferOfficialPanel` | `true` | 优先用官方扩展打开会话；关闭后一律开终端 |
| `claudeWs.newSessionUsesPanel` | `true` | 新建会话使用官方对话面板；关闭后用终端 |
| `claudeWs.guardModelEnv` | `false` | 守护 `~/.claude/settings.json` 中的模型名配置 |
| `claudeWs.guardModelEnvValues` | 见下方 | 守护时要维持的模型名映射 |
| `claudeWs.repatchScript` | `""` | Claude 扩展 UI 补丁恢复脚本路径（为空则不启用） |
| `claudeWs.syncGlobalOnChange` | `false` | 监听 CLAUDE.md 变化并同步到桌面端（需配置脚本和镜像路径） |
| `claudeWs.syncGlobalScript` | `""` | 同步脚本绝对路径 |
| `claudeWs.syncGlobalDst` | `""` | 镜像目标 CLAUDE.md 路径 |
| `claudeWs.backupOnStart` | `false` | 启动时增量备份会话记录（需配置备份脚本） |
| `claudeWs.backupScript` | `""` | 备份脚本绝对路径 |

**guardModelEnvValues 默认值：**

```json
{
  "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-20250514",
  "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-20250514",
  "ANTHROPIC_DEFAULT_FABLE_MODEL": "claude-opus-4-20250514"
}
```

### 已知限制

- Claude **桌面端**（Cowork）的会话在云端，本地没有文件，因此只能列出 **Claude Code CLI** 的本地会话
- 官方 `anthropic.claude-code` 扩展是闭源的，本扩展是与其并排的独立侧栏，无法修改官方面板
- 会话标题取自第一条用户消息，不是 Claude 自动生成的标题
- 自动恢复补丁、全局同步、备份等功能需要额外配置脚本路径，开箱即用只包含会话浏览和切换

---

## English Documentation

A VS Code sidebar extension that groups your local Claude Code sessions by workspace, with one-click switching — inspired by DSH's session management.

### Features

- **Workspace tree in sidebar** — Activity bar icon shows a list of workspaces:
  - Workspace name + session count; **current workspace** marked with `· Current` and `folder-active` icon
  - Expanded view shows recent sessions: title (from first user message) and relative timestamp
- **Status bar** — Always shows the current workspace; click to switch
- **One-click session resume** — Clicking a session prefers the official Claude Code extension (`claude-vscode.editor.open`); falls back to terminal + `claude --resume <id>` if unavailable
- **Context menu** — Resume / Open in terminal / Rename / Copy session ID / Reveal in folder / Delete
  - Rename only affects the sidebar (stored in extension globalState), not Claude's jsonl files
  - Delete **moves** to `<projects>/.trash/` (timestamp-prefixed filename) — not permanent, restore by moving back
- **New session** — Create in any workspace, via terminal or official panel
- **Workspace actions** — Click workspace for menu: new session / open in new window / open in current window / reveal in explorer / copy path
- **Title bar buttons** — New session, switch workspace, refresh, restore from trash

### Data Sources

- **Workspace list**: Read from a multi-root workspace file (`*.code-workspace`), configurable; falls back to scanning `workspaceRoot`
- **Sessions**: Scans `~/.claude/projects/*/*.jsonl`, using the first user message as title and `environment.snapshot.workingDirectory` for grouping
- **Grouping**: Sessions grouped by which workspace directory contains their working directory (longest prefix match)
- Unmatched sessions can be shown in an **Other locations** group (hidden by default)
- Sessions whose directory was renamed/deleted are marked with `· Original directory no longer exists`

### Installation

#### Option 1: From local folder (development / personal use)

1. Clone this repository anywhere
2. In VS Code: `Ctrl+Shift+P` → `Developer: Install Extension from Location...`
3. Select the cloned folder
4. `Developer: Reload Window`
5. New icon appears at the bottom of the activity bar

#### Option 2: From VSIX

```bash
npm install -g @vscode/vsce   # first time only
cd claude-ws-sidebar
vsce package                   # generates .vsix file
```

Then in VS Code: `Extensions` → `⋯` → `Install from VSIX...`, select the generated `.vsix`.

Uninstall: Find `Claude 工作空间` in Extensions view → Uninstall.

### Settings

| Key | Default | Description |
|---|---|---|
| `claudeWs.workspaceFile` | `""` | Path to multi-root workspace file; empty = auto-scan `workspaceRoot` |
| `claudeWs.workspaceRoot` | `""` | Fallback scan directory; empty = use current workspace root |
| `claudeWs.hiddenWorkspaces` | `[]` | Directory names to hide (case-insensitive) |
| `claudeWs.showOtherSessions` | `false` | Show "Other locations" group |
| `claudeWs.projectsDir` | `""` | Claude Code sessions dir; empty = `~/.claude/projects` |
| `claudeWs.maxSessionsPerWorkspace` | `8` | Max sessions shown per workspace |
| `claudeWs.preferOfficialPanel` | `true` | Prefer official extension to open sessions; off = always terminal |
| `claudeWs.newSessionUsesPanel` | `true` | New session uses official panel; off = terminal |
| `claudeWs.guardModelEnv` | `false` | Guard model names in `~/.claude/settings.json` |
| `claudeWs.guardModelEnvValues` | See below | Model name mapping to enforce |
| `claudeWs.repatchScript` | `""` | Path to UI repatch script (empty = disabled) |
| `claudeWs.syncGlobalOnChange` | `false` | Watch CLAUDE.md and sync to desktop mirror (requires script + dst) |
| `claudeWs.syncGlobalScript` | `""` | Sync script absolute path |
| `claudeWs.syncGlobalDst` | `""` | Mirror destination CLAUDE.md path |
| `claudeWs.backupOnStart` | `false` | Incremental backup on startup (requires backup script) |
| `claudeWs.backupScript` | `""` | Backup script absolute path |

**Default guardModelEnvValues:**

```json
{
  "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-20250514",
  "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-20250514",
  "ANTHROPIC_DEFAULT_FABLE_MODEL": "claude-opus-4-20250514"
}
```

### Known Limitations

- Claude **Desktop** (Cowork) sessions live in the cloud with no local files — this extension only lists **Claude Code CLI** local sessions
- The official `anthropic.claude-code` extension is closed-source; this is a separate sidebar running alongside it
- Session titles come from the first user message, not Claude's auto-generated title
- Auto-repatch, global sync, and backup features require external script configuration; out-of-the-box usage covers session browsing and switching only

---

## License

MIT
