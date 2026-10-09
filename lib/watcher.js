// Watches Claude Code transcripts (~/.claude/projects/**) and turns them into live agent state.
//
// Layout on disk:
//   <projects>/<encoded-cwd>/<sessionId>.jsonl                          main agent
//   <projects>/<encoded-cwd>/<sessionId>/subagents/agent-<id>.jsonl     sub-agent
//   <projects>/<encoded-cwd>/<sessionId>/subagents/agent-<id>.meta.json sub-agent metadata
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const MAX_EVENTS = 60;

const READ_CMDS = /^(cat|head|tail|less|more|sed\s+-n|awk|ls|ll|tree|find|fd|rg|grep|ag|wc|nl|file|stat|du|jq|bat|diff|cmp|which|pwd|echo)\b/;
const TEST_CMDS = /\b(test|tests|pytest|jest|vitest|mocha|rspec|phpunit|playwright|cypress|xunit|nunit)\b/;
const GIT_CMDS = /^(git|gh)\b/;
const SEARCH_CMDS = /^(curl|wget|http|xh)\b/;

export function classifyCommand(cmd = '') {
  // Strip env assignments, `cd x &&` prefixes and sudo so we classify the real program.
  let c = String(cmd).trim();
  c = c.replace(/^(cd\s+\S+\s*(&&|;)\s*)+/, '');
  c = c.replace(/^([A-Z_][A-Z0-9_]*=\S+\s+)+/, '').replace(/^sudo\s+/, '');
  if (TEST_CMDS.test(c) && !READ_CMDS.test(c)) return 'testing';
  if (GIT_CMDS.test(c)) return 'git';
  if (SEARCH_CMDS.test(c)) return 'searching';
  if (READ_CMDS.test(c)) return 'reading';
  return 'running';
}

export function classifyTool(name = '', input = {}) {
  const n = name;
  const s = (v) => (v == null ? '' : String(v));
  switch (n) {
    case 'Read': case 'NotebookRead': return ['reading', s(input.file_path || input.notebook_path)];
    case 'Glob': return ['reading', s(input.pattern)];
    case 'Grep': return ['reading', `grep ${s(input.pattern)}`];
    case 'LS': return ['reading', s(input.path)];
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit':
      return ['editing', s(input.file_path || input.notebook_path)];
    case 'Bash': return [classifyCommand(input.command), s(input.description || input.command)];
    case 'BashOutput': case 'Monitor': return ['running', 'checking background output'];
    case 'KillShell': case 'KillBash': case 'TaskStop': return ['running', 'stopping a process'];
    case 'WebSearch': return ['searching', s(input.query)];
    case 'WebFetch': return ['searching', s(input.url)];
    case 'Agent': case 'Task': return ['spawning', s(input.description || input.subagent_type)];
    case 'SendMessage': return ['talking', 'messaging another agent'];
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': case 'EnterPlanMode': case 'ExitPlanMode':
      return ['thinking', 'planning'];
    case 'Skill': return ['reading', `skill: ${s(input.skill)}`];
    case 'ToolSearch': return ['reading', 'looking up tools'];
    case 'AskUserQuestion': return ['talking', 'asking you a question'];
  }
  if (/handback|report_?back/i.test(n)) return ['done', 'reporting back'];
  if (/browser|chrome|navigate|fetch|search/i.test(n)) return ['searching', n.replace(/^mcp__[^_]+__/, '')];
  if (n.startsWith('mcp__')) return ['tooling', n.replace(/^mcp__/, '').replace(/__/g, ' › ')];
  return ['tooling', n];
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n');
}

function isNoiseUserText(t) {
  return !t || /^\s*<(command-|local-command|system-reminder|task-notification|bash-|user-memory)/.test(t) || t.startsWith('[Request interrupted');
}

const oneLine = (t, n = 160) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);

export class ClaudeWatcher extends EventEmitter {
  constructor({ projectsDir, sinceHours = 12, pollMs = 600, scanMs = 3000 }) {
    super();
    this.projectsDir = projectsDir;
    this.sinceMs = sinceHours * 3600_000;
    this.pollMs = pollMs;
    this.scanMs = scanMs;
    this.files = new Map(); // file path -> { offset, rem, agentKey }
    this.agents = new Map(); // agentKey -> agent
    this.childOf = new Map(); // child agentId -> parent agentKey (from Agent tool results)
    this.toolOwner = new Map(); // tool_use id -> agentKey
  }

  start() {
    this.scan();
    this.scanTimer = setInterval(() => this.scan(), this.scanMs);
    this.pollTimer = setInterval(() => this.poll(), this.pollMs);
  }

