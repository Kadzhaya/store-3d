import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/CSS2DRenderer.js';
import { M, buildItem, buildBuilding } from './build.js';
import { Raster, collisions, frontClearance, routeCheck, partRects, CUSTOMER_KINDS, short } from './checks.js';

const $ = s => document.querySelector(s);
const fmt = n => Math.round(n).toLocaleString('ru-RU');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GROUPS = {
  dry: 'Сухой ассортимент', alc: 'Алкоголь и табак', drinks: 'Напитки', fresh: 'Фреш и холод', frozen: 'Заморозка',
  promo: 'Промо', cash: 'Кассовая зона', decor: 'Декор', eng: 'Инженерия', staff: 'Служебное',
};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};

// ============================================================ загрузка
const data = await fetch('data/store.json').then(r => r.json());
const baseById = new Map(data.items.map(i => [i.id, i]));
const tplById = new Map(data.templates.map(t => [t.tid, t]));

// ============================================================ сцена
const view = $('#view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
view.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.inset = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
view.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef1f5);
const [bx0, by0, bx1, by1] = data.meta.bounds;
const center = new THREE.Vector3((bx0 + bx1) / 2 * M, 0, (by0 + by1) / 2 * M);
const span = Math.max(bx1 - bx0, by1 - by0) * M;

scene.add(new THREE.HemisphereLight(0xffffff, 0xb9b2a6, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(center.x - 6, 14, center.z + 9);
sun.target.position.copy(center);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 40 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const building = buildBuilding(data);
scene.add(building.root);

const persp = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
persp.position.set(center.x - 3, 13, center.z + 13);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
ortho.position.set(center.x, 30, center.z);
ortho.up.set(0, 0, -1);
ortho.lookAt(center);
const walkCam = new THREE.PerspectiveCamera(70, 1, 0.05, 100);

const orbit = new OrbitControls(persp, renderer.domElement);
orbit.target.copy(center);
orbit.maxPolarAngle = Math.PI * 0.49;
orbit.minDistance = 2; orbit.maxDistance = 45;
orbit.enableDamping = true;
orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
orbit.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
const planCtl = new OrbitControls(ortho, renderer.domElement);
planCtl.target.copy(center);
planCtl.enableRotate = false;
planCtl.screenSpacePanning = true;
planCtl.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
planCtl.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
planCtl.minZoom = 0.5; planCtl.maxZoom = 8;
planCtl.enabled = false;

let mode = 'orbit';
let camera = persp;

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  persp.aspect = walkCam.aspect = w / h;
  persp.updateProjectionMatrix(); walkCam.updateProjectionMatrix();
  const vs = span * 1.08, asp = w / h;
  const hw = asp >= 1 ? vs * asp / 2 : vs / 2, hh = asp >= 1 ? vs / 2 : vs / asp / 2;
  Object.assign(ortho, { left: -hw, right: hw, top: hh, bottom: -hh });
  ortho.updateProjectionMatrix();
  if (!fitted && w > 0) { // первый кадр: подогнать камеру под экран (на телефоне отодвинуть)
    fitted = true;
    const k = asp < 1.3 ? Math.min(2.2, 1.35 / asp) : 1;
    persp.position.set(center.x - 3 * k, 13 * k, center.z + 13 * k);
    orbit.update();
  }
}
let fitted = false;
new ResizeObserver(resize).observe(view);

// ============================================================ состояние расстановки
const objs = new Map();   // id -> { it, g, label }
let selId = null;
let seq = 1;
const itemsRoot = new THREE.Group();
scene.add(itemsRoot);

function defFor(tid) {
  if (tid.startsWith('dup:')) {
    const src = tid.slice(4);
    const b = baseById.get(src) || defFor(src);
    return b;
  }
  const t = tplById.get(tid);
  if (!t) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, h = 0;
  for (const p of t.parts) { x0 = Math.min(x0, p.x - p.w / 2); x1 = Math.max(x1, p.x + p.w / 2); z0 = Math.min(z0, p.z - p.d / 2); z1 = Math.max(z1, p.z + p.d / 2); h = Math.max(h, p.y0 + p.h); }
  const cats = [...new Set(t.parts.flatMap(p => p.cats || []))];
  return { id: tid, name: t.name, code: t.code, g: t.g, w: x1 - x0, d: z1 - z0, h, hsrc: t.hsrc, spec: t.spec, parts: t.parts, cats, fixed: false, note: t.group === 'Не удалось разместить' ? 'Из блока «Не удалось разместить»' : '' };
}

function makeObj(def, id, x, y, rot, extra = {}) {
  const it = { ...def, id, x, y, rot, ...extra };
  const g = buildItem(it);
  g.userData.id = id;
  g.position.set(x * M, 0, y * M);
  g.rotation.y = rot * Math.PI / 180;
  const div = document.createElement('div');
  div.className = 'lbl';
  div.innerHTML = `<b>${esc(it.code)}</b>`;
  const label = new CSS2DObject(div);
  label.position.set(g.userData.centerLocal.x, g.userData.topY + 0.35, g.userData.centerLocal.z);
  g.add(label);
  itemsRoot.add(g);
  const o = { it, g, label, div };
  objs.set(id, o);
  return o;
}
function removeObj(id) {
  const o = objs.get(id);
  if (!o) return;
  o.g.remove(o.label);
  o.label.element.remove();
  itemsRoot.remove(o.g);
  o.g.traverse(m => { if (m.geometry) m.geometry.dispose(); });
  objs.delete(id);
}
function setPose(o, x, y, rot) {
  o.it.x = x; o.it.y = y; o.it.rot = ((rot % 360) + 540) % 360 - 180;
  o.g.position.set(x * M, 0, y * M);
  o.g.rotation.y = o.it.rot * Math.PI / 180;
}

function snapshot() {
  const m = {}, del = [], add = [];
  for (const b of data.items) {
    const o = objs.get(b.id);
    if (!o) { del.push(b.id); continue; }
    if (o.it.x !== b.x || o.it.y !== b.y || o.it.rot !== b.rot) m[b.id] = [o.it.x, o.it.y, o.it.rot];
  }
  for (const o of objs.values()) if (o.it.tid) add.push([o.it.tid, o.it.id, o.it.x, o.it.y, o.it.rot]);
  return { v: 1, m, del, add };
}
function applyState(st) {
  for (const id of [...objs.keys()]) removeObj(id);
  selId = null;
  const del = new Set(st?.del || []);
  for (const b of data.items) {
    if (del.has(b.id)) continue;
    const p = st?.m?.[b.id];
    makeObj(b, b.id, p ? p[0] : b.x, p ? p[1] : b.y, p ? p[2] : b.rot);
  }
  for (const [tid, id, x, y, rot] of st?.add || []) {
    const def = defFor(tid);
    if (!def) continue;
    makeObj(def, id, x, y, rot, { tid, fixed: false });
    const n = parseInt(String(id).replace(/\D/g, ''), 10);
    if (n >= seq) seq = n + 1;
  }
  applyLabels();
  refreshSelection();
  scheduleChecks();
}

// история
const undo = [], redo = [];
function commit() {
  undo.push(JSON.stringify(lastState));
  if (undo.length > 100) undo.shift();
  redo.length = 0;
  lastState = snapshot();
  syncUndoBtns();
  scheduleChecks();
  saveAuto();
}
let lastState = null;
function doUndo() {
  if (!undo.length) return;
  redo.push(JSON.stringify(snapshot()));
  const st = JSON.parse(undo.pop());
  const keep = selId;
  applyState(st); lastState = snapshot();
  if (keep && objs.has(keep)) select(keep);
  syncUndoBtns(); saveAuto();
}
function doRedo() {
  if (!redo.length) return;
  undo.push(JSON.stringify(snapshot()));
  const st = JSON.parse(redo.pop());
  const keep = selId;
  applyState(st); lastState = snapshot();
  if (keep && objs.has(keep)) select(keep);
  syncUndoBtns(); saveAuto();
}
function syncUndoBtns() { $('#bUndo').disabled = !undo.length; $('#bRedo').disabled = !redo.length; }
function saveAuto() { store.set('store3d.auto', snapshot()); }

// ============================================================ выделение и панель «Объект»
function select(id) {
  selId = id && objs.has(id) ? id : null;
  refreshSelection();
  renderObjPane();
  if (selId) showTab('obj');
}
function refreshSelection() {
  for (const [id, o] of objs) {
    const on = id === selId;
    o.g.userData.frame.visible = on;
    o.g.userData.foot.visible = on && mode !== 'walk';
    o.div.classList.toggle('sel', on);
  }
  drawClearance();
}

const clearanceGroup = new THREE.Group();
scene.add(clearanceGroup);
function clrColor(d) { return d >= 1200 ? '#1f8a4c' : d >= 900 ? '#c77700' : '#c62828'; }
function drawClearance() {
  for (const c of [...clearanceGroup.children]) { clearanceGroup.remove(c); if (c.element) c.element.remove(); }
  if (!selId || mode === 'walk') return;
  const o = objs.get(selId);
  for (const f of frontClearance(o.it, [...objs.values()].map(v => v.it), raster)) {
    if (!f.seg || f.open) continue;
    const [x0, y0, x1, y1] = f.seg;
    const col = clrColor(f.d);
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x0 * M, 0.02, y0 * M), new THREE.Vector3(x1 * M, 0.02, y1 * M)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: col, depthTest: false }));
    line.renderOrder = 11;
    clearanceGroup.add(line);
    const el = document.createElement('div');
    el.className = 'dim'; el.style.background = col; el.textContent = `${fmt(f.d)} мм`;
    const lab = new CSS2DObject(el);
    lab.position.set((x0 + x1) / 2 * M, 0.05, (y0 + y1) / 2 * M);
    clearanceGroup.add(lab);
  }
}

