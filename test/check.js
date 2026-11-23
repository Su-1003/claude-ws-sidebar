'use strict';

// 用真实数据跑一遍纯逻辑，验证分组结果。
const path = require('path');
const lib = require('../lib');

const wsFile = 'E:\\Agent\\Claude\\Claude工作空间.code-workspace';
const wsRoot = 'E:\\Agent\\Claude';
const projectsDir = lib.defaultProjectsDir();

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
