// Построение 3D-геометрии: стены, окна, оборудование.
// Единицы сцены — метры; данные — миллиметры.
import * as THREE from 'three';
import { Stock, goodsPlan, PRODUCE } from './goods.js';

export const M = 0.001;

// ---------------------------------------------------------------- материалы и текстуры
const mats = new Map();
export function mat(color, o = {}) {
  const key = color + JSON.stringify(o);
  if (mats.has(key)) return mats.get(key);
  const m = new THREE.MeshLambertMaterial({ color, ...o });
  mats.set(key, m);
  return m;
}
const glassMat = new THREE.MeshPhongMaterial({
  color: 0xbfe0ff, transparent: true, opacity: 0.22, shininess: 90, specular: 0xffffff, side: THREE.DoubleSide, depthWrite: false,
});
const darkGlass = new THREE.MeshPhongMaterial({ color: 0x222831, shininess: 60, specular: 0x666666 });

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function hash(str) {
  let h = 2166136261;
  for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const prodTex = new Map();
// "Товар на полке": ряд упаковок разной высоты и цвета
function productTexture(seed, kind = 'pack') {
  const key = kind + seed % 6;
  if (prodTex.has(key)) return prodTex.get(key);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  const r = rng(seed % 6 + 7);
  g.fillStyle = '#3b3f46'; g.fillRect(0, 0, 256, 64);
  let x = 0;
  const pal = kind === 'bottle'
    ? ['#2e7d32', '#1565c0', '#f9a825', '#c62828', '#6d4c41', '#00838f', '#ad1457', '#ef6c00']
    : ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#f4f4f4', '#6d4c41', '#00acc1', '#d81b60'];
  while (x < 256) {
    const w = kind === 'bottle' ? 9 + r() * 6 : 12 + r() * 22;
    const h = (kind === 'bottle' ? 0.75 : 0.55) * 64 + r() * 0.4 * 64;
    const col = pal[Math.floor(r() * pal.length)];
    g.fillStyle = col;
    if (kind === 'bottle') {
      g.fillRect(x + 1, 64 - h * 0.78, w - 2, h * 0.78);
      g.fillRect(x + w / 2 - 2, 64 - h, 4, h * 0.25);
    } else {
      g.fillRect(x + 1, 64 - h, w - 2, h);
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.fillRect(x + 3, 64 - h + 5, w - 6, 4);
    }
    x += w;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  prodTex.set(key, t);
  return t;
}
function prodMat(seed, W, kind) {
  const t = productTexture(seed, kind).clone();
  t.repeat.set(Math.max(1, W / 0.3), 1);
  t.needsUpdate = true;
  return new THREE.MeshLambertMaterial({ map: t });
}

const textTexCache = new Map();
export function textTexture(text, { bg = '#ffffff', fg = '#1d2330', w = 512, h = 96, bold = true, size = 0.56 } = {}) {
  const key = [text, bg, fg, w, h, bold, size].join('|');
  if (textTexCache.has(key)) return textTexCache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); } else g.clearRect(0, 0, w, h);
  g.fillStyle = fg;
  let fs = Math.floor(h * size);
  g.font = `${bold ? 700 : 500} ${fs}px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
  while (g.measureText(text).width > w * 0.92 && fs > 10) {
    fs -= 2;
    g.font = `${bold ? 700 : 500} ${fs}px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  textTexCache.set(key, t);
  return t;
}
function signPlane(text, W, Hs, bg, fg) {
  const px = Math.max(256, Math.min(1024, Math.round(W / Hs * 96)));
  const t = textTexture(text, { bg, fg, w: px, h: 96 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(W, Hs), new THREE.MeshBasicMaterial({ map: t, transparent: !bg }));
  return m;
}

function box(W, H, D, material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(W, 0.001), Math.max(H, 0.001), Math.max(D, 0.001)), material);
  m.position.set(x, y + H / 2, z);
  if (shadow) { m.castShadow = true; m.receiveShadow = true; }
  return m;
}
function lighten(hex, k) {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color('#ffffff'), k);
  return '#' + c.getHexString();
}
function darken(hex, k) {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color('#000000'), k);
  return '#' + c.getHexString();
}
function contrastText(hex) {
  const c = new THREE.Color(hex);
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) > 0.6 ? '#1d2330' : '#ffffff';
}

