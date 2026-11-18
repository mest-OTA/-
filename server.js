'use strict';
/*
 * 非常格调的游戏 · 本地服务
 * ------------------------------------------------------------------
 * 1) 托管游戏页面（index.html / assets）
 * 2) /api/health          健康检查，供 keeper 守护
 * 3) /api/tunnel/status   查询公网隧道地址
 * 4) /api/tunnel/control  开关/重启公网隧道
 * 5) /api/stats           通关统计（有多少人通过了人机验证）
 * 6) /api/pass            记录一次通关
 * 公网访问由 tunnel-core.js（Cloudflare 免费隧道）负责，跟着本进程常驻。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const tunnel = require('./tunnel-core');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const PORT = Number(process.env.STYLISH_PORT || 18888);
const STATS = path.join(DATA, 'game-stats.json');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.mp3': 'audio/mpeg'
};

function ensureData() { try { fs.mkdirSync(DATA, { recursive: true }); } catch (e) { } }
function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } }
function writeJson(f, o) { try { ensureData(); fs.writeFileSync(f, JSON.stringify(o, null, 2), 'utf8'); } catch (e) { } }
function json(res, code, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length,
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  res.end(b);
}
function body(req, cb) {
  let s = '';
  req.on('data', c => { s += c; if (s.length > 8192) req.destroy(); });
  req.on('end', () => { let o = {}; try { o = JSON.parse(s || '{}'); } catch (e) { } cb(o); });
}
function stats() { return readJson(STATS, { passes: 0, choices: {}, firstPassAt: '', lastPassAt: '' }); }

const server = http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); res.end(); return; }
  const p = u.pathname;
  const method = req.method || 'GET';

  if (p === '/api/health') return json(res, 200, { ok: true, ts: Date.now(), name: '非常格调的游戏' });
  if (p === '/api/tunnel/status') return json(res, 200, tunnel.status());
  if (p === '/api/tunnel/control' && method === 'POST') {
    return body(req, b => json(res, 200, tunnel.control(b)));
  }
  // 触发本地 CMD 整蛊窗口：仅允许本机访问（公网域名经隧道进来时 Host 不是 localhost，一律拒绝）
  if (p === '/api/cmd-prank' && method === 'POST') {
    const host = String(req.headers.host || '');
    const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
    if (!local) return json(res, 200, { ok: false, msg: '仅限本机访问' });
    const bat = path.join(ROOT, 'cmd-prank.bat');
    if (!fs.existsSync(bat)) return json(res, 200, { ok: false, msg: '脚本缺失' });
    try {
      const child = spawn('cmd.exe', ['/c', 'start', '"prank"', 'cmd.exe', '/k', bat], {
        cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: false
      });
      child.unref();
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 200, { ok: false, msg: e.message });
    }
  }
  if (p === '/api/stats' && method === 'GET') return json(res, 200, stats());
  if (p === '/api/pass' && method === 'POST') {
    return body(req, b => {
      const s = stats();
      s.passes = (s.passes || 0) + 1;
      const id = String(b.identity || '未知').slice(0, 40);
      s.choices = s.choices || {};
      s.choices[id] = (s.choices[id] || 0) + 1;
      const now = new Date().toISOString();
      s.firstPassAt = s.firstPassAt || now;
      s.lastPassAt = now;
      writeJson(STATS, s);
      return json(res, 200, { ok: true, passes: s.passes });
    });
  }

  // 静态文件（简单防目录穿越）
  let rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
  rel = rel.replace(/([.][.][\/\\])+/, '');
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404'); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`非常格调的游戏 已启动：http://127.0.0.1:${PORT}`);
});
server.on('error', e => { console.error('服务启动失败：', e.message); process.exit(1); });

try { tunnel.start(); } catch (e) { /* 隧道失败不阻塞游戏 */ }

process.on('SIGINT', () => { try { tunnel.stopTunnel(); } catch (e) { } process.exit(0); });
process.on('SIGTERM', () => { try { tunnel.stopTunnel(); } catch (e) { } process.exit(0); });