function renderObjPane() {
  const pane = $('#paneObj');
  if (!selId) {
    pane.innerHTML = `<p class="empty">Нажмите на оборудование, чтобы увидеть его параметры и выкладку.</p>
      <h3>Как двигать</h3>
      <ul class="legend" style="padding-left:18px;margin:0">
        <li>Перетащите объект мышкой или пальцем. Шаг сетки 50 мм.</li>
        <li><kbd>R</kbd> повернуть на 90°, стрелки сдвигают на 10 мм, <kbd>Del</kbd> удалить.</li>
        <li>Инженерное оборудование (стояки, радиаторы, щит) зафиксировано.</li>
      </ul>
      <h3>Цвета проходов</h3>
      <div class="legend"><span class="clr ok"><span class="dot" style="background:#1f8a4c"></span>от 1200 мм</span> ·
      <span class="clr warn"><span class="dot" style="background:#c77700"></span>900–1200</span> ·
      <span class="clr bad"><span class="dot" style="background:#c62828"></span>меньше 900</span><br>
      Ориентир 1200 мм взят из легенды схемы (транспортный коридор).</div>`;
    return;
  }
  const o = objs.get(selId), it = o.it;
  const base = baseById.get(it.id);
  const moved = base && (base.x !== it.x || base.y !== it.y || base.rot !== it.rot);
  const issues = lastChecks?.coll.get(it.id) || [];
  const fronts = frontClearance(it, [...objs.values()].map(v => v.it), raster);
  const cats = it.cats || [];
  const sections = it.parts.filter(p => p.cats && p.cats.length);
  pane.innerHTML = `
    <h2>${esc(it.name)}</h2>
    <div class="code">${esc(it.code)} · ${esc(GROUPS[it.g] || '')}${it.tid ? ' · добавлено' : moved ? ' · перемещено' : ''}</div>
    ${issues.length ? `<div class="note" style="background:#fdecec;border-color:#f3b9b9"><b class="bad">Внимание:</b> ${issues.map(i => esc(i.text)).join('; ')}</div>` : ''}
    <h3>Параметры</h3>
    <dl class="kv">
      <dt>Габариты</dt><dd>${fmt(it.w)} × ${fmt(it.d)} мм, высота ${fmt(it.h)} мм ${it.hsrc === 'типовое' ? '<span class="chip typ" title="Высоты нет на схеме, взято типовое значение">типовое</span>' : ''}</dd>
      ${it.spec ? `<dt>По схеме</dt><dd>${esc(it.spec)}</dd>` : ''}
      ${it.temp ? `<dt>Режим</dt><dd>${esc(it.temp)}</dd>` : ''}
      <dt>Центр</dt><dd>X ${fmt(it.x)} · Y ${fmt(it.y)} мм, поворот ${it.rot}°</dd>
    </dl>
    ${it.note ? `<div class="note">${esc(it.note)}</div>` : ''}
    ${fronts.length ? `<h3>Проход перед лицевой стороной</h3>${fronts.map(f => `<div class="clr" style="color:${f.open ? '#1f8a4c' : clrColor(f.d)}"><span class="dot" style="background:${f.open ? '#1f8a4c' : clrColor(f.d)}"></span>${f.open ? 'больше 4 м' : fmt(f.d) + ' мм'}${f.label && fronts.length > 1 ? ` <span class="code">· ${esc(f.label)}</span>` : ''}</div>`).join('')}` : ''}
    ${sections.length > 1 ? `<h3>Выкладка по секциям</h3>${sections.map(p => `<div style="margin-bottom:8px"><div class="code">${esc(p.label || p.sign || '')}</div><div class="chips">${p.cats.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div></div>`).join('')}`
      : cats.length ? `<h3>Выкладка</h3><div class="chips">${cats.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div>` : ''}
    <h3>Действия</h3>
    ${it.fixed ? '<p class="empty">Объект зафиксирован: это инженерное оборудование или конструкция.</p>' : `
    <div class="row">
      <button data-act="rotL" title="Повернуть против часовой">↺ 90°</button>
      <button data-act="rotR" title="Повернуть по часовой (R)">↻ 90°</button>
      <button data-act="rot15" title="Повернуть на 15°">↻ 15°</button>
      <button data-act="dup">Копия</button>
      <button data-act="del" style="color:var(--bad)">Удалить</button>
    </div>
    <div class="row">
      <label>X <input class="num" data-f="x" type="number" step="10" value="${it.x}"></label>
      <label>Y <input class="num" data-f="y" type="number" step="10" value="${it.y}"></label>
      <label>° <input class="num" data-f="rot" type="number" step="15" value="${it.rot}" style="width:70px"></label>
    </div>
    ${base && moved ? '<div class="row"><button data-act="back">Вернуть на место по схеме</button></div>' : ''}`}
  `;
  pane.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act));
  pane.querySelectorAll('[data-f]').forEach(inp => inp.onchange = () => {
    const v = Number(inp.value);
    if (!Number.isFinite(v)) return;
    const n = { x: it.x, y: it.y, rot: it.rot, [inp.dataset.f]: v };
    setPose(o, n.x, n.y, n.rot); commit(); renderObjPane(); drawClearance();
  });
}

