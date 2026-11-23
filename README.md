# Claude 工作空间（VS Code 侧边栏）

像 DSH 一样，按「工作区」分组显示 Claude Code 的本地会话，并支持快速切换。

## 它做什么

- 侧边栏（活动栏）出现一个图标，里面是工作区列表：
  - 工作区名 + 会话数，**当前工作区**标 `· 当前` 且图标变成 `folder-active`
  - 展开是最近会话：标题（第一条用户消息）、相对时间
- 状态栏常驻显示当前工作区，点击可切换
- 会话点一下 → **优先**用官方 Claude Code 扩展把它开成编辑器标签页（`claude-vscode.editor.open`，吃会话 ID）；
  官方扩展不在或调用失败时，回退成「在该会话目录开终端 + `claude --resume <id>`」
- 会话右键 → 在终端中打开会话 / 重命名 / 复制会话 ID / 在文件夹中显示 / 删除会话
  - 重命名只影响这个侧栏（存在扩展的 globalState 里），不改 Claude 的 jsonl
  - 删除是**移到** `<projects>\.trash\`（文件名前缀时间戳），不真删，想恢复把它搬回原目录即可
- 新建会话 → 在**编辑器标签页**里开一个终端跑 `claude`（不是底部面板），可指定任意工作区
- 工作区点一下 → 菜单：新建会话 / 新窗口打开 / 当前窗口打开 / 资源管理器定位 / 复制路径
- 标题栏按钮：新建会话、切换工作区、刷新

## 数据从哪来

- 工作区列表：读 `E:\Agent\Claude\Claude工作空间.code-workspace`（可在设置里改）
- 会话：扫 `~/.claude/projects/*/*.jsonl`，取第一条用户文本当标题、`environment.snapshot.workingDirectory` 当所属目录
- 会话按「目录在哪个工作区下面」归组（取最长前缀，所以 `KeY\KeY` 归到 `KeY`）
- 不属于任何工作区的会话收在最后一组 **其他位置** 里，不会消失
- 会话记录的目录被改名/删掉时，行尾标 `· 原目录已不存在`，恢复时会自动退到最近的仍存在目录

## 安装（不用打包）

1. VS Code 里 `Ctrl+Shift+P`
2. 输入并执行：`Developer: Install Extension from Location...`
3. 选这个文件夹：`E:\Agent\DeepSeek Harness\SJ\work\claude-ws-sidebar`
4. 重新加载窗口（`Developer: Reload Window`）
5. 活动栏最下面会出现新的图标

卸载：扩展视图里找到 `Claude 工作空间` → 卸载。

## 设置项

| 键 | 默认 | 说明 |
|---|---|---|
| `claudeWs.workspaceFile` | `E:\Agent\Claude\Claude工作空间.code-workspace` | 工作区列表来源 |
| `claudeWs.workspaceRoot` | `E:\Agent\Claude` | 工作区文件读不到时的回退扫描目录 |
| `claudeWs.projectsDir` | 空（= `~/.claude/projects`） | Claude Code 会话目录 |
| `claudeWs.maxSessionsPerWorkspace` | 8 | 每个工作区最多列几个会话 |
| `claudeWs.preferOfficialPanel` | true | 点会话时优先用官方扩展在标签页打开；关掉就一律开终端 |

## 已知边界

- Claude **桌面端**（Cowork）的会话在云端，本地没有文件，所以这里只能列出 **Claude Code** 的会话。
- 官方 `anthropic.claude-code` 扩展是闭源的，没法改它的面板；这个是并排的另一个侧栏。
- 会话标题取自第一条用户消息，不是 Claude 自己起的标题。
