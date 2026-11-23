'use strict';

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const lib = require('./lib');

let view;
let status;
let sessionNames = new Map();
let stateStore = null;

class WsProvider {
  constructor() {
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChange.event;
    this._data = null;
  }

  refresh() {
    this._data = null;
    this._onDidChange.fire(undefined);
    updateStatus();
  }

  load() {
    if (this._data) return this._data;
    const cfg = vscode.workspace.getConfiguration('claudeWs');
    const wsFile = cfg.get('workspaceFile');
    const wsRoot = cfg.get('workspaceRoot');
    const projectsDir = lib.expandHome(cfg.get('projectsDir') || lib.defaultProjectsDir());

    const hidden = new Set((cfg.get('hiddenWorkspaces') || []).map((n) => String(n).toLowerCase()));
    const workspaces = lib
      .readWorkspaces(wsFile, wsRoot)
      .filter((w) => !hidden.has(String(w.name).toLowerCase()));
    const sessions = lib.readSessions(projectsDir);
    const grouped = lib.groupSessions(sessions, workspaces);
    const currentRoot = getCurrentRoot();

    const items = workspaces.map((w) => ({
      kind: 'workspace',
      ws: w,
      current: currentRoot ? lib.norm(currentRoot) === lib.norm(w.path) : false,
      sessions: grouped.get(lib.norm(w.path)) || [],
    }));

    // 不属于任何工作区的会话单独收一组，别让它们凭空消失（默认隐藏，见 claudeWs.showOtherSessions）
    const mapped = new Set();
    for (const it of items) for (const s of it.sessions) mapped.add(s.file);
    const orphans = sessions.filter((s) => !mapped.has(s.file));
    if (orphans.length && cfg.get('showOtherSessions') !== false) {
      items.push({
        kind: 'other',
        ws: { name: '其他位置', path: '' },
        isOther: true,
        current: false,
        sessions: orphans,
      });
    }

    this._data = { workspaces, items };
    return this._data;
  }

  getTreeItem(element) {
    if (element.kind === 'pinned') {
      const item = new vscode.TreeItem('Pinned', vscode.TreeItemCollapsibleState.Expanded);
      item.id = 'pinned';
      item.contextValue = 'claudePinned';
      return item;
    }
    if (element.kind === 'workspace' || element.kind === 'other') {
      const n = element.sessions.length;
      const item = new vscode.TreeItem(
        element.ws.name,
        n > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
      );
      item.id = 'ws:' + element.ws.path;
      item.contextValue = 'claudeWorkspace';
      item.iconPath = new vscode.ThemeIcon(element.current ? 'folder-active' : 'folder');
      item.description = element.current ? '当前' : '';
      item.tooltip = element.isOther ? '会话的工作目录不在任何工作区下面' : element.ws.path;
      if (!element.isOther) {
        item.command = {
          command: 'claudeWs.workspaceActions',
          title: '工作区操作',
          arguments: [element],
        };
      }
      return item;
    }

    // 占位节点（该工作区还没有会话）
    if (element.kind === 'empty') {
      const item = new vscode.TreeItem('（暂无会话）', vscode.TreeItemCollapsibleState.None);
      item.contextValue = 'claudeEmpty';
      item.iconPath = new vscode.ThemeIcon('circle-slash');
      item.command = { command: 'claudeWs.newSession', title: '新建会话' };
      return item;
    }

    // session
    const s = element.session;
    const custom = sessionNames.get(s.id);
    const item = new vscode.TreeItem(custom || s.title, vscode.TreeItemCollapsibleState.None);
    item.id = 's:' + s.file;
    item.contextValue = 'claudeSession';
    item.iconPath = new vscode.ThemeIcon('circle-outline');
    item.description = lib.dirExists(s.cwd) ? '' : '原目录已不存在';
    item.tooltip = [
      s.title,
      '',
      '目录：' + (s.cwd || element.ws.path) + (lib.dirExists(s.cwd) ? '' : '（已不存在）'),
      '修改：' + new Date(s.mtime).toLocaleString(),
      '会话 ID：' + s.id,
    ].join('\n');
    item.command = {
      command: 'claudeWs.resume',
      title: '恢复会话',
      arguments: [element],
    };
    return item;
  }

