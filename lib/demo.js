// Writes fake Claude Code transcripts (same on-disk format as ~/.claude/projects) so you can
// watch the town without real agents running. The watcher reads these exactly like real ones.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.random() * (b - a);

const STEPS = {
  read: () => pick([
    ['Read', { file_path: 'src/auth/session.ts' }], ['Read', { file_path: 'src/api/routes.ts' }],
    ['Grep', { pattern: 'TODO|FIXME' }], ['Glob', { pattern: '**/*.test.ts' }],
    ['Bash', { command: 'rg -n "refreshToken" src', description: 'Find refresh token usages' }],
    ['Bash', { command: 'ls -la src/components', description: 'List components' }],
  ]),
  edit: () => pick([
    ['Edit', { file_path: 'src/auth/session.ts' }], ['Edit', { file_path: 'src/api/routes.ts' }],
    ['Write', { file_path: 'src/utils/retry.ts' }], ['MultiEdit', { file_path: 'src/components/Header.tsx' }],
  ]),
  run: () => pick([
    ['Bash', { command: 'npm run build', description: 'Build the project' }],
    ['Bash', { command: 'npx tsc --noEmit', description: 'Type-check' }],
    ['Bash', { command: 'docker compose ps', description: 'Check containers' }],
    ['mcp__postgres__query', { sql: 'select 1' }],
  ]),
  test: () => pick([
    ['Bash', { command: 'npm test -- auth', description: 'Run auth tests' }],
    ['Bash', { command: 'npx vitest run src/api', description: 'Run API tests' }],
    ['Bash', { command: 'dotnet test', description: 'Run .NET tests' }],
  ]),
  git: () => pick([
    ['Bash', { command: 'git status --short', description: 'Check working tree' }],
    ['Bash', { command: 'git diff --stat', description: 'Summarise changes' }],
    ['Bash', { command: 'gh pr view 42', description: 'Look at the PR' }],
  ]),
  search: () => pick([
    ['WebSearch', { query: 'OAuth refresh token rotation best practice' }],
    ['WebFetch', { url: 'https://nodejs.org/api/fs.html' }],
  ]),
  plan: () => ['TodoWrite', { todos: [] }],
};

const SAYS = [
  'Found the culprit: the session cache never expires.',
  'Tests are green, moving on to the edge cases.',
  "I'll split this into three pieces of work.",
  'That helper is unused, so I can remove it safely.',
  'Build passes. Checking types next.',
];

const SUB_JOBS = [
  ['Explore', 'Map the auth flow'], ['general-purpose', 'Fix flaky API tests'],
  ['general-purpose', 'Refactor retry helper'], ['Explore', 'Find all TODOs'],
  ['code-reviewer', 'Review the diff'], ['general-purpose', 'Update the docs'],
];

class Transcript {
  constructor(file, base) {
    this.file = file;
    this.base = base;
    this.parentUuid = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  write(rec) {
    const uuid = randomUUID();
    fs.appendFileSync(this.file, JSON.stringify({
      parentUuid: this.parentUuid, ...this.base, uuid, timestamp: new Date().toISOString(), ...rec,
    }) + '\n');
    this.parentUuid = uuid;
  }
  user(content, extra = {}) { this.write({ type: 'user', message: { role: 'user', content }, ...extra }); }
  assistant(content, stop_reason = 'tool_use') {
    this.write({
      type: 'assistant',
      message: {
        id: 'msg_' + randomBytes(8).toString('hex'), role: 'assistant', model: 'claude-opus-5-5', content, stop_reason,
        usage: { input_tokens: 4, cache_read_input_tokens: Math.floor(rand(20000, 120000)), output_tokens: Math.floor(rand(40, 900)) },
      },
    });
  }
  tool(name, input, result = 'ok', toolUseResult) {
    const id = 'toolu_' + randomBytes(10).toString('hex');
    this.assistant([{ type: 'tool_use', id, name, input }]);
    return () => this.user([{ type: 'tool_result', tool_use_id: id, content: result }], toolUseResult ? { toolUseResult } : {});
  }
}

class FakeAgent {
  constructor(sim, { sessionId, cwd, parent, job, depth = 1 }) {
    this.sim = sim;
    this.sessionId = sessionId;
    this.parent = parent;
    this.children = [];
    this.isMain = !parent;
    this.stepsLeft = Math.floor(this.isMain ? rand(30, 45) : rand(7, 16));
    this.spawnBudget = this.isMain ? Math.floor(rand(3, 6)) : depth < 2 && Math.random() < 0.25 ? 1 : 0;
    this.depth = depth;
    this.finished = false;
    const base = { isSidechain: !!parent, userType: 'external', cwd, sessionId, version: 'demo', gitBranch: 'feature/agent-town' };
    const projDir = path.join(sim.projectsDir, cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    if (parent) {
      this.agentId = 'a' + randomBytes(8).toString('hex');
      const dir = path.join(projDir, sessionId, 'subagents');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `agent-${this.agentId}.meta.json`), JSON.stringify({
        agentType: job[0], description: job[1], toolUseId: job.toolUseId, spawnDepth: depth,
      }));
      this.t = new Transcript(path.join(dir, `agent-${this.agentId}.jsonl`), { ...base, agentId: this.agentId });
      this.t.user(`${job[1]}. Report back with a short summary.`);
    } else {
      this.t = new Transcript(path.join(projDir, `${sessionId}.jsonl`), base);
      this.t.write({ type: 'custom-title', customTitle: job[1] });
      this.t.user(job[0]);
    }
    this.pending = null;
    this.schedule();
  }

