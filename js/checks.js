// Проверки: пересечения, проходы перед оборудованием, ширина маршрутов.
// Все расчеты в мм в координатах плана (x вправо, y вниз).

export const CUSTOMER_KINDS = new Set(['shelf', 'cold', 'fridge', 'chest', 'fresh', 'tobacco', 'bin', 'pallet']);

// ---------------------------------------------------------------- геометрия
export function partRects(it) {
  const t = it.rot * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  return it.parts.map((p, i) => {
    // local (lx,lz) -> plan: X = x + lx c + lz s ; Y = y - lx s + lz c
    const cx = it.x + p.x * c + p.z * s, cy = it.y - p.x * s + p.z * c;
    return { cx, cy, hw: p.w / 2, hd: p.d / 2, c, s, y0: p.y0 || 0, y1: (p.y0 || 0) + p.h, part: p, idx: i };
  });
}
// оси прямоугольника в плане: ex — локальная X, ez — локальная Z
function axes(r) { return [[r.c, -r.s], [r.s, r.c]]; }
export function rectCorners(r, shrink = 0) {
  const [ex, ez] = axes(r), a = r.hw - shrink, b = r.hd - shrink;
  return [[-a, -b], [a, -b], [a, b], [-a, b]].map(([u, v]) => [r.cx + ex[0] * u + ez[0] * v, r.cy + ex[1] * u + ez[1] * v]);
}
export function pointInRect(r, px, py, shrink = 0) {
  const dx = px - r.cx, dy = py - r.cy;
  const [ex, ez] = axes(r);
  const u = dx * ex[0] + dy * ex[1], v = dx * ez[0] + dy * ez[1];
  return Math.abs(u) <= r.hw - shrink && Math.abs(v) <= r.hd - shrink;
}
export function rectsOverlap(a, b, shrink = 3) {
  const ca = rectCorners(a, shrink), cb = rectCorners(b, shrink);
  for (const ax of [...axes(a), ...axes(b)]) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, y] of ca) { const p = x * ax[0] + y * ax[1]; a0 = Math.min(a0, p); a1 = Math.max(a1, p); }
    for (const [x, y] of cb) { const p = x * ax[0] + y * ax[1]; b0 = Math.min(b0, p); b1 = Math.max(b1, p); }
    if (a1 <= b0 || b1 <= a0) return false;
  }
  return true;
}

function pip(pts, x, y) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

