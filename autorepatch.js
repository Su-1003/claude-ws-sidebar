'use strict';
/**
 * autorepatch.js —— 扩展升级后自动恢复本地补丁（右对齐 / 药丸加宽 / 刻度条 / 汉化）
 *
 * 工作方式：
 *   1. VS Code 启动、本扩展激活时调一次 check(ctx)；
 *   2. 与上次处理过的 anthropic.claude-code-* 目录名比对，没变就直接返回（零开销）；
 *   3. 变了就 spawn 一次 repatch.js（幂等脚本），有改动才执行
 *      workbench.action.webview.reloadWebviews，让新 CSS/JS 立刻生效。
 *
 * repatch.js 的位置写死在 REPATCH_CANDIDATES 里，找不到就只记日志、不报错。
 */
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const STATE_KEY = 'ccExtRepatch.dir';

function findRepatch() {
  const cfg = vscode.workspace.getConfiguration('claudeWs').get('repatchScript', '');
  if (!cfg) return null;
  try { if (fs.statSync(cfg).isFile()) return cfg; } catch (e) { /* 忽略 */ }
  return null;
}
// 命令 id 随 VS Code 版本不同：本机 1.145.2 里叫 reloadWebviewAction（命令面板显示 "Developer: Reload Webviews"）
const RELOAD_WEBVIEW_CMDS = [
  'workbench.action.webview.reloadWebviewAction',
  'workbench.action.webview.reloadWebviews',
];

let out = null;
let running = false;

function log(msg) {
  try {
    if (!out) out = vscode.window.createOutputChannel('Claude 补丁守护');
    out.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
  } catch (e) {
    /* 日志失败不影响主流程 */
  }
}

function findRepatch() {
  for (const p of REPATCH_CANDIDATES) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch (e) { /* 继续找下一个 */ }
  }
  return null;
}

function cmpVer(a, b) {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function newestClaudeExtDir() {
  const root = path.join(os.homedir(), '.vscode', 'extensions');
  let names;
  try {
    names = fs.readdirSync(root);
  } catch (e) {
    return null;
  }
  const dirs = names
    .filter((n) => n.startsWith('anthropic.claude-code-'))
    .filter((n) => {
      try { return fs.statSync(path.join(root, n)).isDirectory(); } catch (e) { return false; }
    })
    .map((n) => ({ name: n, ver: n.slice('anthropic.claude-code-'.length) }))
    .sort((a, b) => cmpVer(a.ver, b.ver));
  return dirs.length ? path.join(root, dirs[dirs.length - 1].name) : null;
}

/**
 * @param {vscode.ExtensionContext} context
 * @param {{force?: boolean}} [opts]
 */
function check(context, opts) {
  const force = Boolean(opts && opts.force);
  const dir = newestClaudeExtDir();
  if (!dir) {
    if (force) vscode.window.showWarningMessage('没找到已安装的 Claude Code 扩展。');
    return;
  }
  const dirName = path.basename(dir);
  if (!force && context.globalState.get(STATE_KEY) === dirName) return;
  if (running) return;

  const script = findRepatch();
  if (!script) {
    log(`找不到 repatch.js（请在设置 claudeWs.repatchScript 中指定路径），跳过。`);
    if (force) vscode.window.showWarningMessage('找不到 repatch.js，无法恢复补丁。');
    return;
  }

  running = true;
  log(`检测到 ${dirName}，开始恢复补丁…`);
  execFile(
    process.execPath,
    [script],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      timeout: 120000,
      windowsHide: true,
    },
    async (err, stdout, stderr) => {
      running = false;
      const text = `${stdout || ''}${stderr || ''}`;
      if (err) {
        log(`执行失败：${err.message}`);
        if (force) vscode.window.showErrorMessage(`恢复补丁失败：${err.message}`);
        return;
      }
      const changed = /已恢复/.test(text);
      // force（命令面板「恢复本地补丁」）一律重载 webview：盘上的补丁可能是在别处写进去的
      // （比如手动跑 claude-zh.js apply），这时 repatch 会报「补丁完好」，但界面还是旧渲染。
      const willReload = changed || force;
      log(willReload ? '补丁已恢复，正在重载 webview…' : '补丁完好，无需处理。');
      try { await context.globalState.update(STATE_KEY, dirName); } catch (e) { /* 忽略 */ }
      if (willReload) {
        let reloaded = false;
        for (const id of RELOAD_WEBVIEW_CMDS) {
          try {
            await vscode.commands.executeCommand(id);
            reloaded = true;
            break;
          } catch (e) { /* 试下一个命令 id */ }
        }
        if (!reloaded) {
          log('重载 webview 失败（命令 id 都不认）；请手动执行 Developer: Reload Webviews');
          if (force) vscode.window.showWarningMessage('本地补丁就绪，但自动重载失败，请手动执行 Developer: Reload Webviews。');
          return;
        }
        if (force) {
          vscode.window.showInformationMessage(
            changed ? '补丁已恢复并重载 webview。' : '补丁完好，已重载 webview。'
          );
        }
      }
    }
  );
}

module.exports = { check, log, startEnvGuard, startGlobalSyncWatch, startProjectBackup };

/* ---------------- 模型名 env 守护 ---------------- */
// 2026-11-14 实测：CC Switch 在接管/同步时会重写 ~/.claude/settings.json 的 env，
// 把 ANTHROPIC_DEFAULT_*_MODEL 三项改回它自己的值（14:47:57 与 live-state.json 同一秒写入）。
// 这里监听该文件，发现三项对不上就纠正回来。可在 VS Code 设置里关闭：
//   "claudeWs.guardModelEnv": false
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');

