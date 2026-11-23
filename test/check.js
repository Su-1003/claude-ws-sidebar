'use strict';

// 用真实数据跑一遍纯逻辑，验证分组结果。
// 用法：node check.js [工作区文件路径] [工作区根目录]
// 例：  node check.js "C:\path\to\workspace.code-workspace" "C:\path\to"
const path = require('path');
const lib = require('../lib');

const wsFile = process.argv[2] || '';
const wsRoot = process.argv[3] || '';
const projectsDir = lib.defaultProjectsDir();

if (!wsFile && !wsRoot) {
  console.log('用法: node check.js [工作区文件路径] [工作区根目录]');
  console.log('  不传参数则使用默认 projects 目录，无工作区过滤');
}

const workspaces = lib.readWorkspaces(wsFile, wsRoot);
const sessions = lib.readSessions(projectsDir);
const grouped = lib.groupSessions(sessions, workspaces);

console.log('workspaces:');
for (const w of workspaces) console.log('  -', w.name, '=>', w.path);
console.log('sessions total:', sessions.length, 'at', projectsDir);
console.log('');

const now = Date.now();
const seen = new Set();
for (const w of workspaces) {
  const list = grouped.get(lib.norm(w.path)) || [];
  console.log(`${w.name}  (${list.length})`);
  for (const s of list) {
    seen.add(s.file);
    console.log(`   · ${lib.formatRelative(s.mtime, now).padEnd(8)} ${s.title}  [${s.cwd}]`);
  }
}
const orphans = sessions.filter((s) => !seen.has(s.file));
console.log(`\n未归类 (${orphans.length}):`);
for (const s of orphans) console.log('   ·', s.title, '|', s.cwd || '(no cwd)');
