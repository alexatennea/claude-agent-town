// Countryside around the town: everything outside the W×H town rectangle, so tall or wide
// windows show farms, a lake and a village instead of empty grass.
// buildScenery() paints the static parts once; drawSceneryAnim() and drawSky() animate the rest.

export const PAD_X = 900, PAD_Y = 900;
const GRASS = '#5f9e4f';
const DIRT = '#d7c08f';

export function buildScenery(W, H, ROAD) {
  const canvas = document.createElement('canvas');
  canvas.width = W + PAD_X * 2;
  canvas.height = H + PAD_Y * 2;
  const g = canvas.getContext('2d');
  g.translate(PAD_X, PAD_Y);

  let seed = 1234;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const r = (a, b) => a + rnd() * (b - a);
  const X0 = -PAD_X, Y0 = -PAD_Y, X1 = W + PAD_X, Y1 = H + PAD_Y;
  const riverY = (x) => H + 330 + Math.sin(x / 180) * 28;

  // ----- layout -----
  const lake = { cx: 330, cy: -380, rx: 230, ry: 140 };
  const pond = { cx: W + 320, cy: 680, rx: 120, ry: 64 };
  const fields = { x: 930, y: -560, w: 550, h: 360 };
  const windmill = { x: 760, y: -250 };
  const barn = { x: 1600, y: -330 };
  const farmPath = { x: 1192, w: 26 };
  const orchard = { x: 60, y: H + 70, w: 480, h: 170 };
  const meadow = { x: 1060, y: H + 60, w: 480, h: 190 };
  const plaza = { x: 800, y: H + 580, r: 70 };
  const camp = { x: -320, y: 170 };
  const village = [
    [620, H + 490, '#b5442f'], [980, H + 490, '#3f6fb5'], [590, H + 660, '#7a4f9e'],
    [1010, H + 670, '#c47a2c'], [800, H + 760, '#4f8a5a'], [400, H + 580, '#a8443a'], [1200, H + 580, '#5b5b7a'],
  ];
  const chimneys = [];

  const inEllipse = (e, x, y, m = 0) => ((x - e.cx) / (e.rx + m)) ** 2 + ((y - e.cy) / (e.ry + m)) ** 2 < 1;
  const inRect = (b, x, y, m = 0) => x > b.x - m && x < b.x + b.w + m && y > b.y - m && y < b.y + b.h + m;
  const near = (p, x, y, d) => Math.hypot(p.x - x, p.y - y) < d;
  const blocked = (x, y) =>
    (x > -50 && x < W + 50 && y > -50 && y < H + 50) ||
    (y > ROAD.y - 34 && y < ROAD.y + ROAD.h + 34) ||
    inEllipse(lake, x, y, 50) || inEllipse(pond, x, y, 40) || inRect(fields, x, y, 34) ||
    near(windmill, x, y - 40, 90) || inRect({ x: barn.x - 90, y: barn.y - 120, w: 230, h: 150 }, x, y) ||
    (Math.abs(x - farmPath.x) < 30 && y > fields.y + fields.h && y < 0) ||
    Math.abs(y - riverY(x)) < 62 || (Math.abs(x - 800) < 40 && y > H && y < plaza.y) ||
    inRect(orchard, x, y, 20) || inRect(meadow, x, y, 20) || near(plaza, x, y, 300) ||
    near(camp, x, y, 130) || inRect({ x: 160, y: H + 400, w: 300, h: 140 }, x, y, 20);

  // ----- ground -----
  g.fillStyle = GRASS;
  g.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
  for (let i = 0; i < 16000; i++) {
    const x = r(X0, X1), y = r(Y0, Y1);
    g.fillStyle = rnd() < 0.5 ? '#579448' : '#68a957';
    g.fillRect(Math.floor(x / 4) * 4, Math.floor(y / 4) * 4, 4, 4);
  }

  // road carries on out of town in both directions
  for (const [a, b] of [[X0, 0], [W, X1]]) {
    g.fillStyle = DIRT; g.fillRect(a, ROAD.y, b - a, ROAD.h);
    g.fillStyle = '#c9b07c';
    for (let i = 0; i < 300; i++) g.fillRect(Math.floor(r(a, b) / 4) * 4, ROAD.y + Math.floor(r(0, ROAD.h) / 4) * 4, 4, 4);
    g.fillStyle = '#b89c66'; g.fillRect(a, ROAD.y, b - a, 4); g.fillRect(a, ROAD.y + ROAD.h - 4, b - a, 4);
  }

  // river with sandy banks
  const riverStroke = (w, color) => {
    g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round';
    g.beginPath();
    for (let x = X0; x <= X1; x += 10) x === X0 ? g.moveTo(x, riverY(x)) : g.lineTo(x, riverY(x));
    g.stroke();
  };
  riverStroke(80, '#d9c38f'); riverStroke(56, '#4a8fc4'); riverStroke(18, '#5fa3d6');
  for (let x = X0 + 30; x < X1; x += 90) { g.fillStyle = '#3f7d34'; g.fillRect(x, riverY(x) - 38, 3, 9); g.fillRect(x + 6, riverY(x) + 30, 3, 9); }

  // dirt paths, plaza
  g.fillStyle = DIRT;
  g.fillRect(farmPath.x - farmPath.w / 2, fields.y, farmPath.w, -fields.y + 4);
  g.fillRect(785, H - 4, 30, plaza.y - H);
  g.fillRect(fields.x + fields.w, barn.y - 10, barn.x - fields.x - fields.w - 40, 22);
  g.beginPath(); g.arc(plaza.x, plaza.y, plaza.r, 0, 7); g.fill();
  g.fillRect(plaza.x - 420, plaza.y - 10, 840, 22);

  water(g, lake, rnd, true);
  water(g, pond, rnd, false);
  farmFields(g, fields, farmPath);
  orchardTrees(g, orchard);
  meadowPatch(g, meadow, rnd);
  pumpkinPatch(g, { x: 160, y: H + 400, w: 300, h: 140 });

  // ----- props, painted back to front -----
  const props = [];
  const add = (y, fn) => props.push({ y, fn });

  add(windmill.y, () => windmillTower(g, windmill));
  add(barn.y, () => barnHouse(g, barn));
  add(barn.y - 10, () => silo(g, barn.x + 100, barn.y - 10));
  for (const [x, y, roof] of village) add(y, () => chimneys.push(cottage(g, x, y, roof)));
  add(plaza.y + 10, () => well(g, plaza.x, plaza.y + 10));
  add(camp.y, () => tent(g, camp.x, camp.y));
  add(camp.y + 40, () => { log(g, camp.x + 30, camp.y + 70); log(g, camp.x + 120, camp.y + 60); });
  add(lake.cy + lake.ry + 6, () => dock(g, lake.cx + 90, lake.cy + lake.ry - 40));
  add(ROAD.y - 12, () => signpost(g, -60, ROAD.y - 12, 'Agent Town →'));
  add(ROAD.y - 12, () => signpost(g, W + 60, ROAD.y - 12, '← Agent Town'));
  add(H + 1, () => bridge(g, 800, riverY(800)));
  for (let i = 0; i < 4; i++) add(meadow.y + 60 + (i % 2) * 70, () => beehive(g, meadow.x + 80 + i * 110, meadow.y + 60 + (i % 2) * 70));

  // forests along the far edges, then a scatter of trees, rocks and bushes everywhere else
  const forest = (x0, y0, x1, y1, n) => {
    for (let i = 0; i < n; i++) {
      const x = r(x0, x1), y = r(y0, y1);
      if (blocked(x, y)) continue;
      const kind = rnd() < 0.55 ? 'pine' : rnd() < 0.9 ? 'oak' : 'autumn';
      const s = r(0.9, 1.5);
      add(y, () => tree(g, x, y, s, kind));
    }
  };
  forest(X0, Y0, X1, -660, 520);
  forest(X0, H + 800, X1, Y1, 420);
  forest(X0, -660, -80, H + 800, 260);
  forest(W + 80, -660, X1, H + 800, 260);
  for (let i = 0; i < 260; i++) {
    const x = r(X0, X1), y = r(Y0, Y1);
    if (blocked(x, y)) continue;
    const k = rnd();
    if (k < 0.4) { const s = r(0.8, 1.3), kind = rnd() < 0.5 ? 'oak' : 'pine'; add(y, () => tree(g, x, y, s, kind)); }
    else if (k < 0.6) add(y, () => rock(g, x, y, r(6, 14)));
    else if (k < 0.8) add(y, () => bush(g, x, y));
    else add(y, () => flowers(g, x, y, rnd));
  }

  props.sort((a, b) => a.y - b.y).forEach((p) => p.fn());

  return {
    canvas, riverY, X0, X1,
    windmillHub: { x: windmill.x, y: windmill.y - 92 },
    lake, chimneys, fire: { x: camp.x + 80, y: camp.y + 50 },
  };
}

