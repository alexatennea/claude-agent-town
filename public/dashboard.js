// Dashboard: the same live feed as the town, laid out as sessions, sprint stories,
// workspaces and pull requests, cross-linked by work item id.
import { ACTS, RECENT_MS, esc, trunc, fmtK, displayName, stateOf as stateAt, relTime as relTimeAt, prListHtml } from './common.js';

const BUCKETS = [ // delivery stages, in board order; the server assigns each item one
  ['awaiting', 'Awaiting', 'Awaiting'], ['blocked', 'Blocked / on hold', 'Blocked'], ['progress', 'In progress', 'Doing'],
  ['test', 'In test', 'Test'], ['done', 'Done', 'Done'],
];
const isDone = (s) => s.bucket === 'done';
const vote = (v, w) => ({
  10: `✅ ${w.subject} approved`, 5: `✅ ${w.subject} approved with suggestions`, [-5]: `⏳ ${w.subject} asked for changes`,
  [-10]: `❌ ${w.subject} rejected`, 0: `<b>needs ${w.poss} vote</b>`,
})[v] ?? 'no vote yet';

// Whose context the board cards show: me, unless someone else is picked in Focus.
function who() {
  const ado = data?.prs;
  const isMe = !ado?.focus || ado.focus.id === ado.me;
  const first = isMe ? '' : ado.focus.name.split(/\s+/)[0];
  return { isMe, first, subject: isMe ? 'you' : first, poss: isMe ? 'your' : `${first}'s`, Poss: isMe ? 'My' : `${first}'s` };
}

const $ = (id) => document.getElementById(id);
let data = null;
let clockOffset = 0;
const openMembers = new Set(); // expanded team member rows
const now = () => Date.now() + clockOffset;
const stateOf = (a) => stateAt(a, now());
const relTime = (ts) => relTimeAt(ts, now());

