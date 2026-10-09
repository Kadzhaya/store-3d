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
// Стопка пластиковых корзин на подставке: сужающиеся ящики с решеткой и ручками
B.baskets = (W, D, H, p) => {
  const g = new THREE.Group();
  const col = p.color || '#d32f2f';
  const pl = new THREE.MeshLambertMaterial({ color: col, side: THREE.DoubleSide });
  const bw = Math.min(W, 0.46), bd = Math.min(D, 0.33), bh = 0.22;
  // подставка с табличкой «Корзины»
  g.add(box(bw + 0.06, 0.04, bd + 0.06, mat('#3a3d42'), 0, 0.04, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cylY(0.018, 0.018, 0.04, mat('#222'), sx * bw / 2, 0, sz * bd / 2, 8));
  const tub = new THREE.CylinderGeometry(1, 0.82, 1, 4, 1, true);
  tub.rotateY(Math.PI / 4);
  const n = Math.max(3, Math.floor((H - 0.1 - bh) / 0.06) + 1);
  for (let i = 0; i < n; i++) {
    const y = 0.08 + i * 0.06;
    const m = new THREE.Mesh(tub, pl);
    m.scale.set(bw / Math.SQRT2, bh, bd / Math.SQRT2);
    m.position.set(0, y + bh / 2, 0);
    m.castShadow = true;
    g.add(m);
    // ободок
    g.add(box(bw + 0.01, 0.015, 0.015, pl, 0, y + bh - 0.015, bd / 2), box(bw + 0.01, 0.015, 0.015, pl, 0, y + bh - 0.015, -bd / 2));
  }
  const top = 0.08 + (n - 1) * 0.06;
  g.add(box(bw * 0.8, 0.01, bd * 0.8, pl, 0, top + 0.002, 0, false));
  // решетка на стенках верхней корзины
  for (let k = 1; k < 6; k++) {
    const x = -bw / 2 + k * bw / 6;
    g.add(box(0.012, bh * 0.7, 0.004, mat('#7f1d1d'), x, top + bh * 0.15, bd / 2 + 0.004, false));
  }
  // ручки верхней корзины, сложены вдоль длинных сторон
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.TorusGeometry(bw * 0.3, 0.008, 6, 16, Math.PI), mat('#212121'));
    h.rotation.x = -Math.PI / 2 + s * 0.35;
    h.position.set(0, top + bh, s * bd * 0.42);
    g.add(h);
  }
  return g;
};
// Уголок покупателя: стенд с карманами А4, документами и книгой отзывов
const docTexCache = new Map();
function docTexture(title) {
  if (docTexCache.has(title)) return docTexCache.get(title);
  const c = document.createElement('canvas'); c.width = 210; c.height = 297;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 210, 297);
  g.fillStyle = '#1d2330'; g.font = '700 17px system-ui, Arial, sans-serif'; g.textAlign = 'center';
  const words = title.split(' '); let line = '', y = 38;
  for (const w of words) { if (g.measureText(line + w).width > 180) { g.fillText(line, 105, y); y += 20; line = ''; } line += w + ' '; }
  g.fillText(line, 105, y);
  g.fillStyle = '#9aa3ad';
  for (let k = 0; k < 11; k++) g.fillRect(22, y + 26 + k * 17, 166 - (k % 3) * 22, 5);
  g.strokeStyle = '#1e5bd8'; g.lineWidth = 3; g.beginPath(); g.arc(160, 262, 20, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  docTexCache.set(title, t);
  return t;
}
B.infoboard = (W, D, H, p) => {
  const g = new THREE.Group();
  const col = p.color || '#1e5bd8';
  g.add(box(W, H, 0.02, mat('#f4f6fa'), 0, 0, -D / 2 + 0.01));
  g.add(box(W + 0.03, 0.03, 0.03, mat(col), 0, -0.015, -D / 2 + 0.015), box(W + 0.03, 0.03, 0.03, mat(col), 0, H - 0.015, -D / 2 + 0.015));
  for (const s of [-1, 1]) g.add(box(0.03, H, 0.03, mat(col), s * (W / 2), 0, -D / 2 + 0.015));
  const hd = signPlane('Уголок покупателя', W - 0.06, 0.12, col, '#ffffff');
  hd.position.set(0, H - 0.1, -D / 2 + 0.022); g.add(hd);
  const docs = ['Лицензия на розничную продажу алкоголя', 'Свидетельство ОГРН и ИНН', 'Правила продажи товаров', 'Закон о защите прав потребителей',
    'Режим работы магазина', 'Сертификаты и декларации', 'Контакты Роспотребнадзора', 'Информация о продавце'];
  const cols = Math.max(2, Math.floor((W - 0.04) / 0.23)), rows = 2;
  const aw = 0.18, ah = 0.255;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = r * cols + c;
    if (k >= docs.length) continue;
    const x = -W / 2 + (c + 0.5) * W / cols, y = H - 0.25 - r * (ah + 0.05) - ah / 2;
    const doc = new THREE.Mesh(new THREE.PlaneGeometry(aw, ah), new THREE.MeshBasicMaterial({ map: docTexture(docs[k]) }));
    doc.position.set(x, y, -D / 2 + 0.024); g.add(doc);
    const pocket = new THREE.Mesh(new THREE.PlaneGeometry(aw + 0.02, ah + 0.02), glassMat);
    pocket.position.set(x, y, -D / 2 + 0.03); g.add(pocket);
  }
  // книга отзывов и предложений в кармане внизу
  g.add(box(0.17, 0.22, 0.035, mat('#8d1f2d'), -W / 4, 0.03, -D / 2 + 0.04));
  const bk = signPlane('Книга отзывов', 0.15, 0.045, '#8d1f2d', '#f5e6c8');
  bk.position.set(-W / 4, 0.2, -D / 2 + 0.058); g.add(bk);
  g.add(box(0.24, 0.18, 0.05, glassMat, W / 4, 0.03, -D / 2 + 0.04, false));
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
    // снаружи (+Z, сторона улицы) графитовые панели, изнутри светлая стена
    const sp = [mat('#b9bcc2'), mat('#b9bcc2'), mat('#b9bcc2'), mat('#b9bcc2'), mat('#45484d'), mat('#d9d6cf')];
    if (w.sill > 0) walls.add(box(L, w.sill * M, 0.2, w.kind === 'glass' ? mat('#b9bcc2') : sp, cx, 0, z));
    const top = (w.sill + w.h) * M;
    if (w.kind !== 'glass' && top < C) walls.add(box(L, C - top, 0.2, sp, cx, top, z));
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
  const doors = buildDoors(data);
  root.add(doors.root);
  const facade = buildFacade(data);
  if (facade) root.add(facade.root);
  return { root, walls, beams, labels, floor, doors, facade };
}