  getChildren(element) {
    const data = this.load();
    if (!element) return [{ kind: 'pinned' }];
    if (element.kind === 'pinned') return data.items;
    if (element.kind === 'workspace' || element.kind === 'other') {
      const max = Math.max(1, vscode.workspace.getConfiguration('claudeWs').get('maxSessionsPerWorkspace') || 8);
      const list = element.sessions.slice(0, max).map((s) => ({
        kind: 'session',
        session: s,
        ws: element.ws,
      }));
      if (list.length === 0) return [{ kind: 'empty', ws: element.ws }];
      return list;
    }
    return [];
  }

  getParent() {
    return undefined;
  }
}

function getCurrentRoot() {
  const ed = vscode.window.activeTextEditor;
  if (ed) {
    const f = vscode.workspace.getWorkspaceFolder(ed.document.uri);
    if (f) return f.uri.fsPath;
  }
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length === 1) return folders[0].uri.fsPath;
  return null;
}

function currentLabel() {
  const root = getCurrentRoot();
  if (root) return path.basename(root);
  const wf = vscode.workspace.workspaceFile;
  if (wf) return path.basename(wf.fsPath, '.code-workspace');
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length) return folders[0].name;
  return '未打开工作区';
}

function updateStatus() {
  if (!status) return;
  status.text = '$(folder) ' + currentLabel();
  status.tooltip = 'Claude 工作空间：点击切换';
}

function openTerminal(cwd, name) {
  // 开成编辑器标签页（不是底部面板），看起来更接近"会话面板"
  const loc = vscode.TerminalLocation ? vscode.TerminalLocation.Editor : undefined;
  const term = vscode.window.createTerminal({ name: 'Claude · ' + name, cwd, location: loc });
  term.show(true);
  return term;
}

function officialExtension() {
  try {
    return vscode.extensions.getExtension('anthropic.claude-code');
  } catch (e) {
    return undefined;
  }
}

/** 官方扩展的 editor.open 吃会话 ID，能把该会话直接开成编辑器标签页。 */
async function openInOfficialPanel(sessionId) {
  const cfg = vscode.workspace.getConfiguration('claudeWs');
  if (cfg.get('preferOfficialPanel') === false) return false;
  if (!officialExtension()) return false;
  try {
    await vscode.commands.executeCommand('claude-vscode.editor.open', sessionId);
    return true;
  } catch (e) {
    return false;
  }
}

async function workspaceActions(entry) {
  if (!entry || !entry.ws) return;
  const ws = entry.ws;
  const pick = await vscode.window.showQuickPick(
    [
      { label: '$(add) 在此新建会话', action: 'new' },
      { label: '$(terminal) 在此新建会话（终端·锁定此目录）', action: 'newTerminal' },
      { label: '$(link-external) 在新窗口打开工作区', action: 'newWindow' },
      { label: '$(window) 在当前窗口打开工作区', action: 'sameWindow' },
      { label: '$(folder-opened) 在资源管理器中显示', action: 'explorer' },
      { label: '$(clippy) 复制路径', action: 'copy' },
    ],
    { title: ws.name, placeHolder: ws.path }
  );
  if (!pick) return;
  const uri = vscode.Uri.file(ws.path);
  switch (pick.action) {
    case 'new':
      await newSessionIn(ws);
      break;
    case 'newTerminal':
      await newSessionIn(ws, { terminal: true });
      break;
    case 'newWindow':
      await vscode.commands.executeCommand('vscode.openFolder', uri, true);
      break;
    case 'sameWindow':
      await vscode.commands.executeCommand('vscode.openFolder', uri, false);
      break;
    case 'explorer':
      await vscode.commands.executeCommand('revealInExplorer', uri);
      break;
    case 'copy':
      await vscode.env.clipboard.writeText(ws.path);
      vscode.window.setStatusBarMessage('已复制：' + ws.path, 3000);
      break;
    default:
      break;
  }
}

/**
 * 新建会话：默认走官方扩展的对话面板（不是终端）。
 * 官方 newConversation 不接受目录参数，面板自己决定目录；想要锁死某个目录时才用终端。
 */
