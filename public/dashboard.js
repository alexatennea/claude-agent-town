// Dashboard: the same live feed as the town, laid out as sessions, sprint stories,
// workspaces and pull requests, cross-linked by work item id.
import { ACTS, RECENT_MS, esc, trunc, fmtK, displayName, stateOf as stateAt, relTime as relTimeAt, prListHtml } from './common.js';

const BUCKETS = [ // delivery stages, in board order; the server assigns each item one
  ['awaiting', 'Awaiting', 'Awaiting'], ['blocked', 'Blocked / on hold', 'Blocked'], ['progress', 'In progress', 'Doing'],
  ['test', 'In test', 'Test'], ['done', 'Done', 'Done'],
];
const isDone = (s) => s.bucket === 'done';
const VOTES = { 10: '✅ you approved', 5: '✅ you approved with suggestions', [-5]: '⏳ you asked for changes', [-10]: '❌ you rejected', 0: '<b>needs your vote</b>' };

const $ = (id) => document.getElementById(id);
let data = null;
let clockOffset = 0;
const open = new Set(); // expanded session keys
const openMembers = new Set(); // expanded team member rows
const now = () => Date.now() + clockOffset;
const stateOf = (a) => stateAt(a, now());
const relTime = (ts) => relTimeAt(ts, now());