// ---------------------------------------------------------------- двери
const v2 = a => new THREE.Vector2(a[0] * M, a[1] * M);
function placed(mesh, x, y, z, rotY) { mesh.position.set(x, y, z); mesh.rotation.y = rotY; return mesh; }
function boxAt(L, H, T, material, x, y0, z, rotY, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(L, H, T), material);
  if (shadow) { m.castShadow = true; m.receiveShadow = true; }
  return placed(m, x, y0 + H / 2, z, rotY);
}
const rotOf = u => Math.atan2(-u.y, u.x);
function arcLine(H, c, o, R, color) {
  const pts = [];
  const a0 = Math.atan2(c.y, c.x);
  let da = Math.atan2(o.y, o.x) - a0;
  if (da > Math.PI) da -= 2 * Math.PI;
  if (da < -Math.PI) da += 2 * Math.PI;
  for (let i = 0; i <= 24; i++) {
    const a = a0 + da * i / 24;
    pts.push(new THREE.Vector3(H.x + Math.cos(a) * R, 0.012, H.y + Math.sin(a) * R));
  }
  pts.push(new THREE.Vector3(H.x, 0.012, H.y));
  pts.push(new THREE.Vector3(H.x + o.x * R, 0.012, H.y + o.y * R));
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color, dashSize: 0.08, gapSize: 0.05 }));
  l.computeLineDistances();
  // заливка зоны открывания: на плане сразу видно, где дверь
  const sec = new THREE.Mesh(new THREE.CircleGeometry(R, 24, Math.min(-a0, -(a0 + da)), Math.abs(da)),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false }));
  sec.rotation.x = -Math.PI / 2;
  sec.position.set(H.x, 0.01, H.y);
  const g = new THREE.Group();
  g.add(l, sec);
  return g;
}
function leafGlass(W, H) {
  const g = new THREE.Group();
  const fr = mat('#2f3338'), t = 0.045;
  const gl = new THREE.Mesh(new THREE.PlaneGeometry(W - 2 * t, H - 2 * t), glassMat);
  gl.position.set(W / 2, H / 2, 0);
  g.add(gl);
  g.add(boxAt(W, t, 0.05, fr, W / 2, 0, 0, 0), boxAt(W, t, 0.05, fr, W / 2, H - t, 0, 0));
  g.add(boxAt(t, H, 0.05, fr, t / 2, 0, 0, 0), boxAt(t, H, 0.05, fr, W - t / 2, 0, 0, 0));
  g.add(boxAt(0.03, 0.9, 0.03, mat('#b0b5bb'), W - 0.12, 0.6, 0.06, 0), boxAt(0.03, 0.9, 0.03, mat('#b0b5bb'), W - 0.12, 0.6, -0.06, 0));
  return g;
}
function leafSolid(W, H, color) {
  const g = new THREE.Group();
  g.add(boxAt(W, H, 0.04, mat(color), W / 2, 0, 0, 0));
  const h = mat('#9ea3a8');
  g.add(boxAt(0.12, 0.025, 0.03, h, W - 0.12, 1.0, 0.04, 0), boxAt(0.12, 0.025, 0.03, h, W - 0.12, 1.0, -0.04, 0));
  return g;
}
// полотно, повернутое на петле: dir — направление от петли к свободному краю
function hangLeaf(leaf, Hp, dir) {
  const w = new THREE.Group();
  w.add(leaf);
  w.position.set(Hp.x, 0, Hp.y);
  w.rotation.y = rotOf(dir);
  return w;
}
export function buildDoors(data) {
  const root = new THREE.Group(), tall = new THREE.Group(), flat = new THREE.Group();
  root.name = 'doors';
  root.add(tall, flat);
  const OPEN = 75 * Math.PI / 180;
  for (const d of data.doors || []) {
    const a = v2(d.a), b = v2(d.b), L = a.distanceTo(b);
    const u = b.clone().sub(a).normalize();
    const n = new THREE.Vector2(d.into[0], d.into[1]);
    const t = d.t * M, top = d.top * M, ry = rotOf(u);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const cx = mid.x + n.x * t / 2, cz = mid.y + n.y * t / 2;
    // порог
    const th = new THREE.Mesh(new THREE.PlaneGeometry(L, Math.max(t, 0.06)), mat('#c2bcae'));
    th.rotation.x = -Math.PI / 2; th.rotation.z = ry;
    th.position.set(cx, 0.008, cz);
    flat.add(th);
    if (d.kind === 'glass2') {
      const o = new THREE.Vector2(d.out[0], d.out[1]);
      const W = L / 2 - 0.02;
      for (const [Hp, c] of [[a, u.clone()], [b, u.clone().negate()]]) {
        const dir = c.clone().multiplyScalar(Math.cos(OPEN * 0.85)).add(o.clone().multiplyScalar(Math.sin(OPEN * 0.85))).normalize();
        tall.add(hangLeaf(leafGlass(W, 2.08), Hp.clone().add(c.clone().multiplyScalar(0.02)), dir));
        flat.add(arcLine(Hp, c, o, W, 0x2563eb));
      }
      if (d.transom && top > 2.1) {
        const tr = new THREE.Mesh(new THREE.PlaneGeometry(L, top - 2.1), glassMat);
        tr.position.set(mid.x, 2.1 + (top - 2.1) / 2, mid.y); tr.rotation.y = ry;
        tall.add(tr);
        tall.add(boxAt(L, 0.06, 0.08, mat('#2f3338'), mid.x, 2.07, mid.y, ry));
      }
      continue;
    }
    // перемычка над дверью и коробка
    const wallMat = mat(d.kind === 'fire' ? '#ead7ea' : '#f3f1ec');
    if (top > 2.1) tall.add(boxAt(L, top - 2.1, t, wallMat, cx, 2.1, cz, ry));
    const fr = mat(d.kind === 'fire' ? '#6b7078' : '#8d8f93');
    for (const p of [a.clone().add(u.clone().multiplyScalar(0.03)), b.clone().sub(u.clone().multiplyScalar(0.03))])
      tall.add(boxAt(0.06, 2.1, t + 0.03, fr, p.x + n.x * t / 2, 0, p.y + n.y * t / 2, ry));
    tall.add(boxAt(L, 0.06, t + 0.03, fr, cx, 2.04, cz, ry));
    // полотно, приоткрытое по дуге со схемы
    const Hp = v2(d.hinge);
    const other = Hp.distanceTo(a) < 0.01 ? b : a;
    const c = other.clone().sub(Hp).normalize();
    const o = v2(d.swing).sub(Hp).normalize();
    const W = L - 0.08;
    // служебные двери открываются в узкий коридор: показываем их приоткрытыми, чтобы не перегораживали вид
    const ang = d.kind === 'fire' ? OPEN : 30 * Math.PI / 180;
    const dir = c.clone().multiplyScalar(Math.cos(ang)).add(o.clone().multiplyScalar(Math.sin(ang))).normalize();
    tall.add(hangLeaf(leafSolid(W, 2.03, d.kind === 'fire' ? '#9aa0a6' : '#e9e4d8'), Hp.clone().add(c.clone().multiplyScalar(0.04)), dir));
    flat.add(arcLine(Hp, c, o, W, d.kind === 'fire' ? 0x1f8a4c : 0x2563eb));
    // табличка над дверью со стороны открывания
    if (d.label) {
      const fire = d.kind === 'fire';
      const sw = Math.min(Math.max(L * 1.2, 0.6), 2.2);
      const sg = signPlane(d.label, sw, fire ? 0.22 : 0.18, fire ? '#1f8a4c' : '#ffffff', fire ? '#ffffff' : '#1d2330');
      sg.position.set(mid.x - n.x * 0.012, 2.32, mid.y - n.y * 0.012);
      sg.rotation.y = Math.atan2(-n.x, -n.y);
      tall.add(sg);
    }
  }
  return { root, tall, flat };
}

