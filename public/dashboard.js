// Dashboard: the same live feed as the town, laid out as sessions, sprint stories,
// workspaces and pull requests, cross-linked by work item id.
import { ACTS, esc, trunc, fmtK, displayName, stateOf as stateAt, relTime as relTimeAt, prListHtml } from './common.js';

const RECENT_MS = 30 * 60_000; // idle sessions quieter than this are hidden unless "Show idle"
const WAIT_MS = 4 * 3600_000; // a session waiting on you longer than this was most likely left, not paused
const DONE_STATES = new Set(['Closed', 'Done', 'Resolved', 'Ready for Release']);

const $ = (id) => document.getElementById(id);
let data = null;
let clockOffset = 0;
const open = new Set(); // expanded session keys
const now = () => Date.now() + clockOffset;
const stateOf = (a) => stateAt(a, now());
const relTime = (ts) => relTimeAt(ts, now());

$('showIdle').checked = (() => { try { return localStorage.getItem('dash-show-idle') === '1'; } catch { return false; } })();
$('showIdle').addEventListener('change', () => {
  try { localStorage.setItem('dash-show-idle', $('showIdle').checked ? '1' : '0'); } catch { /* storage unavailable */ }
  render();
});
$('sessions').addEventListener('click', (ev) => {
  const row = ev.target.closest('[data-key]');
  if (!row) return;
  const k = row.dataset.key;
  open.has(k) ? open.delete(k) : open.add(k);
  render();
});

// Work item ids show up in branch names (story/76812-foo) and PR titles (Story/76812 ...).
const idsIn = (...texts) => new Set(texts.join(' ').match(/\d{5,6}/g)?.map(Number) ?? []);

function sessions() {
  const groups = new Map();
  for (const a of data.agents) {
    const g = groups.get(a.sessionId) ?? { kids: [] };
    if (a.isMain) g.main = a; else g.kids.push(a);
    groups.set(a.sessionId, g);
  }
  return [...groups.values()].filter((g) => g.main).map((g) => {
    const st = stateOf(g.main);
    const activeKids = g.kids.filter((k) => !['idle', 'done'].includes(stateOf(k)));
    const lastAt = Math.max(g.main.lastAt, ...g.kids.map((k) => k.lastAt));
    const status = st === 'waiting' ? (now() - lastAt < WAIT_MS ? 'waiting' : 'idle')
      : !['idle', 'done'].includes(st) || activeKids.length ? 'working'
      : 'idle';
    // When the main agent is idle but sub-agents are busy, show what they're doing.
    const busy = !['idle', 'done', 'waiting'].includes(st) ? g.main : activeKids.sort((a, b) => b.lastAt - a.lastAt)[0];
    return { ...g, st, status, activeKids, lastAt, busy };
  }).sort((a, b) => rank(a) - rank(b) || b.lastAt - a.lastAt);
}
const rank = (s) => ({ waiting: 0, working: 1, idle: 2 })[s.status];

function render() {
  if (!data) return;
  const ss = sessions();
  const ado = data.prs;
  const sprint = ado?.sprint;
  const storyIds = new Set(sprint?.stories?.map((s) => s.id) ?? []);
  const linkedIds = (...t) => [...idsIn(...t)].filter((id) => storyIds.has(id));
  renderStats(ss, ado, sprint);
  renderSessions(ss, linkedIds);
  renderSprint(sprint, ss, ado);
  renderWorkspaces(ss, linkedIds);
  $('prsCard').hidden = !ado;
  if (ado) $('prs').innerHTML = prListHtml(ado, now(), (pr) => storyChips(linkedIds(pr.title, pr.source), sprint));
}

function renderStats(ss, ado, sprint) {
  const tile = (n, label, cls = '') => `<div class="kpi ${cls}"><b>${n}</b><span>${label}</span></div>`;
  const waiting = ss.filter((s) => s.status === 'waiting').length;
  const tiles = [
    tile(ss.filter((s) => s.status === 'working').length, 'sessions working'),
    tile(waiting, 'waiting for you', waiting ? 'alert' : ''),
    tile(ss.reduce((n, s) => n + s.activeKids.length, 0), 'sub-agents active'),
  ];
  if (ado) tiles.push(tile(ado.prs.length, 'open PRs'));
  if (sprint?.stories) {
    const pts = (f) => sprint.stories.filter(f).reduce((n, s) => n + (s.points || 0), 0);
    const done = sprint.stories.filter((s) => DONE_STATES.has(s.state)).length;
    tiles.push(tile(`${done}/${sprint.stories.length}`, `stories done · ${pts((s) => DONE_STATES.has(s.state))}/${pts(() => true)} pts`));
    const days = Math.ceil((sprint.end - now()) / 86_400_000);
    tiles.push(tile(Math.max(0, days), `day${days === 1 ? '' : 's'} left in sprint`));
  }
  $('stats').innerHTML = tiles.join('');
}

const STATUS = { waiting: ['☕', 'Waiting for you'], working: ['⚙️', 'Working'], idle: ['💤', 'Idle'] };