// ---------------------------------------------------------------- строители (лицевая сторона +Z, низ в 0)
const B = {};
function stockFor(p, W) { return new Stock(hash(`${p.sign || ''}|${p.label || ''}|${(p.cats || []).join()}|${W.toFixed(2)}`)); }
function addStock(g, st) {
  const m = st.build();
  m.traverse(o => { if (o.isInstancedMesh) o.raycast = () => {}; }); // выбор объекта идет по корпусу
  g.add(m);
}

B.shelf = (W, D, H, p) => {
  const g = new THREE.Group();
  const col = p.color || '#c9d6df';
  const frame = mat(darken(col, 0.15));
  g.add(box(W, 0.1, D - 0.02, mat('#4b4f57'), 0, 0, 0));
  g.add(box(W, H, 0.04, mat(col), 0, 0, -D / 2 + 0.02));
  g.add(box(0.03, H, D, frame, -W / 2 + 0.015, 0, 0));
  g.add(box(0.03, H, D, frame, W / 2 - 0.015, 0, 0));
  const n = H > 2000 ? 6 : H > 1700 ? 5 : H > 1300 ? 4 : 3;
  const gap = (H - 0.16) / n;
  const st = stockFor(p, W), plan = goodsPlan(p, n);
  for (let i = 0; i < n; i++) {
    const y = 0.1 + i * gap;
    g.add(box(W - 0.06, 0.02, D - 0.06, mat('#eceff3'), 0, y, 0.01, false));
    st.shelf(plan[i], -W / 2 + 0.035, W / 2 - 0.035, y + 0.02, D / 2 - 0.03, -D / 2 + 0.05, gap - 0.04, { rows: 3 });
  }
  addStock(g, st);
  if (p.sign) {
    const s = signPlane(p.sign, W - 0.02, 0.16, col, contrastText(col));
    s.position.set(0, H + 0.1, D / 2 - 0.04);
    g.add(s);
    g.add(box(W - 0.02, 0.18, 0.03, mat(col), 0, H + 0.01, D / 2 - 0.07, false));
  }
  return g;
};

B.cold = (W, D, H, p) => {
  const g = new THREE.Group();
  const col = p.color || '#9fb3ff';
  const shell = mat('#e9edf2');
  g.add(box(W, 0.28, D, mat('#c9ced6'), 0, 0, 0));
  g.add(box(W, H, 0.06, mat('#d8dde4'), 0, 0, -D / 2 + 0.03));
  g.add(box(0.05, H, D, shell, -W / 2 + 0.025, 0, 0));
  g.add(box(0.05, H, D, shell, W / 2 - 0.025, 0, 0));
  g.add(box(W, 0.24, D, mat(col), 0, H - 0.24, 0));
  const n = 4, top = H - 0.32, bot = 0.32, gap = (top - bot) / n;
  const st = stockFor(p, W), plan = goodsPlan(p, n);
  for (let i = 0; i < n; i++) {
    const y = bot + i * gap;
    g.add(box(W - 0.1, 0.02, D - 0.16, mat('#f4f6f8'), 0, y, -0.03, false));
    st.shelf(plan[i], -W / 2 + 0.06, W / 2 - 0.06, y + 0.02, D / 2 - 0.12, -D / 2 + 0.1, gap - 0.05, { rows: 3 });
  }
  addStock(g, st);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, H - 0.52), glassMat);
  glass.position.set(0, 0.28 + (H - 0.52) / 2, D / 2 - 0.01);
  g.add(glass);
  const doors = Math.max(1, Math.round(W / 0.65));
  for (let i = 0; i <= doors; i++) {
    const x = -W / 2 + 0.05 + i * (W - 0.1) / doors;
    g.add(box(0.025, H - 0.52, 0.025, mat('#9aa3ad'), x, 0.28, D / 2 - 0.01, false));
  }
  if (p.sign) {
    const s = signPlane(p.sign, W * 0.92, 0.17, col, contrastText(col));
    s.position.set(0, H - 0.12, D / 2 + 0.003);
    g.add(s);
  }
  return g;
};