// ---------------------------------------------------------------- фасад со стороны входа
function pavingTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#9b8f84'; g.fillRect(0, 0, 256, 256);
  const cols = ['#b2a596', '#a69887', '#bcae9e', '#9f9182', '#c2b5a5'];
  // елочка из брусчатки 20x10 см
  for (let y = -64; y < 320; y += 32) for (let x = -64; x < 320; x += 64) {
    for (const [dx, dy, w, h] of [[0, 0, 62, 30], [32, 16, 30, 62]]) {
      g.fillStyle = cols[(x * 7 + y * 3 + dx) & 3];
      g.fillRect(x + dx + 1, y + dy + 1, w - 2, h - 2);
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
function facadeTexture(Wm, Hm, floors, floorH) {
  const pxm = 120, W = Math.round(Wm * pxm), H = Math.round(Hm * pxm);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const X = m => m * pxm, Y = m => H - m * pxm; // м от низа
  g.fillStyle = '#4a4d52'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#3f4246'; g.lineWidth = 2;
  for (let x = 0; x < Wm; x += 0.6) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), H); g.stroke(); }
  for (let y = 0; y < Hm; y += 1.2) { g.beginPath(); g.moveTo(0, Y(y)); g.lineTo(W, Y(y)); g.stroke(); }
  // оранжевая вставка справа
  g.fillStyle = '#d9a03c'; g.fillRect(X(Wm * 0.68), 0, X(Wm * 0.2), H);
  g.strokeStyle = '#c48e30';
  for (let y = 0; y < Hm; y += 0.6) { g.beginPath(); g.moveTo(X(Wm * 0.68), Y(y)); g.lineTo(X(Wm * 0.88), Y(y)); g.stroke(); }
  const glazing = (x0, x1, y0, y1, curtains) => {
    g.fillStyle = '#2b2e33'; g.fillRect(X(x0), Y(y1), X(x1 - x0), X(y1 - y0));
    const n = Math.max(2, Math.round((x1 - x0) / 0.75));
    const cw = (x1 - x0 - 0.06) / n;
    for (let i = 0; i < n; i++) {
      const gx = x0 + 0.06 + i * cw;
      for (const [a, b] of [[y0 + 0.08, y0 + 0.9], [y0 + 0.98, y1 - 0.08]]) {
        const grd = g.createLinearGradient(0, Y(b), 0, Y(a));
        grd.addColorStop(0, '#a9bccb'); grd.addColorStop(1, '#6f8597');
        g.fillStyle = curtains && ((i + Math.floor(y0)) % 3 === 0) && a > y0 + 0.5 ? '#e9e6df' : grd;
        g.fillRect(X(gx), Y(b), X(cw - 0.06), X(b - a));
      }
    }
  };
  const win = (x0, x1, y0, y1) => {
    g.fillStyle = '#2b2e33'; g.fillRect(X(x0) - 4, Y(y1) - 4, X(x1 - x0) + 8, X(y1 - y0) + 8);
    const grd = g.createLinearGradient(0, Y(y1), 0, Y(y0));
    grd.addColorStop(0, '#b8c8d4'); grd.addColorStop(1, '#5f7586');
    g.fillStyle = grd; g.fillRect(X(x0), Y(y1), X(x1 - x0), X(y1 - y0));
    g.fillStyle = '#2b2e33'; g.fillRect(X((x0 + x1) / 2) - 3, Y(y1), 6, X(y1 - y0));
  };
  for (let f = 0; f < floors; f++) {
    const y0 = f * floorH + 0.25, y1 = y0 + floorH - 0.55;
    glazing(Wm * 0.16, Wm * 0.58, y0, y1, true);
    win(Wm * 0.03, Wm * 0.11, y0 + 0.9, y1 - 0.1);
    win(Wm * 0.71, Wm * 0.77, y0 + 0.9, y1 - 0.1);
    win(Wm * 0.8, Wm * 0.86, y0 + 0.9, y1 - 0.1);
    glazing(Wm * 0.9, Wm * 0.995, y0, y1, false);
    g.fillStyle = '#efeeea'; g.fillRect(0, Y(f * floorH + 0.12), W, 10);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
export function buildFacade(data) {
  const F = data.facade;
  if (!F) return null;
  const root = new THREE.Group(), upper = new THREE.Group();
  root.name = 'facade';
  const y = F.y * M, x0 = F.x0 * M, x1 = F.x1 * M, cx = (x0 + x1) / 2, C = data.meta.ceiling * M;
  // тротуар, бордюр, газон
  const pav = pavingTexture(); pav.repeat.set((x1 - x0 + 8) / 1.0, 5.2 / 1.0);
  const sw = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 8, 5.2), new THREE.MeshLambertMaterial({ map: pav }));
  sw.rotation.x = -Math.PI / 2; sw.position.set(cx, 0.002, y + 2.6); sw.receiveShadow = true;
  root.add(sw);
  root.add(boxAt(x1 - x0 + 8, 0.12, 0.15, mat('#b9b6ae'), cx, 0, y + 5.25, 0));
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 8, 6), mat('#7d7a52'));
  lawn.rotation.x = -Math.PI / 2; lawn.position.set(cx, 0.004, y + 8.3); lawn.receiveShadow = true;
  root.add(lawn);
  // пилоны первого этажа
  for (const [a, b, tone] of F.pylons) {
    root.add(boxAt((b - a) * M + 0.04, C, 0.14, mat(tone === 'white' ? '#ecebe6' : '#45484d'), (a + b) / 2 * M, 0, y + 0.07, 0));
  }
  // соседние помещения первого этажа слева и справа
  const [bx0, , bx1] = data.meta.bounds.map(v => v * M);
  for (const [a, b] of [[x0 - 4, bx0], [bx1, x1 + 4]]) {
    root.add(boxAt(b - a, C, 0.3, mat('#45484d'), (a + b) / 2, 0, y - 0.15, 0));
    const gl = new THREE.Mesh(new THREE.PlaneGeometry((b - a) * 0.6, 2.6), darkGlass);
    gl.position.set((a + b) / 2, 0.5 + 1.3, y + 0.005);
    root.add(gl);
  }
  // водосточная труба
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, C, 10), mat('#f2f2f2'));
  pipe.position.set(0.45, C / 2, y + 0.2); root.add(pipe);
  // ограждение приямка перед «открытым фасадом» и потолок над ним
  if (F.railing) {
    const [a, b] = F.railing.map(v => v * M);
    const rm = mat('#3a3d42');
    root.add(boxAt(b - a, 0.04, 0.05, rm, (a + b) / 2, 1.0, y + 0.05, 0));
    root.add(boxAt(b - a, 0.04, 0.05, rm, (a + b) / 2, 0.1, y + 0.05, 0));
    const n = Math.floor((b - a) / 0.12);
    const bar = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 0.9, 0.02), rm, n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) { m4.makeTranslation(a + 0.06 + i * 0.12, 0.55, y + 0.05); bar.setMatrixAt(i, m4); }
    root.add(bar);
    const rec = data.windows.find(w => w.kind === 'window' && w.x0 * M <= a + 0.01 && w.x1 * M >= b - 0.01);
    if (rec) root.add(boxAt(b - a, 0.08, y - rec.y * M, mat('#efeeea'), (a + b) / 2, C - 0.08, (y + rec.y * M) / 2, 0, false));
  }
  // вывеска над входом (нейтральная)
  if (F.sign) {
    const s = F.sign;
    const box3 = boxAt((s.x1 - s.x0) * M, (s.y1 - s.y0) * M, 0.12, mat('#2b2e33'), (s.x0 + s.x1) / 2 * M, s.y0 * M, y + 0.06, 0);
    root.add(box3);
    const pl = signPlane(s.text, (s.x1 - s.x0) * M * 0.9, (s.y1 - s.y0) * M * 0.7, null, '#ffffff');
    pl.position.set((s.x0 + s.x1) / 2 * M, (s.y0 + s.y1) / 2 * M, y + 0.125);
    root.add(pl);
  }
  // белый пояс над первым этажом
  const [b0, b1] = F.band.map(v => v * M);
  root.add(boxAt(x1 - x0 + 8, b1 - b0, 0.5, mat('#f1f0ec'), cx, b0, y + 0.1, 0));
  // этажи жилого дома (видны с улицы)
  const Hm = F.floors * F.floorH * M, Wu = x1 - x0 + 8;
  const tex = facadeTexture(Wu, Hm, F.floors, F.floorH * M);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(Wu, Hm), new THREE.MeshLambertMaterial({ map: tex }));
  wall.position.set(cx, b1 + Hm / 2, y + 0.02);
  upper.add(wall);
  const slab = mat('#efeeea');
  for (let f = 1; f <= F.floors; f++) {
    upper.add(boxAt(Wu * 0.44, 0.18, 0.35, slab, x0 - 4 + Wu * 0.37, b1 + f * F.floorH * M - 0.1, y + 0.17, 0, false));
  }
  const grill = mat('#55595e');
  for (const [fx, f] of [[0.74, 0], [0.83, 1], [0.74, 2]]) {
    upper.add(boxAt(0.9, 0.45, 0.4, grill, x0 - 4 + Wu * fx, b1 + f * F.floorH * M + 0.35, y + 0.22, 0, false));
  }
  root.add(upper);
  return { root, upper, y };
}

// ---------------------------------------------------------------- детализированные модели (лицевая сторона +Z)
const steel = () => mat('#c9ced4');
const black = () => mat('#1e2024');
function cylY(rt, rb, h, material, x, y0, z, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y0 + h / 2, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
function latheY(pts, material, x, y0, z, seg = 16) {
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), material);
  m.position.set(x, y0, z); m.castShadow = true;
  return m;
}
const screenMat = new THREE.MeshPhongMaterial({ color: 0x1b2836, emissive: 0x16324f, shininess: 80, specular: 0x8899aa });

