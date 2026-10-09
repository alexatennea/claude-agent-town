#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ClaudeWatcher } from './lib/watcher.js';
import { startDemo } from './lib/demo.js';

const { values: opts } = parseArgs({
  options: {
    port: { type: 'string', short: 'p', default: process.env.PORT || '4777' },
    dir: { type: 'string', default: process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, 'projects') : path.join(os.homedir(), '.claude', 'projects') },
    hours: { type: 'string', default: '12' },
    demo: { type: 'boolean', default: false },
    open: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (opts.help) {
  console.log(`claude-agent-town: watch Claude Code agents and sub-agents in a little pixel town

  --port, -p <n>   port to serve on (default 4777)
  --dir <path>     Claude projects dir (default ~/.claude/projects)
  --hours <n>      load sessions active in the last n hours (default 12)
  --demo           simulate agents instead of reading real transcripts
  --open           open the browser`);
  process.exit(0);
}

let projectsDir = opts.dir;
if (opts.demo) {
  projectsDir = path.join(os.tmpdir(), 'claude-agent-town-demo', 'projects');
  startDemo(projectsDir);
}

const watcher = new ClaudeWatcher({ projectsDir, sinceHours: Number(opts.hours) || 12 });

const clients = new Set();
let pending = null;
const payload = () => JSON.stringify({ now: Date.now(), demo: opts.demo, agents: watcher.snapshot() });
function broadcast() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    const data = `data: ${payload()}\n\n`;
    for (const res of clients) res.write(data);
  }, 200);
}
watcher.on('change', broadcast);
watcher.start();
setInterval(broadcast, 5000); // keeps "stale" detection honest even when nothing is writing

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${payload()}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(payload());
  }
  const file = path.join(publicDir, path.normalize(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(publicDir)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

// Bind to loopback only: transcripts contain your prompts and code.
server.listen(Number(opts.port), '127.0.0.1', () => {
  const url = `http://localhost:${opts.port}`;
  console.log(`🏘️  Claude Agent Town at ${url}`);
  console.log(opts.demo ? '   demo mode: simulated agents' : `   watching ${projectsDir} (last ${opts.hours}h)`);
  if (opts.open) exec(`${process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open'} ${url}`);
});
