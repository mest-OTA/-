'use strict';
/**
 * 非常格调的游戏 · 公网隧道（Cloudflare Quick Tunnel，免账号 / 免 token / 免费）
 * 照抄第一个任务（SteamLens）的成熟实现：纯出站连接，本机不需开任何入站端口。
 * 本模块运行在 server.js 进程内，跟着 keeper 常驻。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const CF = path.join(ROOT, 'tools', 'cloudflared.exe');
const OUT = path.join(DATA, 'tunnel.out.log');
const ERR = path.join(DATA, 'tunnel.err.log');
const STATE = path.join(DATA, 'tunnel-state.json');
const CONTROL = path.join(DATA, 'tunnel-control.json');
const SPAWN_COOLDOWN_MS = 15000;
const PORT = Number(process.env.STYLISH_PORT || 18888);

let cfProc = null, lastSpawnAt = 0, spawnCount = 0, timer = null, started = false;
const startedAt = Date.now();

function stamp(t = Date.now()) {
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function ensureData() { try { fs.mkdirSync(DATA, { recursive: true }); } catch (e) { } }
function log(msg) {
  const line = `[隧道 ${stamp()}] ${msg}\n`;
  try { ensureData(); fs.appendFileSync(path.join(DATA, 'tunnel.log'), line, 'utf8'); } catch (e) { }
  try { console.log(line.trim()); } catch (e) { }
}
function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } }
function writeState(patch) {
  const s = readJson(STATE, {});
  try { ensureData(); fs.writeFileSync(STATE, JSON.stringify(Object.assign(s, patch, { updatedAt: stamp() }), null, 2), 'utf8'); } catch (e) { }
}
function enabled() { return readJson(CONTROL, {}).enabled !== false; }
function extractUrl() {
  let txt = '';
  try { txt += fs.readFileSync(ERR, 'utf8'); } catch (e) { }
  try { txt += fs.readFileSync(OUT, 'utf8'); } catch (e) { }
  const all = txt.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/ig) || [];
  return all.length ? all[all.length - 1] : '';
}
function killOrphans() {
  try {
    const out = execFileSync('wmic', ['process', 'where', "name='cloudflared.exe'", 'get', 'ProcessId,ExecutablePath', '/format:csv'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const cfNorm = path.resolve(CF).toLowerCase();
    for (const line of out.split(/\r?\n/)) {
      const parts = line.trim().split(',');
      if (parts.length < 3) continue;
      const exe = parts[1] || '', pid = parts[2] || '';
      if (/cloudflared\.exe$/i.test(exe) && path.resolve(exe).toLowerCase() === cfNorm && /^\d+$/.test(pid)) {
        if (cfProc && Number(pid) === cfProc.pid) continue;
        try { process.kill(Number(pid)); log(`清理残留隧道进程 pid=${pid}`); } catch (e) { }
      }
    }
  } catch (e) { }
}
function publishUrl() {
  const url = extractUrl();
  const s = readJson(STATE, {});
  if (url && url !== s.url) {
    writeState({ url, changedAt: stamp() });
    log(`公网地址已更新：${url}`);
  }
  return url;
}
function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function startTunnel(reason) {
  if (cfProc && alive(cfProc.pid)) return false;
  if (!enabled()) return false;
  if (Date.now() - lastSpawnAt < SPAWN_COOLDOWN_MS) return false;
  if (!fs.existsSync(CF)) { log(`找不到 cloudflared：${CF}`); return false; }
  let outFd, errFd;
  try {
    ensureData();
    try { fs.writeFileSync(ERR, '', 'utf8'); } catch (e) { }
    try { fs.writeFileSync(OUT, '', 'utf8'); } catch (e) { }
    outFd = fs.openSync(OUT, 'a');
    errFd = fs.openSync(ERR, 'a');
    const args = ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`];
    const c = spawn(CF, args, { cwd: ROOT, detached: true, windowsHide: true, stdio: ['ignore', outFd, errFd] });
    c.unref();
    try { fs.closeSync(outFd); } catch (e) { }
    try { fs.closeSync(errFd); } catch (e) { }
    cfProc = c;
    lastSpawnAt = Date.now();
    spawnCount += 1;
    writeState({ pid: c.pid, running: true, spawnCount, lastSpawnReason: reason });
    log(`拉起隧道 pid=${c.pid} 原因=${reason} 第 ${spawnCount} 次`);
    c.on('exit', code => {
      if (cfProc === c) cfProc = null;
      log(`隧道退出 pid=${c.pid} code=${code}`);
      writeState({ running: false, pid: null, lastExitCode: code, lastExitAt: stamp() });
    });
    c.on('error', e => { if (cfProc === c) cfProc = null; log(`隧道错误 ${e.message}`); });
    return true;
  } catch (e) { log(`拉起失败：${e.message}`); return false; }
}
function stopTunnel() {
  if (cfProc) { try { process.kill(cfProc.pid); } catch (e) { } cfProc = null; }
  writeState({ running: false, pid: null, url: '', stoppedAt: stamp() });
  log('隧道已停止');
}
function tick() {
  if (!enabled()) { if (cfProc) stopTunnel(); return; }
  if (cfProc && alive(cfProc.pid)) { publishUrl(); return; }
  if (cfProc && !alive(cfProc.pid)) cfProc = null;
  startTunnel('健康检查：隧道未运行');
}
function start() {
  if (started) return;
  started = true;
  log(`隧道模块启动（跟随 server 常驻），目标端口 ${PORT}`);
  killOrphans();
  tick();
  timer = setInterval(() => { try { tick(); } catch (e) { } }, 5000);
  try { timer.unref(); } catch (e) { }
}
function status() {
  const s = readJson(STATE, {});
  return {
    ok: true, enabled: enabled(), running: !!(cfProc && alive(cfProc.pid)),
    url: s.url || '', pid: cfProc ? cfProc.pid : null, spawnCount: s.spawnCount || 0,
    changedAt: s.changedAt || '', provider: 'cloudflare-quick-tunnel',
    note: '免账号 / 免 token / 免费；纯出站连接，不需开入站端口。网址每次隧道重连会变，软件自动更新。',
    uptimeSec: Math.round((Date.now() - startedAt) / 1000)
  };
}
function control(p = {}) {
  if (typeof p.enabled === 'boolean') {
    try { ensureData(); fs.writeFileSync(CONTROL, JSON.stringify({ enabled: p.enabled }, null, 2), 'utf8'); } catch (e) { }
    if (!p.enabled) stopTunnel();
    else setTimeout(() => { lastSpawnAt = 0; tick(); }, 200);
  }
  if (p.restart === true) { stopTunnel(); lastSpawnAt = 0; setTimeout(() => tick(), 300); }
  return status();
}
module.exports = { start, status, control, stopTunnel, startTunnel, publishUrl };