B.fridge = (W, D, H, p) => {
  const g = new THREE.Group();
  const col = p.color || '#1f5fbf';
  const body = mat(col);
  g.add(box(W, 0.12, D, mat('#333'), 0, 0, 0));
  g.add(box(W, H - 0.12, 0.05, body, 0, 0.12, -D / 2 + 0.025));
  g.add(box(0.05, H - 0.12, D, body, -W / 2 + 0.025, 0.12, 0));
  g.add(box(0.05, H - 0.12, D, body, W / 2 - 0.025, 0.12, 0));
  const topH = Math.min(0.22, H * 0.15);
  g.add(box(W, topH, D, body, 0, H - topH, 0));
  const n = Math.max(2, Math.round((H - 0.4) / 0.33));
  const gap = (H - topH - 0.18) / n;
  const st = stockFor(p, W), plan = goodsPlan(p, n);
  for (let i = 0; i < n; i++) {
    const y = 0.14 + i * gap;
    g.add(box(W - 0.1, 0.015, D - 0.12, mat('#eef1f4'), 0, y, -0.02, false));
    st.shelf(plan[i], -W / 2 + 0.06, W / 2 - 0.06, y + 0.015, D / 2 - 0.05, -D / 2 + 0.08, gap - 0.03, { rows: 4 });
  }
  addStock(g, st);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.08, H - topH - 0.14), glassMat);
  glass.position.set(0, 0.12 + (H - topH - 0.14) / 2, D / 2 - 0.005);
  g.add(glass);
  if (p.sign) {
    const s = signPlane(p.sign, W * 0.9, topH * 0.8, col, contrastText(col));
    s.position.set(0, H - topH / 2, D / 2 + 0.003);
    g.add(s);
  }
  return g;
};

B.chest = (W, D, H, p) => {
  const g = new THREE.Group();
  const col = p.color || '#9fdcff';
  const wall = mat('#f1f4f7');
  const t = 0.05;
  g.add(box(W, 0.12, D, mat('#8b929b'), 0, 0, 0));
  g.add(box(W, H - 0.12, t, wall, 0, 0.12, -D / 2 + t / 2));
  g.add(box(W, H - 0.12, t, wall, 0, 0.12, D / 2 - t / 2));
  g.add(box(t, H - 0.12, D, wall, -W / 2 + t / 2, 0.12, 0));
  g.add(box(t, H - 0.12, D, wall, W / 2 - t / 2, 0.12, 0));
  g.add(box(W - 0.01, 0.12, D + 0.004, mat(col), 0, 0.25, 0, false));
  g.add(box(W - 2 * t, H - 0.32, D - 2 * t, mat('#dfe7ee'), 0, 0.12, 0, false));
  const st = stockFor(p, W), plan = goodsPlan(p, 2);
  const mid = 0;
  st.shelf(plan[0], -W / 2 + t + 0.01, (plan[0] === plan[1] ? W / 2 : mid) - t - 0.01, H - 0.2, D / 2 - t - 0.01, -D / 2 + t + 0.01, 0.12, { rows: 6 });
  if (plan[0] !== plan[1]) st.shelf(plan[1], mid + 0.01, W / 2 - t - 0.01, H - 0.2, D / 2 - t - 0.01, -D / 2 + t + 0.01, 0.12, { rows: 6 });
  addStock(g, st);
  const lid = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.06, D - 0.06), glassMat);
  lid.rotation.x = -Math.PI / 2;
  lid.position.set(0, H - 0.01, 0);
  g.add(lid);
  if (p.sign) {
    const s = signPlane(p.sign, Math.min(W * 0.8, 1.2), 0.12, col, contrastText(col));
    s.position.set(0, 0.31 + 0.12, D / 2 + 0.003);
    g.add(s);
  }
  return g;
};

