// Claude Agent Town: a little pixel town where each Claude Code agent walks to the building
// that matches what it's doing right now.

const W = 1600, H = 900;
const ZW = 260, ZH = 250, GAP = 50, MX = 50;
const ROW_Y = [60, 590];
const ROAD = { y: 340, h: 220 };
const LANE_Y = ROAD.y + ROAD.h / 2;

const ZONES = [
  { key: 'library', name: 'Library', emoji: '📚', floor: '#c9a978', wall: '#7a4e2d', col: 0, row: 0 },
  { key: 'workshop', name: 'Workshop', emoji: '🛠️', floor: '#b9a48a', wall: '#6b5444', col: 1, row: 0 },
  { key: 'terminal', name: 'Terminal Lab', emoji: '💻', floor: '#8f9bb3', wall: '#3d4660', col: 2, row: 0 },
  { key: 'lab', name: 'Test Lab', emoji: '🧪', floor: '#cfe3df', wall: '#3f7a74', col: 3, row: 0 },
  { key: 'post', name: 'Git Post Office', emoji: '📮', floor: '#e3c9a8', wall: '#a8443a', col: 4, row: 0 },
  { key: 'observatory', name: 'Observatory', emoji: '🔭', floor: '#7d7fa6', wall: '#2f3157', col: 0, row: 1 },
  { key: 'garden', name: 'Thinking Garden', emoji: '🌳', floor: '#7fb069', wall: '#4b7a3a', col: 1, row: 1 },
  { key: 'hall', name: 'Town Hall', emoji: '🏛️', floor: '#d8cfc0', wall: '#8a7a64', col: 2, row: 1 },
  { key: 'portal', name: 'Spawn Portal', emoji: '🌀', floor: '#5b4a7a', wall: '#2e2342', col: 3, row: 1 },
  { key: 'lounge', name: 'Lounge', emoji: '☕', floor: '#c98f6b', wall: '#6e4430', col: 4, row: 1 },
];
for (const z of ZONES) {
  z.x = MX + z.col * (ZW + GAP);
  z.y = ROW_Y[z.row];
  z.w = ZW; z.h = ZH;
  z.door = { x: z.x + ZW / 2, y: z.row === 0 ? z.y + ZH : z.y };
}
const ZONE = Object.fromEntries(ZONES.map((z) => [z.key, z]));

const ACTS = {
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

const STALE_MS = 3 * 60_000; // no writes for this long and not finished → idle
const RECENT_MS = 30 * 60_000; // hide sessions quieter than this unless "show old"
const DONE_VISIBLE_MS = 10 * 60_000; // finished sub-agents hang around the lounge this long

// ---------- state ----------
const canvas = document.getElementById('town');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);
const ui = {
  project: $('project'), agents: $('agents'), details: $('details'), stats: $('stats'),
  showOld: $('showOld'), allBubbles: $('allBubbles'), tooltip: $('tooltip'), empty: $('empty'),
  conn: $('conn'), mode: $('mode'), legend: $('legend'),
};

let agents = new Map(); // key -> server agent
const sprites = new Map(); // key -> sprite
let clockOffset = 0;
let firstSnapshot = true;
let selected = null;
let hovered = null;
const particles = [];
const prefs = loadPrefs();
ui.showOld.checked = !!prefs.showOld;
ui.allBubbles.checked = !!prefs.allBubbles;

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem('agent-town') || '{}'); } catch { return {}; }
}
function savePrefs() {
  try {
    localStorage.setItem('agent-town', JSON.stringify({
      project: ui.project.value, showOld: ui.showOld.checked, allBubbles: ui.allBubbles.checked,
    }));
  } catch { /* storage unavailable */ }
}

const now = () => Date.now() + clockOffset;

// ---------- helpers ----------
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const rand = (a, b) => a + Math.random() * (b - a);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const trunc = (s, n) => (s = String(s || ''), s.length > n ? s.slice(0, n - 1) + '…' : s);

function displayName(a) {
  if (a.isMain) return a.title || a.task || a.projectName || 'Claude';
  return a.title || a.agentType || 'sub-agent';
}
function shortName(a) {
  if (a.isMain) return trunc(a.projectName, 18);
  return trunc(a.title || a.agentType, 18);
}

function stateOf(a) {
  if (a.done) return 'done';
  if (a.waitingForUser) return 'waiting';
  if (now() - a.lastAt > STALE_MS) return 'idle';
  return ACTS[a.activity] ? a.activity : 'thinking';
}