let envWatcher = null;
let envTimer = null;
let envLastFix = 0;

function fixEnvIfNeeded(reason) {
  const cfg = vscode.workspace.getConfiguration('claudeWs');
  if (!cfg.get('guardModelEnv', false)) return;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
  } catch (e) {
    return;
  }
  const env = data && data.env;
  if (!env) return;
  const wantEnv = cfg.get('guardModelEnvValues', {});
  const drifted = Object.keys(wantEnv).filter((k) => env[k] !== wantEnv[k]);
  if (!drifted.length) return;
  // 冷却 60s，避免和写入方互相拉锯
  if (Date.now() - envLastFix < 60000) return;
  envLastFix = Date.now();
  for (const k of drifted) env[k] = wantEnv[k];
  try {
    fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(data, null, 2) + '\n', 'utf8');
    log(`已纠正被改写的模型名（${reason}）：${drifted.join(', ')}`);
  } catch (e) {
    log(`纠正模型名失败：${e.message}`);
  }
}

function startEnvGuard() {
  try {
    envWatcher = fs.watch(path.dirname(CLAUDE_SETTINGS), (evt, filename) => {
      if (filename && filename !== 'settings.json') return;
      clearTimeout(envTimer);
      envTimer = setTimeout(() => fixEnvIfNeeded('文件被外部修改'), 1500);
    });
    envWatcher.on('error', () => {});
  } catch (e) {
    log(`模型名守护启动失败：${e.message}`);
  }
  setTimeout(() => fixEnvIfNeeded('启动检查'), 5000);
}

/* ---------------- 全局 CLAUDE.md → 镜像 自动同步 ---------------- */
// 监听 ~/.claude/CLAUDE.md，一变就跑指定脚本同步到桌面端镜像（脚本自带 MD5 核对）。
// 需要同时配置 claudeWs.syncGlobalScript 和 claudeWs.syncGlobalDst 才能启用。
// 可用 "claudeWs.syncGlobalOnChange": false 关闭。
const crypto = require('crypto');
const GLOBAL_SRC = path.join(os.homedir(), '.claude', 'CLAUDE.md');
const PWSH_CANDIDATES = [
  'pwsh.exe',
  'powershell.exe',
];

let globalWatcher = null;
let globalTimer = null;
let globalBusy = false;

function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

function pickPwsh() {
  for (const p of PWSH_CANDIDATES) {
    if (!path.isAbsolute(p)) return p; // 裸命令名交给 PATH
    try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* 试下一个 */ }
  }
  return 'powershell.exe';
}

function syncGlobalIfNeeded(reason) {
  const cfg = vscode.workspace.getConfiguration('claudeWs');
  if (!cfg.get('syncGlobalOnChange', false)) return;
  const script = cfg.get('syncGlobalScript', '');
  const dst = cfg.get('syncGlobalDst', '');
  if (!script || !dst) return;
  if (globalBusy) return;
  try {
    if (!fs.existsSync(GLOBAL_SRC)) return;
    if (fs.existsSync(dst) && md5(GLOBAL_SRC) === md5(dst)) return;
  } catch (e) {
    return;
  }
  globalBusy = true;
  execFile(
    pickPwsh(),
    ['-NoProfile', '-File', script],
    { timeout: 60000, windowsHide: true },
    (err, stdout, stderr) => {
      globalBusy = false;
      if (err) {
        log(`全局指令同步失败（${reason}）：${err.message}`);
        return;
      }
      const ok = /\[成功\] 两边一致|已复制/.test(`${stdout || ''}${stderr || ''}`);
      log(ok ? `全局指令已同步到镜像（${reason}）` : `全局指令同步完成但有异常输出（${reason}）`);
    }
  );
}

function startGlobalSyncWatch() {
  try {
    globalWatcher = fs.watch(path.dirname(GLOBAL_SRC), (evt, filename) => {
      if (filename && filename !== 'CLAUDE.md') return;
      clearTimeout(globalTimer);
      globalTimer = setTimeout(() => syncGlobalIfNeeded('文件被修改'), 2000);
    });
    globalWatcher.on('error', () => {});
  } catch (e) {
    log(`全局指令同步监视启动失败：${e.message}`);
  }
  // 启动时补一次：上次会话可能改完就关了
  setTimeout(() => syncGlobalIfNeeded('启动检查'), 8000);
}

/* ---------------- 聊天记录自动备份 ---------------- */
// VS Code 启动时跑一次指定的备份脚本，增量快照 ~/.claude/projects 到指定目录。
// 需要同时配置 claudeWs.backupScript 才能启用。可用 "claudeWs.backupOnStart": false 关闭。
let backupStarted = false;

function startProjectBackup() {
  if (backupStarted) return;
  const cfg = vscode.workspace.getConfiguration('claudeWs');
  if (cfg.get('backupOnStart', false) !== true) return;
  const script = cfg.get('backupScript', '');
  if (!script) return;
  backupStarted = true;
  // 启动后 20 秒再跑，避开扩展激活高峰
  setTimeout(() => {
    try {
      if (!fs.existsSync(script)) {
        log(`找不到备份脚本：${script}`);
        return;
      }
    } catch (e) { return; }
    execFile(
      pickPwsh(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { timeout: 600000, windowsHide: true },
      (err, stdout, stderr) => {
        const text = `${stdout || ''}${stderr || ''}`.trim();
        if (err) {
          log(`聊天记录备份失败：${err.message}`);
          return;
        }
        const last = text.split(/\r?\n/).filter(Boolean).pop() || '';
        log(`聊天记录备份：${last}`);
      }
    );
  }, 20000);
}
