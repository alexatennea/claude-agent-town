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
import { AzDoPrs } from './lib/azdo.js';
import { Workspaces } from './lib/workspaces.js';

// Local settings (e.g. AZURE_DEVOPS_PAT) live in a gitignored .env next to this file; real env vars win.
const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
if (fs.existsSync(envFile)) {
  if (process.loadEnvFile) process.loadEnvFile(envFile);
  else console.warn('   .env found but ignored: needs Node 20.12+');
}

const { values: opts } = parseArgs({
  options: {
    port: { type: 'string', short: 'p', default: process.env.PORT || '4777' },
    dir: { type: 'string', default: process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, 'projects') : path.join(os.homedir(), '.claude', 'projects') },
    hours: { type: 'string', default: '12' },
    demo: { type: 'boolean', default: false },
    open: { type: 'boolean', default: false },
    'ado-org': { type: 'string', default: process.env.AZURE_DEVOPS_ORG },
    'ado-tenant': { type: 'string', default: process.env.AZURE_DEVOPS_TENANT },
    'ado-project': { type: 'string', default: process.env.AZURE_DEVOPS_PROJECT },
    'ado-team': { type: 'string', default: process.env.AZURE_DEVOPS_TEAM },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (opts.help) {
  console.log(`claude-agent-town: watch Claude Code agents and sub-agents in a little pixel town

  --port, -p <n>   port to serve on (default 4777)
  --dir <path>     Claude projects dir (default ~/.claude/projects)
  --hours <n>      load sessions active in the last n hours (default 12)
  --demo           simulate agents instead of reading real transcripts
  --open           open the browser
  --ado-org <org>  show your open Azure DevOps PRs from this org (or AZURE_DEVOPS_ORG)
  --ado-tenant <t> tenant for the az CLI token (or AZURE_DEVOPS_TENANT); AZURE_DEVOPS_PAT skips az
  --ado-project <p> --ado-team <t>
                   also show your stories in that team's current sprint (or AZURE_DEVOPS_PROJECT / _TEAM)`);
  process.exit(0);
}

let projectsDir = opts.dir;
if (opts.demo) {
  projectsDir = path.join(os.tmpdir(), 'claude-agent-town-demo', 'projects');
  startDemo(projectsDir);
}

const watcher = new ClaudeWatcher({ projectsDir, sinceHours: Number(opts.hours) || 12 });

// Choices made in the dashboard (board, person in focus, refresh rate) persist here; flags and .env are the defaults.
const settingsFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '.agent-town.json');
const saved = (() => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return {}; } })();
const saveSettings = (patch) => {
  Object.assign(saved, patch);
  fs.writeFile(settingsFile, JSON.stringify(saved, null, 2), (err) => err && console.warn(`   couldn't save settings: ${err.message}`));
};

const REFRESH_CHOICES = [30, 60, 120, 300, 900]; // seconds, offered in the dashboard
let refreshSeconds = [saved.refreshSeconds, Number(process.env.REFRESH_SECONDS)].find((n) => REFRESH_CHOICES.includes(n)) ?? 60;
const azdo = opts['ado-org'] ? new AzDoPrs({
  org: opts['ado-org'], tenant: opts['ado-tenant'], intervalMs: refreshSeconds * 1000,
  project: saved.project ?? opts['ado-project'], team: saved.team ?? opts['ado-team'], focusId: saved.focusId ?? null,
}) : null;
azdo?.start();
const workspaces = new Workspaces({ cwds: () => watcher.snapshot().map((a) => a.project) });

const clients = new Set();
let pending = null;
const payload = () => JSON.stringify({ now: Date.now(), demo: opts.demo, agents: watcher.snapshot(), prs: azdo?.snapshot() ?? null, workspaces: workspaces.snapshot(), refresh: { seconds: refreshSeconds, choices: REFRESH_CHOICES } });
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
workspaces.start();
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
  // Writes need a JSON body, which a cross-site form can't send without a CORS preflight.
  if (req.method === 'POST' && (req.headers['content-type'] || '').startsWith('application/json')) {
    if (url.pathname === '/api/refresh') {
      Promise.all([azdo?.refresh(), workspaces.refresh()]).then(() => {
        broadcast();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(payload());
      });
      return;
    }
    if (url.pathname === '/api/settings') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e4) req.destroy(); });
      req.on('end', () => {
        let b;
        try { b = JSON.parse(body || '{}'); } catch { b = null; }
        const fail = (msg) => { res.writeHead(400); res.end(msg); };
        if (!b || typeof b !== 'object') return fail('bad JSON');
        if ('refreshSeconds' in b) {
          if (!REFRESH_CHOICES.includes(b.refreshSeconds)) return fail('bad refreshSeconds');
          refreshSeconds = b.refreshSeconds;
          azdo?.setIntervalMs(refreshSeconds * 1000);
          saveSettings({ refreshSeconds });
        }
        if (azdo && ('team' in b || 'focusId' in b)) {
          const pick = {};
          if ('team' in b) {
            const t = azdo.snapshot().teams?.find((x) => x.project === b.project && x.name === b.team);
            if (!t) return fail('unknown team');
            Object.assign(pick, { project: t.project, team: t.name });
          }
          if ('focusId' in b) {
            if (b.focusId !== null && !/^[0-9a-f-]{36}$/i.test(b.focusId)) return fail('bad focusId');
            pick.focusId = b.focusId === azdo.snapshot().me ? null : b.focusId; // null = whoever is signed in
          }
          saveSettings(pick);
          azdo.select(pick).then(broadcast);
        }
        broadcast();
        res.writeHead(204);
        res.end();
      });
      return;
    }
  }
  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(payload());
  }
  const file = path.join(publicDir, path.normalize(url.pathname === '/' ? '/index.html' : url.pathname === '/dashboard' ? '/dashboard.html' : url.pathname));
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