function renderSessions(ss, linkedIds) {
  const show = $('showIdle').checked ? ss : ss.filter((s) => s.status !== 'idle' || now() - s.lastAt < RECENT_MS);
  const hidden = ss.length - show.length;
  if (!show.length) {
    $('sessions').innerHTML = `<p class="empty">No active sessions${hidden ? ` (${hidden} idle hidden)` : ''}.</p>`;
    return;
  }
  const rows = show.map((s) => {
    const m = s.main;
    const what = s.status === 'waiting' ? 'Waiting for you'
      : s.busy ? `${ACTS[stateOf(s.busy)].emoji} ${ACTS[stateOf(s.busy)].label}${s.busy.detail ? `: ${s.busy.detail}` : ''}${s.busy !== m ? ` (${displayName(s.busy)})` : ''}`
      : m.done ? 'Finished' : 'Idle';
    const ids = linkedIds(m.branch);
    const row = `<tr data-key="${esc(m.key)}" class="s-${s.status}${open.has(m.key) ? ' open' : ''}">
      <td><span class="chip ${s.status}">${STATUS[s.status][0]} ${STATUS[s.status][1]}</span></td>
      <td class="title"><span title="${esc(displayName(m))}">${esc(trunc(displayName(m), 70))}</span></td>
      <td><span class="ws">${esc(m.projectName)}</span>${m.branch ? `<span class="branch">${esc(m.branch)}</span>` : ''}${storyChips(ids, data.prs?.sprint)}</td>
      <td class="what" title="${esc(what)}">${esc(trunc(what, 90))}</td>
      <td class="num">${s.kids.length ? `${s.activeKids.length}/${s.kids.length}` : '–'}</td>
      <td class="num">${fmtK(m.contextTokens)}</td>
      <td class="num">${relTime(s.lastAt)}</td>
    </tr>`;
    if (!open.has(m.key)) return row;
    const events = [...m.events].slice(-8).reverse();
    return row + `<tr class="detail"><td colspan="7">
      ${m.task ? `<div class="task">${esc(m.task)}</div>` : ''}
      <div class="kv"><span>Workspace</span><span>${esc(m.project)}</span><span>Model</span><span>${esc(m.model || '?')}</span>
        <span>Started</span><span>${relTime(m.startedAt)}</span><span>Tool calls</span><span>${m.toolCalls}</span></div>
      ${s.kids.length ? `<div class="kids">${s.kids.sort((a, b) => b.lastAt - a.lastAt).map((k) => `<span class="chip ${['idle', 'done'].includes(stateOf(k)) ? 'idle' : 'working'}">${ACTS[stateOf(k)].emoji} ${esc(trunc(displayName(k), 40))}</span>`).join('')}</div>` : ''}
      ${events.length ? `<ul class="log">${events.map((e) => `<li><time>${new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span>${esc(e.text)}</span></li>`).join('')}</ul>` : ''}
    </td></tr>`;
  });
  $('sessions').innerHTML = `<div class="table-wrap"><table class="sessions">
    <thead><tr><th>Status</th><th>Session</th><th>Workspace</th><th>Doing</th><th class="num">Sub-agents</th><th class="num">Context</th><th class="num">Last active</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table></div>
    ${hidden ? `<p class="muted foot">${hidden} idle session${hidden > 1 ? 's' : ''} hidden</p>` : ''}`;
}

function storyChips(ids, sprint) {
  if (!ids.length) return '';
  const byId = new Map(sprint?.stories?.map((s) => [s.id, s]) ?? []);
  return `<span class="links">${ids.map((id) => `<a class="story-chip" href="${esc(byId.get(id)?.url)}" target="_blank" rel="noopener" title="${esc(byId.get(id)?.title)}">#${id}</a>`).join('')}</span>`;
}