function act(a) {
  const o = objs.get(selId);
  if (!o || o.it.fixed) return;
  const it = o.it;
  if (a === 'rotR') setPose(o, it.x, it.y, it.rot - 90);
  if (a === 'rotL') setPose(o, it.x, it.y, it.rot + 90);
  if (a === 'rot15') setPose(o, it.x, it.y, it.rot - 15);
  if (a === 'back') { const b = baseById.get(it.id); setPose(o, b.x, b.y, b.rot); }
  if (a === 'del') { removeObj(selId); selId = null; commit(); renderObjPane(); refreshSelection(); toast('Объект удален. Отменить: ↶'); return; }
  if (a === 'dup') {
    const id = 'n' + seq++;
    const tid = it.tid || 'dup:' + it.id;
    const def = defFor(tid);
    const n = makeObj(def, id, it.x + 300, it.y + 300, it.rot, { tid, fixed: false });
    applyLabels();
    commit(); select(n.it.id); return;
  }
  commit(); renderObjPane(); drawClearance();
}

// ============================================================ перетаскивание
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let drag = null, downAt = null;

function pickAt(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(itemsRoot.children, true);
  for (const h of hits) {
    if (h.object.userData.isFrame) continue;
    let g = h.object;
    while (g && !g.userData.id) g = g.parent;
    if (g) return { id: g.userData.id, point: h.point };
  }
  return null;
}
function floorPoint(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const p = new THREE.Vector3();
  return ray.ray.intersectPlane(floorPlane, p) ? p : null;
}

renderer.domElement.addEventListener('pointerdown', ev => {
  downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() };
  if (mode === 'walk') return;
  const hit = pickAt(ev);
  if (!hit) return;
  const o = objs.get(hit.id);
  if (o.it.fixed) return;
  const fp = floorPoint(ev);
  if (!fp) return;
  drag = { id: hit.id, ox: o.it.x - fp.x / M, oy: o.it.y - fp.z / M, moved: false, pid: ev.pointerId, sx: ev.clientX, sy: ev.clientY };
  orbit.enabled = false; planCtl.enabled = false;
  renderer.domElement.setPointerCapture(ev.pointerId);
});
renderer.domElement.addEventListener('pointermove', ev => {
  if (drag && ev.pointerId === drag.pid) {
    if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 4) return;
    if (!drag.moved) { drag.moved = true; if (selId !== drag.id) select(drag.id); }
    const fp = floorPoint(ev);
    if (!fp) return;
    const step = ev.altKey ? 10 : 50;
    const o = objs.get(drag.id);
    const x = Math.round((fp.x / M + drag.ox) / step) * step, y = Math.round((fp.z / M + drag.oy) / step) * step;
    setPose(o, x, y, o.it.rot);
    liveCollision(o);
    drawClearance();
    return;
  }
  if (mode !== 'walk' && ev.pointerType === 'mouse' && !ev.buttons) {
    const h = pickAt(ev);
    renderer.domElement.style.cursor = h ? (objs.get(h.id).it.fixed ? 'pointer' : 'grab') : '';
  }
});
function endDrag(ev) {
  if (drag) {
    const moved = drag.moved;
    try { renderer.domElement.releasePointerCapture(drag.pid); } catch {}
    drag = null;
    orbit.enabled = mode === 'orbit'; planCtl.enabled = mode === 'plan';
    if (moved) { commit(); renderObjPane(); return; }
  }
  if (downAt && Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) < 5) {
    const h = pickAt(ev);
    select(h ? h.id : null);
  }
  downAt = null;
}
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);

function liveCollision(o) {
  const res = collisions([o.it, ...[...objs.values()].filter(v => v !== o).map(v => v.it)], raster, []);
  const bad = (res.get(o.it.id) || []).some(e => e.type !== 'beam');
  o.g.userData.frame.material.color.set(bad ? 0xc62828 : 0x1e5bd8);
  o.g.userData.foot.material.color.set(bad ? 0xc62828 : 0x1e5bd8);
}

