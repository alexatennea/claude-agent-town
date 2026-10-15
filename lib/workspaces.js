// Git state for each working directory Claude Code is running in: branch, worktree, dirty files, ahead/behind.
import { execFile } from 'node:child_process';
import fs from 'node:fs';

const git = (cwd, args) => new Promise((resolve) => execFile('git', ['-C', cwd, ...args], { timeout: 10_000 }, (err, out) => resolve(err ? null : out.trim())));

export class Workspaces {
  constructor({ cwds, intervalMs = 30_000 }) {
    this.cwds = cwds; // () => string[] of directories to inspect
    this.intervalMs = intervalMs;
    this.state = {};
  }

  start() {
    this.refresh();
    setTimeout(() => this.refresh(), 3000); // the watcher may still be reading transcripts on first pass
    setInterval(() => this.refresh(), this.intervalMs);
  }

  snapshot() { return this.state; }

  async refresh() {
    const next = {};
    await Promise.all([...new Set(this.cwds())].filter(Boolean).map(async (cwd) => { next[cwd] = await inspect(cwd); }));
    this.state = next;
  }
}

async function inspect(cwd) {
  if (!fs.existsSync(cwd)) return { exists: false };
  const top = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (!top) return { exists: true, git: false };
  const [branch, gitDir, commonDir, status, upstream, last] = await Promise.all([
    git(cwd, ['branch', '--show-current']),
    git(cwd, ['rev-parse', '--absolute-git-dir']),
    git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    git(cwd, ['status', '--porcelain']),
    git(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']),
    git(cwd, ['log', '-1', '--format=%ct%x00%s']),
  ]);
  const [behind, ahead] = upstream ? upstream.split(/\s+/).map(Number) : [null, null];
  const [commitAt, commitMsg] = last ? last.split('\0') : [];
  const lines = status ? status.split('\n') : [];
  return {
    exists: true,
    git: true,
    root: top,
    repo: commonDir ? commonDir.replace(/\/\.git$/, '').split('/').pop() : top.split('/').pop(),
    branch: branch || '(detached)',
    worktree: !!(gitDir && commonDir && gitDir !== commonDir),
    changed: lines.filter((l) => !l.startsWith('??')).length,
    untracked: lines.filter((l) => l.startsWith('??')).length,
    ahead, behind, // null when the branch has no upstream
    lastCommit: commitAt ? { at: Number(commitAt) * 1000, message: commitMsg } : null,
  };
}