// Унитаз: чаша, сиденье, крышка, бачок с кнопкой
B.toilet = (W, D, H, p) => {
  const g = new THREE.Group();
  const w = new THREE.MeshPhongMaterial({ color: 0xfbfbfb, shininess: 60, specular: 0x666666 });
  const L = Math.min(D, 0.68), bz = -D / 2 + 0.12 + 0.2;
  const ped = cylY(0.13, 0.11, 0.3, w, 0, 0, bz + 0.05); ped.scale.z = 1.5; g.add(ped);
  const bowl = latheY([[0.11, 0], [0.17, 0.06], [0.19, 0.1], [0.18, 0.11], [0.12, 0.08], [0, 0.03]], w, 0, 0.3, bz + 0.07, 20);
  bowl.scale.z = 1.35; g.add(bowl);
  const seat = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 8, 24), w);
  seat.rotation.x = Math.PI / 2; seat.scale.y = 1.35; seat.position.set(0, 0.42, bz + 0.07); g.add(seat);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 24), w);
  lid.scale.z = 1.3; lid.rotation.x = -1.25; lid.position.set(0, 0.62, -D / 2 + 0.2); g.add(lid);
  g.add(box(0.4, 0.38, 0.17, w, 0, 0.42, -D / 2 + 0.085));
  g.add(box(0.42, 0.03, 0.19, w, 0, 0.8, -D / 2 + 0.095));
  g.add(cylY(0.03, 0.03, 0.012, mat('#c0c4c8'), 0, 0.83, -D / 2 + 0.09));
  return g;
};
// Раковина на стене: чаша, смеситель, пьедестал, зеркало
B.sink = (W, D, H, p) => {
  const g = new THREE.Group();
  const w = new THREE.MeshPhongMaterial({ color: 0xfbfbfb, shininess: 60, specular: 0x666666 });
  const bw = Math.min(W, 0.5), bd = Math.min(D, 0.42), top = 0.85;
  g.add(box(bw, 0.16, bd, w, 0, top - 0.16, -D / 2 + bd / 2));
  g.add(box(bw - 0.08, 0.012, bd - 0.1, mat('#d9dee3'), 0, top - 0.005, -D / 2 + bd / 2 + 0.02, false));
  g.add(cylY(0.07, 0.09, top - 0.16, w, 0, 0, -D / 2 + 0.12));
  g.add(cylY(0.018, 0.022, 0.16, steel(), 0, top, -D / 2 + 0.05));
  g.add(box(0.025, 0.025, 0.12, steel(), 0, top + 0.13, -D / 2 + 0.11, false));
  const mir = new THREE.Mesh(new THREE.PlaneGeometry(bw, 0.7), new THREE.MeshPhongMaterial({ color: 0xcfe3ee, shininess: 120, specular: 0xffffff }));
  mir.position.set(0, top + 0.25 + 0.35, -D / 2 + 0.006); g.add(mir);
  g.add(box(bw + 0.04, 0.7 + 0.04, 0.008, mat('#8d9399'), 0, top + 0.23, -D / 2 + 0.002, false));
  return g;
};
// Кофемашина: корпус, панель, группы, поддон, бункер для зерна, чашки
B.coffee = (W, D, H, p) => {
  const g = new THREE.Group();
  const bw = Math.min(W, 0.75), bd = Math.min(D, 0.55), bh = Math.min(H, 0.55);
  g.add(box(bw, bh, bd, mat('#2c2e31'), 0, 0, -0.05));
  g.add(box(bw * 0.96, bh * 0.35, 0.02, steel(), 0, bh * 0.55, bd / 2 - 0.05));
  const scr = box(0.16, 0.09, 0.01, screenMat, 0, bh * 0.68, bd / 2 - 0.035, false); g.add(scr);
  for (const x of [-bw * 0.25, bw * 0.25]) {
    g.add(cylY(0.035, 0.035, 0.06, steel(), x, bh * 0.4, bd / 2 - 0.08));
    g.add(cylY(0.035, 0.03, 0.07, mat('#f4f1ea'), x, 0.04, bd / 2 - 0.06));
  }
  g.add(box(bw * 0.9, 0.03, 0.12, steel(), 0, 0.01, bd / 2 - 0.04));
  const hop = cylY(0.07, 0.05, 0.16, new THREE.MeshPhongMaterial({ color: 0x6b4423, transparent: true, opacity: 0.7 }), bw * 0.3, bh, -0.08);
  g.add(hop);
  for (let i = 0; i < 3; i++) g.add(cylY(0.04, 0.035, 0.05, mat('#f4f1ea'), -bw * 0.28 + i * 0.09, bh, -0.08));
  return g;
};
// Сиропы, стаканы и крышки на стойке рядом с кофемашиной
B.syrups = (W, D, H, p) => {
  const g = new THREE.Group();
  const cols = ['#7b1f1f', '#c98a2b', '#3e2723', '#e8c46b', '#8e2a5a', '#2e7d32', '#f1e3c6', '#b23a2a'];
  const n = Math.max(3, Math.floor((W - 0.05) / 0.075));
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + 0.05 + i * (W - 0.1) / (n - 1);
    const z = -D / 2 + 0.1;
    g.add(latheY([[0.03, 0], [0.032, 0.22], [0.016, 0.26], [0.011, 0.29], [0, 0.29]],
      new THREE.MeshPhongMaterial({ color: cols[i % cols.length], shininess: 70 }), x, 0, z, 10));
    g.add(cylY(0.012, 0.012, 0.05, black(), x, 0.29, z, 8));
    g.add(box(0.06, 0.012, 0.012, black(), x + 0.025, 0.335, z, false));
  }
  // стопки стаканов и крышек
  for (const [x, c] of [[-W * 0.25, '#f4f1ea'], [0, '#5d4037'], [W * 0.25, '#f4f1ea']]) {
    for (let k = 0; k < 8; k++) g.add(cylY(0.045, 0.035, 0.02, mat(c), x, k * 0.018, D / 2 - 0.08, 12));
  }
  return g;
};
// Касса с лентопротягом: тумба, рама из нержавейки, лента, ограничители
B.belt = (W, D, H, p) => {
  const g = new THREE.Group();
  const long = W >= D, L = long ? W : D, S = long ? D : W;
  const along = (len, h, wid, material, o, y0, s = 0, shadow = true) =>
    long ? box(len, h, wid, material, o, y0, s, shadow) : box(wid, h, len, material, s, y0, o, shadow);
  g.add(along(L, H - 0.06, S, mat(p.color || '#e9d8b8'), 0, 0));
  g.add(along(L, 0.04, S + 0.02, steel(), 0, H - 0.06));
  const bw = Math.min(S - 0.12, 0.5);
  g.add(along(L - 0.16, 0.02, bw, mat('#1b1b1b'), 0, H - 0.02, 0, false));
  for (const e of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, bw, 12), steel());
    if (long) { r.rotation.x = Math.PI / 2; r.position.set(e * (L / 2 - 0.08), H - 0.01, 0); }
    else { r.rotation.z = Math.PI / 2; r.position.set(0, H - 0.01, e * (L / 2 - 0.08)); }
    g.add(r);
  }
  for (const s of [-1, 1]) g.add(along(L - 0.1, 0.05, 0.03, steel(), 0, H, s * (bw / 2 + 0.03)));
  // разделитель покупок
  g.add(along(0.4, 0.04, 0.05, mat('#2f6fd6'), L * 0.15, H, 0, false));
  return g;
};
// Рабочее место кассира: стол, сканер, монитор кассира, дисплей покупателя, терминал, принтер
B.checkout = (W, D, H, p) => {
  const g = new THREE.Group();
  g.add(box(W, H - 0.04, D, mat(p.color || '#e9d8b8')));
  g.add(box(W + 0.02, 0.04, D + 0.02, mat('#4a4d52'), 0, H - 0.04, 0));
  // сканер в столешнице
  g.add(box(0.32, 0.006, 0.26, mat('#1f3a2a'), -W / 2 + 0.3, H, 0.0, false));
  g.add(box(0.32, 0.18, 0.06, mat('#2b2e33'), -W / 2 + 0.3, H, -0.16));
  // монитор кассира на стойке (смотрит назад, на кассира)
  g.add(box(0.05, 0.3, 0.05, mat('#2b2e33'), -W / 2 + 0.75, H, -D / 2 + 0.2));
  const mon = box(0.4, 0.28, 0.04, mat('#2b2e33'), -W / 2 + 0.75, H + 0.3, -D / 2 + 0.2);
  g.add(mon);
  const ms = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.24), screenMat);
  ms.rotation.y = Math.PI; ms.position.set(-W / 2 + 0.75, H + 0.44, -D / 2 + 0.177); g.add(ms);
  // дисплей покупателя (лицом к покупателю)
  const cd = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.12), screenMat);
  cd.position.set(-W / 2 + 0.75, H + 0.5, -D / 2 + 0.224); g.add(cd);
  // платежный терминал на краю, принтер чеков, денежный ящик
  g.add(box(0.08, 0.04, 0.16, black(), -W / 2 + 1.05, H, D / 2 - 0.12));
  g.add(box(0.07, 0.02, 0.05, screenMat, -W / 2 + 1.05, H + 0.04, D / 2 - 0.08, false));
  g.add(box(0.16, 0.14, 0.2, mat('#3a3d42'), -W / 2 + 1.25, H, -D / 2 + 0.15));
  g.add(box(0.42, 0.12, 0.42, mat('#2b2e33'), -W / 2 + 0.75, H - 0.2, -D / 2 + 0.215));
  return g;
};
// КСО: тумба, сканер, весовая площадка для пакетов, сенсорный экран, терминал, маячок
B.kiosk = (W, D, H, p) => {
  const g = new THREE.Group();
  const bw = Math.min(W, 0.55), bd = Math.min(D, 0.5);
  const body = mat('#eceef1');
  g.add(box(bw, 0.86, bd, body, 0, 0, -0.05));
  g.add(box(bw + 0.04, 0.03, bd + 0.08, mat('#3a3d42'), 0, 0.86, -0.03));
  g.add(box(0.3, 0.005, 0.22, mat('#1f3a2a'), 0, 0.89, 0.03, false));
  // площадка для пакетов сбоку
  const side = Math.min(0.35, (W - bw) / 2 - 0.02);
  if (side > 0.15) {
    g.add(box(side, 0.78, bd, body, bw / 2 + side / 2 + 0.02, 0, -0.05));
    g.add(box(side, 0.02, bd, steel(), bw / 2 + side / 2 + 0.02, 0.78, -0.05));
    for (const s of [-1, 1]) g.add(box(0.02, 0.3, 0.02, steel(), bw / 2 + side / 2 + 0.02 + s * side * 0.4, 0.8, -0.05 - bd * 0.4));
  }
  // экран на колонне
  g.add(box(0.12, 0.45, 0.1, body, 0, 0.89, -bd / 2 + 0.02));
  const frame = box(0.42, 0.62, 0.05, mat('#2b2e33'), 0, 0, 0);
  const sc = new THREE.Group();
  sc.add(frame);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.37, 0.56), screenMat); scr.position.set(0, 0.31, 0.027); sc.add(scr);
  sc.position.set(0, 1.25, -bd / 2 + 0.08); sc.rotation.x = -0.18;
  g.add(sc);
  g.add(box(0.08, 0.14, 0.05, black(), bw / 2 - 0.06, 0.95, bd / 2 - 0.12));
  // маячок с номером
  g.add(cylY(0.015, 0.015, Math.max(0.2, H - 1.95), steel(), -0.18, 1.85, -bd / 2 + 0.05, 8));
  g.add(cylY(0.05, 0.05, 0.12, new THREE.MeshPhongMaterial({ color: 0x2ecc71, emissive: 0x145c32 }), -0.18, Math.max(2.05, H - 0.1), -bd / 2 + 0.05));
  return g;
};
// Складской стеллаж с коробками
B.storage = (W, D, H, p) => {
  const g = new THREE.Group();
  const post = mat('#3d5a80'), beam = mat('#e07a1f');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.04, H, 0.04, post, sx * (W / 2 - 0.02), 0, sz * (D / 2 - 0.02)));
  const n = 4, gap = (H - 0.15) / n;
  const st = stockFor({ label: 'storage' }, W);
  for (let i = 0; i < n; i++) {
    const y = 0.12 + i * gap;
    g.add(box(W, 0.03, D, mat('#c9ced4'), 0, y, 0, false));
    for (const sz of [-1, 1]) g.add(box(W, 0.06, 0.03, beam, 0, y - 0.03, sz * (D / 2 - 0.015), false));
    st.shelf('carton', -W / 2 + 0.03, W / 2 - 0.03, y + 0.03, D / 2 - 0.02, -D / 2 + 0.02, gap - 0.06, { rows: 3 });
  }
  addStock(g, st);
  return g;
};
// Моноблок с клавиатурой и мышью
B.monoblock = (W, D, H, p) => {
  const g = new THREE.Group();
  const sw = Math.min(W, 0.6), sh = Math.min(H, 0.45) * 0.78;
  g.add(box(0.2, 0.012, 0.16, mat('#c9ced4'), 0, 0, -D / 2 + 0.1));
  g.add(box(0.05, H - sh - 0.02, 0.03, mat('#c9ced4'), 0, 0, -D / 2 + 0.12));
  g.add(box(sw, sh, 0.03, mat('#2b2e33'), 0, H - sh, -D / 2 + 0.1));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(sw - 0.03, sh - 0.05), screenMat);
  scr.position.set(0, H - sh / 2 + 0.01, -D / 2 + 0.116); g.add(scr);
  g.add(box(0.42, 0.015, 0.13, mat('#e9ebee'), -0.05, 0, D / 2 - 0.1, false));
  g.add(box(0.06, 0.02, 0.1, mat('#e9ebee'), 0.24, 0, D / 2 - 0.1, false));
  return g;
};