async function newSessionIn(ws, opts) {
  const usePanel = !(opts && opts.terminal);
  if (usePanel) {
    const cfg = vscode.workspace.getConfiguration('claudeWs');
    if (cfg.get('newSessionUsesPanel') !== false && officialExtension()) {
      try {
        await vscode.commands.executeCommand('claude-vscode.sidebar.open');
        await vscode.commands.executeCommand('claude-vscode.newConversation');
        return;
      } catch (e) {
        // 官方命令变了就退回终端
      }
    }
  }
  const term = openTerminal(ws.path, ws.name);
  term.sendText('claude', true);
}

async function newSessionInTerminal(entry) {
  const ws = (entry && entry.ws) || provider.load().items.find((i) => i.current)?.ws;
  if (!ws) {
    vscode.window.showWarningMessage('没有可用的工作区。');
    return;
  }
  await newSessionIn(ws, { terminal: true });
}

async function newSession() {
  const data = provider.load();
  if (!data.items.length) {
    vscode.window.showWarningMessage('没有找到工作区，请检查 claudeWs.workspaceFile 配置。');
    return;
  }
  const current = data.items.find((i) => i.current);
  if (current) {
    await newSessionIn(current.ws);
    return;
  }
  const pick = await vscode.window.showQuickPick(
    data.items.map((i) => ({ label: i.ws.name, description: i.ws.path, ws: i.ws })),
    { title: '在哪个工作区新建会话？' }
  );
  if (pick) await newSessionIn(pick.ws);
}

async function pickWorkspace() {
  const data = provider.load();
  if (!data.items.length) {
    vscode.window.showWarningMessage('没有找到工作区，请检查 claudeWs.workspaceFile 配置。');
    return;
  }
  const pick = await vscode.window.showQuickPick(
    data.items.map((i) => ({
      label: (i.current ? '$(folder-active) ' : '$(folder) ') + i.ws.name,
      description: i.sessions.length + ' 个会话',
      detail: i.ws.path,
      entry: i,
    })),
    { title: '切换到哪个工作区？', matchOnDescription: true, matchOnDetail: true }
  );
  if (!pick) return;
  await workspaceActions(pick.entry);
}

/**
 * 官方面板默认只解析「窗口第一个工作区文件夹」对应的项目目录（外加它的 git worktree）。
 * repatch.js 给官方 extension.js 打了跨目录补丁后，其它工作区文件夹也能解析；
 * 补丁不在时，那些目录的会话点进面板会变成空白新会话，只能走终端。
 * 返回 '' 表示判断不了（没有工作区文件夹），此时保持原逻辑。
 */
function panelSessionRoot() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length ? folders[0].uri.fsPath : '';
}

let crossDirPatchCache = null;

/** 官方 extension.js 里有没有 repatch.js 的跨目录补丁标记（按 mtime+size 缓存）。 */
function officialResolvesCrossFolder() {
  const ext = officialExtension();
  if (!ext) return false;
  try {
    const file = path.join(ext.extensionPath, 'extension.js');
    const st = fs.statSync(file);
    const key = st.mtimeMs + ':' + st.size;
    if (crossDirPatchCache && crossDirPatchCache.key === key) return crossDirPatchCache.ok;
    const ok = fs.readFileSync(file, 'utf8').indexOf('CC-CROSS-DIR-PATCH') >= 0;
    crossDirPatchCache = { key, ok };
    return ok;
  } catch (e) {
    return false;
  }
}

function sessionInPanelScope(s) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length || !s || !s.cwd) return true;
  const cwd = lib.norm(s.cwd);
  if (cwd === lib.norm(folders[0].uri.fsPath)) return true;
  if (officialResolvesCrossFolder()) {
    return folders.some((f) => lib.norm(f.uri.fsPath) === cwd);
  }
  return false;
}

async function resumeSession(entry) {
  if (!entry || !entry.session) return;

  // 面板加载不到的会话（不属于任何工作区文件夹，或官方扩展没打跨目录补丁）：
  // 直接在它自己的目录里用终端恢复。
  if (!sessionInPanelScope(entry.session)) {
    resumeInTerminal(entry);
    vscode.window.setStatusBarMessage(
      '会话目录 ' + (entry.session.cwd || '未知') + ' 不在当前工作区文件夹内（或官方扩展未打跨目录补丁），已在终端中恢复',
      8000
    );
    return;
  }

  // 优先：官方扩展把它开成编辑器标签页（真正的对话面板）
  if (await openInOfficialPanel(entry.session.id)) return;

  resumeInTerminal(entry);
}