B.fresh = (W, D, H, p) => {
  const g = new THREE.Group();
  const col = p.color || '#5cc95c';
  const wood = mat('#b98652');
  g.add(box(W, H, 0.05, wood, 0, 0, -D / 2 + 0.025));
  const st = stockFor(p, W);
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const depth = (D - 0.05) / tiers;
    const z = D / 2 - depth * (i + 0.5);
    const top = 0.55 + i * 0.28;
    g.add(box(W - 0.02, top, depth, wood, 0, 0, z));
    const crate = box(W - 0.08, 0.1, depth - 0.06, mat(col), 0, top, z);
    g.add(crate);
    const kinds = PRODUCE[(p.cats || [])[0]] || PRODUCE['Фрукты'];
    const crates = W > 1 ? 2 : 1;
    for (let c = 0; c < crates; c++) {
      const cx0 = -W / 2 + 0.05 + c * (W - 0.1) / crates, cx1 = cx0 + (W - 0.1) / crates - 0.02;
      if (crates > 1) g.add(box(0.02, 0.13, depth - 0.06, mat(darken(col, 0.25)), cx1 + 0.01, top, z, false));
      st.pile(kinds[(i * crates + c) % kinds.length], cx0, cx1, z - depth / 2 + 0.04, z + depth / 2 - 0.04, top + 0.1);
    }
  }
  addStock(g, st);
  if (p.sign) {
    const s = signPlane(p.sign, W * 0.9, 0.18, col, contrastText(col));
    s.position.set(0, H - 0.15, -D / 2 + 0.055);
    g.add(s);
  }
  return g;
};

