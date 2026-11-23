'use strict';

// 在临时目录里造一套假数据，验证「重命名」和「删除（移到 .trash）」这两条右键命令。
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const root = path.join(__dirname, 'fixture');
const wsA = path.join(root, 'ws', 'A');
const projects = path.join(root, 'projects');
const proj1 = path.join(projects, 'fixture-A');
const wsFile = path.join(root, 'fixture.code-workspace');

fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(wsA, { recursive: true });
fs.mkdirSync(proj1, { recursive: true });
fs.mkdirSync(path.join(projects, '.trash'), { recursive: true });
fs.writeFileSync(
  path.join(projects, '.trash', 'old-session.jsonl'),
  JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '回收站里的旧会话' }] } }) + '\n'
);
fs.writeFileSync(wsFile, JSON.stringify({ folders: [{ path: 'ws/A' }] }, null, 2));
const sess1 = path.join(proj1, 'sess-0001.jsonl');
fs.writeFileSync(
  sess1,
  [
    JSON.stringify({ type: 'environment', snapshot: { workingDirectory: wsA } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '测试会话标题' }] } }),
  ].join('\n') + '\n'
);

// ---- vscode 桩 ----
const registered = new Map();
class EventEmitter {
  constructor() {
    this._l = [];
    this.event = (fn) => {
      this._l.push(fn);
      return { dispose() {} };
    };
  }
  fire(x) {
    for (const fn of this._l) fn(x);
  }
}
class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}
const globalState = new Map();
let inputAnswer = '我改的名字';
let provider = null;

const stub = {
  EventEmitter,
  TreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(id) { this.id = id; } },
  StatusBarAlignment: { Left: 1, Right: 2 },
  TerminalLocation: { Panel: 1, Editor: 2 },
  RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
  Uri: { file: (p) => ({ fsPath: p, scheme: 'file' }) },
  env: { clipboard: { writeText: async () => {} } },
  extensions: { getExtension: () => undefined },
  window: {
    activeTextEditor: undefined,
    createTreeView: (id, opts) => {
      provider = opts.treeDataProvider;
      return { id, description: '', dispose() {} };
    },
    createStatusBarItem: () => ({ text: '', tooltip: '', command: '', show() {}, dispose() {} }),
    createTerminal: (o) => ({ name: o.name, cwd: o.cwd, sent: [], show() {}, sendText(t) { this.sent.push(t); } }),
    showQuickPick: async (items) => items[0],
    showWarningMessage: async (msg, opts, ...btns) => {
      console.log('确认框:', msg, '| 按钮:', btns.join('/'));
      return btns[0];
    },
    showInputBox: async (o) => {
      console.log('输入框默认值:', JSON.stringify(o.value));
      return inputAnswer;
    },
    showErrorMessage: (m) => console.log('ERR', m),
    setStatusBarMessage: (m) => console.log('MSG', m),
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
  },
  workspace: {
    createFileSystemWatcher: () => ({ onDidCreate: () => ({ dispose() {} }), onDidChange: () => ({ dispose() {} }), onDidDelete: () => ({ dispose() {} }), dispose() {} }),
    workspaceFile: { fsPath: wsFile },
    workspaceFolders: [{ uri: { fsPath: wsA }, name: 'A' }],
    getConfiguration: () => ({
      get(k) {
        if (k === 'workspaceFile') return wsFile;
        if (k === 'workspaceRoot') return path.join(root, 'ws');
        if (k === 'projectsDir') return projects;
        if (k === 'maxSessionsPerWorkspace') return 8;
        if (k === 'preferOfficialPanel') return true;
        if (k === 'sessionNames') return undefined;
        return undefined;
      },
    }),
    getWorkspaceFolder: () => undefined,
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
  },
  commands: {
    registerCommand: (id, fn) => {
      registered.set(id, fn);
      return { dispose() {} };
    },
    executeCommand: async () => {},
  },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'vscode') return 'vscode-stub';
  return origResolve.call(this, request, ...rest);
};
require.cache['vscode-stub'] = { id: 'vscode-stub', filename: 'vscode-stub', loaded: true, exports: stub };

const ext = require(path.join(__dirname, '..', 'extension.js'));
ext.activate({
  subscriptions: [],
  globalState: {
    get: (k) => globalState.get(k),
    update: async (k, v) => globalState.set(k, v),
  },
});

function roots() {
  // 根节点现在是 Pinned 分组，工作区在它下面
  return provider.getChildren(provider.getChildren()[0]);
}
function sessionsOf(r) {
  return provider.getChildren(r);
}
function label(node) {
  const it = provider.getTreeItem(node);
  return typeof it.label === 'string' ? it.label : it.label && it.label.label;
}

const r0 = roots()[0];
const s0 = sessionsOf(r0)[0];
console.log('工作区:', label(r0), '| 会话:', label(s0));
console.log('回收站目录里的文件会被当成会话吗？→', sessionsOf(r0).length === 1 ? '不会（已排除 . 开头目录）' : '会（有 bug）');

(async () => {
  await registered.get('claudeWs.renameSession')(s0);
  const renamed = sessionsOf(roots()[0])[0];
  console.log('重命名后:', label(renamed), '| 持久化:', JSON.stringify(globalState.get('sessionNames')));

  await registered.get('claudeWs.deleteSession')(renamed);
  const trash = fs.readdirSync(path.join(projects, '.trash'));
  console.log('删除后列表条数:', sessionsOf(roots()[0]).length);
  console.log('.trash 内容:', trash);
  console.log('原文件还在吗:', fs.existsSync(sess1));
  const ok = trash.some((f) => f.endsWith('sess-0001.jsonl')) && !fs.existsSync(sess1);
  console.log(ok ? 'OK' : 'FAIL');
  process.exit(ok ? 0 : 1);
})();