function relTime(ts) {
  const s = Math.max(0, Math.round((now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n || 0));

function isVisible(a) {
  if (ui.showOld.checked) return true;
  const age = now() - a.lastAt;
  if (a.done) return age < DONE_VISIBLE_MS;
  return age < RECENT_MS;
}

function currentProject() {
  const v = ui.project.value;
  if (v !== '__auto') return v;
  // Stick with the current pick while it's still busy so the town doesn't flip between projects.
  const busy = (p) => [...agents.values()].some((a) => a.project === p && !a.done && now() - a.lastAt < 2 * 60_000);
  if (autoPick && busy(autoPick)) return autoPick;
  let best = null;
  for (const a of agents.values()) if (!best || a.lastAt > best.lastAt) best = a;
  autoPick = best ? best.project : null;
  return autoPick || '__all';
}
let autoPick = null;

function visibleAgents() {
  const p = currentProject();
  return [...agents.values()].filter((a) => (p === '__all' || a.project === p) && isVisible(a));
}

// ---------- sprites & movement ----------
function spotIn(z) {
  return { x: rand(z.x + 30, z.x + z.w - 30), y: rand(z.y + 78, z.y + z.h - 18) };
}
function zoneAt(x, y) {
  return ZONES.find((z) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h);
}

function makeSprite(a, placeDirectly) {
  const h = hash(a.key);
  const zKey = ACTS[stateOf(a)].zone;
  const portal = ZONE.portal;
  const start = placeDirectly ? spotIn(ZONE[zKey]) : { x: portal.x + portal.w / 2, y: portal.y + 150 };
  const s = {
    key: a.key, x: start.x, y: start.y, path: [], zone: placeDirectly ? zKey : 'portal',
    shirt: `hsl(${h % 360} 65% 58%)`, pants: `hsl(${(h >> 9) % 360} 25% 30%)`,
    hair: ['#2b1d14', '#6b3e1f', '#d9b25f', '#8a8a8a', '#c4502d', '#1f1f1f'][h % 6],
    skin: ['#f2c9a0', '#e0ac7e', '#c68b5e', '#8d5a3b', '#f5d7bd'][(h >> 4) % 5],
    hat: hatFor(a), arrivedAt: performance.now(), wantSince: 0, walk: 0, facing: 1, nextWander: 0, lastState: null, stateAt: now(), nextFx: 0, born: performance.now(),
  };
  if (!placeDirectly) puff(s.x, s.y - 10, 14);
  return s;
}

function hatFor(a) {
  if (a.isMain) return 'crown';
  const t = (a.agentType || '').toLowerCase();
  if (t.includes('explore')) return '#4caf50';
  if (t.includes('plan')) return '#8e6bd8';
  if (t.includes('review')) return '#e05d5d';
  if (t.includes('general')) return '#3f8fd6';
  return `hsl(${hash(t) % 360} 55% 50%)`;
}

function routeTo(s, zKey) {
  const from = zoneAt(s.x, s.y); // null when out on the road
  const to = ZONE[zKey];
  const dest = spotIn(to);
  s.path = [];
  if (from !== to) {
    const j = rand(-18, 18);
    const lane = LANE_Y + rand(-70, 70);
    if (from) s.path.push({ x: from.door.x + j, y: from.door.y + (from.row === 0 ? -12 : 12) });
    s.path.push({ x: from ? from.door.x + j : s.x, y: lane });
    s.path.push({ x: to.door.x + j, y: lane });
    s.path.push({ x: to.door.x + j, y: to.door.y + (to.row === 0 ? -12 : 12) });
  }
  s.path.push(dest);
  s.zone = zKey;
}

// Tool calls can flip every second; agents finish their trip and linger a moment before
// heading somewhere new, so the town reads as "busy" rather than "jittery".
const DWELL_MS = 1400;
const RETARGET_MS = 1800;

function updateSprite(s, a, dt, t) {
  const st = stateOf(a);
  if (st !== s.lastState) {
    s.lastState = st;
    s.stateAt = now();
    s.wantSince = t;
  }
  const want = ACTS[st].zone;
  if (want !== s.zone) {
    const settled = !s.path.length && t - (s.arrivedAt || 0) > DWELL_MS;
    const stable = t - s.wantSince > RETARGET_MS;
    if (settled || stable) routeTo(s, want);
  }
  const moving = s.path.length > 0;
  if (moving) {
    const target = s.path[0];
    const dx = target.x - s.x, dy = target.y - s.y;
    const d = Math.hypot(dx, dy);
    const speed = st === 'idle' || st === 'done' ? 110 : 250;
    const stepLen = speed * dt;
    if (d <= stepLen) { s.x = target.x; s.y = target.y; s.path.shift(); if (!s.path.length) s.arrivedAt = t; }
    else { s.x += (dx / d) * stepLen; s.y += (dy / d) * stepLen; }
    if (Math.abs(dx) > 1) s.facing = dx > 0 ? 1 : -1;
    s.walk += dt * 10;
    s.nextWander = t + rand(2500, 6000);
  } else {
    s.walk = 0;
    // Busy agents shuffle around their building so it feels alive.
    const sleepy = st === 'idle' || st === 'done';
    if (!sleepy && t > s.nextWander) {
      const z = ZONE[s.zone];
      const p = spotIn(z);
      s.path.push({ x: (s.x * 2 + p.x) / 3, y: (s.y * 2 + p.y) / 3 });
      s.nextWander = t + rand(2500, 6000);
    }
    if (t > s.nextFx) {
      const fx = ACTS[st].fx;
      particles.push({ x: s.x + rand(-8, 8), y: s.y - 46, vy: -18, life: 0, max: 1.6, text: fx[Math.floor(Math.random() * fx.length)], zzz: fx[0] === 'z' });
      s.nextFx = t + (sleepy ? rand(1200, 2000) : rand(1500, 4000));
    }
  }
}

function puff(x, y, n) {
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2;
    particles.push({ x, y, vx: Math.cos(ang) * rand(20, 70), vy: Math.sin(ang) * rand(20, 70), life: 0, max: 0.8, dot: true, color: `hsl(${rand(250, 320)} 80% 75%)` });
  }
}

// ---------- background (cached) ----------
const BG_SCALE = 2;
const bg = document.createElement('canvas');
bg.width = W * BG_SCALE; bg.height = H * BG_SCALE;

function drawBackground(g) {
  g.scale(BG_SCALE, BG_SCALE);
  g.imageSmoothingEnabled = false;
  // grass with pixel noise
  g.fillStyle = '#5f9e4f';
  g.fillRect(0, 0, W, H);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rnd() < 0.5 ? '#579448' : '#68a957';
    g.fillRect(Math.floor(rnd() * W / 4) * 4, Math.floor(rnd() * H / 4) * 4, 4, 4);
  }
  // road
  g.fillStyle = '#d7c08f';
  g.fillRect(0, ROAD.y, W, ROAD.h);
  g.fillStyle = '#c9b07c';
  for (let i = 0; i < 700; i++) g.fillRect(Math.floor(rnd() * W / 4) * 4, ROAD.y + Math.floor(rnd() * ROAD.h / 4) * 4, 4, 4);
  g.fillStyle = '#b89c66';
  g.fillRect(0, ROAD.y, W, 4); g.fillRect(0, ROAD.y + ROAD.h - 4, W, 4);
  // paths from doors to road
  for (const z of ZONES) {
    g.fillStyle = '#d7c08f';
    if (z.row === 0) g.fillRect(z.door.x - 22, z.y + z.h, 44, ROAD.y - (z.y + z.h));
    else g.fillRect(z.door.x - 22, ROAD.y + ROAD.h, 44, z.y - (ROAD.y + ROAD.h));
  }
  // trees & flowers in the margins
  const tree = (x, y, r) => {
    g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(x, y + r * 0.9, r, r * 0.35, 0, 0, 7); g.fill();
    g.fillStyle = '#6b4a2b'; g.fillRect(x - 3, y, 6, r * 0.8);
    g.fillStyle = '#3f7d34'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.fillStyle = '#4f9541'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.6, 0, 7); g.fill();
  };
  for (let i = 0; i < 5; i++) tree(MX + ZW + GAP / 2 + i * (ZW + GAP), ROW_Y[0] + 40, 16);
  for (let i = 0; i < 4; i++) tree(MX + ZW + GAP / 2 + i * (ZW + GAP), ROW_Y[1] + ZH - 30, 16);
  for (const [x, y] of [[20, 30], [W - 22, 40], [24, H - 30], [W - 24, H - 34], [W / 2, 22], [W / 2 + 300, H - 18]]) tree(x, y, 13);
  for (let i = 0; i < 90; i++) {
    const x = rnd() * W, y = rnd() * H;
    if ((y > ROAD.y - 6 && y < ROAD.y + ROAD.h + 6) || zoneAt(x, y)) continue;
    g.fillStyle = ['#f6e27f', '#f49ac1', '#ffffff', '#c3a6ff'][Math.floor(rnd() * 4)];
    g.fillRect(Math.floor(x), Math.floor(y), 4, 4);
  }
  for (const z of ZONES) drawBuilding(g, z, rnd);
}