  stop() {
    clearInterval(this.scanTimer);
    clearInterval(this.pollTimer);
  }

  scan() {
    const cutoff = Date.now() - this.sinceMs;
    let projectDirs = [];
    try { projectDirs = fs.readdirSync(this.projectsDir, { withFileTypes: true }); } catch { return; }
    let changed = false;
    for (const pd of projectDirs) {
      if (!pd.isDirectory()) continue;
      const dir = path.join(this.projectsDir, pd.name);
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.jsonl')) {
          changed = this.track(path.join(dir, e.name), cutoff, { sessionId: e.name.slice(0, -6) }) || changed;
        } else if (e.isDirectory()) {
          const subDir = path.join(dir, e.name, 'subagents');
          let subs = [];
          try { subs = fs.readdirSync(subDir); } catch { continue; }
          for (const f of subs) {
            if (!f.endsWith('.jsonl')) continue;
            changed = this.track(path.join(subDir, f), cutoff, { sessionId: e.name, agentId: f.replace(/^agent-/, '').slice(0, -6) }) || changed;
          }
        }
      }
    }
    if (changed) this.emit('change');
  }

  track(file, cutoff, ids) {
    if (this.files.has(file)) return false;
    let st;
    try { st = fs.statSync(file); } catch { return false; }
    if (st.mtimeMs < cutoff) return false;
    const key = ids.agentId ? `${ids.sessionId}/${ids.agentId}` : ids.sessionId;
    this.files.set(file, { offset: 0, rem: Buffer.alloc(0), key });
    const agent = this.ensureAgent(key, ids);
    if (ids.agentId) {
      try {
        const meta = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
        agent.agentType = meta.agentType || agent.agentType;
        agent.title = meta.description || agent.title;
        agent.spawnToolUseId = meta.toolUseId;
        agent.depth = meta.spawnDepth || 1;
        agent.background = meta.requestShape === 'background';
      } catch { /* meta is optional */ }
    }
    this.read(file);
    return true;
  }

  ensureAgent(key, { sessionId, agentId }) {
    let a = this.agents.get(key);
    if (!a) {
      a = {
        key, sessionId, agentId: agentId || null, isMain: !agentId,
        title: '', agentType: agentId ? 'subagent' : 'main', cwd: '', branch: '', model: '',
        task: '', activity: 'idle', detail: '', activityAt: 0, startedAt: 0, lastAt: 0,
        done: false, waitingForUser: false, contextTokens: 0, outputTokens: 0, toolCalls: 0,
        events: [], depth: agentId ? 1 : 0,
      };
      this.agents.set(key, a);
    }
    return a;
  }

  poll() {
    let changed = false;
    for (const file of this.files.keys()) changed = this.read(file) || changed;
    if (changed) this.emit('change');
  }

  read(file) {
    const f = this.files.get(file);
    let st;
    try { st = fs.statSync(file); } catch { return false; }
    if (st.size < f.offset) { f.offset = 0; f.rem = Buffer.alloc(0); } // truncated / rewritten
    if (st.size === f.offset) return false;
    const fd = fs.openSync(file, 'r');
    try {
      const len = st.size - f.offset;
      const chunk = Buffer.alloc(len);
      fs.readSync(fd, chunk, 0, len, f.offset);
      f.offset = st.size;
      const buf = f.rem.length ? Buffer.concat([f.rem, chunk]) : chunk;
      const nl = buf.lastIndexOf(10);
      if (nl === -1) { f.rem = buf; return false; }
      f.rem = buf.subarray(nl + 1);
      const agent = this.agents.get(f.key);
      for (const line of buf.subarray(0, nl).toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        try { this.apply(agent, JSON.parse(line)); } catch { /* partial or odd line */ }
      }
      return true;
    } finally {
      fs.closeSync(fd);
    }
  }

  set(agent, activity, detail, ts, logText) {
    agent.activity = activity;
    agent.detail = oneLine(detail);
    agent.activityAt = ts;
    const text = oneLine(logText ?? detail, 400);
    const last = agent.events[agent.events.length - 1];
    if (last && last.activity === activity && last.text === text) return;
    agent.events.push({ ts, activity, text });
    if (agent.events.length > MAX_EVENTS) agent.events.splice(0, agent.events.length - MAX_EVENTS);
  }

  apply(a, rec) {
    const ts = Date.parse(rec.timestamp) || 0;
    if (rec.cwd && !a.cwd) a.cwd = rec.cwd;
    if (rec.gitBranch) a.branch = rec.gitBranch;
    if (ts) {
      if (!a.startedAt || ts < a.startedAt) a.startedAt = ts;
      if (ts > a.lastAt) a.lastAt = ts;
    }

    switch (rec.type) {
      case 'custom-title': if (rec.customTitle) a.title = rec.customTitle; return;
      case 'agent-name': if (rec.agentName && !a.title) a.title = rec.agentName; return;
      case 'summary': if (rec.summary && !a.title) a.title = rec.summary; return;
      case 'system':
        if (rec.subtype === 'api_error') this.set(a, a.activity, a.detail, ts, '⚠️ API error, retrying');
        return;
      case 'user': return this.applyUser(a, rec, ts);
      case 'assistant': return this.applyAssistant(a, rec, ts);
    }
  }

  applyUser(a, rec, ts) {
    if (a.isMain && rec.isSidechain) return; // legacy in-file sidechains
    const content = rec.message?.content;
    if (Array.isArray(content) && content.some((c) => c?.type === 'tool_result')) {
      // An Agent tool result tells us which sub-agent this agent spawned.
      const r = rec.toolUseResult;
      if (r && typeof r === 'object' && r.agentId) this.childOf.set(String(r.agentId), a.key);
      return;
    }
    const text = textOf(content);
    if (isNoiseUserText(text) || rec.isMeta) return;
    if (!a.task) a.task = oneLine(text, 400);
    a.done = false;
    a.waitingForUser = false;
    this.set(a, 'listening', a.isMain ? 'new instructions' : 'got the brief', ts, (a.isMain ? '🧑 ' : '📋 ') + text);
  }

  applyAssistant(a, rec, ts) {
    if (a.isMain && rec.isSidechain) return;
    const m = rec.message || {};
    if (m.model && m.model !== '<synthetic>') a.model = m.model;
    const u = m.usage;
    if (u) {
      const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      if (ctx) a.contextTokens = ctx;
    }
    // Streaming splits one message across lines; count output tokens once per message id.
    if (u?.output_tokens && m.id && m.id !== a._lastMsgId) {
      a._lastMsgId = m.id;
      a.outputTokens += u.output_tokens;
    }
    a.done = false;
    a.waitingForUser = false;

    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (c.type === 'thinking' || c.type === 'redacted_thinking') {
        this.set(a, 'thinking', 'thinking…', ts, '💭 thinking');
      } else if (c.type === 'text' && c.text?.trim()) {
        this.set(a, 'talking', c.text, ts, '💬 ' + c.text);
      } else if (c.type === 'tool_use') {
        a.toolCalls++;
        this.toolOwner.set(c.id, a.key);
        const [act, detail] = classifyTool(c.name, c.input || {});
        this.set(a, act, detail, ts, `${c.name}: ${detail}`);
        if (act === 'done') a.done = !a.isMain;
      } else if (c.type === 'server_tool_use') {
        this.set(a, 'searching', c.input?.query || c.name, ts, `${c.name}: ${c.input?.query || ''}`);
      }
    }

    if (m.stop_reason === 'end_turn' || m.stop_reason === 'stop_sequence') {
      if (a.isMain) {
        a.waitingForUser = true;
        this.set(a, 'waiting', 'waiting for you', ts, '✅ finished turn, waiting for you');
      } else {
        a.done = true;
        this.set(a, 'done', 'finished', ts, '🏁 finished and reported back');
      }
    }
  }

  parentOf(a) {
    if (a.isMain) return null;
    if (this.childOf.has(a.agentId)) return this.childOf.get(a.agentId);
    if (a.spawnToolUseId && this.toolOwner.has(a.spawnToolUseId)) return this.toolOwner.get(a.spawnToolUseId);
    return this.agents.has(a.sessionId) ? a.sessionId : null;
  }

  snapshot() {
    const list = [...this.agents.values()].filter((a) => a.lastAt);
    const parents = new Map(list.map((a) => [a.key, this.parentOf(a)]));
    const root = (a) => {
      let k = a.key;
      for (let i = 0; i < 10 && parents.get(k); i++) k = parents.get(k);
      return this.agents.get(k) || a;
    };
    return list.map((a) => {
      const r = root(a);
      const cwd = r.cwd || a.cwd;
      const { _lastMsgId, spawnToolUseId, ...rest } = a;
      return {
        ...rest,
        parent: parents.get(a.key),
        project: cwd,
        projectName: projectName(cwd),
        sessionTitle: r.title || r.task,
      };
    });
  }
}

export function projectName(cwd = '') {
  if (!cwd) return 'unknown';
  if (cwd.includes('/scratch-workspaces/')) return `scratch ${path.basename(cwd).replace(/^scratch-/, '')}`;
  return path.basename(cwd);
}