$('showIdle').checked = (() => { try { return localStorage.getItem('dash-show-idle') === '1'; } catch { return false; } })();
$('showIdle').addEventListener('change', () => {
  try { localStorage.setItem('dash-show-idle', $('showIdle').checked ? '1' : '0'); } catch { /* storage unavailable */ }
  render();
});
$('team').addEventListener('click', (ev) => {
  const row = ev.target.closest('[data-member]');
  if (!row || ev.target.closest('a')) return;
  const k = row.dataset.member;
  openMembers.has(k) ? openMembers.delete(k) : openMembers.add(k);
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
    // Same rule as the town: once a session has been quiet long enough to leave town, it's parked, not waiting.
    const status = st === 'waiting' ? (now() - lastAt < RECENT_MS ? 'waiting' : 'idle')
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
  const attention = attentionItems(ss, ado, sprint);
  renderAttention(attention);
  alertOnNew(attention);
  renderStats(ss, ado, sprint);
  renderSessions(ss, linkedIds);
  renderSprint(sprint, ss, ado);
  renderTeam(sprint);
  renderWorkspaces(ss, linkedIds);
  $('prsCard').hidden = !ado;
  if (ado) {
    $('prs').innerHTML = prListHtml(ado, now(), (pr) => storyChips(linkedIds(pr.title, pr.source), sprint));
    $('prsMineCount').textContent = ado.prs.length || '';
    const reviews = ado.reviews ?? [];
    $('reviewsCount').textContent = reviews.filter((p) => p.myVote === 0).length || '';
    $('reviews').innerHTML = ado.error ? '' : reviews.length
      ? prListHtml({ ...ado, prs: reviews }, now(), (pr) => `<span class="links muted my-vote">by ${esc(pr.author)} · ${VOTES[pr.myVote] ?? 'no vote yet'}</span>`)
      : '<li class="muted">Nobody is waiting on your review.</li>';
  }
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
    const done = sprint.stories.filter(isDone).length;
    tiles.push(tile(`${done}/${sprint.stories.length}`, `my stories done · ${pts(isDone)}/${pts(() => true)} pts`));
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
    const what = s.status === 'waiting' ? `Waiting for you · ${ago(s.lastAt)}`
      : s.busy ? `${ACTS[stateOf(s.busy)].emoji} ${ACTS[stateOf(s.busy)].label}${s.busy.detail ? `: ${s.busy.detail}` : ''}${s.busy !== m ? ` (${displayName(s.busy)})` : ''}`
      : m.done ? 'Finished' : 'Idle';
    const ids = linkedIds(m.branch);
    const row = `<tr data-key="${esc(m.key)}" class="s-${s.status}${open.has(m.key) ? ' open' : ''}">
      <td><span class="chip ${s.status}">${STATUS[s.status][0]} ${STATUS[s.status][1]}</span></td>
      <td class="title"><div class="t" title="${esc(displayName(m))}">${esc(displayName(m))}</div>
        <div class="sub"><span class="ws">${esc(m.projectName)}</span>${m.branch ? `<span class="branch" title="${esc(m.branch)}">${esc(m.branch)}</span>` : ''}${storyChips(ids, data.prs?.sprint)}</div></td>
      <td class="what" title="${esc(what)}">${esc(what)}</td>
      <td class="num">${s.kids.length ? `${s.activeKids.length}/${s.kids.length}` : '–'}</td>
      <td class="num">${relTime(s.lastAt)}</td>
    </tr>`;
    if (!open.has(m.key)) return row;
    const events = [...m.events].slice(-8).reverse();
    return row + `<tr class="detail"><td colspan="5">
      ${m.task ? `<div class="task">${esc(m.task)}</div>` : ''}
      <div class="kv"><span>Workspace</span><span>${esc(m.project)}</span><span>Model</span><span>${esc(m.model || '?')}</span>
        <span>Started</span><span>${relTime(m.startedAt)}</span><span>Tool calls</span><span>${m.toolCalls}</span>
        <span>Branch</span><span>${esc(m.branch || '–')}</span><span>Context</span><span>${fmtK(m.contextTokens)} tokens</span></div>
      ${s.kids.length ? `<div class="kids">${s.kids.sort((a, b) => b.lastAt - a.lastAt).map((k) => `<span class="chip ${['idle', 'done'].includes(stateOf(k)) ? 'idle' : 'working'}">${ACTS[stateOf(k)].emoji} ${esc(trunc(displayName(k), 40))}</span>`).join('')}</div>` : ''}
      ${events.length ? `<ul class="log">${events.map((e) => `<li><time>${new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span>${esc(e.text)}</span></li>`).join('')}</ul>` : ''}
    </td></tr>`;
  });
  $('sessions').innerHTML = `<div class="table-wrap"><table class="sessions">
    <thead><tr><th>Status</th><th>Session</th><th>Doing</th><th class="num" title="active / total sub-agents">Subs</th><th class="num">Active</th></tr></thead>
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
  $('sprintTitle').textContent = `My sprint${sprint.name ? ` · ${sprint.name}` : ''}`;
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

  // Every board column in board order, like the board itself; empty ones collapse to a thin strip.
  const cols = [...new Set([...(sprint.columns ?? []), ...sprint.stories.map((s) => s.column)])];
  html += '<div class="kanban">' + cols.map((col) => {
    const items = sprint.stories.filter((s) => s.column === col);
    if (!items.length) return `<div class="col empty" title="${esc(col)}: nothing of yours"><h3>${esc(col)}</h3></div>`;
    return `<div class="col"><h3>${esc(col)} <span class="count">${items.length}</span></h3><ul class="stories">${items.map((s) => {
      const prs = prsFor(s.id), ws = wsFor(s.id), live = sessFor(s.id);
      return `<li class="${isDone(s) ? 'done' : ''}">
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
  }).join('') + '</div>';
  $('sprint').innerHTML = html;
}

const sumPts = (items) => items.reduce((n, i) => n + (i.points || 0), 0);
const stackBar = (items) => `<div class="stack-bar">${BUCKETS.map(([b, label]) => {
  const n = items.filter((i) => i.bucket === b).length;
  return n ? `<i class="b-${b}" style="flex:${n}" title="${label}: ${n}"></i>` : '';
}).join('')}</div>`;

function renderTeam(sprint) {
  const team = sprint?.team;
  $('teamCard').hidden = !team;
  if (!team) return;
  $('teamTitle').textContent = `Team delivery${sprint.name ? ` · ${sprint.name}` : ''}`;
  if (sprint.boardUrl) $('teamBoardLink').href = sprint.boardUrl;
  if (!team.length) { $('team').innerHTML = '<p class="empty">Nothing in this sprint yet.</p>'; return; }

  // Health: share of points done vs share of the sprint gone.
  const total = sumPts(team), done = sumPts(team.filter(isDone));
  const elapsed = sprint.start ? Math.min(1, Math.max(0, (now() - sprint.start) / (sprint.end - sprint.start))) : null;
  const donePct = total ? done / total : team.filter(isDone).length / team.length;
  const pace = elapsed == null ? null : donePct >= elapsed - 0.1 ? ['ok', 'On track'] : donePct >= elapsed - 0.3 ? ['warn', 'Behind'] : ['bad', 'At risk'];
  const counts = BUCKETS.map(([b, label]) => {
    const items = team.filter((i) => i.bucket === b);
    return `<div class="bucket"><span class="sw b-${b}"></span><b>${items.length}</b><span>${label}</span><span class="muted">${sumPts(items)} pts</span></div>`;
  }).join('');
  const blocked = team.filter((i) => i.bucket === 'blocked');

  const members = new Map();
  for (const i of team) {
    const k = i.assignee?.id ?? '';
    if (!members.has(k)) members.set(k, { name: i.assignee?.name ?? 'Unassigned', items: [] });
    members.get(k).items.push(i);
  }
  const myIds = new Set(sprint.stories.map((s) => s.id));
  const rows = [...members.entries()].sort(([ka, a], [kb, b]) => (ka === '') - (kb === '') || b.items.length - a.items.length).map(([k, m]) => {
    const me = m.items.some((i) => myIds.has(i.id));
    const cells = BUCKETS.map(([b]) => { const n = m.items.filter((i) => i.bucket === b).length; return `<td class="cnt b-text-${b} ${n ? '' : 'zero'}">${n || '·'}</td>`; }).join('');
    const row = `<tr data-member="${esc(k)}" class="${me ? 'me' : ''}${openMembers.has(k) ? ' open' : ''}">
      <td class="who"><span class="avatar">${esc(initials(m.name))}</span>${esc(m.name)}</td>
      <td class="bar-cell">${stackBar(m.items)}</td>${cells}<td class="cnt sum">${sumPts(m.items)}</td></tr>`;
    if (!openMembers.has(k)) return row;
    return row + `<tr class="detail"><td colspan="${BUCKETS.length + 3}"><ul class="member-items">${m.items.map((i) => itemLine(i)).join('')}</ul></td></tr>`;
  }).join('');

  $('team').innerHTML = `
    <div class="health">
      <div class="health-top">
        ${pace ? `<span class="pace ${pace[0]}">${pace[1]}</span>` : ''}
        <span>${done}/${total} pts done (${Math.round(donePct * 100)}%)${elapsed != null ? ` with ${Math.round(elapsed * 100)}% of the sprint gone` : ''} · ${team.length} items</span>
      </div>
      ${stackBar(team)}
      <div class="buckets">${counts}</div>
    </div>
    ${blocked.length ? `<div class="blocked"><h3>Blocked / on hold <span class="count">${blocked.length}</span></h3><ul class="member-items">${blocked.map((i) => itemLine(i, true)).join('')}</ul></div>` : ''}
    <div class="table-wrap"><table class="members">
      <thead><tr><th>Member</th><th></th>${BUCKETS.map(([b, l, short]) => `<th class="cnt" title="${l}"><span class="sw b-${b}"></span>${short}</th>`).join('')}<th class="cnt sum">Pts</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

const initials = (name) => name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
const itemLine = (i, withWho = false) => `<li><span class="sw b-${i.bucket}" title="${esc(i.column)}"></span>
  <a href="${esc(i.url)}" target="_blank" rel="noopener"><span class="sid">#${i.id}</span> ${esc(i.title)}</a>
  <span class="muted">${esc(i.column)}${withWho ? ` · ${esc(i.assignee?.name ?? 'Unassigned')}` : ''}${i.points != null ? ` · ${i.points} pts` : ''}</span></li>`;

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

// ---------- needs your attention ----------
const DAY = 86_400_000;
const STALE_BRANCH_MS = 3 * DAY;
const ago = (ts) => relTime(ts).replace(' ago', '');
const SNOOZE_KEY = 'dash-snoozed';
let snoozed = (() => { try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}'); } catch { return {}; } })();
function snooze(key) {
  snoozed[key] = Date.now() + DAY;
  for (const [k, until] of Object.entries(snoozed)) if (until < Date.now()) delete snoozed[k];
  try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(snoozed)); } catch { /* storage unavailable */ }
  render();
}
$('attention').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-snooze]');
  if (b) snooze(b.dataset.snooze);
});
$('showSnoozed').addEventListener('click', () => { snoozed = {}; try { localStorage.removeItem(SNOOZE_KEY); } catch { /* storage unavailable */ } render(); });