// ---------------------------------------------------------------- касса по образцу: накопитель, модуль кассира, лента, тумба
const caseGray = () => mat('#5f6669');
const plinth = () => mat('#1e2024');
// корпус с черным цоколем и закругленным торцом-бортом из нержавейки
function cabinet(g, W, H, D, color, x = 0, z = 0) {
  g.add(box(W - 0.02, 0.08, D - 0.04, plinth(), x, 0, z));
  g.add(box(W, H - 0.08, D, mat(color), x, 0.08, z));
}
// Накопитель: наклонный лоток из нержавейки с бортами
B.bagging = (W, D, H, p) => {
  const g = new THREE.Group();
  cabinet(g, W, H - 0.1, D, p.color || '#5f6669');
  const tray = box(W - 0.06, 0.02, D - 0.06, mat('#d6dade'), 0, 0, 0, false);
  tray.position.y = H - 0.09; tray.rotation.x = 0.08;
  g.add(tray);
  g.add(box(W, 0.1, 0.06, steel(), 0, H - 0.1, D / 2 - 0.03), box(W, 0.1, 0.06, steel(), 0, H - 0.1, -D / 2 + 0.03));
  g.add(box(0.06, 0.1, D, steel(), -W / 2 + 0.03, H - 0.1, 0));
  // держатель пакетов
  g.add(box(0.02, 0.35, 0.02, steel(), W / 2 - 0.08, H, -D / 2 + 0.12), box(0.25, 0.02, 0.2, mat('#3a3d42'), W / 2 - 0.2, H + 0.33, -D / 2 + 0.12, false));
  return g;
};
// Модуль кассира: узкая тумба со стороны покупателя, ниша для ног, сканер, экран из оргстекла
B.checkout = (W, D, H, p) => {
  const g = new THREE.Group();
  const col = p.color || '#5f6669';
  cabinet(g, W, H - 0.15, D * 0.45, col, 0, D / 2 - D * 0.225);
  g.add(box(W, 0.04, D, mat('#4a4d52'), 0, H - 0.19, 0));
  g.add(box(W, 0.12, D * 0.45, steel(), 0, H - 0.15, D / 2 - D * 0.225));
  // сканер в столешнице
  g.add(box(Math.min(0.34, W - 0.1), 0.006, 0.26, mat('#1f3a2a'), 0, H - 0.15, -0.02, false));
  // экран из оргстекла со стороны покупателя
  const shield = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(0.6, W - 0.06), 0.45), glassMat);
  shield.position.set(0, H + 0.2, D / 2 - 0.02); g.add(shield);
  for (const s of [-1, 1]) g.add(box(0.03, 0.5, 0.03, mat('#3a3d42'), s * Math.min(0.3, W / 2 - 0.03), H - 0.05, D / 2 - 0.02, false));
  // монитор кассира, дисплей покупателя, терминал, принтер
  g.add(box(0.04, 0.3, 0.04, mat('#2b2e33'), -W / 2 + 0.12, H - 0.15, -D / 2 + 0.12));
  const mon = box(0.38, 0.27, 0.04, mat('#2b2e33'), -W / 2 + 0.12, H + 0.12, -D / 2 + 0.12); g.add(mon);
  const ms = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.23), screenMat);
  ms.rotation.y = Math.PI; ms.position.set(-W / 2 + 0.12, H + 0.255, -D / 2 + 0.098); g.add(ms);
  const cd = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.13), screenMat);
  cd.position.set(-W / 2 + 0.12, H + 0.28, -D / 2 + 0.142); g.add(cd);
  g.add(box(0.08, 0.04, 0.16, black(), W / 2 - 0.1, H - 0.15, D / 2 - 0.12));
  g.add(box(0.07, 0.015, 0.05, screenMat, W / 2 - 0.1, H - 0.11, D / 2 - 0.08, false));
  g.add(box(0.16, 0.14, 0.2, mat('#3a3d42'), W / 2 - 0.14, H - 0.15, -D / 2 + 0.15));
  return g;
};
// Лента: корпус, рама с закругленным торцом, черное полотно, кнопка стоп.
// Если в подписи есть «импульс», на лицевой панели со стороны покупателя ниже столешницы
// появляются полочки с батончиками, жвачкой и энергетиками: обзор над лентой остается свободным.
B.belt = (W, D, H, p) => {
  const g = new THREE.Group();
  const imp = /импульс/i.test(p.label || '');
  const long = W >= D, L = long ? W : D, S0 = long ? D : W;
  const sd = imp ? 0.11 : 0;
  const S = S0 - sd, off = -sd / 2; // корпус сдвинут назад, спереди полочки
  const along = (len, h, wid, material, o, y0, s = 0, shadow = true) =>
    long ? box(len, h, wid, material, o, y0, s + off, shadow) : box(wid, h, len, material, s + off, y0, o, shadow);
  const col = p.color || '#5f6669';
  g.add(along(L - 0.02, 0.08, S - 0.04, plinth(), 0, 0));
  g.add(along(L, H - 0.2, S, mat(col), 0, 0.08));
  g.add(along(L, 0.12, S + 0.04, mat('#6c7377'), 0, H - 0.12));
  const end = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, S + 0.04, 16), mat('#6c7377'));
  if (long) { end.rotation.x = Math.PI / 2; end.position.set(L / 2, H - 0.06, off); }
  else { end.rotation.z = Math.PI / 2; end.position.set(off, H - 0.06, L / 2); }
  g.add(end);
  const bw = Math.min(S - 0.14, 0.48);
  g.add(along(L - 0.12, 0.014, bw, mat('#151515'), 0, H, 0, false));
  for (const s of [-1, 1]) g.add(along(L - 0.06, 0.03, 0.03, steel(), 0, H, s * (bw / 2 + 0.02)));
  g.add(along(0.4, 0.04, 0.05, mat('#2f6fd6'), L * 0.2, H + 0.01, 0, false));
  const sx = -L / 2 + 0.14;
  g.add(long ? box(0.16, 0.1, 0.01, mat('#e9ebee'), sx, H - 0.25, -S0 / 2 - 0.005, false) : box(0.01, 0.1, 0.16, mat('#e9ebee'), -S0 / 2 - 0.005, H - 0.25, sx, false));
  const stop = cylY(0.025, 0.025, 0.03, mat('#d32f2f'), 0, 0, 0, 12);
  stop.rotation.x = Math.PI / 2;
  if (long) stop.position.set(sx + 0.15, H - 0.3, -S0 / 2 - 0.01); else stop.position.set(-S0 / 2 - 0.01, H - 0.3, sx + 0.15);
  g.add(stop);
  if (imp && long) {
    const st = stockFor({ label: 'impulse' }, L);
    const z0 = S0 / 2 - sd, z1 = S0 / 2;
    [[0.18, 'energy'], [0.42, 'bar'], [0.62, 'gum']].forEach(([y, kind]) => {
      g.add(box(L - 0.1, 0.012, sd, mat('#d6dade'), 0, y, (z0 + z1) / 2, false));
      g.add(box(L - 0.1, 0.035, 0.008, mat('#e53935'), 0, y, z1 - 0.004, false));
      st.shelf(kind, -L / 2 + 0.08, L / 2 - 0.08, y + 0.012, z1 - 0.01, z0, 0.17, { rows: 2 });
    });
    for (const sxx of [-1, 1]) g.add(box(0.02, 0.6, sd, mat('#3a3d42'), sxx * (L / 2 - 0.05), 0.12, (z0 + z1) / 2, false));
    addStock(g, st);
  }
  return g;
};
// Прикассовая навеска над лентой: жевательная резинка и батончики
B.impulse = (W, D, H, p) => {
  const g = new THREE.Group();
  const fr = mat('#3a3d42');
  for (const s of [-1, 1]) g.add(box(0.03, H, 0.03, fr, s * (W / 2 - 0.02), 0, 0));
  const st = stockFor({ label: 'impulse' }, W);
  const levels = [H - 0.42, H - 0.2];
  levels.forEach((y, i) => {
    g.add(box(W, 0.015, Math.max(D, 0.12), mat('#d6dade'), 0, y, 0, false));
    g.add(box(W, 0.04, 0.01, mat('#d6dade'), 0, y, Math.max(D, 0.12) / 2, false));
    st.shelf(i ? 'gum' : 'bar', -W / 2 + 0.04, W / 2 - 0.04, y + 0.015, Math.max(D, 0.12) / 2 - 0.01, -Math.max(D, 0.12) / 2, 0.16, { rows: 2 });
  });
  g.add(box(W, 0.06, 0.02, mat('#e53935'), 0, H - 0.04, 0, false));
  addStock(g, st);
  return g;
};
// Тумба справа от кассира: корпус с открытыми полками и черной столешницей
B.pedestal = (W, D, H, p) => {
  const g = new THREE.Group();
  cabinet(g, W, H - 0.03, D, p.color || '#5f6669');
  g.add(box(W + 0.06, 0.03, D + 0.04, mat('#1e2024'), 0, H - 0.03, 0));
  const inner = mat('#3d4246');
  g.add(box(W - 0.08, H - 0.25, 0.01, inner, 0, 0.12, D / 2 + 0.001, false));
  g.add(box(W - 0.08, 0.02, 0.02, mat('#6c7377'), 0, 0.12 + (H - 0.25) / 2, D / 2 + 0.005, false));
  return g;
};
// Кресло кассира: крестовина на колесах, газлифт, сиденье, спинка, подлокотники
B.officechair = (W, D, H, p) => {
  const g = new THREE.Group();
  const dark = mat('#2b2e33'), fab = mat(p.color || '#33475b');
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    const arm = box(0.3, 0.035, 0.05, dark, Math.cos(a) * 0.15, 0.05, Math.sin(a) * 0.15, false);
    arm.rotation.y = -a; g.add(arm);
    g.add(cylY(0.025, 0.025, 0.05, dark, Math.cos(a) * 0.29, 0, Math.sin(a) * 0.29, 8));
  }
  g.add(cylY(0.03, 0.03, 0.35, steel(), 0, 0.08, 0, 10));
  g.add(box(0.48, 0.08, 0.46, fab, 0, 0.44, 0));
  const back = box(0.44, 0.5, 0.06, fab, 0, 0, 0);
  back.position.set(0, 0.62 + 0.25, -0.24); back.rotation.x = -0.12; g.add(back);
  g.add(box(0.05, 0.3, 0.04, dark, 0, 0.5, -0.24));
  for (const s of [-1, 1]) { g.add(box(0.04, 0.2, 0.04, dark, s * 0.24, 0.5, -0.02)); g.add(box(0.06, 0.03, 0.26, dark, s * 0.24, 0.7, 0.0)); }
  return g;
};
// Промо-стойка из картона: ступенчатые полки, яркие боковины, шапка «ПРОМО»
B.promo = (W, D, H, p) => {
  const g = new THREE.Group();
  const col = p.color || '#ff7a00';
  g.add(box(W, H - 0.3, 0.02, mat('#f5f5f5'), 0, 0, -D / 2 + 0.01));
  for (const s of [-1, 1]) g.add(box(0.02, H - 0.3, D, mat(col), s * (W / 2 - 0.01), 0, 0));
  g.add(box(W, 0.12, D, mat(col), 0, 0, 0));
  const n = 4, gap = (H - 0.45) / n;
  const st = stockFor(p, W), plan = goodsPlan(p, n);
  for (let i = 0; i < n; i++) {
    const y = 0.12 + i * gap, depth = D - i * (D - 0.18) / (n - 1);
    g.add(box(W - 0.04, 0.015, depth, mat('#ffffff'), 0, y, -D / 2 + depth / 2, false));
    g.add(box(W - 0.04, 0.05, 0.005, mat(col), 0, y, -D / 2 + depth, false));
    st.shelf(plan[i], -W / 2 + 0.03, W / 2 - 0.03, y + 0.015, -D / 2 + depth - 0.01, -D / 2 + 0.02, gap - 0.04, { rows: 3 });
  }
  addStock(g, st);
  const hd = signPlane(p.sign || 'ПРОМО', W, 0.28, '#e53935', '#ffffff');
  hd.position.set(0, H - 0.16, -D / 2 + 0.03); g.add(hd);
  g.add(box(W, 0.32, 0.02, mat('#e53935'), 0, H - 0.31, -D / 2 + 0.01));
  return g;
};
// Шкаф для посуды: внизу глухие дверцы, вверху стекло, внутри тарелки и кружки
B.cupboard = (W, D, H, p) => {
  const g = new THREE.Group();
  const wood = mat(p.color || '#d8c08a'), edge = mat('#b89e6a');
  g.add(box(W, 0.08, D - 0.03, plinth(), 0, 0, -0.01));
  g.add(box(W, H - 0.08, 0.02, wood, 0, 0.08, -D / 2 + 0.01));
  for (const s of [-1, 1]) g.add(box(0.02, H - 0.08, D, wood, s * (W / 2 - 0.01), 0.08, 0));
  g.add(box(W, 0.02, D, wood, 0, H - 0.02, 0));
  const split = 0.85;
  g.add(box(W, 0.03, D, edge, 0, split, 0));
  // нижние дверцы
  const nd = W > 0.5 ? 2 : 1;
  for (let i = 0; i < nd; i++) {
    const dw = (W - 0.03) / nd, x = -W / 2 + 0.015 + dw * (i + 0.5);
    g.add(box(dw - 0.006, split - 0.1, 0.018, wood, x, 0.09, D / 2 - 0.009));
    g.add(box(0.015, 0.12, 0.02, steel(), x + (i === 0 && nd === 2 ? dw / 2 - 0.05 : -dw / 2 + 0.05), split - 0.25, D / 2 + 0.005, false));
  }
  // полки с посудой
  const plates = mat('#fafafa'), mugs = [mat('#e57373'), mat('#64b5f6'), mat('#fff176'), mat('#ffffff')];
  const shelves = [split + 0.05, split + 0.42, split + 0.78];
  shelves.forEach((y, k) => {
    if (k) g.add(box(W - 0.04, 0.015, D - 0.05, edge, 0, y - 0.015, -0.01, false));
    if (k === 0) for (let j = 0; j < 2; j++) for (let t = 0; t < 8; t++) g.add(cylY(0.1, 0.09, 0.012, plates, -W / 4 + j * W / 2, y + t * 0.014, -0.02, 18));
    else for (let j = 0; j < Math.max(2, Math.floor((W - 0.06) / 0.11)); j++)
      g.add(cylY(0.04, 0.038, 0.09, mugs[(j + k) % mugs.length], -W / 2 + 0.07 + j * 0.11, y, -0.02, 12));
  });
  // стеклянные дверцы
  const gh = H - split - 0.06;
  const gl = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.04, gh), glassMat);
  gl.position.set(0, split + 0.03 + gh / 2, D / 2 - 0.006); g.add(gl);
  g.add(box(W - 0.02, 0.025, 0.02, edge, 0, H - 0.05, D / 2 - 0.01, false), box(0.025, gh, 0.02, edge, 0, split + 0.03, D / 2 - 0.01, false));
  return g;
};