// ============================================================ проверки
const raster = new Raster(data, 25);
let lastChecks = null, checkTimer = 0;
const routeGroup = new THREE.Group();
scene.add(routeGroup);
let showRoutes = false;
function scheduleChecks() { clearTimeout(checkTimer); checkTimer = setTimeout(runChecks, 120); }
function runChecks() {
  const items = [...objs.values()].map(o => o.it);
  const coll = collisions(items, raster, []);
  const fronts = [];
  for (const it of items) for (const f of frontClearance(it, items, raster)) if (!f.open) fronts.push({ it, ...f });
  fronts.sort((a, b) => a.d - b.d);
  const routes = routeCheck(data.routes, items, raster);
  lastChecks = { coll, fronts, routes };
  for (const [id, o] of objs) {
    const bad = (coll.get(id) || []).some(e => e.type !== 'beam');
    o.div.classList.toggle('bad', bad && id !== selId);
    o.g.userData.frame.material.color.set(bad ? 0xc62828 : 0x1e5bd8);
    o.g.userData.foot.material.color.set(bad ? 0xc62828 : 0x1e5bd8);
  }
  renderChecks();
  drawRoutes();
  if (selId) renderObjPane();
}
function renderChecks() {
  const { coll, fronts, routes } = lastChecks;
  const collList = [];
  const seen = new Set();
  for (const [id, es] of coll) for (const e of es) {
    if (e.type === 'item') { const k = [id, e.other].sort().join('|'); if (seen.has(k)) continue; seen.add(k); }
    collList.push({ id, e });
  }
  const hard = collList.filter(c => c.e.type !== 'beam');
  const badRoutes = routes.filter(r => !r.ok);
  const narrow = fronts.filter(f => f.d < 1200);
  const badge = $('#chkBadge');
  const n = hard.length + badRoutes.length;
  badge.hidden = !(n || narrow.length);
  badge.textContent = n || narrow.length;
  badge.classList.toggle('warn', !n);
  const it = id => objs.get(id)?.it;
  $('#paneChk').innerHTML = `
    <h3 style="margin-top:0">Маршруты</h3>
    <ul class="list">${routes.map((r, i) => `<li data-route="${i}"><span class="dot" style="margin-top:6px;background:${r.ok ? '#1f8a4c' : '#c62828'}"></span>
      <span class="t">${esc(r.name)}<small>нужно не менее ${fmt(r.need)} мм${r.need >= 1200 ? ' (ориентир по легенде схемы)' : ''}${r.bottleneck && !r.ok ? `; узкое место: ${esc(nearestName(r.bottleneck))}` : ''}</small></span>
      <span class="v ${r.ok ? 'ok' : 'bad'}">≈ ${fmt(r.width)} мм</li>`).join('')}</ul>
    <div class="row" style="margin-top:8px"><button id="bRoutes" class="${showRoutes ? 'primary' : ''}">${showRoutes ? 'Скрыть маршруты на плане' : 'Показать маршруты на плане'}</button></div>
    <p class="legend">Ширина — самое узкое место на лучшем пути между точками, с точностью около ±50 мм. Красная точка на плане показывает это место.</p>
    <h3>Пересечения ${hard.length ? `<span class="badge">${hard.length}</span>` : ''}</h3>
    ${hard.length ? `<ul class="list">${hard.map(c => `<li data-id="${c.id}"><span class="dot" style="margin-top:6px;background:#c62828"></span><span class="t">${esc(short(it(c.id)))} <small>${esc(it(c.id).name)}</small></span><span class="v bad">${esc(c.e.text)}</span></li>`).join('')}</ul>` : '<p class="empty">Нет. Оборудование не заходит в стены и друг в друга.</p>'}
    ${collList.some(c => c.e.type === 'beam') ? `<h3>Ригели</h3><ul class="list">${collList.filter(c => c.e.type === 'beam').map(c => `<li data-id="${c.id}"><span class="dot" style="margin-top:6px;background:#c77700"></span><span class="t">${esc(short(it(c.id)))}</span><span class="v warn">${esc(c.e.text)}</span></li>`).join('')}</ul>` : ''}
    <h3>Проходы перед оборудованием уже 1200 мм</h3>
    ${narrow.length ? `<ul class="list">${narrow.map(f => `<li data-id="${f.it.id}"><span class="dot" style="margin-top:6px;background:${clrColor(f.d)}"></span><span class="t">${esc(short(f.it))}${f.label ? ` <small>${esc(f.label)}</small>` : `<small>${esc(f.it.name)}</small>`}</span><span class="v" style="color:${clrColor(f.d)}">${fmt(f.d)} мм</span></li>`).join('')}</ul>` : '<p class="empty">Нет узких мест.</p>'}
    <p class="legend">Проход меряется от лицевой стороны до ближайшего препятствия по перпендикуляру. В исходной схеме часть проходов тоже меньше 1200 мм, это проектное решение.</p>`;
  $('#paneChk').querySelectorAll('[data-id]').forEach(li => li.onclick = () => { select(li.dataset.id); focusOn(li.dataset.id); });
  $('#paneChk').querySelectorAll('[data-route]').forEach(li => li.onclick = () => { showRoutes = true; drawRoutes(+li.dataset.route); renderChecks(); });
  $('#bRoutes').onclick = () => { showRoutes = !showRoutes; drawRoutes(); renderChecks(); };
}
function nearestName([x, y]) {
  let best = null, bd = Infinity;
  for (const o of objs.values()) {
    if (o.it.fixed) continue;
    for (const r of partRects(o.it)) {
      const dx = x - r.cx, dy = y - r.cy;
      const u = Math.max(0, Math.abs(dx * r.c - dy * r.s) - r.hw), v = Math.max(0, Math.abs(dx * r.s + dy * r.c) - r.hd);
      const d = Math.hypot(u, v);
      if (d < bd) { bd = d; best = o.it; }
    }
  }
  return best && bd < 1500 ? `у «${short(best)}»` : 'проем в стене';
}
function drawRoutes(only) {
  for (const c of [...routeGroup.children]) { routeGroup.remove(c); if (c.element) c.element.remove(); }
  if (!showRoutes || !lastChecks) return;
  lastChecks.routes.forEach((r, i) => {
    if (only != null && only !== i) return;
    if (!r.path.length) return;
    const col = r.ok ? 0x1f8a4c : 0xc62828;
    const pts = r.path.map(([x, y]) => new THREE.Vector3(x * M, 0.03 + i * 0.002, y * M));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: col, dashSize: 0.18, gapSize: 0.1, depthTest: false }));
    line.computeLineDistances(); line.renderOrder = 12;
    routeGroup.add(line);
    if (r.bottleneck) {
      const s = new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), new THREE.MeshBasicMaterial({ color: col, depthTest: false }));
      s.rotation.x = -Math.PI / 2; s.position.set(r.bottleneck[0] * M, 0.04, r.bottleneck[1] * M); s.renderOrder = 13;
      routeGroup.add(s);
      const el = document.createElement('div');
      el.className = 'dim'; el.style.background = r.ok ? '#1f8a4c' : '#c62828'; el.textContent = `≈ ${fmt(r.width)}`;
      const lab = new CSS2DObject(el); lab.position.set(r.bottleneck[0] * M, 0.1, r.bottleneck[1] * M);
      routeGroup.add(lab);
    }
  });
}
function focusOn(id) {
  const o = objs.get(id);
  if (!o) return;
  const p = new THREE.Vector3(o.it.x * M, 0, o.it.y * M);
  if (mode === 'plan') { planCtl.target.copy(p); ortho.position.set(p.x, 30, p.z); ortho.zoom = Math.max(ortho.zoom, 2); ortho.updateProjectionMatrix(); }
  else if (mode === 'orbit') { const d = persp.position.clone().sub(orbit.target); orbit.target.copy(p); persp.position.copy(p).add(d.setLength(Math.min(d.length(), 8))); }
}