B.box = (W, D, H, p) => {
  const g = new THREE.Group();
  const col = p.color || '#bbb';
  g.add(box(W, H, D, mat(col), 0, 0, 0));
  if (p.sign) {
    const hs = Math.min(0.22, H * 0.4, W * 0.5);
    const s = signPlane(p.sign, Math.min(W * 0.9, 1.2), hs, col, contrastText(col));
    s.position.set(0, H - hs * 0.9, D / 2 + 0.003);
    g.add(s);
  }
  return g;
};
B.spine = (W, D, H, p) => { const g = new THREE.Group(); g.add(box(W, H, D, mat(p.color || '#999'))); return g; };
B.counter = (W, D, H, p) => {
  const g = new THREE.Group();
  const col = p.color || '#ddd';
  g.add(box(W, H - 0.04, D, mat(col)));
  g.add(box(W + 0.02, 0.04, D + 0.02, mat(lighten(col, 0.4)), 0, H - 0.04, 0));
  return g;
};
B.belt = (W, D, H, p) => {
  const g = B.counter(W, D, H, p);
  const bw = Math.min(W, D) * 0.6;
  const long = W > D;
  g.add(box(long ? W - 0.1 : bw, 0.012, long ? bw : D - 0.1, mat('#1b1b1b'), 0, H, 0, false));
  return g;
};
B.kiosk = (W, D, H, p) => {
  const g = new THREE.Group();
  g.add(box(W * 0.75, 0.9, D * 0.55, mat('#8e959e')));
  g.add(box(W * 0.75 + 0.04, 0.03, D * 0.55 + 0.04, mat('#d7dbe0'), 0, 0.9, 0));
  g.add(box(0.08, H - 1.15, 0.08, mat('#555'), 0, 0.93, -D * 0.15));
  const scr = box(0.48, 0.34, 0.04, darkGlass, 0, 0, 0);
  scr.position.set(0, H - 0.2, -D * 0.1);
  scr.rotation.x = -0.35;
  g.add(scr);
  return g;
};
B.coffee = (W, D, H, p) => {
  const g = new THREE.Group();
  g.add(box(W, H, D, mat('#2b2b2b')));
  g.add(box(W * 0.6, H * 0.25, 0.02, mat('#c0c0c0'), 0, H * 0.55, D / 2));
  return g;
};
B.chair = (W, D, H, p) => {
  const g = new THREE.Group();
  const c = mat(p.color || '#cfcfcf');
  const s = Math.min(W, D, 0.5);
  g.add(box(0.05, 0.42, 0.05, mat('#555'), 0, 0.02, 0));
  g.add(box(s, 0.07, s, c, 0, 0.44, 0));
  g.add(box(s, Math.max(0.2, H - 0.5), 0.06, c, 0, 0.5, -s / 2 + 0.03));
  g.add(box(s * 0.9, 0.03, s * 0.9, mat('#555'), 0, 0, 0, false));
  return g;
};
B.table = (W, D, H, p) => {
  const g = new THREE.Group();
  g.add(box(W, 0.04, D, mat(p.color || '#f2f2f2'), 0, H - 0.04, 0));
  const leg = mat('#666');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.04, H - 0.04, 0.04, leg, sx * (W / 2 - 0.05), 0, sz * (D / 2 - 0.05)));
  return g;
};
B.toilet = (W, D, H, p) => {
  const g = new THREE.Group();
  const w = mat('#fafafa');
  g.add(box(0.36, 0.4, Math.min(D, 0.55), w, 0, 0, 0.05));
  g.add(box(0.38, 0.38, 0.16, w, 0, 0.4, -D / 2 + 0.1));
  return g;
};
B.sink = (W, D, H, p) => {
  const g = new THREE.Group();
  g.add(box(W, H - 0.05, D, mat('#d8c08a')));
  g.add(box(W, 0.05, D, mat('#fafafa'), 0, H - 0.05, 0));
  g.add(box(0.03, 0.18, 0.03, mat('#aaa'), 0, H, -D / 2 + 0.06));
  return g;
};
B.rack = (W, D, H, p) => {
  const g = new THREE.Group();
  g.add(box(W, H, D, mat('#20242a')));
  for (let y = 0.15; y < H - 0.1; y += 0.12) g.add(box(W * 0.8, 0.02, 0.01, mat('#3cb371'), 0, y, D / 2 + 0.002, false));
  return g;
};
B.radiator = (W, D, H, p) => {
  const g = new THREE.Group();
  const c = mat(p.color || '#c9a79a');
  const long = W >= D;
  const L = long ? W : D;
  const n = Math.max(3, Math.floor(L / 0.08));
  for (let i = 0; i < n; i++) {
    const o = -L / 2 + (i + 0.5) * L / n;
    g.add(long ? box(L / n * 0.7, H, D, c, o, 0, 0) : box(W, H, L / n * 0.7, c, 0, 0, o));
  }
  return g;
};
B.panel = (W, D, H, p) => {
  const g = new THREE.Group();
  const col = p.color || '#b77cff';
  g.add(box(W, H, D, mat(col)));
  if (p.sign) {
    const s = signPlane(p.sign, W * 0.9, Math.min(0.4, W * 0.12), col, contrastText(col));
    s.position.set(0, H * 0.6, D / 2 + 0.003);
    g.add(s);
  }
  return g;
};
B.baskets = (W, D, H, p) => {
  const g = new THREE.Group();
  const c = mat(p.color || '#d33');
  for (let i = 0; i < 6; i++) g.add(box(W * 0.9, 0.08, D * 0.9, c, 0, i * 0.09, 0));
  return g;
};
B.tobacco = (W, D, H, p) => {
  const g = new THREE.Group();
  g.add(box(W, H, D, mat('#2f2f33')));
  const st = stockFor({ sign: 'Табак' }, W);
  for (let y = 0.9; y < H - 0.15; y += 0.14) {
    g.add(box(W - 0.06, 0.01, D - 0.04, mat('#55555c'), 0, y - 0.01, 0, false));
    st.shelf('cig', -W / 2 + 0.04, W / 2 - 0.04, y, D / 2 + 0.002, D / 2 - 0.1, 0.11, { rows: 2 });
  }
  addStock(g, st);
  if (p.sign) {
    const s = signPlane(p.sign, W * 0.6, 0.14, '#2f2f33', '#ffffff');
    s.position.set(0, H - 0.1, D / 2 + 0.004);
    g.add(s);
  }
  return g;
};
B.roll = (W, D, H, p) => {
  const g = new THREE.Group();
  g.add(box(W, 0.06, D, mat('#888'), 0, 0.08, 0));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H - 0.14, D, 3, 6, 3)),
    new THREE.LineBasicMaterial({ color: 0x8a8f96 }));
  edges.position.y = 0.14 + (H - 0.14) / 2;
  g.add(edges);
  g.add(box(W * 0.8, H * 0.5, D * 0.7, mat(p.color || '#e8b4b4'), 0, 0.14, 0));
  return g;
};
B.bin = (W, D, H, p) => {
  const g = new THREE.Group();
  const c = mat(p.color || '#ffcc33');
  const t = 0.03;
  g.add(box(W, 0.05, D, c));
  g.add(box(W, H, t, c, 0, 0, -D / 2 + t / 2));
  g.add(box(W, H, t, c, 0, 0, D / 2 - t / 2));
  g.add(box(t, H, D, c, -W / 2 + t / 2, 0, 0));
  g.add(box(t, H, D, c, W / 2 - t / 2, 0, 0));
  g.add(box(W - 2 * t, H * 0.55, D - 2 * t, mat('#e0c070'), 0, 0.05, 0, false));
  const st = stockFor(p, W), plan = goodsPlan(p, 1);
  st.shelf(plan[0], -W / 2 + t, W / 2 - t, H * 0.6, D / 2 - t, -D / 2 + t, H * 0.4, { rows: 6 });
  addStock(g, st);
  if (p.sign) {
    const s = signPlane(p.sign, W * 0.8, 0.14, p.color || '#ffcc33', '#1d2330');
    s.position.set(0, H - 0.2, D / 2 + 0.003);
    g.add(s);
  }
  return g;
};
B.pallet = (W, D, H, p) => {
  const g = new THREE.Group();
  g.add(box(W, 0.14, D, mat('#c49a5a')));
  g.add(box(W * 0.96, H - 0.14, D * 0.96, prodMat(hash('pal'), W, 'pack'), 0, 0.14, 0));
  if (p.sign) {
    const s = signPlane(p.sign, W * 0.8, 0.16, '#ffcc33', '#1d2330');
    s.position.set(0, H + 0.12, 0);
    g.add(s);
  }
  return g;
};