// ---------------------------------------------------------------- растр стен (25 мм)
export class Raster {
  constructor(data, cell = 25) {
    const [bx0, by0, bx1, by1] = data.meta.bounds;
    this.cell = cell; this.x0 = bx0 - 200; this.y0 = by0 - 200;
    this.nx = Math.ceil((bx1 - bx0 + 400) / cell); this.ny = Math.ceil((by1 - by0 + 400) / cell);
    this.wall = new Uint8Array(this.nx * this.ny);   // 1 стена/фасад
    this.inside = new Uint8Array(this.nx * this.ny); // 1 внутри помещения
    const polys = data.walls.map(w => ({ pts: w.pts, holes: w.holes, bb: bbox(w.pts) }));
    const fl = data.floor, fbb = bbox(fl);
    for (let j = 0; j < this.ny; j++) {
      const y = this.y0 + (j + 0.5) * cell;
      for (let i = 0; i < this.nx; i++) {
        const x = this.x0 + (i + 0.5) * cell, k = j * this.nx + i;
        if (x >= fbb[0] && x <= fbb[2] && y >= fbb[1] && y <= fbb[3] && pip(fl, x, y)) this.inside[k] = 1;
        for (const p of polys) {
          if (x < p.bb[0] || x > p.bb[2] || y < p.bb[1] || y > p.bb[3]) continue;
          if (pip(p.pts, x, y) && !p.holes.some(h => pip(h, x, y))) { this.wall[k] = 1; break; }
        }
      }
    }
    // остекление как препятствие (кроме дверного проема витрины)
    for (const w of data.windows) {
      const segs = w.door ? [[w.x0, w.door[0]], [w.door[1], w.x1]] : [[w.x0, w.x1]];
      for (const [a, b] of segs) this.fillRect(a, w.y - 30, b, w.y + 30);
    }
  }
  fillRect(x0, y0, x1, y1) {
    const i0 = Math.max(0, Math.floor((x0 - this.x0) / this.cell)), i1 = Math.min(this.nx - 1, Math.floor((x1 - this.x0) / this.cell));
    const j0 = Math.max(0, Math.floor((y0 - this.y0) / this.cell)), j1 = Math.min(this.ny - 1, Math.floor((y1 - this.y0) / this.cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.wall[j * this.nx + i] = 1;
  }
  isWall(x, y) {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((y - this.y0) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return true;
    return this.wall[j * this.nx + i] === 1;
  }
  isInside(x, y) {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((y - this.y0) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return false;
    return this.inside[j * this.nx + i] === 1;
  }
}
function bbox(pts) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of pts) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  return [a, b, c, d];
}

// ---------------------------------------------------------------- пересечения
export function collisions(items, raster, beams) {
  const res = new Map(); // id -> [{type, text, other}]
  const add = (id, e) => { if (!res.has(id)) res.set(id, []); res.get(id).push(e); };
  const R = items.map(it => ({ it, rects: partRects(it) }));
  for (const { it, rects } of R) {
    let hitWall = false, outside = false;
    for (const r of rects) {
      if (r.y0 >= 600 && it.fixed) continue; // навесное инженерное оборудование на стене
      const [ex, ez] = axes(r);
      const a = r.hw - 20, b = r.hd - 20;
      if (a <= 0 || b <= 0) continue;
      const nu = Math.max(1, Math.ceil(2 * a / 40)), nv = Math.max(1, Math.ceil(2 * b / 40));
      for (let i = 0; i <= nu && !hitWall; i++) for (let j = 0; j <= nv; j++) {
        const u = -a + 2 * a * i / nu, v = -b + 2 * b * j / nv;
        const x = r.cx + ex[0] * u + ez[0] * v, y = r.cy + ex[1] * u + ez[1] * v;
        if (raster.isWall(x, y)) { hitWall = true; break; }
        if (!raster.isInside(x, y)) outside = true;
      }
    }
    if (!it.fixed) {
      if (hitWall) add(it.id, { type: 'wall', text: 'заходит в стену' });
      else if (outside) add(it.id, { type: 'out', text: 'стоит вне помещения' });
    }
    for (const bm of beams) {
      const [x0, y0, x1, y1] = bm.b;
      const br = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hw: (x1 - x0) / 2, hd: (y1 - y0) / 2, c: 1, s: 0 };
      if (rects.some(r => r.y1 > bm.y0 && rectsOverlap(r, br, 1))) { add(it.id, { type: 'beam', text: `выше низа ригеля (${bm.y0} мм)` }); break; }
    }
  }
  for (let a = 0; a < R.length; a++) for (let b = a + 1; b < R.length; b++) {
    const A = R[a], Bq = R[b];
    if (Math.abs(A.it.x - Bq.it.x) > (A.it.w + A.it.d + Bq.it.w + Bq.it.d) / 2 + 50 ||
        Math.abs(A.it.y - Bq.it.y) > (A.it.w + A.it.d + Bq.it.w + Bq.it.d) / 2 + 50) continue;
    let hit = false;
    for (const ra of A.rects) { for (const rb of Bq.rects) {
      if (ra.y1 <= rb.y0 || rb.y1 <= ra.y0) continue;
      if (rectsOverlap(ra, rb, 3)) { hit = true; break; }
    } if (hit) break; }
    if (hit) {
      add(A.it.id, { type: 'item', text: `пересекается с «${short(Bq.it)}»`, other: Bq.it.id });
      add(Bq.it.id, { type: 'item', text: `пересекается с «${short(A.it)}»`, other: A.it.id });
    }
  }
  return res;
}
export function short(it) { return it.code && it.code !== '?' ? `${it.code}` : it.name; }

// ---------------------------------------------------------------- проход перед лицевой стороной
export function frontClearance(it, items, raster, maxD = 4000) {
  const own = partRects(it);
  const others = [];
  for (const o of items) if (o !== it) for (const r of partRects(o)) if (r.y0 < 1200) others.push(r);
  const out = [];
  for (const r of own) {
    const p = r.part;
    if (!p.face || !CUSTOMER_KINDS.has(p.kind)) continue;
    if ((p.y0 || 0) > 300) continue;
    const lf = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] }[p.face];
    const [ex, ez] = axes(r);
    const nx = ex[0] * lf[0] + ez[0] * lf[1], ny = ex[1] * lf[0] + ez[1] * lf[1];
    const half = (lf[0] ? r.hw : r.hd), span = (lf[0] ? r.hd : r.hw);
    const tx = lf[0] ? ez[0] : ex[0], ty = lf[0] ? ez[1] : ex[1];
    const samples = [];
    const k = 5;
    for (let s = 0; s < k; s++) {
      const off = (-1 + 2 * (s + 0.5) / k) * Math.max(0, span - 60);
      const sx = r.cx + nx * (half + 2) + tx * off, sy = r.cy + ny * (half + 2) + ty * off;
      let d = 0;
      for (; d < maxD; d += 10) {
        const x = sx + nx * d, y = sy + ny * d;
        if (raster.isWall(x, y) || !raster.isInside(x, y)) break;
        let hit = false;
        for (const o of others) if (Math.abs(o.cx - x) < o.hw + o.hd + 5 && Math.abs(o.cy - y) < o.hw + o.hd + 5 && pointInRect(o, x, y)) { hit = true; break; }
        if (hit) break;
      }
      samples.push({ d, seg: [sx, sy, sx + nx * d, sy + ny * d] });
    }
    // медиана по ширине лицевой стороны: углы, где соседний стеллаж стоит встык, не искажают результат
    samples.sort((a, b) => a.d - b.d);
    const med = samples[Math.floor(samples.length / 2)];
    out.push({ part: r.idx, label: p.label || p.sign || '', d: med.d, seg: med.seg, open: med.d >= maxD });
  }
  return out;
}