// ============================================================ режимы
const HUD = {
  plan: 'Вид сверху. <kbd>ЛКМ</kbd> по пустому месту двигает план, колесо приближает. Перетаскивайте оборудование мышкой, <kbd>R</kbd> поворот, <kbd>Alt</kbd> шаг 10 мм.',
  orbit: '<kbd>ЛКМ</kbd> вращать, <kbd>ПКМ</kbd> сдвигать, колесо приближать. Перетаскивайте оборудование мышкой, <kbd>R</kbd> поворот.',
  walk: 'Прогулка: <kbd>W A S D</kbd> или стрелки — идти, мышью с нажатой кнопкой — смотреть. Клик по оборудованию показывает его параметры.',
};
function setMode(m) {
  mode = m;
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  orbit.enabled = m === 'orbit';
  planCtl.enabled = m === 'plan';
  camera = m === 'plan' ? ortho : m === 'walk' ? walkCam : persp;
  $('#walkpad').hidden = m !== 'walk';
  $('#hud').innerHTML = HUD[m];
  building.beams.visible = m !== 'plan';
  if (m === 'walk') {
    if (!walk.init) { walk.x = 1900; walk.y = 9700; walk.yaw = 0; walk.pitch = 0; walk.init = true; }
    walk.lowWallsWas = lowWalls; if (lowWalls) setLowWalls(false);
  } else if (walk.lowWallsWas) { setLowWalls(true); walk.lowWallsWas = false; }
  applyLabels();
  refreshSelection();
}
document.querySelectorAll('.seg button').forEach(b => b.onclick = () => setMode(b.dataset.mode));

let labelsOn = window.innerWidth > 700, lowWalls = false;
$('#bLabels').classList.toggle('on', labelsOn);
function applyLabels() {
  for (const o of objs.values()) o.label.visible = labelsOn && mode !== 'walk' && !o.it.id.startsWith('rad-') && !o.it.id.startsWith('riser-') || o.it.id === selId && mode !== 'walk';
}
$('#bLabels').onclick = e => { labelsOn = !labelsOn; e.currentTarget.classList.toggle('on', labelsOn); applyLabels(); };
function setLowWalls(on) {
  lowWalls = on;
  $('#bLow').classList.toggle('on', on);
  building.walls.scale.y = on ? 1200 / data.meta.ceiling : 1;
  building.beams.visible = !on && mode !== 'plan';
  building.doors.tall.visible = !on; // дуги открывания на полу остаются
  if (building.facade) building.facade.root.visible = !on;
}
$('#bLow').onclick = () => setLowWalls(!lowWalls);
$('#bStreet').onclick = () => {
  if (lowWalls) setLowWalls(false);
  setMode('orbit');
  const fy = (data.facade?.y ?? by1) * M, x = 6.7;
  orbit.target.set(x, 3.2, fy);
  persp.position.set(x - 2.5, 2.2, fy + 12);
  orbit.update();
  toast('Вид на вход с улицы. Вращайте мышкой, чтобы осмотреть фасад');
};