// Each item: key (stable, for snooze/alerts), kind, icon, html text, optional url, sort weight.
function attentionItems(ss, ado, sprint) {
  const items = [];
  const link = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>`;

  for (const s of ss.filter((x) => x.status === 'waiting')) {
    items.push({ key: `wait:${s.main.key}:${s.main.lastAt}`, kind: 'waiting', icon: '☕', weight: 0, alert: true,
      title: `${trunc(displayName(s.main), 60)} is waiting for you`,
      html: `<b>${esc(trunc(displayName(s.main), 80))}</b> has been waiting for you for ${ago(s.lastAt)} <span class="muted">· ${esc(s.main.projectName)}</span>` });
  }

  for (const pr of ado?.reviews ?? []) {
    if (pr.myVote !== 0) continue; // already voted
    items.push({ key: `review:${pr.id}`, kind: 'review', icon: '👀', weight: 1, alert: true,
      title: `Review requested: !${pr.id} ${trunc(pr.title, 60)}`,
      html: `Review ${link(pr.url, `!${pr.id} ${trunc(pr.title, 70)}`)} from ${esc(pr.author)} <span class="muted">· ${esc(pr.repo)} · opened ${relTime(pr.createdAt)}${pr.iAmRequired ? ' · you are required' : ''}</span>` });
  }

  for (const pr of ado?.prs ?? []) {
    const p = link(pr.url, `!${pr.id} ${trunc(pr.title, 60)}`);
    const age = now() - pr.createdAt;
    if (pr.rejected || pr.waiting) items.push({ key: `pr-changes:${pr.id}`, kind: 'pr', icon: '✍️', weight: 2, html: `${p} has changes requested` });
    if (pr.mergeStatus === 'conflicts') items.push({ key: `pr-conflict:${pr.id}`, kind: 'pr', icon: '⚠️', weight: 2, html: `${p} has merge conflicts` });
    if (pr.draft && age > DAY) items.push({ key: `pr-draft:${pr.id}`, kind: 'pr', icon: '📝', weight: 4, html: `${p} has been a draft for ${ago(pr.createdAt)}; publish it when it's ready for review` });
    else if (!pr.draft && !pr.reviewers) items.push({ key: `pr-noreview:${pr.id}`, kind: 'pr', icon: '🙋', weight: 3, html: `${p} has no reviewers` });
  }

  // Board drift: my stories whose column says "not started / on hold" while there's live work on them.
  for (const st of sprint?.stories ?? []) {
    if (!['awaiting', 'blocked'].includes(st.bucket)) continue;
    const evidence = [];
    for (const pr of ado?.prs ?? []) if (idsIn(pr.title, pr.source).has(st.id)) evidence.push(`PR !${pr.id}`);
    const live = ss.filter((x) => idsIn(x.main.branch).has(st.id) && now() - x.lastAt < DAY).sort((a, b) => b.lastAt - a.lastAt)[0];
    if (live) evidence.push(`a session active ${relTime(live.lastAt)}`);
    const ws = Object.values(data.workspaces).find((w) => w.git && idsIn(w.branch).has(st.id) && w.lastCommit && now() - w.lastCommit.at < 2 * DAY);
    if (ws) evidence.push(`a commit in ${ws.repo} ${relTime(ws.lastCommit.at)}`);
    if (!evidence.length) continue;
    items.push({ key: `drift:${st.id}:${st.column}`, kind: 'drift', icon: '🧭', weight: 2,
      html: `${link(st.url, `#${st.id} ${trunc(st.title, 60)}`)} is <b>${esc(st.column)}</b> on the board, but has ${evidence.join(', ')}. Move it?` });
  }

  // Forgotten work: uncommitted or unpushed changes on a feature branch nobody has touched for a few days.
  for (const [cwd, w] of Object.entries(data.workspaces)) {
    if (!w.git || /^(main|master|develop|trunk|\(detached\))$/.test(w.branch)) continue;
    const touched = Math.max(w.lastCommit?.at ?? 0, ...ss.filter((x) => x.main.project === cwd).map((x) => x.lastAt));
    if (now() - touched < STALE_BRANCH_MS) continue;
    const bits = [];
    if (w.changed + w.untracked) bits.push(`${w.changed + w.untracked} uncommitted change${w.changed + w.untracked > 1 ? 's' : ''}`);
    if (w.ahead) bits.push(`${w.ahead} unpushed commit${w.ahead > 1 ? 's' : ''}`);
    if (w.ahead == null) bits.push('no remote branch');
    if (!bits.length) continue;
    items.push({ key: `stale:${cwd}:${w.branch}:${touched}`, kind: 'stale', icon: '🧳', weight: 5,
      html: `<b>${esc(w.repo)}</b> <span class="branch">${esc(w.branch)}</span> has ${bits.join(' and ')}, untouched for ${ago(touched)}` });
  }
  return items.sort((a, b) => a.weight - b.weight);
}

function renderAttention(items) {
  const live = items.filter((i) => !(snoozed[i.key] > Date.now()));
  const hidden = items.length - live.length;
  document.title = live.length ? `(${live.length}) Agent Dashboard` : 'Agent Dashboard';
  $('attentionCount').textContent = live.length || '';
  $('showSnoozed').hidden = !hidden;
  $('showSnoozed').textContent = `Show ${hidden} snoozed`;
  $('attention').innerHTML = live.length
    ? `<ul class="attention">${live.map((i) => `<li class="k-${i.kind}"><span class="ico">${i.icon}</span><span class="txt">${i.html}</span>
        <button class="snooze" data-snooze="${esc(i.key)}" title="Hide for a day">Snooze</button></li>`).join('')}</ul>`
    : '<p class="empty">All clear. Nothing needs you right now.</p>';
}

// Desktop notifications for new waiting sessions and review requests (not on first load).
let seen = null;
const alertsWanted = () => { try { return localStorage.getItem('dash-alerts') === '1'; } catch { return false; } };
function syncAlertButton() {
  const on = alertsWanted() && 'Notification' in window && Notification.permission === 'granted';
  $('alerts').textContent = on ? '🔔 Alerts on' : '🔕 Alerts off';
  $('alerts').classList.toggle('on', on);
  if (!('Notification' in window)) { $('alerts').disabled = true; $('alerts').title = 'This browser has no notifications'; }
  else if (Notification.permission === 'denied') $('alerts').title = 'Notifications are blocked for this site in your browser settings';
}
$('alerts').addEventListener('click', async () => {
  const want = !alertsWanted();
  if (want && Notification.permission !== 'granted') await Notification.requestPermission();
  try { localStorage.setItem('dash-alerts', want && Notification.permission === 'granted' ? '1' : '0'); } catch { /* storage unavailable */ }
  syncAlertButton();
});
syncAlertButton();

function alertOnNew(items) {
  const alertable = items.filter((i) => i.alert && !(snoozed[i.key] > Date.now()));
  if (seen && alertsWanted() && Notification.permission === 'granted') {
    for (const i of alertable) {
      if (seen.has(i.key)) continue;
      const n = new Notification(i.title, { tag: i.key, body: i.kind === 'waiting' ? 'Claude Code session needs your input' : 'Azure DevOps' });
      n.onclick = () => { window.focus(); n.close(); };
    }
  }
  seen = new Set(alertable.map((i) => i.key));
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