const FACE_ROT = { '+z': 0, '-z': Math.PI, '+x': Math.PI / 2, '-x': -Math.PI / 2 };

export function buildPart(p) {
  const face = p.face || '+z';
  let W = p.w * M, D = p.d * M;
  if (face === '+x' || face === '-x') [W, D] = [D, W];
  const fn = B[p.kind] || B.box;
  const g = fn(W, D, p.h * M, p);
  g.rotation.y = FACE_ROT[face];
  g.position.set(p.x * M, (p.y0 || 0) * M, p.z * M);
  return g;
}

export function buildItem(item) {
  const g = new THREE.Group();
  g.name = item.id;
  const inner = new THREE.Group();
  for (const p of item.parts) inner.add(buildPart(p));
  g.add(inner);
  // рамка выделения
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = 0;
  for (const p of item.parts) {
    x0 = Math.min(x0, p.x - p.w / 2); x1 = Math.max(x1, p.x + p.w / 2);
    z0 = Math.min(z0, p.z - p.d / 2); z1 = Math.max(z1, p.z + p.d / 2);
    y1 = Math.max(y1, (p.y0 || 0) + p.h);
  }
  const bw = (x1 - x0) * M + 0.04, bd = (z1 - z0) * M + 0.04, bh = Math.max(y1 * M, 0.1) + 0.04;
  const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(bw, bh, bd)),
    new THREE.LineBasicMaterial({ color: 0x1e5bd8, depthTest: false, transparent: true }));
  frame.position.set((x0 + x1) / 2 * M, bh / 2 - 0.02, (z0 + z1) / 2 * M);
  frame.renderOrder = 10;
  frame.visible = false;
  frame.userData.isFrame = true;
  g.add(frame);
  const foot = new THREE.Mesh(new THREE.PlaneGeometry(bw, bd), new THREE.MeshBasicMaterial({ color: 0x1e5bd8, transparent: true, opacity: 0.18, depthWrite: false }));
  foot.rotation.x = -Math.PI / 2;
  foot.position.set((x0 + x1) / 2 * M, 0.006, (z0 + z1) / 2 * M);
  foot.visible = false;
  foot.userData.isFrame = true;
  g.add(foot);
  g.userData.frame = frame;
  g.userData.foot = foot;
  g.userData.topY = y1 * M;
  g.userData.centerLocal = new THREE.Vector3((x0 + x1) / 2 * M, 0, (z0 + z1) / 2 * M);
  return g;
}