// ---------- animated layers ----------

// Ground-level life: drawn under the town.
export function drawSceneryAnim(g, s, t) {
  // river shimmer
  g.fillStyle = 'rgba(255,255,255,.45)';
  const span = s.X1 - s.X0;
  for (let k = 0; k < 40; k++) {
    const x = s.X0 + ((k * 137 + t * 0.03) % span);
    g.fillRect(x, s.riverY(x) + ((k * 7) % 22) - 11, 8, 2);
  }
  // ducks paddling round the lake
  const L = s.lake;
  for (let i = 0; i < 4; i++) {
    const dir = i % 2 ? 1 : -1;
    const a = (t / 9000) * dir + i * 1.7;
    const x = L.cx + Math.cos(a) * L.rx * (0.35 + i * 0.1), y = L.cy + Math.sin(a) * L.ry * (0.3 + i * 0.08);
    const facing = -Math.sin(a) * dir > 0 ? 1 : -1;
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1;
    g.beginPath(); g.ellipse(x - facing * 6, y + 2, 9, 3, 0, 0, 7); g.stroke();
    g.fillStyle = i === 0 ? '#e8e3d0' : '#8a6a4a'; g.beginPath(); g.ellipse(x, y, 7, 4, 0, 0, 7); g.fill();
    g.fillStyle = i === 0 ? '#e8e3d0' : '#2f6b3a'; g.beginPath(); g.arc(x + facing * 6, y - 4, 3, 0, 7); g.fill();
    g.fillStyle = '#f0a030'; g.fillRect(x + facing * 9 - (facing < 0 ? 3 : 0), y - 4, 3, 2);
  }
  // windmill sails
  const h = s.windmillHub;
  g.save(); g.translate(h.x, h.y); g.rotate(t / 1400);
  for (let i = 0; i < 4; i++) {
    g.rotate(Math.PI / 2);
    g.fillStyle = '#7a5230'; g.fillRect(-1.5, -66, 3, 66);
    g.fillStyle = '#f4ecdc'; g.fillRect(2, -64, 11, 50);
    g.strokeStyle = '#a08060'; g.lineWidth = 1;
    for (let y = -60; y < -14; y += 9) { g.beginPath(); g.moveTo(2, y); g.lineTo(13, y); g.stroke(); }
  }
  g.restore();
  g.fillStyle = '#5b3a20'; g.beginPath(); g.arc(h.x, h.y, 5, 0, 7); g.fill();
  // campfire
  const f = s.fire;
  for (let i = 0; i < 3; i++) {
    const fl = Math.sin(t / 90 + i * 2) * 3;
    g.fillStyle = ['#e74c3c', '#f39c12', '#f7dc6f'][i];
    g.beginPath(); g.moveTo(f.x - 9 + i * 3, f.y); g.lineTo(f.x + 9 - i * 3, f.y); g.lineTo(f.x + fl * 0.5, f.y - 20 + i * 5 + fl); g.closePath(); g.fill();
  }
  // chimney smoke
  for (const c of s.chimneys) smoke(g, c.x, c.y, t);
  smoke(g, f.x, f.y - 18, t + 700);
}