function drawBuilding(g, z, rnd) {
  const { x, y, w, h } = z;
  g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 6, y + 8, w, h);
  g.fillStyle = z.wall; g.fillRect(x - 4, y - 4, w + 8, h + 8);
  g.fillStyle = z.floor; g.fillRect(x, y, w, h);
  // floor tiles
  g.fillStyle = 'rgba(0,0,0,.06)';
  for (let ty = y + 52; ty < y + h; ty += 20) for (let tx = x + ((ty / 20) % 2) * 20; tx < x + w; tx += 40) g.fillRect(tx, ty, 20, 20);
  // roof / sign
  g.fillStyle = z.wall; g.fillRect(x, y, w, 46);
  g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(x, y, w, 4);
  g.font = '22px "Apple Color Emoji","Segoe UI Emoji",sans-serif';
  g.textBaseline = 'middle';
  g.fillText(z.emoji, x + 10, y + 24);
  g.font = 'bold 17px ui-monospace, Menlo, monospace';
  g.fillStyle = '#fff8e8';
  g.fillText(z.name, x + 42, y + 24);
  // door gap
  g.fillStyle = z.floor;
  g.fillRect(z.door.x - 20, z.row === 0 ? y + h - 2 : y - 4, 40, 8);
  if (z.row === 1) { g.fillStyle = z.wall; g.fillRect(x, y, w, 46); g.font = '22px "Apple Color Emoji","Segoe UI Emoji",sans-serif'; g.fillText(z.emoji, x + 10, y + 24); g.font = 'bold 17px ui-monospace, Menlo, monospace'; g.fillStyle = '#fff8e8'; g.fillText(z.name, x + 42, y + 24); }
  PROPS[z.key]?.(g, z, rnd);
}