function resumeInTerminal(entry) {
  const s = entry.session;
  const cwd = lib.nearestExistingDir(s.cwd, entry.ws.path) || entry.ws.path || process.cwd();
  const name = path.basename(cwd) || entry.ws.name;
  const term = openTerminal(cwd, name);
  term.sendText('claude --resume ' + s.id, true);
}

function openInExplorer(entry) {
  if (!entry || !entry.ws) return;
  vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(entry.ws.path));
}

function projectsDirResolved() {
  const cfg = vscode.workspace.getConfiguration('claudeWs');
  return lib.expandHome(cfg.get('projectsDir') || lib.defaultProjectsDir());
}

function saveNames() {
  if (stateStore) stateStore.update('sessionNames', Object.fromEntries(sessionNames));
}

async function renameSession(entry) {
  if (!entry || !entry.session) return;
  const s = entry.session;
  const cur = sessionNames.get(s.id) || '';
  const name = await vscode.window.showInputBox({
    title: '重命名会话',
    prompt: '留空 = 恢复原名（第一条提问）',
    value: cur,
  });
  if (name === undefined) return;
  const trimmed = name.trim();
  if (trimmed) sessionNames.set(s.id, trimmed);
  else sessionNames.delete(s.id);
  saveNames();
  provider.refresh();
}

async function deleteSession(entry) {
  if (!entry || !entry.session) return;
  const s = entry.session;
  const title = sessionNames.get(s.id) || s.title;
  const ok = await vscode.window.showWarningMessage(
    '删除会话「' + title + '」？',
    { modal: true, detail: '不真删：会话文件会挪到 .claude/projects/.trash，想恢复把它搬回去即可。' },
    '删除'
  );
  if (ok !== '删除') return;
  try {
    const dest = lib.moveSessionToTrash(s.file, projectsDirResolved());
    sessionNames.delete(s.id);
    saveNames();
    provider.refresh();
    vscode.window.setStatusBarMessage('已移到回收站：' + dest, 6000);
  } catch (e) {
    vscode.window.showErrorMessage('删除失败：' + (e && e.message));
  }
}

async function copySessionId(entry) {
  if (!entry || !entry.session) return;
  await vscode.env.clipboard.writeText(entry.session.id);
  vscode.window.setStatusBarMessage('已复制会话 ID：' + entry.session.id, 4000);
}

/** 从 .trash 捞回来：按 jsonl 里的 workingDirectory 还原到正确的项目目录。 */
async function restoreFromTrash() {
  const dir = projectsDirResolved();
  const items = lib.listTrash(dir);
  if (!items.length) {
    vscode.window.showInformationMessage('回收站是空的：' + lib.trashDir(dir));
    return;
  }
  const picks = await vscode.window.showQuickPick(
    items.map((t) => ({
      label: '$(history) ' + (t.cwd ? path.basename(t.cwd) : '(未知目录)'),
      description: '删除于 ' + lib.formatRelative(t.mtime) + ' · ' + (t.cwd || ''),
      detail: t.name,
      file: t.file,
    })),
    { title: '从回收站恢复会话（可多选）', canPickMany: true, matchOnDetail: true }
  );
  if (!picks || !picks.length) return;
  let ok = 0;
  const fails = [];
  for (const p of picks) {
    try {
      lib.restoreFromTrash(p.file, dir);
      ok++;
    } catch (e) {
      fails.push((e && e.message) || String(e));
    }
  }
  provider.refresh();
  if (fails.length) vscode.window.showWarningMessage('恢复 ' + ok + ' 个，失败 ' + fails.length + ' 个：' + fails[0]);
  else vscode.window.setStatusBarMessage('已恢复 ' + ok + ' 个会话', 5000);
}

function revealSession(entry) {
  if (!entry || !entry.session) return;
  vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(entry.session.file));
}

let provider;
let ctx = null;