// Things above everyone's heads: drifting cloud shadows and a flock of birds.
export function drawSky(g, s, t) {
  const span = s.X1 - s.X0 + 800;
  for (let i = 0; i < 6; i++) {
    const x = s.X0 - 400 + ((i * 613 + t * 0.012) % span);
    const y = -700 + i * 420;
    g.fillStyle = 'rgba(20,40,20,.07)';
    g.beginPath(); g.ellipse(x, y, 160, 60, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(x + 90, y - 25, 110, 50, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(x - 100, y + 10, 90, 40, 0, 0, 7); g.fill();
  }
  const bx = s.X0 - 200 + ((t * 0.05) % span), by = -420 + Math.sin(t / 3000) * 40;
  g.strokeStyle = '#2b2b2b'; g.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    const x = bx - Math.abs(i - 2) * 22, y = by + (i - 2) * 18;
    const flap = Math.sin(t / 120 + i) * 4;
    g.beginPath(); g.moveTo(x - 7, y - flap); g.lineTo(x, y); g.lineTo(x + 7, y - flap); g.stroke();
  }
}

// ---------- painters ----------

function smoke(g, x, y, t) {
  for (let i = 0; i < 4; i++) {
    const p = ((t / 2600) + i / 4) % 1;
    g.fillStyle = `rgba(230,230,230,${0.55 * (1 - p)})`;
    g.beginPath(); g.arc(x + Math.sin(p * 6 + i) * 5, y - p * 50, 3 + p * 7, 0, 7); g.fill();
  }
}

function water(g, e, rnd, big) {
  g.fillStyle = '#d9c38f'; g.beginPath(); g.ellipse(e.cx, e.cy, e.rx + 18, e.ry + 14, 0, 0, 7); g.fill();
  g.fillStyle = '#4a8fc4'; g.beginPath(); g.ellipse(e.cx, e.cy, e.rx, e.ry, 0, 0, 7); g.fill();
  g.fillStyle = '#5fa3d6'; g.beginPath(); g.ellipse(e.cx - e.rx * 0.1, e.cy - e.ry * 0.15, e.rx * 0.65, e.ry * 0.55, 0, 0, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,.5)';
  for (let i = 0; i < (big ? 14 : 5); i++) g.fillRect(e.cx + (rnd() - 0.5) * e.rx * 1.3, e.cy + (rnd() - 0.5) * e.ry * 1.2, 10, 2);
  for (let i = 0; i < (big ? 9 : 3); i++) {
    const a = rnd() * 7, x = e.cx + Math.cos(a) * e.rx * 0.8, y = e.cy + Math.sin(a) * e.ry * 0.75;
    g.fillStyle = '#4f9541'; g.beginPath(); g.arc(x, y, 6, 0.4, 6); g.lineTo(x, y); g.fill();
    if (rnd() < 0.4) { g.fillStyle = '#f49ac1'; g.fillRect(x - 2, y - 2, 4, 4); }
  }
  g.fillStyle = '#3f7d34';
  for (let i = 0; i < (big ? 26 : 10); i++) {
    const a = rnd() * 7, x = e.cx + Math.cos(a) * (e.rx + 12), y = e.cy + Math.sin(a) * (e.ry + 10);
    g.fillRect(x, y - 10, 3, 12); g.fillRect(x + 4, y - 7, 3, 9);
  }
}

function farmFields(g, f, path) {
  const half = (f.w - 16) / 2, hh = (f.h - 16) / 2;
  const kinds = ['wheat', 'cabbage', 'stripes', 'pumpkin'];
  kinds.forEach((kind, i) => {
    const x = f.x + (i % 2) * (half + 16), y = f.y + Math.floor(i / 2) * (hh + 16);
    if (kind === 'wheat') {
      g.fillStyle = '#d9b44a'; g.fillRect(x, y, half, hh);
      g.fillStyle = '#c49a35'; for (let yy = y + 6; yy < y + hh; yy += 10) g.fillRect(x + 4, yy, half - 8, 3);
    } else if (kind === 'stripes') {
      for (let xx = x; xx < x + half; xx += 12) { g.fillStyle = ((xx - x) / 12) % 2 ? '#5d8f40' : '#76b356'; g.fillRect(xx, y, Math.min(12, x + half - xx), hh); }
    } else {
      g.fillStyle = '#7a5a3a'; g.fillRect(x, y, half, hh);
      g.fillStyle = '#6a4c30'; for (let yy = y + 8; yy < y + hh; yy += 16) g.fillRect(x + 4, yy + 4, half - 8, 3);
      g.fillStyle = kind === 'cabbage' ? '#7fc06a' : '#e67e22';
      for (let yy = y + 10; yy < y + hh - 4; yy += 16) for (let xx = x + 10; xx < x + half - 4; xx += 16) { g.beginPath(); g.arc(xx, yy, 5, 0, 7); g.fill(); }
    }
  });
  // fence, with a gap where the path leaves the fields
  g.fillStyle = '#8b5a2b';
  const post = (x, y) => g.fillRect(x - 2, y - 8, 4, 10);
  for (let x = f.x - 10; x <= f.x + f.w + 10; x += 20) { post(x, f.y - 10); if (Math.abs(x - path.x) > 24) post(x, f.y + f.h + 10); }
  for (let y = f.y - 10; y <= f.y + f.h + 10; y += 20) { post(f.x - 10, y); post(f.x + f.w + 10, y); }
  g.fillStyle = '#a0743f';
  g.fillRect(f.x - 10, f.y - 14, f.w + 20, 2);
  g.fillRect(f.x - 10, f.y + f.h + 6, path.x - 24 - f.x + 10, 2);
  g.fillRect(path.x + 24, f.y + f.h + 6, f.x + f.w + 10 - path.x - 24, 2);
}

function orchardTrees(g, o) {
  for (let row = 0; row < 3; row++) for (let col = 0; col < 7; col++) {
    const x = o.x + 30 + col * 70, y = o.y + 50 + row * 55;
    tree(g, x, y, 0.85, 'oak');
    g.fillStyle = '#e74c3c';
    for (let k = 0; k < 4; k++) g.fillRect(x - 8 + ((k * 7) % 16), y - 22 + ((k * 5) % 12), 4, 4);
  }
}

function meadowPatch(g, m, rnd) {
  for (let i = 0; i < 260; i++) {
    g.fillStyle = ['#f6e27f', '#f49ac1', '#ffffff', '#c3a6ff', '#ff8c69'][Math.floor(rnd() * 5)];
    g.fillRect(m.x + rnd() * m.w, m.y + rnd() * m.h, 4, 4);
  }
}

function pumpkinPatch(g, p) {
  g.fillStyle = '#7a5a3a'; g.fillRect(p.x, p.y, p.w, p.h);
  for (let y = p.y + 18; y < p.y + p.h; y += 28) for (let x = p.x + 18; x < p.x + p.w; x += 30) {
    g.fillStyle = '#4f8f3f'; g.fillRect(x - 10, y + 2, 20, 3);
    g.fillStyle = '#e67e22'; g.beginPath(); g.ellipse(x, y, 8, 6, 0, 0, 7); g.fill();
    g.fillStyle = '#5b3a20'; g.fillRect(x - 1, y - 9, 2, 4);
  }
}

function shadow(g, x, y, rx, ry) {
  g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill();
}

function tree(g, x, y, s, kind) {
  shadow(g, x + 3, y, 14 * s, 5 * s);
  g.fillStyle = '#6b4a2b'; g.fillRect(x - 3 * s, y - 12 * s, 6 * s, 12 * s);
  if (kind === 'pine') {
    for (let i = 0; i < 3; i++) {
      const w = (18 - i * 4) * s, top = y - (14 + i * 11) * s;
      g.fillStyle = i % 2 ? '#3a7d45' : '#2f6b3a';
      g.beginPath(); g.moveTo(x - w, top + 6 * s); g.lineTo(x + w, top + 6 * s); g.lineTo(x, top - 18 * s); g.closePath(); g.fill();
    }
  } else {
    const [dark, light] = kind === 'autumn' ? ['#c0692b', '#e08a3c'] : ['#3f7d34', '#4f9541'];
    g.fillStyle = dark; g.beginPath(); g.arc(x, y - 20 * s, 15 * s, 0, 7); g.fill();
    g.fillStyle = light; g.beginPath(); g.arc(x - 5 * s, y - 25 * s, 9 * s, 0, 7); g.fill();
  }
}

function rock(g, x, y, s) {
  shadow(g, x + 2, y + 2, s, s * 0.45);
  g.fillStyle = '#8d8d8d'; g.beginPath(); g.ellipse(x, y - s * 0.3, s, s * 0.7, 0, 0, 7); g.fill();
  g.fillStyle = '#a9a9a9'; g.beginPath(); g.ellipse(x - s * 0.25, y - s * 0.55, s * 0.5, s * 0.3, 0, 0, 7); g.fill();
}

function bush(g, x, y) {
  shadow(g, x, y + 2, 14, 4);
  g.fillStyle = '#4a8a3c';
  for (const [dx, dy, rr] of [[-7, -5, 7], [6, -5, 7], [0, -10, 8]]) { g.beginPath(); g.arc(x + dx, y + dy, rr, 0, 7); g.fill(); }
  g.fillStyle = '#e74c3c'; g.fillRect(x - 4, y - 12, 3, 3); g.fillRect(x + 5, y - 7, 3, 3);
}

function flowers(g, x, y, rnd) {
  for (let i = 0; i < 7; i++) {
    g.fillStyle = ['#f6e27f', '#f49ac1', '#ffffff', '#c3a6ff'][Math.floor(rnd() * 4)];
    g.fillRect(x + (rnd() - 0.5) * 30, y + (rnd() - 0.5) * 20, 4, 4);
  }
}

function cottage(g, x, y, roof) {
  shadow(g, x + 4, y + 2, 44, 8);
  g.fillStyle = '#efe1c4'; g.fillRect(x - 34, y - 40, 68, 40);
  g.fillStyle = '#d8c7a6'; g.fillRect(x - 34, y - 4, 68, 4);
  g.fillStyle = '#8a8a8a'; g.fillRect(x + 14, y - 84, 11, 22);
  g.fillStyle = roof;
  g.beginPath(); g.moveTo(x - 42, y - 36); g.lineTo(x + 42, y - 36); g.lineTo(x + 30, y - 70); g.lineTo(x - 30, y - 70); g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(x - 30, y - 72, 60, 4);
  g.fillStyle = 'rgba(255,255,255,.15)'; for (let yy = y - 64; yy < y - 38; yy += 8) g.fillRect(x - 36, yy, 72, 2);
  g.fillStyle = '#7a4e2d'; g.fillRect(x - 7, y - 22, 14, 22);
  g.fillStyle = '#f5c542'; g.fillRect(x + 3, y - 12, 2, 2);
  for (const wx of [x - 27, x + 15]) { g.fillStyle = '#5b3a20'; g.fillRect(wx - 1, y - 31, 14, 12); g.fillStyle = '#9fd3f0'; g.fillRect(wx + 1, y - 29, 10, 8); }
  return { x: x + 19, y: y - 86 };
}

function barnHouse(g, b) {
  const { x, y } = b;
  shadow(g, x + 6, y + 2, 66, 10);
  g.fillStyle = '#b5442f'; g.fillRect(x - 55, y - 60, 110, 60);
  g.fillStyle = '#6b2a20';
  g.beginPath(); g.moveTo(x - 64, y - 54); g.lineTo(x + 64, y - 54); g.lineTo(x + 40, y - 100); g.lineTo(x - 40, y - 100); g.closePath(); g.fill();
  g.fillStyle = '#fff3e0'; g.fillRect(x - 22, y - 44, 44, 44);
  g.fillStyle = '#b5442f'; g.fillRect(x - 18, y - 40, 36, 40);
  g.strokeStyle = '#fff3e0'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(x - 18, y - 40); g.lineTo(x + 18, y); g.moveTo(x + 18, y - 40); g.lineTo(x - 18, y); g.stroke();
  g.fillStyle = '#e8c35a'; g.fillRect(x - 90, y - 18, 22, 18); g.fillRect(x - 86, y - 30, 14, 12);
}

function silo(g, x, y) {
  shadow(g, x + 3, y + 2, 22, 6);
  g.fillStyle = '#b8b8b8'; g.fillRect(x - 18, y - 90, 36, 90);
  g.fillStyle = '#d0d0d0'; g.fillRect(x - 12, y - 90, 8, 90);
  g.fillStyle = '#8a8a8a'; g.beginPath(); g.ellipse(x, y - 90, 18, 9, 0, Math.PI, 0); g.fill();
}

function windmillTower(g, w) {
  const { x, y } = w;
  shadow(g, x + 4, y + 2, 32, 8);
  g.fillStyle = '#d9cdb5';
  g.beginPath(); g.moveTo(x - 26, y); g.lineTo(x + 26, y); g.lineTo(x + 15, y - 90); g.lineTo(x - 15, y - 90); g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,.1)'; for (let yy = y - 80; yy < y; yy += 14) g.fillRect(x - 24, yy, 48, 2);
  g.fillStyle = '#7a4e2d'; g.fillRect(x - 7, y - 22, 14, 22); g.fillRect(x - 5, y - 60, 10, 10);
  g.fillStyle = '#6b4a2b'; g.beginPath(); g.ellipse(x, y - 92, 20, 12, 0, Math.PI, 0); g.fill();
}