// ---------------------------------------------------------------- КПП и главная касса
// Холодильник бытовой (по грудь): корпус, дверь с ручкой, морозильная дверца сверху
B.homefridge = (W, D, H, p) => {
  const g = new THREE.Group();
  const white = new THREE.MeshPhongMaterial({ color: 0xf6f7f8, shininess: 40, specular: 0x444444 });
  g.add(box(W - 0.02, 0.06, D - 0.06, mat('#3a3d42'), 0, 0, -0.02));
  g.add(box(W, H - 0.06, D - 0.05, white, 0, 0.06, -0.025));
  const fz = Math.min(0.32, H * 0.28);
  g.add(box(W - 0.01, H - 0.08 - fz - 0.01, 0.05, white, 0, 0.07, D / 2 - 0.025));
  g.add(box(W - 0.01, fz, 0.05, white, 0, H - fz - 0.005, D / 2 - 0.025));
  g.add(box(W - 0.02, 0.006, 0.052, mat('#c9ced4'), 0, H - fz - 0.012, D / 2 - 0.025, false));
  const hdl = mat('#b9bec4');
  g.add(box(0.025, 0.3, 0.03, hdl, W / 2 - 0.07, H - fz - 0.4, D / 2 + 0.015));
  g.add(box(0.025, 0.14, 0.03, hdl, W / 2 - 0.07, H - fz + 0.08, D / 2 + 0.015));
  return g;
};
// Микроволновая печь: белый корпус, затемненное окно дверцы, панель управления, ручка
B.microwave = (W, D, H, p) => {
  const g = new THREE.Group();
  const mw = Math.min(W, 0.5), md = Math.min(D, 0.38), mh = Math.min(H, 0.29);
  const white = new THREE.MeshPhongMaterial({ color: 0xf8f8f8, shininess: 50, specular: 0x555555 });
  g.add(box(mw, mh, md, white, 0, 0, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cylY(0.012, 0.012, 0.012, mat('#333'), sx * (mw / 2 - 0.04), -0.012, sz * (md / 2 - 0.04), 8));
  const win = new THREE.Mesh(new THREE.PlaneGeometry(mw * 0.55, mh * 0.62), new THREE.MeshPhongMaterial({ color: 0x1d2329, shininess: 90, specular: 0x777777 }));
  win.position.set(-mw * 0.12, mh / 2, md / 2 + 0.002); g.add(win);
  g.add(box(0.02, mh * 0.6, 0.025, mat('#d0d4d8'), mw * 0.2, mh * 0.2, md / 2 + 0.012));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(mw * 0.2, mh * 0.82), mat('#eef0f2'));
  panel.position.set(mw * 0.37, mh / 2, md / 2 + 0.002); g.add(panel);
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(mw * 0.14, 0.03), screenMat);
  disp.position.set(mw * 0.37, mh * 0.8, md / 2 + 0.004); g.add(disp);
  for (let i = 0; i < 2; i++) {
    const k = cylY(0.018, 0.018, 0.015, mat('#9ea3a8'), 0, 0, 0, 14);
    k.rotation.x = Math.PI / 2; k.position.set(mw * 0.37, mh * (0.5 - i * 0.28), md / 2 + 0.01); g.add(k);
  }
  return g;
};
// Сейф: толстые стенки, дверь с петлями слева, кодовый замок и поворотная ручка
B.safe = (W, D, H, p) => {
  const g = new THREE.Group();
  const steelDark = new THREE.MeshPhongMaterial({ color: 0x3b4046, shininess: 35, specular: 0x555555 });
  g.add(box(W, H, D - 0.06, steelDark, 0, 0, -0.03));
  g.add(box(W - 0.06, H - 0.06, 0.06, mat('#454b52'), 0, 0.03, D / 2 - 0.03));
  for (const y of [0.15, H - 0.25]) g.add(cylY(0.018, 0.018, 0.1, steel(), -W / 2 + 0.02, y, D / 2 - 0.01, 10));
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.12), mat('#1f2328'));
  pad.position.set(W * 0.18, H * 0.68, D / 2 + 0.002); g.add(pad);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.02), screenMat);
  scr.position.set(W * 0.18, H * 0.68 + 0.04, D / 2 + 0.003); g.add(scr);
  const hub = cylY(0.035, 0.035, 0.03, steel(), 0, 0, 0, 16);
  hub.rotation.x = Math.PI / 2; hub.position.set(W * 0.18, H * 0.45, D / 2 + 0.015); g.add(hub);
  for (let i = 0; i < 3; i++) {
    const s = box(0.012, 0.11, 0.012, steel(), 0, 0, 0, false);
    s.position.set(W * 0.18, H * 0.45, D / 2 + 0.035); s.rotation.z = i * Math.PI / 3; g.add(s);
  }
  return g;
};
// АДМ (депозитарная машина): корпус, сенсорный экран, купюроприемник, кардридер, принтер, подсветка
B.adm = (W, D, H, p) => {
  const g = new THREE.Group();
  const body = new THREE.MeshPhongMaterial({ color: 0x4a5a6a, shininess: 30 });
  g.add(box(W, 0.08, D - 0.04, plinth(), 0, 0, -0.02));
  g.add(box(W, H - 0.08, D * 0.7, body, 0, 0.08, -D * 0.15));
  // наклонная лицевая часть с экраном
  const fascia = new THREE.Group();
  fascia.add(box(W - 0.02, 0.52, 0.06, mat('#dfe3e8'), 0, 0, 0));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.5, 0.26), screenMat); scr.position.set(0, 0.3, 0.031); fascia.add(scr);
  fascia.add(box(W * 0.5, 0.03, 0.03, mat('#111'), 0, 0.07, 0.03, false));
  fascia.position.set(0, H - 0.72, D * 0.2 + 0.06); fascia.rotation.x = -0.15;
  g.add(fascia);
  g.add(box(W, 0.9, D * 0.3, mat('#e9ebee'), 0, 0.08, D * 0.35));
  g.add(box(W * 0.5, 0.025, 0.03, mat('#111'), 0, 0.82, D / 2 + 0.002, false));
  g.add(box(0.08, 0.05, 0.03, mat('#111'), W * 0.3, 0.72, D / 2 + 0.002, false));
  g.add(box(W * 0.3, 0.015, 0.02, mat('#111'), -W * 0.2, 0.6, D / 2 + 0.002, false));
  g.add(box(W, 0.12, D * 0.7, mat('#1e5bd8'), 0, H - 0.12, -D * 0.15));
  const lbl = signPlane('АДМ', W * 0.6, 0.09, '#1e5bd8', '#ffffff');
  lbl.position.set(0, H - 0.06, D * 0.2 + 0.001); g.add(lbl);
  return g;
};