function activate(context) {
  ctx = context;
  provider = new WsProvider();
  stateStore = context.globalState;
  const saved = (stateStore && stateStore.get('sessionNames')) || {};
  sessionNames = new Map(Object.entries(saved));

  view = vscode.window.createTreeView('claudeWs.view', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  view.description = currentLabel();

  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = 'claudeWs.pickWorkspace';
  status.show();
  updateStatus();

  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg('claudeWs.refresh', () => {
    provider.refresh();
    view.description = currentLabel();
  });
  reg('claudeWs.newSession', () => newSession());
  reg('claudeWs.newSessionTerminal', (entry) => newSessionInTerminal(entry));
  reg('claudeWs.pickWorkspace', () => pickWorkspace());
  reg('claudeWs.workspaceActions', (entry) => workspaceActions(entry));
  reg('claudeWs.resume', (entry) => resumeSession(entry));
  reg('claudeWs.resumeTerminal', (entry) => resumeInTerminal(entry));
  reg('claudeWs.renameSession', (entry) => renameSession(entry));
  reg('claudeWs.deleteSession', (entry) => deleteSession(entry));
  reg('claudeWs.copySessionId', (entry) => copySessionId(entry));
  reg('claudeWs.restoreFromTrash', () => restoreFromTrash());
  reg('claudeWs.revealSession', (entry) => revealSession(entry));
  reg('claudeWs.openInExplorer', (entry) => openInExplorer(entry));

  const onCtx = () => {
    provider.refresh();
    view.description = currentLabel();
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(onCtx));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(onCtx));

  // 文件变化后自动刷新（会话写入时）
  provider.refresh();
  watchSessions();

  // Claude Code 扩展升级后自动恢复本地补丁（右对齐 / 药丸加宽 / 刻度条 / 汉化）。
  // 版本没变时零开销；变了才跑 repatch.js，并自动重载 webview。
  const autorepatch = require('./autorepatch');
  reg('claudeWs.repatchNow', () => autorepatch.check(context, { force: true }));
  try { autorepatch.startEnvGuard(); } catch (e) { /* 守护失败不影响扩展本体 */ }
  try { autorepatch.startGlobalSyncWatch(); } catch (e) { /* 同步监视失败不影响扩展本体 */ }
  try { autorepatch.startProjectBackup(); } catch (e) { /* 备份失败不影响扩展本体 */ }
  setTimeout(() => {
    try { autorepatch.check(context); } catch (e) { /* 补丁失败不影响扩展本体 */ }
  }, 3000);
}

/**
 * 监听 ~/.claude/projects 下的 jsonl：新建对话、删对话、对话续写都自动刷树。
 * 带 1.5s 去抖 + 指纹比对，避免对话每写一行就重排一次树。
 */
function watchSessions() {
  let timer = null;
  let lastSig = '';
  const sig = () => {
    const dir = projectsDirResolved();
    const out = [];
    const walk = (d) => {
      let list = [];
      try {
        list = fs.readdirSync(d, { withFileTypes: true });
      } catch (e) {
        return;
      }
      for (const e of list) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (!e.name.startsWith('.')) walk(p);
        } else if (e.name.endsWith('.jsonl')) {
          try {
            out.push(e.name + ':' + fs.statSync(p).mtimeMs);
          } catch (err) {}
        }
      }
    };
    walk(dir);
    return out.sort().join('|');
  };
  const kick = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const now = sig();
      if (now === lastSig) return;
      lastSig = now;
      provider.refresh();
      if (view) view.description = currentLabel();
    }, 1500);
  };
  lastSig = sig();
  let watcher;
  try {
    const root = vscode.Uri.file(projectsDirResolved());
    const pattern = new vscode.RelativePattern(root, '**/*.jsonl');
    watcher = vscode.workspace.createFileSystemWatcher(pattern, false, true, false);
    watcher.onDidCreate(kick);
    watcher.onDidDelete(kick);
  } catch (e) {
    watcher = undefined;
  }
  const folderWatcher = (() => {
    try {
      const root = vscode.Uri.file(projectsDirResolved());
      const p = new vscode.RelativePattern(root, '*');
      return vscode.workspace.createFileSystemWatcher(p, false, true, false);
    } catch (e) {
      return undefined;
    }
  })();
  if (folderWatcher) {
    folderWatcher.onDidCreate(kick);
    folderWatcher.onDidDelete(kick);
  }
  if (watcher || folderWatcher) {
    const disposable = {
      dispose() {
        if (timer) clearTimeout(timer);
        if (watcher) watcher.dispose();
        if (folderWatcher) folderWatcher.dispose();
      },
    };
    if (ctx) ctx.subscriptions.push(disposable);
    else if (watcher) watcher.dispose();
  }
}

function deactivate() {
  if (status) status.dispose();
}

module.exports = { activate, deactivate };
