'use strict';
/*
 * 非常格调的游戏 · 24 小时常驻守护 (keeper)
 * 1) 用 127.0.0.1:18889 做单实例锁；
 * 2) 每 5 秒检查 /api/health，不通就 detached 重新拉起 server.js；
 * 3) 日志写 data/keeper.log，状态写 data/keeper-state.json。
 * 用法：node keeper.js --loop | --ensure | --status
 * 只用 Node 内置模块。
 */
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const NODE = process.execPath;
const SERVER_JS = path.join(ROOT, 'server.js');
const DATA = path.join(ROOT, 'data');
const LOG_FILE = path.join(DATA, 'keeper.log');
const CONSOLE_LOG = path.join(DATA, 'keeper-console.log');
const OUT_FILE = path.join(DATA, 'server.out.log');
const ERR_FILE = path.join(DATA, 'server.err.log');
const STATE_FILE = path.join(DATA, 'keeper-state.json');
const LOCK_PORT = 18889;
const WEB_PORT = Number(process.env.STYLISH_PORT || 18888);
const CHECK_MS = 5000;
const SPAWN_COOLDOWN_MS = 8000;
const MAX_LOG_BYTES = 512 * 1024;

function stamp(t = Date.now()) {
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function ensureData() { try { fs.mkdirSync(DATA, { recursive: true }); } catch (e) { } }
function log(msg) {
  const line = `[${stamp()}] ${msg}\n`;
  try {
    ensureData();
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
      const tail = fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-600).join('\n');
      fs.writeFileSync(LOG_FILE, tail + '\n', 'utf8');
    }
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch (e) { }
  try { if (process.stdout.isTTY) process.stdout.write(line); } catch (e) { }
}
function saveState(patch) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { }
  try {
    ensureData();
    fs.writeFileSync(STATE_FILE, JSON.stringify(Object.assign(s, patch, { updatedAt: stamp() }), null, 2), 'utf8');
  } catch (e) { }
}
function healthy(cb) {
  let settled = false;
  const done = v => { if (!settled) { settled = true; cb(v); } };
  let req;
  try {
    req = http.get({ host: '127.0.0.1', port: WEB_PORT, path: '/api/health', timeout: 2000 }, res => {
      let body = '';
      res.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
      res.on('end', () => {
        let ok = res.statusCode === 200;
        try { ok = ok && JSON.parse(body).ok === true; } catch (e) { ok = false; }
        done(ok);
      });
    });
  } catch (e) { return done(false); }
  req.on('timeout', () => { try { req.destroy(); } catch (e) { } done(false); });
  req.on('error', () => done(false));
}
let child = null, lastSpawnAt = 0, spawnCount = 0, wasDown = false;
function startServer(reason, detached) {
  if (child) return false;
  if (Date.now() - lastSpawnAt < SPAWN_COOLDOWN_MS) return false;
  let outFd, errFd, logFd;
  try {
    ensureData();
    if (detached) {
      outFd = fs.openSync(OUT_FILE, 'a');
      errFd = fs.openSync(ERR_FILE, 'a');
    } else {
      logFd = fs.openSync(LOG_FILE, 'a');
      outFd = logFd; errFd = logFd;
    }
    const c = spawn(NODE, [SERVER_JS], {
      cwd: ROOT, detached: true, windowsHide: true,
      stdio: ['ignore', outFd, errFd], env: Object.assign({}, process.env)
    });
    c.unref();
    if (outFd !== logFd) fs.closeSync(outFd);
    if (errFd !== logFd) fs.closeSync(errFd);
    if (logFd) fs.closeSync(logFd);
    child = c;
    lastSpawnAt = Date.now();
    spawnCount += 1;
    log(`已拉起服务 pid=${c.pid} 原因=${reason} 第 ${spawnCount} 次`);
    saveState({ lastSpawnAt: stamp(), lastSpawnReason: reason, spawnCount, serverPid: c.pid });
    c.on('exit', code => {
      if (child === c) child = null;
      log(`服务进程退出 pid=${c.pid} code=${code}，守护会在下一轮检查时重拉`);
      saveState({ serverPid: null, lastExitCode: code, lastExitAt: stamp() });
    });
    c.on('error', e => {
      if (child === c) child = null;
      log(`服务进程错误 pid=${c.pid} ${e.message}`);
    });
    return true;
  } catch (e) {
    log(`拉起服务失败：${e.message}`);
    return false;
  }
}
function tick() {
  healthy(ok => {
    if (ok) {
      if (wasDown) { log('服务已恢复，/api/health 正常'); wasDown = false; }
      saveState({ healthy: true, lastHealthyAt: stamp() });
      return;
    }
    if (!wasDown) { log(`健康检查失败（端口 ${WEB_PORT}），开始自动恢复`); wasDown = true; }
    saveState({ healthy: false });
    startServer('健康检查失败', true);
  });
}
function runLoop() {
  const lock = net.createServer(s => s.destroy());
  lock.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.log('非常格调的游戏 常驻守护已在运行（单实例），本次退出。');
      process.exit(0);
    }
    console.error('守护锁端口失败：' + e.message);
    process.exit(1);
  });
  lock.listen(LOCK_PORT, '127.0.0.1', () => {
    log(`守护已启动 pid=${process.pid} 锁端口=${LOCK_PORT} 服务端口=${WEB_PORT} 检查间隔=${CHECK_MS / 1000}s`);
    saveState({ keeperPid: process.pid, lockPort: LOCK_PORT, webPort: WEB_PORT, startedAt: stamp(), spawnCount, healthy: false });
    setTimeout(() => { tick(); setInterval(tick, CHECK_MS); }, 1200);
  });
  process.on('SIGINT', () => { log('守护收到 SIGINT，退出'); process.exit(0); });
  process.on('SIGTERM', () => { log('守护收到 SIGTERM，退出'); process.exit(0); });
}
function spawnKeeper() {
  let fd = null;
  try {
    ensureData();
    try { fd = fs.openSync(CONSOLE_LOG, 'a'); } catch (e) { fd = null; }
    const c = spawn(NODE, [__filename, '--loop'], {
      cwd: ROOT, detached: true, windowsHide: true,
      stdio: fd == null ? 'ignore' : ['ignore', fd, fd], env: Object.assign({}, process.env)
    });
    c.unref();
    if (fd != null) fs.closeSync(fd);
    console.log(`已拉起 非常格调的游戏 常驻守护 pid=${c.pid}`);
  } catch (e) {
    if (fd != null) { try { fs.closeSync(fd); } catch (e) { } }
    console.error('拉起常驻守护失败：' + e.message);
  }
}
function ensure() {
  const s = net.connect(LOCK_PORT, '127.0.0.1');
  s.setTimeout(1500);
  let done = false;
  const finish = (msg, need) => {
    if (done) return;
    done = true;
    try { s.destroy(); } catch (e) { }
    console.log(msg);
    if (need) spawnKeeper();
    else process.exit(0);
    setTimeout(() => process.exit(0), 200);
  };
  s.on('connect', () => finish('常驻守护已在运行，无需重复启动。', false));
  s.on('error', () => finish('守护未运行，正在后台拉起…', true));
  s.on('timeout', () => finish('守护探测超时，正在后台拉起…', true));
}
function status() {
  let st = {};
  try { st = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { }
  const s = net.connect(LOCK_PORT, '127.0.0.1');
  s.setTimeout(1200);
  const out = o => { console.log(JSON.stringify(o, null, 2)); process.exit(0); };
  s.on('connect', () => { s.destroy(); out(Object.assign({ keeperRunning: true }, st)); });
  s.on('error', () => out(Object.assign({ keeperRunning: false }, st)));
  s.on('timeout', () => { s.destroy(); out(Object.assign({ keeperRunning: false }, st)); });
}
const arg = process.argv[2] || '--loop';
if (arg === '--ensure') ensure();
else if (arg === '--status') status();
else if (arg === '--once') { tick(); setTimeout(() => process.exit(0), 3000); }
else runLoop();