function well(g, x, y) {
  shadow(g, x, y + 2, 22, 6);
  g.fillStyle = '#9a9a9a'; g.beginPath(); g.ellipse(x, y - 6, 18, 10, 0, 0, 7); g.fill();
  g.fillStyle = '#2b4a6b'; g.beginPath(); g.ellipse(x, y - 8, 11, 5, 0, 0, 7); g.fill();
  g.fillStyle = '#6b4a2b'; g.fillRect(x - 18, y - 38, 4, 32); g.fillRect(x + 14, y - 38, 4, 32);
  g.fillStyle = '#a8443a'; g.fillRect(x - 24, y - 44, 48, 8);
}

function tent(g, x, y) {
  shadow(g, x + 4, y + 2, 42, 8);
  g.fillStyle = '#d9773b';
  g.beginPath(); g.moveTo(x - 40, y); g.lineTo(x + 40, y); g.lineTo(x, y - 54); g.closePath(); g.fill();
  g.fillStyle = '#7a3b1c';
  g.beginPath(); g.moveTo(x - 11, y); g.lineTo(x + 11, y); g.lineTo(x, y - 32); g.closePath(); g.fill();
  g.fillStyle = '#9a9a9a';
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; g.beginPath(); g.arc(x + 80 + Math.cos(a) * 16, y + 50 + Math.sin(a) * 7, 4, 0, 7); g.fill(); }
  g.fillStyle = '#6b4a2b'; g.fillRect(x + 70, y + 46, 20, 4);
}