const PROPS = {
  library(g, z, rnd) {
    for (let i = 0; i < 3; i++) {
      const sx = z.x + 14 + i * 82, sy = z.y + 56;
      g.fillStyle = '#5b3a20'; g.fillRect(sx, sy, 70, 34);
      for (let b = 0; b < 12; b++) { g.fillStyle = ['#c0392b', '#2e86c1', '#27ae60', '#f1c40f', '#8e44ad'][Math.floor(rnd() * 5)]; g.fillRect(sx + 3 + b * 5.5, sy + 3, 4, 13); g.fillRect(sx + 3 + b * 5.5, sy + 19, 4, 12); }
    }
    g.fillStyle = '#8b5a2b'; g.fillRect(z.x + 90, z.y + 170, 80, 26);
  },
  workshop(g, z) {
    g.fillStyle = '#7a5230'; g.fillRect(z.x + 16, z.y + 60, 100, 22); g.fillRect(z.x + 144, z.y + 60, 100, 22);
    g.fillStyle = '#9aa4ad'; g.fillRect(z.x + 30, z.y + 64, 18, 6); g.fillRect(z.x + 170, z.y + 63, 30, 4);
    g.fillStyle = '#a0522d'; g.fillRect(z.x + 30, z.y + 180, 26, 26); g.fillRect(z.x + 60, z.y + 186, 20, 20);
  },
  terminal(g, z) {
    for (let i = 0; i < 4; i++) {
      const dx = z.x + 14 + i * 62;
      g.fillStyle = '#4a4f63'; g.fillRect(dx, z.y + 78, 50, 14);
      g.fillStyle = '#1e2230'; g.fillRect(dx + 8, z.y + 56, 34, 24);
      g.fillStyle = '#5be37d'; g.fillRect(dx + 11, z.y + 60, 18, 2); g.fillRect(dx + 11, z.y + 65, 24, 2); g.fillRect(dx + 11, z.y + 70, 12, 2);
    }
    g.fillStyle = '#2b3042'; g.fillRect(z.x + z.w - 40, z.y + 150, 26, 60);
    g.fillStyle = '#e74c3c'; g.fillRect(z.x + z.w - 34, z.y + 158, 4, 4); g.fillStyle = '#5be37d'; g.fillRect(z.x + z.w - 26, z.y + 158, 4, 4);
  },
  lab(g, z) {
    g.fillStyle = '#e9f1f0'; g.fillRect(z.x + 14, z.y + 62, z.w - 28, 20);
    g.fillStyle = '#a7bdbb'; g.fillRect(z.x + 14, z.y + 80, z.w - 28, 4);
    const cols = ['#5be37d', '#5bc0eb', '#f25f5c', '#ffe066', '#c3a6ff'];
    for (let i = 0; i < 9; i++) { g.fillStyle = cols[i % 5]; g.fillRect(z.x + 24 + i * 25, z.y + 64, 8, 14); g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(z.x + 25 + i * 25, z.y + 58, 6, 6); }
  },
  post(g, z) {
    g.fillStyle = '#7a5230'; g.fillRect(z.x + 14, z.y + 60, z.w - 28, 24);
    for (let i = 0; i < 4; i++) { g.fillStyle = '#c0392b'; g.fillRect(z.x + 24 + i * 58, z.y + 160 + (i % 2) * 20, 18, 26); g.fillStyle = '#922b21'; g.fillRect(z.x + 24 + i * 58, z.y + 160 + (i % 2) * 20, 18, 5); }
    g.fillStyle = '#d4a373'; g.fillRect(z.x + 40, z.y + 66, 16, 12); g.fillRect(z.x + 70, z.y + 68, 20, 10);
  },
  observatory(g, z) {
    g.fillStyle = '#20223f'; g.fillRect(z.x, z.y + 46, z.w, z.h - 46);
    let s = 3; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 50; i++) { g.fillStyle = r() < 0.2 ? '#ffe066' : '#ffffff'; g.fillRect(z.x + r() * z.w, z.y + 50 + r() * (z.h - 54), 2, 2); }
    g.fillStyle = '#9aa4ad'; g.save(); g.translate(z.x + z.w - 60, z.y + 120); g.rotate(-0.6); g.fillRect(-6, -30, 12, 60); g.restore();
    g.fillStyle = '#5c6370'; g.fillRect(z.x + z.w - 66, z.y + 140, 12, 30);
  },
  garden(g, z) {
    g.fillStyle = '#6aa257';
    for (let i = 0; i < 40; i++) g.fillRect(z.x + ((i * 53) % z.w), z.y + 50 + ((i * 37) % (z.h - 54)), 4, 4);
    g.fillStyle = '#c9b07c'; g.beginPath(); g.ellipse(z.x + z.w / 2, z.y + 150, 70, 34, 0, 0, 7); g.fill();
    g.fillStyle = '#5dade2'; g.beginPath(); g.ellipse(z.x + z.w / 2, z.y + 150, 26, 12, 0, 0, 7); g.fill();
    for (const [fx, fy] of [[30, 70], [220, 80], [40, 220], [215, 210]]) { g.fillStyle = '#3f7d34'; g.beginPath(); g.arc(z.x + fx, z.y + fy, 14, 0, 7); g.fill(); g.fillStyle = '#f49ac1'; g.fillRect(z.x + fx - 2, z.y + fy - 2, 4, 4); }
  },
  hall(g, z) {
    g.fillStyle = '#8a5a3b'; g.fillRect(z.x + z.w / 2 - 22, z.y + 58, 44, 26);
    g.fillStyle = '#c0392b'; g.fillRect(z.x + z.w / 2 - 50, z.y + 50, 100, 6);
    g.fillStyle = '#a07850';
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) g.fillRect(z.x + 30 + c * 130, z.y + 140 + r * 46, 70, 10);
  },
  portal(g, z) {
    g.fillStyle = '#3d2f57'; g.beginPath(); g.ellipse(z.x + z.w / 2, z.y + 150, 60, 30, 0, 0, 7); g.fill();
    g.fillStyle = '#4b3a6b';
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.fillRect(z.x + z.w / 2 + Math.cos(a) * 80 - 4, z.y + 150 + Math.sin(a) * 44 - 4, 8, 8); }
  },
  lounge(g, z) {
    g.fillStyle = '#8e3b46'; g.fillRect(z.x + 20, z.y + 60, 90, 22); g.fillRect(z.x + 20, z.y + 56, 90, 8);
    g.fillStyle = '#8e3b46'; g.fillRect(z.x + 150, z.y + 60, 90, 22); g.fillRect(z.x + 150, z.y + 56, 90, 8);
    g.fillStyle = '#6b4a2b'; g.fillRect(z.x + 100, z.y + 160, 60, 30);
    g.fillStyle = '#fff'; g.fillRect(z.x + 112, z.y + 166, 8, 8); g.fillRect(z.x + 138, z.y + 168, 8, 8);
    g.fillStyle = '#3f7d34'; g.beginPath(); g.arc(z.x + 236, z.y + 214, 12, 0, 7); g.fill();
  },
};

