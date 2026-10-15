// Shared by the town and the dashboard.

export const ACTS = {
  reading: { zone: 'library', emoji: '📖', label: 'Reading', fx: ['📄', '📖', '🔍'] },
  editing: { zone: 'workshop', emoji: '🔨', label: 'Editing', fx: ['✨', '🔧', '📝'] },
  running: { zone: 'terminal', emoji: '⚙️', label: 'Running', fx: ['⚙️', '▶️', '💾'] },
  tooling: { zone: 'terminal', emoji: '🔌', label: 'Using a tool', fx: ['🔌', '⚡'] },
  testing: { zone: 'lab', emoji: '🧪', label: 'Testing', fx: ['✅', '🧪', '✅', '❌'] },
  git: { zone: 'post', emoji: '📮', label: 'Git', fx: ['✉️', '📦'] },
  searching: { zone: 'observatory', emoji: '🔭', label: 'On the web', fx: ['🌐', '⭐', '🔎'] },
  thinking: { zone: 'garden', emoji: '💭', label: 'Thinking', fx: ['💡', '💭', '🤔'] },
  talking: { zone: 'hall', emoji: '💬', label: 'Talking', fx: ['💬'] },
  listening: { zone: 'hall', emoji: '👂', label: 'Getting instructions', fx: ['📋'] },
  spawning: { zone: 'portal', emoji: '✨', label: 'Spawning a sub-agent', fx: ['✨', '🌟'] },
  waiting: { zone: 'lounge', emoji: '☕', label: 'Waiting for you', fx: ['☕'] },
  done: { zone: 'lounge', emoji: '💤', label: 'Finished', fx: ['z'] },
  idle: { zone: 'lounge', emoji: '💤', label: 'Idle', fx: ['z'] },
};

// Sessions quieter than this leave the town (unless "show old") and stop counting as waiting for you.
export const RECENT_MS = 30 * 60_000;

export const STALE_MS = 3 * 60_000; // no writes for this long and not finished → idle

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const trunc = (s, n) => (s = String(s || ''), s.length > n ? s.slice(0, n - 1) + '…' : s);
export const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n || 0));

export function displayName(a) {
  if (a.isMain) return a.title || a.task || a.projectName || 'Claude';
  return a.title || a.agentType || 'sub-agent';
}

export function stateOf(a, now) {
  if (a.done) return 'done';
  if (a.waitingForUser) return 'waiting';
  if (now - a.lastAt > STALE_MS) return 'idle';
  return ACTS[a.activity] ? a.activity : 'thinking';
}

export function relTime(ts, now) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// PR list items for an Azure DevOps snapshot; extra(pr) adds markup under each row.
export function prListHtml(state, now, extra = () => '') {
  const rows = state.prs.map((pr) => {
    const review = pr.rejected ? ['❌', 'rejected']
      : pr.waiting ? ['⏳', 'waiting for author']
      : pr.approvals ? ['✅', `${pr.approvals} approval${pr.approvals > 1 ? 's' : ''}`]
      : ['👀', pr.reviewers ? 'awaiting review' : 'no reviewers'];
    return `<li><a href="${esc(pr.url)}" target="_blank" rel="noopener">
      <span class="title" title="${esc(pr.title)}">${pr.draft ? '<span class="draft">DRAFT</span> ' : ''}${esc(pr.title)}</span>
      <span class="meta">${esc(pr.repo)} · !${pr.id} → ${esc(pr.target)}</span>
      <span class="meta"><span title="${esc(review[1])}">${review[0]} ${esc(review[1])}</span>${pr.mergeStatus === 'conflicts' ? ' · ⚠️ conflicts' : ''} · ${relTime(pr.createdAt, now)}</span>
    </a>${extra(pr)}</li>`;
  });
  if (state.error) rows.unshift(`<li class="err">⚠️ ${esc(state.error)}</li>`);
  else if (!state.fetchedAt) rows.push('<li class="muted">Loading…</li>');
  else if (!state.prs.length) rows.push('<li class="muted">No open PRs. Nice.</li>');
  return rows.join('');
}