function log(g, x, y) {
  shadow(g, x, y + 3, 20, 4);
  g.fillStyle = '#7a5230'; g.fillRect(x - 18, y - 8, 36, 10);
  g.fillStyle = '#c49a6c'; g.beginPath(); g.ellipse(x + 18, y - 3, 3, 5, 0, 0, 7); g.fill();
}

function dock(g, x, y) {
  g.fillStyle = '#8b5a2b'; g.fillRect(x - 12, y, 24, 64);
  g.fillStyle = '#6b4a2b'; for (let yy = y + 6; yy < y + 64; yy += 8) g.fillRect(x - 12, yy, 24, 2);
  g.fillStyle = '#5b3a20'; g.fillRect(x - 14, y - 2, 4, 8); g.fillRect(x + 10, y - 2, 4, 8);
}

function bridge(g, x, y) {
  shadow(g, x + 4, y + 4, 34, 40);
  g.fillStyle = '#a0743f'; g.fillRect(x - 24, y - 46, 48, 92);
  g.fillStyle = '#8b5a2b'; for (let yy = y - 42; yy < y + 46; yy += 9) g.fillRect(x - 24, yy, 48, 2);
  g.fillStyle = '#6b4a2b'; g.fillRect(x - 28, y - 48, 5, 96); g.fillRect(x + 23, y - 48, 5, 96);
}

function signpost(g, x, y, text) {
  shadow(g, x, y + 2, 10, 3);
  g.fillStyle = '#6b4a2b'; g.fillRect(x - 3, y - 40, 6, 40);
  g.font = 'bold 12px ui-monospace, Menlo, monospace';
  const w = g.measureText(text).width + 16;
  g.fillStyle = '#a0743f'; g.fillRect(x - w / 2, y - 56, w, 22);
  g.strokeStyle = '#5b3a20'; g.lineWidth = 2; g.strokeRect(x - w / 2, y - 56, w, 22);
  g.fillStyle = '#fff8e8'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y - 44);
}

function beehive(g, x, y) {
  shadow(g, x, y + 2, 12, 4);
  g.fillStyle = '#e8c35a'; g.fillRect(x - 10, y - 26, 20, 26);
  g.fillStyle = '#c49a35'; g.fillRect(x - 10, y - 18, 20, 2); g.fillRect(x - 10, y - 9, 20, 2);
  g.fillStyle = '#8a6a4a'; g.fillRect(x - 12, y - 30, 24, 5);
  g.fillStyle = '#3a2a1a'; g.fillRect(x - 2, y - 5, 4, 3);
}