// ---------- rendering ----------
let view = { scale: 1, ox: 0, oy: 0, dpr: 1 };
function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  const scale = Math.min(r.width / W, r.height / H);
  view = { scale, ox: (r.width - W * scale) / 2, oy: (r.height - H * scale) / 2, dpr };
}
window.addEventListener('resize', resize);

function drawAgent(g, s, a, t) {
  const st = stateOf(a);
  const sleepy = st === 'done' || st === 'idle';
  const x = Math.round(s.x), y = Math.round(s.y);
  const u = 3; // pixel unit
  const bob = s.path.length ? Math.abs(Math.sin(s.walk)) * 2 : sleepy ? 0 : Math.sin(t / 300 + hash(s.key)) * 0.8;
  const legA = s.path.length ? Math.sin(s.walk) * 3 : 0;
  g.globalAlpha = sleepy ? 0.7 : 1;

  // selection ring + shadow
  if (selected === s.key || hovered === s.key) {
    g.strokeStyle = selected === s.key ? '#d97757' : 'rgba(255,255,255,.8)';
    g.lineWidth = 2; g.beginPath(); g.ellipse(x, y, 16, 6, 0, 0, 7); g.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(x, y, 11, 4, 0, 0, 7); g.fill();

  const top = y - 13 * u - bob;
  // legs
  g.fillStyle = s.pants;
  g.fillRect(x - 2 * u, y - 4 * u + legA, u * 1.5, 4 * u - legA);
  g.fillRect(x + 0.5 * u, y - 4 * u - legA, u * 1.5, 4 * u + legA);
  // body
  g.fillStyle = s.shirt; g.fillRect(x - 3 * u, top + 6 * u, 6 * u, 4 * u);
  g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(x - 3 * u, top + 9 * u, 6 * u, u);
  // arms (wave while talking, hammer while editing)
  const armSwing = st === 'editing' && !s.path.length ? Math.sin(t / 90) * 3 : st === 'talking' && !s.path.length ? -Math.abs(Math.sin(t / 200)) * 6 : legA;
  g.fillStyle = s.shirt;
  g.fillRect(x - 4 * u, top + 6 * u - (s.facing < 0 ? armSwing : 0), u, 3.5 * u);
  g.fillRect(x + 3 * u, top + 6 * u - (s.facing > 0 ? armSwing : 0), u, 3.5 * u);
  // head
  g.fillStyle = s.skin; g.fillRect(x - 3 * u, top, 6 * u, 6 * u);
  g.fillStyle = s.hair; g.fillRect(x - 3 * u, top, 6 * u, 1.5 * u); g.fillRect(x - 3 * u + (s.facing > 0 ? 0 : 5 * u), top, u, 3 * u);
  // eyes
  g.fillStyle = '#222';
  const ex = x + s.facing * u;
  if (sleepy) { g.fillRect(ex - 2 * u, top + 3 * u, u * 1.4, 0.6 * u); g.fillRect(ex + 0.6 * u, top + 3 * u, u * 1.4, 0.6 * u); }
  else { g.fillRect(ex - 1.5 * u, top + 2.5 * u, u, u); g.fillRect(ex + 0.8 * u, top + 2.5 * u, u, u); }
  // hat
  if (s.hat === 'crown') {
    g.fillStyle = '#f5c542';
    g.fillRect(x - 3 * u, top - 1.5 * u, 6 * u, 1.5 * u);
    g.fillRect(x - 3 * u, top - 3 * u, u, 1.5 * u); g.fillRect(x - 0.5 * u, top - 3 * u, u, 1.5 * u); g.fillRect(x + 2 * u, top - 3 * u, u, 1.5 * u);
    g.fillStyle = '#e74c3c'; g.fillRect(x - 0.5 * u, top - 1.2 * u, u, u);
  } else {
    g.fillStyle = s.hat;
    g.fillRect(x - 3 * u, top - u, 6 * u, 1.8 * u);
    g.fillRect(x + (s.facing > 0 ? 1 : -4) * u, top + 0.2 * u, 3 * u, 0.8 * u);
  }
  g.globalAlpha = 1;

  // activity icon
  g.font = '15px "Apple Color Emoji","Segoe UI Emoji",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'bottom';
  const icon = s.path.length && !sleepy ? '🏃' : ACTS[st].emoji;
  g.fillText(icon, x + 15, top + 2 + Math.sin(t / 250) * 1.5);

  // name tag
  g.font = '11px ui-monospace, Menlo, monospace';
  g.textBaseline = 'top';
  const label = shortName(a);
  const lw = g.measureText(label).width + 8;
  g.fillStyle = a.isMain ? 'rgba(120,70,20,.85)' : 'rgba(20,22,30,.75)';
  g.fillRect(x - lw / 2, y + 5, lw, 14);
  g.fillStyle = '#fff'; g.fillText(label, x, y + 7);
}

function drawBubble(g, s, a, t) {
  const st = stateOf(a);
  let text = a.detail;
  if (st === 'thinking' && !(selected === s.key || hovered === s.key)) text = '.'.repeat(1 + Math.floor(t / 400) % 3);
  if (st === 'waiting') text = 'Waiting for you…';
  if (st === 'idle') text = 'zzz (no activity)';
  if (st === 'done') text = 'Done ✔';
  if (!text) return;
  text = trunc(text, 42);
  g.font = '12px ui-monospace, Menlo, monospace';
  const tw = g.measureText(text).width;
  const bw = tw + 14, bh = 22;
  const bx = Math.round(s.x - bw / 2), by = Math.round(s.y - 78);
  g.fillStyle = st === 'thinking' ? 'rgba(255,255,255,.85)' : '#fffdf5';
  g.strokeStyle = '#1b1d26'; g.lineWidth = 2;
  roundRect(g, bx, by, bw, bh, 6); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(s.x - 5, by + bh); g.lineTo(s.x, by + bh + 7); g.lineTo(s.x + 5, by + bh); g.closePath(); g.fill();
  g.fillStyle = '#1b1d26'; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(text, bx + 7, by + bh / 2 + 1);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function drawPortal(g, t) {
  const z = ZONE.portal, cx = z.x + z.w / 2, cy = z.y + 150;
  for (let i = 0; i < 3; i++) {
    g.strokeStyle = `hsla(${(t / 20 + i * 40) % 360} 80% 70% / .7)`;
    g.lineWidth = 3;
    g.beginPath(); g.ellipse(cx, cy, 52 - i * 14, 24 - i * 6, 0, t / 500 + i, t / 500 + i + 4.4); g.stroke();
  }
}

function drawLinks(g, vis, t) {
  g.save();
  g.setLineDash([6, 6]);
  g.lineDashOffset = -t / 40;
  for (const a of vis) {
    if (!a.parent) continue;
    const c = sprites.get(a.key), p = sprites.get(a.parent);
    if (!c || !p || !agents.has(a.parent) || !isVisible(agents.get(a.parent))) continue;
    const active = !a.done;
    g.strokeStyle = active ? c.shirt : 'rgba(255,255,255,.25)';
    g.globalAlpha = active ? 0.55 : 0.25;
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(p.x, p.y - 20); g.lineTo(c.x, c.y - 20); g.stroke();
  }
  g.restore();
}

let lastT = performance.now();
function frame(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  const vis = visibleAgents();

  for (const a of vis) {
    let s = sprites.get(a.key);
    if (!s) { s = makeSprite(a, firstSnapshot); sprites.set(a.key, s); }
    updateSprite(s, a, dt, t);
  }

  const { scale, ox, oy, dpr } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#4f8a41';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bg, 0, 0, W, H);
  drawPortal(ctx, t);

  // occupancy counters on each building
  const counts = {};
  for (const a of vis) { const z = ACTS[stateOf(a)].zone; counts[z] = (counts[z] || 0) + 1; }
  ctx.font = 'bold 13px ui-monospace, Menlo, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const z of ZONES) {
    if (!counts[z.key]) continue;
    ctx.fillStyle = '#d97757'; ctx.beginPath(); ctx.arc(z.x + z.w - 18, z.y + 23, 12, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(counts[z.key], z.x + z.w - 18, z.y + 24);
  }

  drawLinks(ctx, vis, t);

  const ordered = vis.map((a) => [a, sprites.get(a.key)]).sort((p, q) => p[1].y - q[1].y);
  for (const [a, s] of ordered) drawAgent(ctx, s, a, t);

  // particles
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life > p.max) { particles.splice(i, 1); continue; }
    p.x += (p.vx || 0) * dt; p.y += p.vy * dt;
    ctx.globalAlpha = 1 - p.life / p.max;
    if (p.dot) { ctx.fillStyle = p.color; ctx.fillRect(p.x - 2, p.y - 2, 4, 4); }
    else if (p.zzz) { ctx.fillStyle = '#fff'; ctx.font = 'bold 13px ui-monospace, Menlo, monospace'; ctx.fillText('z', p.x + Math.sin(p.life * 4) * 4, p.y); }
    else { ctx.font = '13px "Apple Color Emoji","Segoe UI Emoji",sans-serif'; ctx.fillText(p.text, p.x, p.y); }
  }
  ctx.globalAlpha = 1;

  // speech bubbles on top
  const all = ui.allBubbles.checked;
  for (const [a, s] of ordered) {
    const fresh = now() - s.stateAt < 4500 && !['idle', 'done'].includes(stateOf(a));
    if (all || fresh || selected === s.key || hovered === s.key) drawBubble(ctx, s, a, t);
  }

  ui.empty.hidden = vis.length > 0;
  requestAnimationFrame(frame);
}

