'use strict';

// 用最小 vscode 桩跑一遍扩展，验证树结构、当前工作区判定、空工作区占位都正常。
// 所有路径均为测试桩数据，不依赖任何真实目录。
const Module = require('module');
const path = require('path');

const registered = [];
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

let capturedProvider = null;

const TEST_ROOT = '/test-data';
const stub = {
  EventEmitter,
  TreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(id) { this.id = id; } },
  StatusBarAlignment: { Left: 1, Right: 2 },
  RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
  Uri: { file: (p) => ({ fsPath: p, scheme: 'file' }) },
  env: { clipboard: { writeText: async () => {} } },
  window: {
    activeTextEditor: { document: { uri: { fsPath: TEST_ROOT + '/projects/alpha/file.md' } } },
    createTreeView: (id, opts) => {
      capturedProvider = opts.treeDataProvider;
      return { id, description: '', dispose() {} };
    },
    createStatusBarItem: () => ({ text: '', tooltip: '', command: '', show() {}, dispose() {} }),
    createTerminal: (o) => ({
      name: o.name,
      cwd: o.cwd,
      sent: [],
      show() {},
      sendText(t) { this.sent.push(t); },
    }),
    showQuickPick: async (items) => items[0],
    showWarningMessage: (m) => console.log('WARN', m),
    setStatusBarMessage: (m) => console.log('MSG', m),
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
  },
  extensions: { getExtension: () => undefined },
  workspace: {
    createFileSystemWatcher: () => ({ onDidCreate: () => ({ dispose() {} }), onDidChange: () => ({ dispose() {} }), onDidDelete: () => ({ dispose() {} }), dispose() {} }),
    workspaceFile: { fsPath: TEST_ROOT + '/workspace.code-workspace' },
    workspaceFolders: [
      { uri: { fsPath: TEST_ROOT + '/workspace' }, name: 'workspace' },
      { uri: { fsPath: TEST_ROOT + '/daily' }, name: 'daily' },
      { uri: { fsPath: TEST_ROOT + '/projects' }, name: 'projects' },
      { uri: { fsPath: TEST_ROOT + '/assets' }, name: 'assets' },
    ],
    getConfiguration: () => ({
      get(k) {
        if (k === 'workspaceFile') return TEST_ROOT + '/workspace.code-workspace';
        if (k === 'workspaceRoot') return TEST_ROOT;
        if (k === 'projectsDir') return '';
        if (k === 'maxSessionsPerWorkspace') return 8;
        return undefined;
      },
    }),
    getWorkspaceFolder(uri) {
      const p = uri.fsPath.toLowerCase();
      for (const f of stub.workspace.workspaceFolders) {
        const root = f.uri.fsPath.toLowerCase();
        if (p === root || p.startsWith(root + '/')) return f;
      }
      return undefined;
    },
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
  },
  commands: {
    registerCommand: (id, fn) => {
      registered.push({ id, fn });
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
ext.activate({ subscriptions: [] });

if (!capturedProvider) {
  console.log('FAIL: 没有拿到 TreeDataProvider');
  process.exit(1);
}

const rootNodes = capturedProvider.getChildren();
const pinnedNode = rootNodes[0];
const pinnedItem = capturedProvider.getTreeItem(pinnedNode);
console.log('根节点：' + rootNodes.length + ' 个 [' + pinnedItem.label + ']，命令注册：' + registered.map((r) => r.id).join(', '));
const roots = capturedProvider.getChildren(pinnedNode);
console.log('工作区节点：' + roots.length);
for (const r of roots) {
  const item = capturedProvider.getTreeItem(r);
  const icon = item.iconPath && item.iconPath.id ? item.iconPath.id : '';
  console.log(`\n[${item.label}]  desc="${item.description}"  icon=${icon}  state=${item.collapsibleState}`);
  const kids = capturedProvider.getChildren(r);
  for (const c of kids) {
    const ci = capturedProvider.getTreeItem(c);
    const desc = typeof ci.description === 'string' ? ci.description : '';
    console.log(`    · ${ci.label}  ${desc}`);
  }
}

// 验证点击会话会发 claude --resume
const resumeCmd = registered.find((r) => r.id === 'claudeWs.resume');
const keyWs = roots.find((r) => r.ws.path.endsWith('projects'));
if (keyWs) {
  const sess = capturedProvider.getChildren(keyWs)[0];
  const origCreate = stub.window.createTerminal;
  let last = null;
  stub.window.createTerminal = (o) => {
    last = origCreate(o);
    return last;
  };
  resumeCmd.fn(sess).then(() => {
    console.log('\nresume → terminal cwd =', last && last.cwd);
    console.log('resume → sendText =', last && last.sent);
  });
}

// 空工作区占位（造一个不存在的目录工作区）
const fakeWs = { kind: 'workspace', ws: { name: 'empty-test', path: TEST_ROOT + '/nonexistent' }, current: false, sessions: [] };
const kids2 = capturedProvider.getChildren(fakeWs);
if (kids2.length) {
  const k0 = capturedProvider.getTreeItem(kids2[0]);
  console.log('\n空工作区子节点:', kids2[0].kind, '→', k0.label);
}
console.log('\nOK');