// ---------------------------------------------------------------- здание
function shapeFrom(pts, holes = []) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * M, y * M)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x * M, y * M))));
  return s;
}

export function buildBuilding(data) {
  const root = new THREE.Group();
  const C = data.meta.ceiling * M;
  // пол
  const floorTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#e9e6df'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#e2ded5'; g.fillRect(0, 0, 128, 128); g.fillRect(128, 128, 128, 128);
    g.strokeStyle = '#cfc9bd'; g.lineWidth = 2; g.strokeRect(0, 0, 256, 256); g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 1.2, 1 / 1.2); t.anisotropy = 8;
    return t;
  })();
  const fg = new THREE.ShapeGeometry(shapeFrom(data.floor));
  fg.rotateX(Math.PI / 2);
  const floor = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ map: floorTex, side: THREE.DoubleSide }));
  floor.receiveShadow = true;
  floor.position.y = 0.001;
  floor.name = 'floor';
  root.add(floor);
  const b = data.meta.bounds;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshLambertMaterial({ color: 0xd4d7dc }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((b[0] + b[2]) / 2 * M, -0.01, (b[1] + b[3]) / 2 * M);
  ground.receiveShadow = true;
  root.add(ground);
  // стены
  const walls = new THREE.Group();
  walls.name = 'walls';
  const wm = { struct: mat('#b9bcc2'), part: mat('#f3f1ec'), fire: mat('#ead7ea') };
  for (const w of data.walls) {
    const geo = new THREE.ExtrudeGeometry(shapeFrom(w.pts, w.holes), { depth: w.h * M, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, w.h * M, 0);
    const m = new THREE.Mesh(geo, wm[w.kind] || wm.part);
    m.castShadow = true; m.receiveShadow = true;
    walls.add(m);
  }
  // фасад: остекление, подоконные и надоконные участки
  for (const w of data.windows) {
    const L = (w.x1 - w.x0) * M, cx = (w.x0 + w.x1) / 2 * M, z = w.y * M;
    const segs = w.door ? [[w.x0, w.door[0]], [w.door[1], w.x1]] : [[w.x0, w.x1]];
    for (const [a, c] of segs) {
      const gl = new THREE.Mesh(new THREE.PlaneGeometry((c - a) * M, w.h * M), glassMat);
      gl.position.set((a + c) / 2 * M, (w.sill + w.h / 2) * M, z);
      walls.add(gl);
      for (const x of [a, c]) walls.add(box(0.05, w.h * M, 0.08, mat('#5b6068'), x * M, w.sill * M, z));
    }
    if (w.door) {
      const dw = (w.door[1] - w.door[0]) * M, dh = 2.1;
      const dg = new THREE.Mesh(new THREE.PlaneGeometry(dw, w.h * M - dh), glassMat);
      dg.position.set((w.door[0] + w.door[1]) / 2 * M, dh + (w.h * M - dh) / 2, z);
      walls.add(dg);
      walls.add(box(dw, 0.06, 0.1, mat('#5b6068'), (w.door[0] + w.door[1]) / 2 * M, dh, z));
    }
    walls.add(box(L, 0.05, 0.1, mat('#5b6068'), cx, w.sill * M + w.h * M, z));
    if (w.sill > 0) walls.add(box(L, w.sill * M, 0.2, mat('#b9bcc2'), cx, 0, z));
    const top = (w.sill + w.h) * M;
    if (w.kind !== 'glass' && top < C) walls.add(box(L, C - top, 0.2, mat('#b9bcc2'), cx, top, z));
  }
  for (const l of data.lintels || []) {
    walls.add(box((l.x1 - l.x0) * M, C - l.y0h * M, (l.y1 - l.y0) * M, wm.struct, (l.x0 + l.x1) / 2 * M, l.y0h * M, (l.y0 + l.y1) / 2 * M));
  }
  root.add(walls);
  // ригели
  const beams = new THREE.Group();
  beams.name = 'beams';
  const bm = new THREE.MeshLambertMaterial({ color: 0xe8c547, transparent: true, opacity: 0.55, depthWrite: false });
  for (const bb of data.beams) {
    const [x0, y0, x1, y1] = bb.b;
    const m = box((x1 - x0) * M, C - bb.y0 * M, (y1 - y0) * M, bm, (x0 + x1) / 2 * M, bb.y0 * M, (y0 + y1) / 2 * M, false);
    beams.add(m);
  }
  root.add(beams);
  // надписи на полу
  const labels = new THREE.Group();
  labels.name = 'floorLabels';
  for (const l of data.labels) {
    const t = textTexture(l.t, { bg: null, fg: 'rgba(60,66,80,0.55)', w: 1024, h: 128, size: 0.6 });
    const W = 3.6 * l.s, H = W / 8;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(l.x * M, 0.004, l.y * M);
    labels.add(m);
  }
  for (const d of data.decals) {
    const [x0, y0, x1, y1] = d.b;
    const W = (x1 - x0) * M, D = (y1 - y0) * M;
    let material;
    if (d.kind === 'evac') {
      const c = document.createElement('canvas'); c.width = 64; c.height = 256;
      const g = c.getContext('2d');
      g.fillStyle = '#4caf50';
      for (let i = 0; i < 3; i++) { const y = 20 + i * 80; g.beginPath(); g.moveTo(8, y + 50); g.lineTo(32, y); g.lineTo(56, y + 50); g.lineTo(56, y + 70); g.lineTo(32, y + 22); g.lineTo(8, y + 70); g.fill(); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      material = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
    } else material = new THREE.MeshLambertMaterial({ color: 0x4a4f57 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W, D), material);
    m.rotation.x = -Math.PI / 2;
    if (d.kind === 'evac') m.rotation.z = Math.PI;
    m.position.set((x0 + x1) / 2 * M, 0.005, (y0 + y1) / 2 * M);
    m.receiveShadow = true;
    labels.add(m);
  }
  root.add(labels);
  return { root, walls, beams, labels, floor };
}