// ---------- interaction ----------
function agentAt(ev) {
  const r = canvas.getBoundingClientRect();
  const wx = (ev.clientX - r.left - view.ox) / view.scale;
  const wy = (ev.clientY - r.top - view.oy) / view.scale;
  let best = null, bestD = 26;
  for (const a of visibleAgents()) {
    const s = sprites.get(a.key);
    if (!s) continue;
    const d = Math.hypot(s.x - wx, s.y - 18 - wy);
    if (d < bestD) { best = a; bestD = d; }
  }
  return best;
}

canvas.addEventListener('mousemove', (ev) => {
  const a = agentAt(ev);
  hovered = a?.key || null;
  canvas.classList.toggle('hovering', !!a);
  if (!a) { ui.tooltip.hidden = true; return; }
  const st = stateOf(a);
  ui.tooltip.innerHTML = `<b>${esc(trunc(displayName(a), 60))}</b><br>${ACTS[st].emoji} ${esc(ACTS[st].label)}${a.detail ? `: ${esc(trunc(a.detail, 120))}` : ''}<br><span class="muted">${esc(a.isMain ? 'main agent' : a.agentType)} · ${relTime(a.lastAt)}</span>`;
  const r = canvas.getBoundingClientRect();
  ui.tooltip.hidden = false;
  ui.tooltip.style.left = `${Math.min(ev.clientX - r.left + 14, r.width - 330)}px`;
  ui.tooltip.style.top = `${ev.clientY - r.top + 14}px`;
});
canvas.addEventListener('mouseleave', () => { hovered = null; ui.tooltip.hidden = true; });
canvas.addEventListener('click', (ev) => { const a = agentAt(ev); select(a ? a.key : null); });