  schedule() {
    if (this.finished || this.sim.stopped) return;
    this.timer = setTimeout(() => this.step(), rand(1800, 4500));
  }

  step() {
    if (this.pending) { this.pending(); this.pending = null; }
    const activeKids = this.children.filter((c) => !c.finished);
    if (this.stepsLeft-- <= 0 && activeKids.length === 0) return this.finish();

    const roll = Math.random();
    if (this.spawnBudget > 0 && roll < (this.isMain ? 0.35 : 0.2)) {
      this.spawnBudget--;
      const job = [...pick(SUB_JOBS)];
      const toolUseId = 'toolu_' + randomBytes(10).toString('hex');
      job.toolUseId = toolUseId;
      this.t.assistant([{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { description: job[1], subagent_type: job[0], prompt: job[1], run_in_background: true } }]);
      const child = new FakeAgent(this.sim, { sessionId: this.sessionId, cwd: this.t.base.cwd, parent: this, job, depth: this.depth + (this.isMain ? 0 : 1) });
      this.children.push(child);
      this.t.user([{ type: 'tool_result', tool_use_id: toolUseId, content: 'launched' }], {
        toolUseResult: { isAsync: true, status: 'async_launched', agentId: child.agentId, description: job[1] },
      });
    } else if (activeKids.length && roll < 0.55) {
      this.t.assistant([{ type: 'thinking', thinking: 'Waiting on sub-agents…' }]);
    } else if (roll < 0.68) {
      this.t.assistant([{ type: 'thinking', thinking: '…' }]);
    } else if (roll < 0.76) {
      this.t.assistant([{ type: 'text', text: pick(SAYS) }]);
    } else {
      const kind = pick(['read', 'read', 'read', 'edit', 'edit', 'run', 'test', 'git', 'search', 'plan']);
      const [name, input] = STEPS[kind]();
      this.pending = this.t.tool(name, input);
    }
    this.schedule();
  }

  finish() {
    this.finished = true;
    this.t.assistant([{ type: 'text', text: this.isMain ? 'All done! Summary of changes above.' : 'Done. Here is what I found.' }], 'end_turn');
    if (this.isMain) this.sim.onMainFinished(this);
  }
}

const TASKS = [
  ['Fix the login timeout bug and add tests', 'Login timeout fix'],
  ['Refactor the API client to use retries', 'API client retries'],
  ['Upgrade to Node 24 and fix breakages', 'Node 24 upgrade'],
];

export function startDemo(projectsDir) {
  fs.rmSync(projectsDir, { recursive: true, force: true });
  fs.mkdirSync(projectsDir, { recursive: true });
  const sim = {
    projectsDir,
    stopped: false,
    agents: [],
    onMainFinished(agent) {
      setTimeout(() => !sim.stopped && launch(agent.t.base.cwd), 6000);
    },
  };
  const launch = (cwd) => sim.agents.push(new FakeAgent(sim, { sessionId: randomUUID(), cwd, job: pick(TASKS) }));
  launch('/Users/you/repos/acme-api');
  setTimeout(() => launch('/Users/you/repos/acme-api'), 4000);
  setTimeout(() => launch('/Users/you/repos/web-portal'), 1500);
  return () => { sim.stopped = true; };
}