$('team').addEventListener('click', (ev) => {
  const row = ev.target.closest('[data-member]');
  if (!row || ev.target.closest('a')) return;
  const k = row.dataset.member;
  openMembers.has(k) ? openMembers.delete(k) : openMembers.add(k);
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
  $('updated').textContent = ado?.fetchedAt ? `Updated ${relTime(ado.fetchedAt)}` : '';
  $('updated').title = ado?.fetchedAt ? `Azure DevOps last fetched ${new Date(ado.fetchedAt).toLocaleTimeString()}` : '';
  const attention = attentionItems(ss, ado, sprint);
  renderAttention(attention);
  alertOnNew(attention);
  renderStats(ss, ado, sprint);
  renderSprint(sprint, ss, ado);
  renderTeam(sprint);
  renderRunRate(sprint);
  $('prsCard').hidden = !ado;
  if (ado) {
    $('prs').innerHTML = prListHtml(ado, now(), (pr) => storyChips(linkedIds(pr.title, pr.source), sprint));
    const w = who();
    $('prsMineLabel').textContent = w.isMe ? 'Mine' : `${w.first}'s`;
    $('reviewsLabel').textContent = w.isMe ? 'To review' : `${w.first} to review`;
    $('prsMineCount').textContent = ado.prs.length || '';
    const reviews = ado.reviews ?? [];
    $('reviewsCount').textContent = reviews.filter((p) => p.myVote === 0).length || '';
    $('reviews').innerHTML = ado.error ? '' : reviews.length
      ? prListHtml({ ...ado, prs: reviews }, now(), (pr) => `<span class="links muted my-vote">by ${esc(pr.author)} · ${vote(pr.myVote, w)}</span>`)
      : `<li class="muted">Nobody is waiting on ${w.poss} review.</li>`;
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
  if (ado) tiles.push(tile(ado.prs.length, who().isMe ? 'open PRs' : `${who().Poss} open PRs`));
  if (sprint?.stories) {
    const pts = (f) => sprint.stories.filter(f).reduce((n, s) => n + (s.points || 0), 0);
    const done = sprint.stories.filter(isDone).length;
    tiles.push(tile(`${done}/${sprint.stories.length}`, `${who().isMe ? 'my' : who().Poss} stories done · ${pts(isDone)}/${pts(() => true)} pts`));
    const days = Math.ceil((sprint.end - now()) / 86_400_000);
    tiles.push(tile(Math.max(0, days), `day${days === 1 ? '' : 's'} left in sprint`));
  }
  $('stats').innerHTML = tiles.join('');
}

const STATUS = { waiting: ['☕', 'Waiting for you'], working: ['⚙️', 'Working'], idle: ['💤', 'Idle'] };

function storyChips(ids, sprint) {
  if (!ids.length) return '';
  const byId = new Map(sprint?.stories?.map((s) => [s.id, s]) ?? []);
  return `<span class="links">${ids.map((id) => `<a class="story-chip" href="${esc(byId.get(id)?.url)}" target="_blank" rel="noopener" title="${esc(byId.get(id)?.title)}">#${id}</a>`).join('')}</span>`;
}

function renderSprint(sprint, ss, ado) {
  $('sprintCard').hidden = !sprint;
  if (!sprint) return;
  $('sprintTitle').textContent = `${who().Poss} sprint${sprint.name ? ` · ${sprint.name}` : ''}`;
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

// ---------- run rate (cricket-style: current vs required scoring per working day) ----------
// Sprint dates are calendar days (midnight UTC); count Mon–Fri between them, both ends inclusive.
function workingDays(fromMs, toMs) {
  let n = 0;
  for (let d = new Date(fromMs); d.getTime() <= toMs; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}
const today = () => { const d = new Date(now()); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
const rate = (n) => (n >= 10 ? n.toFixed(0) : n.toFixed(1));

function renderRunRate(sprint) {
  const team = sprint?.team;
  $('runRateCard').hidden = !team?.length || !sprint.start;
  if ($('runRateCard').hidden) return;
  $('runRateTitle').textContent = `Run rate${sprint.name ? ` · ${sprint.name}` : ''}`;
  const total = working(sprint.start, sprint.end);
  const t = today();
  const played = Math.min(total, Math.max(1, working(sprint.start, Math.min(t, sprint.end)))); // today counts as in play
  const left = t < sprint.start ? total : working(t + 86_400_000, sprint.end);

  const score = (unit) => {
    const target = unit === 'pts' ? sumPts(team) : team.length;
    const done = unit === 'pts' ? sumPts(team.filter(isDone)) : team.filter(isDone).length;
    const crr = done / played;
    const need = target - done;
    const rrr = left ? need / left : need > 0 ? Infinity : 0;
    return { target, done, crr, need, rrr, projected: Math.round(done + crr * left) };
  };
  const pts = score('pts'), items = score('items');
  const verdict = pts.need <= 0 ? ['ok', 'Target reached']
    : !left ? ['bad', 'Out of days']
    : pts.rrr <= pts.crr ? ['ok', 'Ahead of the rate']
    : pts.rrr <= pts.crr * 1.5 ? ['warn', 'Gettable']
    : ['bad', 'Behind the rate'];
  const unpointed = team.filter((i) => i.points == null && !isDone(i)).length;

  $('runRate').innerHTML = `
    <div class="scoreboard">
      <div class="score"><b>${pts.done}<span>/${pts.target}</span></b><span class="muted">points · day ${played} of ${total}</span></div>
      <span class="pace ${verdict[0]}">${verdict[1]}</span>
    </div>
    <div class="rates">
      <div class="rate"><span class="muted">Current run rate</span><b>${rate(pts.crr)}</b><span class="muted">pts / day</span></div>
      <div class="rate ${pts.rrr > pts.crr ? 'behind' : ''}"><span class="muted">Required run rate</span><b>${Number.isFinite(pts.rrr) ? rate(pts.rrr) : '–'}</b><span class="muted">pts / day</span></div>
      <div class="rate"><span class="muted">Projected</span><b>${pts.projected}</b><span class="muted">pts by ${new Date(sprint.end).toLocaleDateString([], { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span></div>
    </div>
    ${worm(sprint, team, pts, played, total)}
    <p class="commentary">${pts.need > 0
      ? `Needs <b>${pts.need} pts</b> from ${left} working day${left === 1 ? '' : 's'}${left ? ` (${rate(pts.rrr)} a day)` : ''}, scoring ${rate(pts.crr)} a day so far.`
      : 'Target reached. Anything else is extras.'}
      By items: ${items.done}/${items.target} done${items.need > 0 && left ? `, need ${rate(items.rrr)} a day` : ''}.
      ${unpointed ? `<span class="muted">${unpointed} open item${unpointed > 1 ? 's have' : ' has'} no points, so the points target is understated.</span>` : ''}</p>`;
}
const working = workingDays;

// Cricket "worm": cumulative points by working day vs the par line, the rate still required, and a projection.
function worm(sprint, team, pts, played, total) {
  const W = 560, H = 200, L = 34, R = 10, T = 10, B = 24;
  const days = [];
  for (let d = new Date(sprint.start); d.getTime() <= sprint.end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(d.getTime());
  }
  const doneBy = (ms) => sumPts(team.filter((i) => isDone(i) && (i.doneAt ?? i.changedAt) < ms));
  // x = k is the end of working day k; x = 0 is the start of the sprint.
  const actual = [[0, doneBy(sprint.start)]];
  for (let k = 1; k <= played; k++) actual.push([k, k === played ? pts.done : doneBy(days[k - 1] + 86_400_000)]);
  const yMax = Math.max(pts.target, pts.projected, 1) * 1.08;
  const x = (k) => L + (k / total) * (W - L - R);
  const y = (v) => T + (1 - v / yMax) * (H - T - B);
  const line = (p) => p.map(([k, v], i) => `${i ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const step = yMax > 40 ? 20 : yMax > 16 ? 10 : 5;
  const grid = [];
  for (let v = 0; v <= yMax; v += step) grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${L - 6}" y="${y(v) + 3}" class="ax" text-anchor="end">${v}</text>`);
  const labels = days.map((d, i) => {
    const dt = new Date(d);
    const txt = i === 0 || dt.getUTCDate() === 1 ? dt.toLocaleDateString([], { day: 'numeric', month: 'short', timeZone: 'UTC' }) : dt.getUTCDate();
    return `<text x="${(x(i) + x(i + 1)) / 2}" y="${H - 8}" class="ax${i < played ? '' : ' future'}" text-anchor="middle">${txt}</text>`;
  }).join('');
  const [px, pv] = actual[actual.length - 1];
  const dots = actual.slice(1).map(([k, v]) => `<circle cx="${x(k)}" cy="${y(v)}" r="3" class="dot"><title>Day ${k} · ${new Date(days[k - 1]).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}: ${v} pts</title></circle>`).join('');
  return `<figure class="worm">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Points done per working day against target">
      ${grid.join('')}
      <rect x="${x(played - 1)}" y="${T}" width="${x(played) - x(played - 1)}" height="${H - T - B}" class="today"><title>Today</title></rect>
      <path d="${line([[0, 0], [total, pts.target]])}" class="par"/>
      ${pts.need > 0 && played < total ? `<path d="${line([[px, pv], [total, pts.target]])}" class="req"/>` : ''}
      ${played < total ? `<path d="${line([[px, pv], [total, pts.projected]])}" class="proj"/>` : ''}
      <path d="${line(actual)}" class="act"/>
      ${dots}
      ${labels}
    </svg>
    <figcaption><span class="key act"></span>Done <span class="key par"></span>Par <span class="key req"></span>Required from here <span class="key proj"></span>Projected at current rate</figcaption>
  </figure>`;
}

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
  const colIndex = (i) => (sprint.columns ?? []).indexOf(i.column);
  const rows = [...members.entries()].sort(([ka, a], [kb, b]) => (ka === '') - (kb === '') || b.items.length - a.items.length).map(([k, m]) => {
    const me = k === data.prs.focus?.id;
    const cells = BUCKETS.map(([b]) => { const n = m.items.filter((i) => i.bucket === b).length; return `<td class="cnt b-text-${b} ${n ? '' : 'zero'}">${n || '·'}</td>`; }).join('');
    const row = `<tr data-member="${esc(k)}" class="${me ? 'me' : ''}${openMembers.has(k) ? ' open' : ''}">
      <td class="who"><span class="avatar">${esc(initials(m.name))}</span>${esc(m.name)}</td>
      <td class="bar-cell">${stackBar(m.items)}</td>${cells}<td class="cnt sum">${sumPts(m.items)}</td></tr>`;
    if (!openMembers.has(k)) return row;
    // Furthest along first: board columns right to left (Closed at the top); sort is stable, so priority order holds within a column.
    const byColumn = [...m.items].sort((a, b) => colIndex(b) - colIndex(a));
    return row + `<tr class="detail"><td colspan="${BUCKETS.length + 3}"><ul class="member-items">${byColumn.map((i) => itemLine(i)).join('')}</ul></td></tr>`;
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

  const w = who();
  // Claude Code sessions and workspaces on this machine are only ever mine; skip them when focusing on someone else.
  for (const s of w.isMe ? ss.filter((x) => x.status === 'waiting') : []) {
    items.push({ key: `wait:${s.main.key}:${s.main.lastAt}`, kind: 'waiting', icon: '☕', weight: 0, alert: true,
      title: `${trunc(displayName(s.main), 60)} is waiting for you`,
      html: `<b>${esc(trunc(displayName(s.main), 80))}</b> has been waiting for you for ${ago(s.lastAt)} <span class="muted">· ${esc(s.main.projectName)}</span>` });
  }

  for (const pr of ado?.reviews ?? []) {
    if (pr.myVote !== 0) continue; // already voted
    items.push({ key: `review:${pr.id}`, kind: 'review', icon: '👀', weight: 1, alert: w.isMe,
      title: `Review requested: !${pr.id} ${trunc(pr.title, 60)}`,
      html: `${w.isMe ? 'Review' : `${esc(w.first)} owes a review on`} ${link(pr.url, `!${pr.id} ${trunc(pr.title, 70)}`)} from ${esc(pr.author)} <span class="muted">· ${esc(pr.repo)} · opened ${relTime(pr.createdAt)}${pr.iAmRequired ? ` · ${w.isMe ? 'you are' : ''} required` : ''}</span>` });
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
    if (live && w.isMe) evidence.push(`a session active ${relTime(live.lastAt)}`);
    const ws = Object.values(data.workspaces).find((w) => w.git && idsIn(w.branch).has(st.id) && w.lastCommit && now() - w.lastCommit.at < 2 * DAY);
    if (ws && w.isMe) evidence.push(`a commit in ${ws.repo} ${relTime(ws.lastCommit.at)}`);
    if (!evidence.length) continue;
    items.push({ key: `drift:${st.id}:${st.column}`, kind: 'drift', icon: '🧭', weight: 2,
      html: `${link(st.url, `#${st.id} ${trunc(st.title, 60)}`)} is <b>${esc(st.column)}</b> on the board, but has ${evidence.join(', ')}. Move it?` });
  }

  // Forgotten work: uncommitted or unpushed changes on a feature branch nobody has touched for a few days.
  for (const [cwd, w] of who().isMe ? Object.entries(data.workspaces) : []) {
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

// ---------- board + focus pickers ----------
let pickerKey = '';
function syncPickers() {
  const ado = data.prs;
  $('pickers').hidden = !ado?.teams?.length;
  if (!ado?.teams?.length) return;
  const loading = !ado.fetchedAt;
  const key = JSON.stringify([ado.teams.length, ado.project, ado.team, ado.people?.map((p) => p.id), ado.focus?.id]);
  if (key !== pickerKey) {
    pickerKey = key;
    const byProject = new Map();
    for (const t of ado.teams) byProject.set(t.project, [...(byProject.get(t.project) ?? []), t]);
    $('board').innerHTML = [...byProject].map(([proj, ts]) => `<optgroup label="${esc(proj)}">${ts.map((t) =>
      `<option value="${esc(JSON.stringify([t.project, t.name]))}"${t.project === ado.project && t.name === ado.team ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</optgroup>`).join('');
    const people = [...(ado.people ?? [])].sort((a, b) => (b.id === ado.me) - (a.id === ado.me) || a.name.localeCompare(b.name));
    $('focus').innerHTML = people.map((p) => `<option value="${esc(p.id)}"${p.id === ado.focus?.id ? ' selected' : ''}>${esc(p.name)}${p.id === ado.me ? ' (me)' : ''}</option>`).join('');
  }
  $('board').disabled = $('focus').disabled = loading;
  document.body.classList.toggle('switching', loading);
}
$('board').addEventListener('change', (ev) => {
  const [project, team] = JSON.parse(ev.target.value);
  post('/api/settings', { project, team });
});
$('focus').addEventListener('change', (ev) => post('/api/settings', { focusId: ev.target.value }));

// ---------- refresh controls ----------
const fmtEvery = (sec) => (sec < 60 ? `${sec}s` : `${sec / 60} min`);
function syncRefresh() {
  const r = data.refresh;
  const sel = $('refreshEvery');
  if (!r) return;
  if (sel.options.length !== r.choices.length) sel.innerHTML = r.choices.map((c) => `<option value="${c}">${fmtEvery(c)}</option>`).join('');
  if (document.activeElement !== sel) sel.value = String(r.seconds);
}
const post = (path, body = {}) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
$('refreshEvery').addEventListener('change', (ev) => post('/api/settings', { refreshSeconds: Number(ev.target.value) }));
$('refreshNow').addEventListener('click', async () => {
  const b = $('refreshNow');
  b.disabled = true;
  b.textContent = '↻ Refreshing…';
  try {
    data = await (await post('/api/refresh')).json();
    clockOffset = data.now - Date.now();
    render();
  } finally {
    b.disabled = false;
    b.textContent = '↻ Refresh';
  }
});

function connect() {
  const es = new EventSource('/events');
  es.onopen = () => { $('conn').className = 'dot on'; $('conn').title = 'live'; };
  es.onerror = () => { $('conn').className = 'dot off'; $('conn').title = 'disconnected, retrying'; };
  es.onmessage = (ev) => {
    data = JSON.parse(ev.data);
    clockOffset = data.now - Date.now();
    $('mode').hidden = !data.demo;
    syncRefresh();
    syncPickers();
    render();
  };
}

connect();
setInterval(render, 5000);