// Мелочи на обеденном столе: кружки, тарелка, салфетница, миска с фруктами, блокнот, бутылка воды
B.tableclutter = (W, D, H, p) => {
  const g = new THREE.Group();
  const white = new THREE.MeshPhongMaterial({ color: 0xfafafa, shininess: 60 });
  const mug = (x, z, c) => {
    g.add(cylY(0.04, 0.038, 0.095, mat(c), x, 0, z, 14));
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 6, 12), mat(c));
    h.position.set(x + 0.045, 0.05, z); g.add(h);
  };
  mug(-W * 0.3, D * 0.25, '#e57373'); mug(-W * 0.18, D * 0.3, '#64b5f6');
  g.add(cylY(0.12, 0.1, 0.018, white, W * 0.15, 0, D * 0.15, 20));
  g.add(cylY(0.03, 0.03, 0.04, mat('#d7a86e'), W * 0.15, 0.018, D * 0.15, 10));
  g.add(box(0.12, 0.09, 0.05, mat('#c9ced4'), W * 0.35, 0, -D * 0.3));
  g.add(box(0.1, 0.05, 0.03, white, W * 0.35, 0.06, -D * 0.3, false));
  const bowl = latheY([[0.03, 0], [0.11, 0.05], [0.12, 0.07], [0.0, 0.07]], mat('#5d4037'), -W * 0.05, 0, -D * 0.25, 18);
  g.add(bowl);
  for (const [dx, dz, c] of [[-0.04, 0, '#c62828'], [0.04, 0.01, '#9ccc65'], [0, -0.05, '#fb8c00'], [0.01, 0.05, '#c62828']]) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 8), mat(c));
    f.position.set(-W * 0.05 + dx, 0.075, -D * 0.25 + dz); f.castShadow = true; g.add(f);
  }
  g.add(box(0.15, 0.012, 0.21, mat('#1e5bd8'), -W * 0.3, 0, -D * 0.2));
  const pen = cylY(0.005, 0.005, 0.14, mat('#212121'), 0, 0, 0, 6);
  pen.rotation.z = Math.PI / 2; pen.position.set(-W * 0.3, 0.018, -D * 0.12); g.add(pen);
  g.add(latheY([[0.032, 0], [0.033, 0.17], [0.016, 0.21], [0.016, 0.23], [0, 0.23]], new THREE.MeshPhongMaterial({ color: 0xcfe9f7, shininess: 80 }), W * 0.38, 0, D * 0.3, 12));
  g.add(cylY(0.017, 0.017, 0.02, mat('#1565c0'), W * 0.38, 0.23, D * 0.3, 10));
  return g;
};