// ---------------------------------------------------------------- маршруты
// Препятствия растрируются с шагом 25 мм, точное евклидово расстояние до них
// считается по Фельзенсвальбу; поиск пути идет по сетке 50 мм.
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
function edt(block, nx, ny) {
  const INF = 1e12, g = new Float64Array(nx * ny);
  for (let q = 0; q < nx * ny; q++) g[q] = block[q] ? 0 : INF;
  const n = Math.max(nx, ny), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) f[j] = g[j * nx + i];
    edt1d(f, ny, d, v, z);
    for (let j = 0; j < ny; j++) g[j * nx + i] = d[j];
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) f[i] = g[j * nx + i];
    edt1d(f, nx, d, v, z);
    for (let i = 0; i < nx; i++) g[j * nx + i] = d[i];
  }
  return g; // квадрат расстояния в клетках
}

export function routeCheck(routes, items, raster) {
  // 1) мелкая сетка = растр стен
  const fc = raster.cell, fnx = raster.nx, fny = raster.ny, X0 = raster.x0, Y0 = raster.y0;
  const fb = new Uint8Array(fnx * fny);
  for (let q = 0; q < fb.length; q++) fb[q] = raster.wall[q] || !raster.inside[q] ? 1 : 0;
  for (const it of items) for (const r of partRects(it)) {
    if (r.y0 >= 1200) continue;
    const ext = r.hw + r.hd;
    const i0 = Math.max(0, Math.floor((r.cx - ext - X0) / fc)), i1 = Math.min(fnx - 1, Math.floor((r.cx + ext - X0) / fc));
    const j0 = Math.max(0, Math.floor((r.cy - ext - Y0) / fc)), j1 = Math.min(fny - 1, Math.floor((r.cy + ext - Y0) / fc));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++)
      if (pointInRect(r, X0 + (i + 0.5) * fc, Y0 + (j + 0.5) * fc)) fb[j * fnx + i] = 1;
  }
  const d2 = edt(fb, fnx, fny);
  // 2) грубая сетка 50 мм: запас = лучший из 4 подклеток
  const k = 2, cell = fc * k, nx = Math.floor(fnx / k), ny = Math.floor(fny / k), N = nx * ny;
  const clear = new Float32Array(N), block = new Uint8Array(N);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let best = 0;
    for (let a = 0; a < k; a++) for (let c = 0; c < k; c++) {
      const q = (j * k + a) * fnx + (i * k + c);
      if (!fb[q]) best = Math.max(best, Math.sqrt(d2[q]) * fc); // без вычета полклетки: ближайший центр препятствия в среднем лежит у его границы
    }
    clear[j * nx + i] = best;
    block[j * nx + i] = best <= 0 ? 1 : 0;
  }
  const idx = (x, y) => {
    const i = Math.floor((x - X0) / cell), j = Math.floor((y - Y0) / cell);
    return (i < 0 || j < 0 || i >= nx || j >= ny) ? -1 : j * nx + i;
  };
  const snap = q => { // ближайшая свободная клетка
    if (q >= 0 && !block[q]) return q;
    if (q < 0) return -1;
    const i0 = q % nx, j0 = Math.floor(q / nx);
    for (let rr = 1; rr < 40; rr++) for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== rr) continue;
      const i = i0 + di, j = j0 + dj;
      if (i >= 0 && j >= 0 && i < nx && j < ny && !block[j * nx + i]) return j * nx + i;
    }
    return -1;
  };
  const nb = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const results = [];
  for (const rt of routes) {
    const s = snap(idx(...rt.from)), t = snap(idx(...rt.to));
    if (s < 0 || t < 0) { results.push({ ...rt, need: rt.width, width: 0, ok: false, path: [] }); continue; }
    // клетки рядом с началом и концом не ограничивают ширину: точки стоят у оборудования и дверей
    const R2 = (700 / cell) ** 2, si = s % nx, sj = Math.floor(s / nx), ti = t % nx, tj = Math.floor(t / nx);
    const nearEnd = q => { const i = q % nx, j = (q - i) / nx; return (i - si) ** 2 + (j - sj) ** 2 < R2 || (i - ti) ** 2 + (j - tj) ** 2 < R2; };
    const each = (q, fn) => {
      const i = q % nx, j = (q - i) / nx;
      for (const [di, dj] of nb) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const n = jj * nx + ii;
        if (block[n]) continue;
        if (di && dj && (block[j * nx + ii] || block[jj * nx + i])) continue;
        fn(n, di && dj ? 1.414 : 1);
      }
    };
    // проход 1: путь с максимальной шириной самого узкого места
    const best = new Float32Array(N).fill(-1);
    let heap = new Heap();
    best[s] = 1e9; heap.push(s, 1e9, 0);
    while (heap.size) {
      const [q, bv] = heap.pop();
      if (bv < best[q]) continue;
      if (q === t) break;
      each(q, n => {
        const nv = nearEnd(n) ? bv : Math.min(bv, clear[n]);
        if (nv > best[n]) { best[n] = nv; heap.push(n, nv, 0); }
      });
    }
    const B = best[t];
    if (B < 0) { results.push({ ...rt, need: rt.width, width: 0, ok: false, path: [] }); continue; }
    // проход 2: кратчайший путь по середине проходов, не уже найденного
    const cost = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    heap = new Heap();
    cost[s] = 0; heap.push(s, 0, 0);
    while (heap.size) {
      const [q, nc] = heap.pop();
      if (-nc > cost[q] + 1e-6) continue;
      if (q === t) break;
      each(q, (n, len) => {
        if (!nearEnd(n) && clear[n] < B - 1e-3) return;
        const c = cost[q] + len * (1 + 3 * Math.max(0, (650 - clear[n]) / 650));
        if (c < cost[n]) { cost[n] = c; prev[n] = q; heap.push(n, -c, 0); }
      });
    }
    const path = [];
    let bottleneck = null, bmin = Infinity;
    for (let q = t; q >= 0; q = prev[q]) {
      const x = X0 + (q % nx + 0.5) * cell, y = Y0 + (Math.floor(q / nx) + 0.5) * cell;
      path.push([x, y]);
      if (!nearEnd(q) && clear[q] < bmin) { bmin = clear[q]; bottleneck = [x, y]; }
      if (q === s) break;
    }
    path.reverse();
    const w = Math.round(2 * Math.min(B, 5000) / 10) * 10;
    results.push({ ...rt, need: rt.width, width: w, ok: w >= rt.width, path: simplify(path), bottleneck });
  }
  return results;
}
function simplify(path) {
  if (path.length < 3) return path;
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const [ax, ay] = out[out.length - 1], [bx, by] = path[i], [cx, cy] = path[i + 1];
    if (Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) > 1) out.push(path[i]);
  }
  out.push(path[path.length - 1]);
  return out;
}
class Heap { // max по b, затем min по d
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  less(x, y) { return x[1] < y[1] || (x[1] === y[1] && x[2] > y[2]); }
  push(q, b, d) {
    const a = this.a; a.push([q, b, d]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (this.less(a[p], a[i])) { [a[p], a[i]] = [a[i], a[p]]; i = p; } else break; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && this.less(a[m], a[l])) m = l;
        if (r < a.length && this.less(a[m], a[r])) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}