function select(key) {
  selected = key;
  renderPanel();
}

ui.project.addEventListener('change', () => { savePrefs(); renderPanel(); });
ui.showOld.addEventListener('change', () => { savePrefs(); renderPanel(); });
ui.allBubbles.addEventListener('change', savePrefs);
ui.agents.addEventListener('click', (ev) => {
  const li = ev.target.closest('li[data-key]');
  if (li) select(li.dataset.key === selected ? null : li.dataset.key);
});

// ---------- side panel ----------
function renderProjects() {
  const byProject = new Map();
  for (const a of agents.values()) {
    const p = byProject.get(a.project) || { name: a.projectName, lastAt: 0, n: 0 };
    p.lastAt = Math.max(p.lastAt, a.lastAt); p.n++;
    byProject.set(a.project, p);
  }
  const want = ui.project.value || prefs.project || '__auto';
  const opts = [['__auto', '⚡ Most recently active'], ['__all', '🌍 All projects'],
    ...[...byProject.entries()].sort((a, b) => b[1].lastAt - a[1].lastAt).map(([k, p]) => [k, `${p.name} (${p.n})`])];
  ui.project.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  ui.project.value = opts.some(([v]) => v === want) ? want : '__auto';
  const auto = currentProject();
  if (ui.project.value === '__auto' && byProject.has(auto)) ui.project.options[0].text = `⚡ Most recently active: ${byProject.get(auto).name}`;
}