// ---------------------------------------------------------------- прогулка
const walk = { x: 0, y: 0, yaw: 0, pitch: 0, keys: new Set(), look: null, init: false };
const keyMap = { KeyW: 'fw', ArrowUp: 'fw', KeyS: 'bw', ArrowDown: 'bw', KeyA: 'sl', KeyD: 'sr', ArrowLeft: 'lt', ArrowRight: 'rt', KeyQ: 'lt', KeyE: 'rt' };
renderer.domElement.addEventListener('pointerdown', ev => {
  if (mode !== 'walk') return;
  walk.look = { x: ev.clientX, y: ev.clientY, yaw: walk.yaw, pitch: walk.pitch, id: ev.pointerId };
});
window.addEventListener('pointermove', ev => {
  if (mode !== 'walk' || !walk.look || walk.look.id !== ev.pointerId) return;
  const k = ev.pointerType === 'mouse' ? 0.004 : 0.006;
  walk.yaw = walk.look.yaw - (ev.clientX - walk.look.x) * k;
  walk.pitch = Math.max(-1.2, Math.min(1.2, walk.look.pitch - (ev.clientY - walk.look.y) * k));
});
window.addEventListener('pointerup', ev => { if (walk.look && walk.look.id === ev.pointerId) walk.look = null; });
document.querySelectorAll('#walkpad button').forEach(b => {
  const k = b.dataset.k;
  b.addEventListener('pointerdown', e => { e.preventDefault(); walk.keys.add(k); b.setPointerCapture(e.pointerId); });
  const up = () => walk.keys.delete(k);
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
});
const FY = data.facade ? data.facade.y : Infinity;
// Тротуар: за линией фасада можно ходить; у самого фасада мешают только стены и стекло
function walkBlocked(x, y) {
  if (x < -2500 || x > 16000 || y > FY + 5000) return true;
  if (y > FY + 150) return false;
  if (raster.isWall(x, y)) return true;
  if (y < FY - 200 && !raster.isInside(x, y)) return true;
  for (const o of objs.values()) {
    if (Math.abs(o.it.x - x) > (o.it.w + o.it.d) || Math.abs(o.it.y - y) > (o.it.w + o.it.d)) continue;
    for (const r of partRects(o.it)) if (r.y0 < 1500 && Math.abs(r.cx - x) < r.hw + r.hd + 250 && Math.abs(r.cy - y) < r.hw + r.hd + 250) {
      const dx = x - r.cx, dy = y - r.cy;
      const u = dx * r.c - dy * r.s, v = dx * r.s + dy * r.c;
      if (Math.abs(u) < r.hw + 200 && Math.abs(v) < r.hd + 200) return true;
    }
  }
  return false;
}
function stepWalk(dt) {
  const turn = 1.8 * dt;
  if (walk.keys.has('lt')) walk.yaw += turn;
  if (walk.keys.has('rt')) walk.yaw -= turn;
  let f = 0, s = 0;
  if (walk.keys.has('fw')) f += 1;
  if (walk.keys.has('bw')) f -= 1;
  if (walk.keys.has('sl')) s -= 1;
  if (walk.keys.has('sr')) s += 1;
  if (f || s) {
    const sp = 1400 * dt; // мм/с
    const fx = -Math.sin(walk.yaw), fy = -Math.cos(walk.yaw);
    const rx = -fy, ry = fx;
    const dx = (fx * f + rx * s) * sp, dy = (fy * f + ry * s) * sp;
    if (!walkBlocked(walk.x + dx, walk.y)) walk.x += dx;
    if (!walkBlocked(walk.x, walk.y + dy)) walk.y += dy;
  }
  walkCam.position.set(walk.x * M, 1.6, walk.y * M);
  walkCam.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
}

// ============================================================ клавиатура
window.addEventListener('keydown', ev => {
  if (ev.target.closest('input, textarea, dialog[open]')) return;
  if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyZ') { ev.preventDefault(); ev.shiftKey ? doRedo() : doUndo(); return; }
  if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyY') { ev.preventDefault(); doRedo(); return; }
  if (ev.code === 'Digit1') return setMode('plan');
  if (ev.code === 'Digit2') return setMode('orbit');
  if (ev.code === 'Digit3') return setMode('walk');
  if (mode === 'walk' && keyMap[ev.code]) { walk.keys.add(keyMap[ev.code]); ev.preventDefault(); return; }
  if (!selId) return;
  const o = objs.get(selId);
  if (ev.code === 'Escape') return select(null);
  if (o.it.fixed) return;
  if (ev.code === 'KeyR') { act(ev.shiftKey ? 'rotL' : 'rotR'); return; }
  if (ev.code === 'Delete' || ev.code === 'Backspace') { ev.preventDefault(); act('del'); return; }
  const nudge = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[ev.code];
  if (nudge) {
    ev.preventDefault();
    const k = ev.shiftKey ? 5 : 1;
    setPose(o, o.it.x + nudge[0] * k, o.it.y + nudge[1] * k, o.it.rot);
    drawClearance(); clearTimeout(o._nt); o._nt = setTimeout(() => { commit(); renderObjPane(); }, 400);
  }
});
window.addEventListener('keyup', ev => { if (keyMap[ev.code]) walk.keys.delete(keyMap[ev.code]); });

// ============================================================ панель «Добавить»
function renderAddPane() {
  const groups = {};
  for (const t of data.templates) (groups[t.group] ||= []).push(t);
  $('#paneAdd').innerHTML = Object.entries(groups).map(([g, ts]) => `<h3${g === Object.keys(groups)[0] ? ' style="margin-top:0"' : ''}>${esc(g)}</h3>` +
    ts.map(t => `<button class="tpl" data-tid="${t.tid}"><span class="sw" style="background:${t.parts[0].color}"></span><span><b>${esc(t.name)}</b><small>${esc(t.code)}${t.spec ? ' · ' + esc(t.spec) : ''}</small></span></button>`).join('')).join('') +
    '<p class="legend">Новый объект появится в центре экрана. Перетащите его на нужное место.</p>';
  $('#paneAdd').querySelectorAll('[data-tid]').forEach(b => b.onclick = () => addFromTemplate(b.dataset.tid));
}
function addFromTemplate(tid) {
  const def = defFor(tid);
  let x, y;
  if (mode === 'plan') { x = planCtl.target.x / M; y = planCtl.target.z / M; }
  else if (mode === 'orbit') { x = orbit.target.x / M; y = orbit.target.z / M; }
  else { x = walk.x - Math.sin(walk.yaw) * 1500; y = walk.y - Math.cos(walk.yaw) * 1500; }
  x = Math.round(x / 50) * 50; y = Math.round(y / 50) * 50;
  const id = 'n' + seq++;
  makeObj(def, id, x, y, 0, { tid, fixed: false });
  applyLabels();
  commit(); select(id);
  toast(`Добавлено: ${def.name}`);
}

// ============================================================ варианты, ссылка, Excel
async function encodeState(st) {
  const json = JSON.stringify(st);
  try {
    const cs = new CompressionStream('deflate-raw');
    const buf = await new Response(new Blob([json]).stream().pipeThrough(cs)).arrayBuffer();
    return 'z' + b64u(new Uint8Array(buf));
  } catch { return 'j' + b64u(new TextEncoder().encode(json)); }
}
async function decodeState(s) {
  const bytes = unb64u(s.slice(1));
  if (s[0] === 'j') return JSON.parse(new TextDecoder().decode(bytes));
  const ds = new DecompressionStream('deflate-raw');
  const txt = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
  return JSON.parse(txt);
}
function b64u(u8) { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s) { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); }

