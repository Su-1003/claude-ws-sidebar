'use strict';

// 纯逻辑，不依赖 vscode，方便用 node 直接测。
const fs = require('fs');
const os = require('os');
const path = require('path');

function expandHome(p) {
  if (!p) return p;
  if (p === '~' || p.startsWith('~\\') || p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

function norm(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function isInside(child, parent) {
  return child === parent || child.startsWith(parent + '/');
}

/** 配置的工作区文件不存在时，在 workspaceRoot 里找现存的 *.code-workspace（取最新修改的）。 */
function findWorkspaceFile(workspaceRoot) {
  if (!workspaceRoot) return '';
  try {
    const root = expandHome(workspaceRoot);
    const files = fs
      .readdirSync(root)
      .filter((n) => n.toLowerCase().endsWith('.code-workspace'))
      .map((n) => {
        const p = path.join(root, n);
        let m = 0;
        try {
          m = fs.statSync(p).mtimeMs;
        } catch (e) {
          /* ignore */
        }
        return { p, m };
      })
      .sort((a, b) => b.m - a.m);
    return files.length ? files[0].p : '';
  } catch (e) {
    return '';
  }
}

/**
 * 读多根工作区文件；配置的路径不存在时自动找同目录的 *.code-workspace；
 * 都读不到才回退扫描目录。
 * @returns {{name: string, path: string}[]}
 */
function readWorkspaces(workspaceFile, workspaceRoot) {
  const out = [];
  const candidates = [];
  if (workspaceFile) candidates.push(expandHome(workspaceFile));
  if (workspaceRoot) {
    const alt = findWorkspaceFile(workspaceRoot);
    if (alt && candidates.every((p) => norm(p) !== norm(alt))) candidates.push(alt);
  }
  for (const file of candidates) {
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      const base = path.dirname(file);
      for (const f of json.folders || []) {
        if (!f || !f.path) continue;
        const p = path.isAbsolute(f.path) ? f.path : path.join(base, f.path);
        out.push({ name: f.name || path.basename(p), path: p });
      }
      if (out.length) break;
    } catch (e) {
      /* 文件不存在或格式不对，试下一个 */
    }
  }
  if (out.length === 0 && workspaceRoot) {
    try {
      for (const d of fs.readdirSync(expandHome(workspaceRoot), { withFileTypes: true })) {
        if (!d.isDirectory() || d.name.startsWith('.')) continue;
        out.push({ name: d.name, path: path.join(expandHome(workspaceRoot), d.name) });
      }
    } catch (e) {
      /* ignore */
    }
  }
  return out;
}

function cleanTitle(t) {
  if (!t) return '';
  const s = String(t).replace(/\s+/g, ' ').trim();
  return s.length > 60 ? s.slice(0, 60) + '…' : s;
}

/**
 * 读文件尾部一小段，找官方写的 ai-title 行（{"type":"ai-title","aiTitle":"…"}）。
 */
function readAiTitle(file, size, tailBytes) {
  const span = Math.min(size || 0, tailBytes || 128 * 1024);
  if (!span) return '';
  let text = '';
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(span);
    fs.readSync(fd, buf, 0, span, Math.max(0, (size || 0) - span));
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch (e) {
    return '';
  }
  let found = '';
  for (const line of text.split(/\r?\n/)) {
    if (line.indexOf('"ai-title"') < 0) continue;
    try {
      const o = JSON.parse(line);
      if (o && o.type === 'ai-title' && typeof o.aiTitle === 'string' && o.aiTitle.trim()) found = o.aiTitle;
    } catch (e) {
      /* 半行跳过 */
    }
  }
  return found;
}

/**
 * 扫 Claude Code 的会话目录。每个 .jsonl 取：标题（第一条用户文本）、
 * 工作目录（environment 快照里的 workingDirectory）、修改时间。
 */
function readSessions(projectsDir, maxBytes) {
  maxBytes = maxBytes || 256 * 1024;
  const out = [];
  let dirs = [];
  try {
    dirs = fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'));
  } catch (e) {
    return out;
  }
  for (const d of dirs) {
    const dir = path.join(projectsDir, d.name);
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch (e) {
      continue;
    }
    for (const f of files) {
      const file = path.join(dir, f);
      let st;
      try {
        st = fs.statSync(file);
      } catch (e) {
        continue;
      }
      if (!st.size) continue;

      let text = '';
      try {
        const fd = fs.openSync(file, 'r');
        const len = Math.min(st.size, maxBytes);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, 0);
        fs.closeSync(fd);
        text = buf.toString('utf8');
      } catch (e) {
        continue;
      }

      const lines = text.split(/\r?\n/).slice(0, 200);
      let title = '';
      let cwd = '';
      for (const line of lines) {
        if (!line || line.charCodeAt(0) !== 123) continue; // '{'
        let obj;
        try {
          obj = JSON.parse(line);
        } catch (e) {
          continue;
        }
        if (!cwd) {
          const snap = (obj.attachment && obj.attachment.snapshot) || obj.snapshot;
          if (snap && typeof snap.workingDirectory === 'string') cwd = snap.workingDirectory;
        }
        if (!title && obj.type === 'user' && obj.message && Array.isArray(obj.message.content)) {
          const t = obj.message.content.find(
            (c) => c && c.type === 'text' && typeof c.text === 'string' && c.text.trim()
          );
          if (t) title = t.text;
        }
        if (title && cwd) break;
      }

      // 官方会写 ai-title 行（就是面板里显示的那个标题），通常在文件尾部，单独读一段尾巴
      const aiTitle = readAiTitle(file, st.size);

      out.push({
        id: path.basename(f, '.jsonl'),
        file,
        title: cleanTitle(aiTitle || title) || '未命名会话',
        aiTitle: aiTitle || '',
        cwd,
        mtime: st.mtimeMs,
        size: st.size,
      });
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/**
 * 把会话挂到工作区下（按路径前缀，取最长的匹配，避免 KeY 抢走 KeY\KeY 的会话）。
 * @returns Map<string, object[]>  key = norm(workspace.path)
 */
function groupSessions(sessions, workspaces) {
  const map = new Map(workspaces.map((w) => [norm(w.path), []]));
  for (const s of sessions) {
    if (!s.cwd) continue;
    const c = norm(s.cwd);
    let bestKey = null;
    let bestLen = -1;
    for (const w of workspaces) {
      const key = norm(w.path);
      if (isInside(c, key) && key.length > bestLen) {
        bestKey = key;
        bestLen = key.length;
      }
    }
    if (bestKey) map.get(bestKey).push(s);
  }
  return map;
}

/** 会话记录里的目录可能已被改名/删掉：往上找最近一个还存在的目录。 */
function dirExists(p) {
  try {
    return !!p && fs.statSync(p).isDirectory();
  } catch (e) {
    return false;
  }
}

function nearestExistingDir(p, stopAt) {
  if (!p) return '';
  let cur = p;
  for (let i = 0; i < 12; i++) {
    try {
      if (fs.existsSync(cur) && fs.statSync(cur).isDirectory()) return cur;
    } catch (e) {
      /* ignore */
    }
    if (stopAt && norm(cur) === norm(stopAt)) return stopAt;
    const parent = path.dirname(cur);
    if (parent === cur) return '';
    cur = parent;
  }
  return '';
}

function formatRelative(ms, now) {  now = now || Date.now();
  const diff = Math.max(0, now - ms);
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return '刚刚';
  if (diff < hour) return Math.floor(diff / min) + ' 分钟';
  if (diff < day) return Math.floor(diff / hour) + ' 小时';
  if (diff < 7 * day) return Math.floor(diff / day) + ' 天';
  const d = new Date(ms);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`;
}

function defaultProjectsDir() {
  return path.join(os.homedir(), '.claude', 'projects');
}

function trashDir(projectsDir) {
  return path.join(projectsDir, '.trash');
}

/** 不真删：把会话文件挪进 <projects>/.trash，随时能捞回来。 */
function moveSessionToTrash(file, projectsDir) {
  const dir = trashDir(projectsDir);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(dir, stamp + '-' + path.basename(file));
  fs.renameSync(file, dest);
  return dest;
}

/** Claude Code 的项目目录名 = 工作目录里每个非 [A-Za-z0-9-] 的字符换成 '-'。 */
function encodeProjectDir(p) {
  return String(p || '').replace(/[^A-Za-z0-9-]/g, '-');
}

/** 只读前 N 字节，从 environment 行里取 snapshot.workingDirectory。 */
function readSessionCwd(file, maxBytes) {
  const limit = maxBytes || 64 * 1024;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(limit);
    const n = fs.readSync(fd, buf, 0, limit, 0);
    for (const line of buf.slice(0, n).toString('utf8').split('\n')) {
      const t = line.trim();
      if (!t.startsWith('{') || t.indexOf('workingDirectory') < 0) continue;
      try {
        const o = JSON.parse(t);
        const cwd = (o.snapshot && o.snapshot.workingDirectory) || (o.attachment && o.attachment.snapshot && o.attachment.snapshot.workingDirectory);
        if (cwd) return cwd;
      } catch (e) {
        /* 半行/坏行跳过 */
      }
    }
  } catch (e) {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return '';
}

/** 列出回收站里的会话文件（新的在前）。 */
function listTrash(projectsDir) {
  const dir = trashDir(projectsDir);
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'));
  } catch (e) {
    return [];
  }
  return names
    .map((n) => {
      const file = path.join(dir, n);
      let mtime = 0;
      try {
        mtime = fs.statSync(file).mtimeMs;
      } catch (e) {}
      return { file, name: n, mtime, cwd: readSessionCwd(file) };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/** 把回收站里的一个文件搬回它原来所属的项目目录。 */
function restoreFromTrash(file, projectsDir) {
  const cwd = readSessionCwd(file);
  const base = path.basename(file).replace(/^\d{4}-\d\d-\d\dT[\d-]+Z-/, '');
  const dirName = cwd ? encodeProjectDir(cwd) : path.basename(path.dirname(file));
  const dest = path.join(projectsDir, dirName, base);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(file, dest);
  return dest;
}

module.exports = {
  expandHome,
  norm,
  isInside,
  readWorkspaces,
  findWorkspaceFile,
  readSessions,
  groupSessions,
  nearestExistingDir,
  dirExists,
  formatRelative,
  cleanTitle,
  defaultProjectsDir,
  trashDir,
  moveSessionToTrash,
  encodeProjectDir,
  readSessionCwd,
  listTrash,
  restoreFromTrash,
};