// Солонка, перечница, салфетница с салфетками, сахарница, зубочистки
B.condiments = (W, D, H, p) => {
  const g = new THREE.Group();
  const glass = new THREE.MeshPhongMaterial({ color: 0xe8f1f5, shininess: 90, transparent: true, opacity: 0.85 });
  const shaker = (x, z, cap) => {
    g.add(latheY([[0.022, 0], [0.024, 0.07], [0.02, 0.085], [0, 0.085]], glass, x, 0, z, 14));
    g.add(cylY(0.02, 0.021, 0.022, mat(cap), x, 0.083, z, 14));
  };
  shaker(-0.035, D * 0.15, '#c0c4c8');
  shaker(0.035, D * 0.15, '#2b2e33');
  // салфетница с салфетками
  const nx = W * 0.2, nz = -D * 0.15;
  g.add(box(0.15, 0.015, 0.07, mat('#c0c4c8'), nx, 0, nz));
  for (const s of [-1, 1]) g.add(box(0.14, 0.09, 0.006, mat('#c0c4c8'), nx, 0.015, nz + s * 0.032, false));
  g.add(box(0.13, 0.11, 0.05, mat('#ffffff'), nx, 0.015, nz, false));
  // сахарница с крышкой
  g.add(latheY([[0.04, 0], [0.05, 0.05], [0.045, 0.08], [0, 0.08]], new THREE.MeshPhongMaterial({ color: 0xfafafa, shininess: 60 }), -W * 0.25, 0, -D * 0.2, 16));
  g.add(cylY(0.012, 0.012, 0.02, mat('#fafafa'), -W * 0.25, 0.08, -D * 0.2, 10));
  // стаканчик с зубочистками
  g.add(cylY(0.018, 0.018, 0.06, mat('#8d6e63'), W * 0.3, 0, D * 0.3, 10));
  for (let i = 0; i < 6; i++) g.add(cylY(0.0015, 0.0015, 0.065, mat('#e8d3b0'), W * 0.3 + (i % 3 - 1) * 0.008, 0.02, D * 0.3 + (i < 3 ? -0.005 : 0.005), 4));
  return g;
};