async function shareLink(name) {
  const st = snapshot();
  if (name) st.name = name;
  const empty = !Object.keys(st.m).length && !st.del.length && !st.add.length;
  const url = location.origin + location.pathname + (empty ? '' : '#v=' + await encodeState(st));
  return url;
}
$('#bShare').onclick = async () => {
  const name = $('#vName')?.value?.trim() || '';
  const url = await shareLink(name);
  let copied = false;
  try { await navigator.clipboard.writeText(url); copied = true; } catch {}
  dialog('Ссылка на эту расстановку', `
    <p>${copied ? 'Ссылка скопирована. ' : ''}Отправьте ее коллеге: по ней откроется ровно эта расстановка. Ничего устанавливать не нужно.</p>
    <textarea rows="4" readonly onclick="this.select()">${esc(url)}</textarea>
    <p class="legend">Расстановка хранится прямо в ссылке. Если что-то поменяете, нажмите «Поделиться» еще раз, чтобы получить новую ссылку.</p>`,
    [['Скопировать', async () => { try { await navigator.clipboard.writeText(url); toast('Скопировано'); } catch { toast('Выделите ссылку и скопируйте вручную'); } return false; }], ['Готово']]);
};

function renderVarPane() {
  const list = store.get('store3d.variants', []);
  $('#paneVar').innerHTML = `
    <h3 style="margin-top:0">Сохранить текущую расстановку</h3>
    <div class="row"><input id="vName" class="inp" placeholder="Название, например «Вариант с островом у входа»" style="flex:1"><button id="vSave" class="primary">Сохранить</button></div>
    <p class="legend">Варианты сохраняются в этом браузере. Чтобы показать вариант коллеге, нажмите «Поделиться» — по ссылке откроется именно он.</p>
    <h3>Мои варианты</h3>
    ${list.length ? list.map((v, i) => `<div class="vrow"><span class="t" title="${esc(v.name)}"><b>${esc(v.name)}</b><br><small class="code">${new Date(v.t).toLocaleString('ru-RU')}</small></span>
      <button data-load="${i}">Открыть</button><button data-link="${i}" title="Скопировать ссылку">🔗</button><button data-del="${i}" title="Удалить" style="color:var(--bad)">✕</button></div>`).join('') : '<p class="empty">Пока нет сохраненных вариантов.</p>'}
    <h3>Исходная схема</h3>
    <div class="row"><button id="vReset">Вернуть расстановку проектировщика</button></div>`;
  $('#vSave').onclick = () => {
    const name = $('#vName').value.trim() || `Вариант ${list.length + 1}`;
    list.unshift({ name, t: Date.now(), st: snapshot() });
    if (!store.set('store3d.variants', list)) toast('Браузер не дал сохранить. Используйте «Поделиться».');
    else toast(`Сохранено: ${name}`);
    renderVarPane();
  };
  $('#paneVar').querySelectorAll('[data-load]').forEach(b => b.onclick = () => { const v = list[+b.dataset.load]; loadState(v.st); toast(`Открыт: ${v.name}`); });
  $('#paneVar').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { list.splice(+b.dataset.del, 1); store.set('store3d.variants', list); renderVarPane(); });
  $('#paneVar').querySelectorAll('[data-link]').forEach(b => b.onclick = async () => {
    const v = list[+b.dataset.link];
    const url = location.origin + location.pathname + '#v=' + await encodeState({ ...v.st, name: v.name });
    try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована'); } catch { dialog('Ссылка', `<textarea rows="4" readonly>${esc(url)}</textarea>`); }
  });
  $('#vReset').onclick = resetAll;
}
function loadState(st) {
  undo.push(JSON.stringify(snapshot())); redo.length = 0;
  applyState(st); lastState = snapshot(); syncUndoBtns(); saveAuto();
}
function resetAll() {
  dialog('Вернуть исходную схему?', '<p>Все перемещения, удаления и добавленные объекты будут сброшены. Действие можно отменить кнопкой ↶.</p>',
    [['Вернуть', () => { loadState({ v: 1, m: {}, del: [], add: [] }); history.replaceState(null, '', location.pathname); toast('Расстановка как на схеме'); }], ['Отмена']]);
}

// Excel
function exportXlsx() {
  if (!window.XLSX) return toast('Модуль Excel еще загружается, попробуйте через секунду');
  const items = [...objs.values()].map(o => o.it);
  const all = items.map(it => frontClearance(it, items, raster));
  const rows = items.map((it, i) => {
    const b = baseById.get(it.id);
    const st = it.tid ? 'добавлено' : (b.x !== it.x || b.y !== it.y || b.rot !== it.rot) ? 'перемещено' : 'по схеме';
    const fr = all[i].length ? Math.min(...all[i].map(f => f.d)) : '';
    const iss = (lastChecks?.coll.get(it.id) || []).map(e => e.text).join('; ');
    return {
      'ID': it.id, 'Шаблон': it.tid || '', 'Наименование': it.name, 'Код': it.code, 'Группа': GROUPS[it.g] || '',
      'X центра, мм': it.x, 'Y центра, мм': it.y, 'Поворот, °': it.rot, 'Ширина, мм': it.w, 'Глубина, мм': it.d, 'Высота, мм': it.h,
      'Высота: источник': it.hsrc, 'Режим': it.temp || '', 'Выкладка': (it.cats || []).join(', '),
      'Проход перед лиц. стороной, мм': fr === 4000 ? '> 4000' : fr, 'Статус': st, 'Замечания': iss, 'Примечание': it.note || '',
    };
  });
  const removed = data.items.filter(b => !objs.has(b.id)).map(b => ({ 'ID': b.id, 'Наименование': b.name, 'Код': b.code }));
  const routes = (lastChecks?.routes || []).map(r => ({ 'Маршрут': r.name, 'Требуется, мм': r.need, 'Фактически ≈, мм': r.width, 'Итог': r.ok ? 'проходит' : 'узко' }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [8, 12, 40, 18, 18, 12, 12, 10, 10, 10, 10, 12, 14, 50, 16, 12, 30, 30].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, 'Оборудование');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(routes.length ? routes : [{ 'Маршрут': '' }]), 'Маршруты');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(removed.length ? removed : [{ 'ID': '', 'Наименование': 'Ничего не удалено' }]), 'Удалено');
  const d = new Date();
  XLSX.writeFile(wb, `Магазин_расстановка_${d.toISOString().slice(0, 10)}.xlsx`);
  toast('Файл Excel сохранен');
}
async function importXlsx(file) {
  if (!window.XLSX) return toast('Модуль Excel еще загружается');
  const wb = XLSX.read(await file.arrayBuffer());
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  if (!rows.length || !('ID' in rows[0])) return toast('Не нашел колонку ID. Загрузите файл, выгруженный из модели.');
  const st = { v: 1, m: {}, del: [], add: [] };
  const seen = new Set();
  for (const r of rows) {
    const id = String(r['ID']), x = Number(r['X центра, мм']), y = Number(r['Y центра, мм']), rot = Number(r['Поворот, °']) || 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (baseById.has(id)) { st.m[id] = [x, y, rot]; seen.add(id); }
    else if (r['Шаблон'] && defFor(String(r['Шаблон']))) st.add.push([String(r['Шаблон']), id, x, y, rot]);
  }
  st.del = data.items.filter(b => !seen.has(b.id)).map(b => b.id);
  loadState(st);
  toast(`Загружено строк: ${rows.length}`);
}