function renderPanel() {
  const vis = visibleAgents();
  const states = vis.map(stateOf);
  const working = states.filter((s) => !['idle', 'done', 'waiting'].includes(s)).length;
  ui.stats.innerHTML = `
    <div class="stat"><b>${vis.length}</b><span>agents</span></div>
    <div class="stat"><b>${working}</b><span>working</span></div>
    <div class="stat"><b>${vis.filter((a) => !a.isMain).length}</b><span>sub-agents</span></div>`;

  // tree order: roots by recency, children beneath their parent
  const kids = new Map();
  const keys = new Set(vis.map((a) => a.key));
  const roots = [];
  for (const a of vis) {
    if (a.parent && keys.has(a.parent)) { if (!kids.has(a.parent)) kids.set(a.parent, []); kids.get(a.parent).push(a); }
    else roots.push(a);
  }
  const rows = [];
  const walk = (a, depth) => {
    rows.push([a, depth]);
    (kids.get(a.key) || []).sort((p, q) => p.startedAt - q.startedAt).forEach((c) => walk(c, depth + 1));
  };
  roots.sort((p, q) => q.lastAt - p.lastAt).forEach((r) => walk(r, 0));
  ui.agents.innerHTML = rows.map(([a, depth]) => {
    const st = stateOf(a);
    const s = sprites.get(a.key);
    return `<li data-key="${esc(a.key)}" class="${a.key === selected ? 'sel' : ''} ${['done', 'idle'].includes(st) ? 'faded' : ''}" style="padding-left:${6 + depth * 16}px">
      <span class="swatch" style="background:${s ? s.shirt : '#888'}"></span>
      <span class="name" title="${esc(displayName(a))}">${a.isMain ? '👑 ' : depth ? '↳ ' : ''}${esc(displayName(a))}</span>
      <span class="act">${ACTS[st].emoji} ${esc(ACTS[st].label)}</span></li>`;
  }).join('');

  const a = selected && agents.get(selected);
  ui.details.hidden = !a;
  if (!a) return;
  const st = stateOf(a);
  const parent = a.parent && agents.get(a.parent);
  ui.details.innerHTML = `
    <h4>${a.isMain ? '👑 ' : ''}${esc(displayName(a))}</h4>
    <div class="kv">
      <span>Status</span><span>${ACTS[st].emoji} ${esc(ACTS[st].label)}${a.detail && !['done', 'idle', 'waiting'].includes(st) ? `: ${esc(a.detail)}` : ''}</span>
      <span>Type</span><span>${esc(a.isMain ? 'main session' : a.agentType)}${a.background ? ' (background)' : ''}</span>
      ${parent ? `<span>Spawned by</span><span>${esc(trunc(displayName(parent), 60))}</span>` : ''}
      <span>Project</span><span>${esc(a.projectName)}${a.branch ? ` · ${esc(a.branch)}` : ''}</span>
      <span>Model</span><span>${esc(a.model || '?')}</span>
      <span>Context</span><span>${fmtK(a.contextTokens)} tokens · ${fmtK(a.outputTokens)} out</span>
      <span>Tool calls</span><span>${a.toolCalls}</span>
      <span>Started</span><span>${relTime(a.startedAt)}</span>
      <span>Last seen</span><span>${relTime(a.lastAt)}</span>
    </div>
    ${a.task ? `<div class="task">${esc(a.task)}</div>` : ''}
    <ul class="log">${[...a.events].reverse().map((e) => `<li><time>${new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span>${esc(e.text)}</span></li>`).join('')}</ul>`;
}

ui.legend.innerHTML = Object.entries(ACTS).map(([, v]) => `<li>${v.emoji} ${esc(v.label)} → ${esc(ZONE[v.zone].name)}</li>`).join('');

// ---------- live data ----------
function connect() {
  const es = new EventSource('/events');
  es.onopen = () => { ui.conn.className = 'dot on'; ui.conn.title = 'live'; };
  es.onerror = () => { ui.conn.className = 'dot off'; ui.conn.title = 'disconnected, retrying'; };
  es.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    clockOffset = data.now - Date.now();
    ui.mode.hidden = !data.demo;
    agents = new Map(data.agents.map((a) => [a.key, a]));
    renderProjects();
    if (firstSnapshot) {
      // Place everyone already in town at their spot instead of streaming out of the portal.
      for (const a of visibleAgents()) sprites.set(a.key, makeSprite(a, true));
      firstSnapshot = false;
    }
    renderPanel();
  };
}

drawBackground(bg.getContext('2d'));
resize();
connect();
setInterval(renderPanel, 1000);
requestAnimationFrame(frame);