function renderSprint(sprint, ss, ado) {
  $('sprintCard').hidden = !sprint;
  if (!sprint) return;
  $('sprintTitle').textContent = sprint.name ? `Sprint ${sprint.name}` : 'Sprint';
  if (sprint.boardUrl) $('boardLink').href = sprint.boardUrl;
  const fmt = (t) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });
  let html = sprint.error ? `<p class="err">⚠️ ${esc(sprint.error)}</p>` : '';
  if (!sprint.stories) { $('sprint').innerHTML = html || '<p class="empty">Loading…</p>'; return; }
  if (sprint.start) {
    const pct = Math.min(100, Math.max(0, ((now() - sprint.start) / (sprint.end - sprint.start)) * 100));
    html += `<div class="sprint-dates"><span>${fmt(sprint.start)}</span><div class="bar"><i style="width:${pct}%"></i></div><span>${fmt(sprint.end)}</span></div>`;
  }
  if (!sprint.stories.length) { $('sprint').innerHTML = html + '<p class="empty">Nothing assigned to you this sprint.</p>'; return; }

  // What's linked to each story: PRs by title/branch, workspaces and sessions by branch.
  const prsFor = (id) => (ado?.prs ?? []).filter((p) => idsIn(p.title, p.source).has(id));
  const wsFor = (id) => Object.entries(data.workspaces).filter(([, w]) => w.git && idsIn(w.branch).has(id));
  const sessFor = (id) => ss.filter((s) => s.status !== 'idle' && idsIn(s.main.branch).has(id));

  const cols = [...new Set([...(sprint.columns ?? []), ...sprint.stories.map((s) => s.column)])]
    .filter((c) => sprint.stories.some((s) => s.column === c));
  html += cols.map((col) => {
    const items = sprint.stories.filter((s) => s.column === col);
    return `<div class="col"><h3>${esc(col)} <span class="count">${items.length}</span></h3><ul class="stories">${items.map((s) => {
      const prs = prsFor(s.id), ws = wsFor(s.id), live = sessFor(s.id);
      return `<li class="${DONE_STATES.has(s.state) ? 'done' : ''}">
        <a class="story" href="${esc(s.url)}" target="_blank" rel="noopener">
          <span class="sid">${s.type === 'User Story' ? '' : `${esc(s.type)} `}#${s.id}</span>
          <span class="stitle">${esc(s.title)}</span>
          ${s.points != null ? `<span class="pts" title="story points">${s.points}</span>` : ''}
        </a>
        ${s.state !== s.column ? `<span class="chip idle">${esc(s.state)}</span>` : ''}
        ${live.map((x) => `<span class="chip ${x.status}">${STATUS[x.status][0]} ${esc(trunc(displayName(x.main), 30))}</span>`).join('')}
        ${prs.map((p) => `<a class="chip pr" href="${esc(p.url)}" target="_blank" rel="noopener" title="${esc(p.title)}">PR !${p.id} · ${esc(p.repo)}</a>`).join('')}
        ${ws.map(([cwd, w]) => `<span class="chip ws" title="${esc(cwd)}">📁 ${esc(w.repo)}</span>`).join('')}
      </li>`;
    }).join('')}</ul></div>`;
  }).join('');
  $('sprint').innerHTML = html;
}

function renderWorkspaces(ss, linkedIds) {
  const entries = Object.entries(data.workspaces).map(([cwd, w]) => {
    const mine = ss.filter((s) => s.main.project === cwd);
    return { cwd, w, mine, lastAt: Math.max(0, ...mine.map((s) => s.lastAt)) };
  }).sort((a, b) => b.lastAt - a.lastAt);
  if (!entries.length) { $('workspaces').innerHTML = '<p class="empty">No workspaces yet.</p>'; return; }
  $('workspaces').innerHTML = `<ul class="workspaces">${entries.map(({ cwd, w, mine, lastAt }) => {
    const name = w.git ? w.repo : cwd.includes('/scratch-workspaces/') ? 'Scratch workspace' : cwd.split('/').pop();
    const working = mine.filter((s) => s.status === 'working').length;
    const waiting = mine.filter((s) => s.status === 'waiting').length;
    const git = !w.exists ? '<span class="chip idle">folder gone</span>'
      : !w.git ? '<span class="muted">not a git repo</span>'
      : [
        `<span class="branch">${esc(w.branch)}</span>`,
        w.worktree ? '<span class="chip idle">worktree</span>' : '',
        w.changed || w.untracked ? `<span class="chip dirty" title="${w.changed} changed, ${w.untracked} untracked">✎ ${w.changed + w.untracked}</span>` : '<span class="chip clean">clean</span>',
        w.ahead ? `<span class="chip" title="commits not pushed">↑${w.ahead}</span>` : '',
        w.behind ? `<span class="chip" title="commits to pull">↓${w.behind}</span>` : '',
        w.ahead == null ? '<span class="chip idle" title="branch has no upstream">no upstream</span>' : '',
        storyChips(linkedIds(w.branch), data.prs?.sprint),
      ].join('');
    return `<li>
      <div class="ws-head"><b title="${esc(cwd)}">${esc(name)}</b>
        <span class="ws-agents">${waiting ? `<span class="chip waiting">☕ ${waiting}</span>` : ''}${working ? `<span class="chip working">⚙️ ${working}</span>` : ''}
        <span class="muted">${mine.length} session${mine.length === 1 ? '' : 's'}${lastAt ? ` · ${relTime(lastAt)}` : ''}</span></span></div>
      <div class="ws-git">${git}</div>
      ${w.lastCommit ? `<div class="muted ws-commit" title="${esc(w.lastCommit.message)}">${esc(trunc(w.lastCommit.message, 70))} · ${relTime(w.lastCommit.at)}</div>` : ''}
    </li>`;
  }).join('')}</ul>`;
}

function connect() {
  const es = new EventSource('/events');
  es.onopen = () => { $('conn').className = 'dot on'; $('conn').title = 'live'; };
  es.onerror = () => { $('conn').className = 'dot off'; $('conn').title = 'disconnected, retrying'; };
  es.onmessage = (ev) => {
    data = JSON.parse(ev.data);
    clockOffset = data.now - Date.now();
    $('mode').hidden = !data.demo;
    render();
  };
}

connect();
setInterval(render, 5000);