// ============================================================ меню, диалоги, вкладки
const menu = $('#menu');
$('#bMenu').onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; };
document.addEventListener('click', e => { if (!menu.hidden && !e.target.closest('#menu')) menu.hidden = true; });
$('#mExport').onclick = () => { menu.hidden = true; exportXlsx(); };
$('#mImport').onchange = e => { menu.hidden = true; const f = e.target.files[0]; if (f) importXlsx(f).catch(() => toast('Не удалось прочитать файл')); e.target.value = ''; };
$('#mReset').onclick = () => { menu.hidden = true; resetAll(); };
$('#mHelp').onclick = () => { menu.hidden = true; help(); };
$('#mPng').onclick = () => {
  menu.hidden = true;
  renderer.render(scene, camera);
  const a = document.createElement('a');
  a.download = `Магазин_${mode === 'plan' ? 'план' : '3D'}.png`;
  a.href = renderer.domElement.toDataURL('image/png');
  a.click();
};
$('#bUndo').onclick = doUndo;
$('#bRedo').onclick = doRedo;

function showTab(t) {
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.dataset.pane === t));
  if (t === 'var') renderVarPane();
  $('#side').classList.remove('collapsed');
}
document.querySelectorAll('.tabs [data-tab]').forEach(b => b.onclick = () => showTab(b.dataset.tab));
$('#sideToggle').onclick = () => { $('#side').classList.toggle('collapsed'); };

const dlg = $('#dlg');
function dialog(title, html, actions = [['Понятно']]) {
  $('#dlgTitle').textContent = title;
  $('#dlgBody').innerHTML = html;
  const box = $('#dlgActions');
  box.innerHTML = '';
  actions.forEach(([label, fn], i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    if (i === 0) b.className = 'primary';
    b.onclick = async () => { const keep = fn ? await fn() : true; if (keep !== false) dlg.close(); };
    box.appendChild(b);
  });
  dlg.showModal();
}
let toastT = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600);
}
function help() {
  dialog('Как пользоваться моделью', `
    <ul>
      <li><b>План / 3D / Прогулка</b> — три способа смотреть на зал. В «Прогулке» можно пройти по магазину на уровне глаз.</li>
      <li><b>Двигать оборудование</b> — перетащите объект мышкой или пальцем. Клавиша <b>R</b> поворачивает на 90°.</li>
      <li><b>Нажмите на объект</b> — справа появятся габариты, режим и что на нем выкладывается.</li>
      <li><b>Проверки</b> — модель сама считает проходы, пересечения со стенами и ширину путей эвакуации.</li>
      <li><b>Добавить</b> — оборудование, которое не поместилось на схеме, и типовые стеллажи.</li>
      <li><b>Поделиться</b> — ссылка на вашу расстановку. Коллега откроет ее в браузере.</li>
      <li><b>⋯ → Excel</b> — выгрузка списка оборудования с координатами.</li>
    </ul>
    <p class="legend">Высоты, которых нет на схеме, взяты типовые и отмечены в карточке объекта. Размеры помещения сняты с обмерной схемы с точностью около 1 мм.</p>`);
}

// ============================================================ цикл
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (mode === 'walk') stepWalk(dt);
  else if (mode === 'orbit') orbit.update();
  else planCtl.update();
  if (building.facade) { // этажи дома видны только с улицы, иначе закрывали бы зал
    const cp = camera.position;
    const outside = cp.z > building.facade.y + 0.5;
    building.facade.upper.visible = !lowWalls && outside && (mode === 'walk' || (mode === 'orbit' && cp.y < 9));
    labelRenderer.domElement.style.visibility = outside && cp.y < 9 && mode !== 'plan' ? 'hidden' : ''; // с улицы подписи мешают
  }
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ============================================================ старт
renderAddPane();
let initial = null;
if (location.hash.startsWith('#v=')) {
  try { initial = await decodeState(location.hash.slice(3)); toast(initial.name ? `Открыт вариант: ${initial.name}` : 'Открыта расстановка по ссылке'); }
  catch { toast('Ссылка повреждена, открыта исходная схема'); }
} else {
  const auto = store.get('store3d.auto', null);
  if (auto && (Object.keys(auto.m || {}).length || (auto.del || []).length || (auto.add || []).length)) {
    initial = auto;
    setTimeout(() => toast('Восстановлены ваши последние изменения'), 400);
  }
}
applyState(initial);
lastState = snapshot();
syncUndoBtns();
setMode('orbit');
renderObjPane();
resize();
$('#loading').remove();
if (!store.get('store3d.seenHelp', false)) { store.set('store3d.seenHelp', true); setTimeout(help, 300); }
frame();
window.__app = { orbitTo: (px, py, pz, tx, ty, tz) => { setMode("orbit"); orbit.target.set(tx, ty, tz); persp.position.set(px, py, pz); orbit.update(); }, lowWalls: on => setLowWalls(on), walk, walkTo: (x, y, yaw, pitch = 0) => { setMode('walk'); Object.assign(walk, { x, y, yaw, pitch, init: true }); }, info: () => renderer.info.render, screenOf: id => { const o = objs.get(id); const v = new THREE.Vector3(o.it.x * M, 0.3, o.it.y * M).project(camera); const r = renderer.domElement.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }, objs, snapshot, runChecks: () => (runChecks(), lastChecks), setMode, select, data };
