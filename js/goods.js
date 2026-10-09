// Товары на полках: объемные упаковки по категориям выкладки.
// Каждый вид товара собран из 1–3 простых деталей (бутылка, этикетка, крышка),
// все экземпляры рисуются через InstancedMesh, поэтому тысячи товаров не тормозят.
import * as THREE from 'three';

// ---------------------------------------------------------------- геометрия
function lathe(pts, seg = 8) { return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg); }
function cyl(rt, rb, h, y = 0, seg = 8, open = false) { const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open); g.translate(0, y + h / 2, 0); return g; }
function bx(w, h, d, y = 0, z = 0) { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, y + h / 2, z); return g; }
function sph(r, sx = 1, sy = 1, sz = 1, seg = 7) { const g = new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)); g.scale(sx, sy, sz); g.translate(0, r * sy, 0); return g; }
function capX(r, len, sy = 1) { const g = new THREE.CapsuleGeometry(r, len, 2, 7); g.rotateZ(Math.PI / 2); g.scale(1, sy, 1); g.translate(0, r * sy, 0); return g; }
function roof(w, h, d, y) {
  const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, y, -d / 2);
  return g;
}

const GEO_DEF = {
  'water.body': () => lathe([[0, 0], [.045, 0], [.046, .01], [.046, .2], [.03, .25], [.015, .27], [.015, .285], [0, .285]]),
  'water.label': () => cyl(.0475, .0475, .07, .09, 8, true),
  'water.cap': () => cyl(.016, .016, .02, .285),
  'soda.body': () => lathe([[0, 0], [.04, 0], [.04, .18], [.025, .225], [.013, .24], [.013, .255], [0, .255]]),
  'soda.label': () => cyl(.0415, .0415, .065, .08, 8, true),
  'soda.cap': () => cyl(.014, .014, .018, .255),
  'beer.body': () => lathe([[0, 0], [.032, 0], [.032, .13], [.026, .16], [.013, .18], [.013, .225], [0, .225]]),
  'beer.label': () => cyl(.033, .033, .055, .045, 8, true),
  'beer.cap': () => cyl(.014, .014, .012, .225),
  'wine.body': () => lathe([[0, 0], [.037, 0], [.037, .19], [.03, .225], [.012, .245], [.012, .30], [0, .30]]),
  'wine.label': () => cyl(.038, .038, .075, .055, 8, true),
  'wine.cap': () => cyl(.0128, .0128, .05, .255),
  'vodka.body': () => lathe([[0, 0], [.04, 0], [.04, .19], [.035, .22], [.014, .24], [.014, .285], [0, .285]]),
  'vodka.label': () => cyl(.041, .041, .085, .07, 8, true),
  'vodka.cap': () => cyl(.016, .016, .03, .27),
  'whisky.body': () => bx(.08, .2, .08),
  'whisky.neck': () => cyl(.016, .022, .06, .2),
  'whisky.label': () => bx(.082, .08, .082, .05),
  'oil.body': () => lathe([[0, 0], [.042, 0], [.042, .22], [.02, .26], [.013, .27], [.013, .285], [0, .285]]),
  'oil.label': () => cyl(.0435, .0435, .07, .07, 8, true),
  'oil.cap': () => cyl(.016, .016, .018, .282),
  'can.body': () => cyl(.033, .033, .115, 0, 8),
  'can.top': () => cyl(.029, .033, .008, .115, 8),
  'tin.body': () => cyl(.04, .04, .105, 0, 8),
  'tin.label': () => cyl(.0415, .0415, .085, .01, 8, true),
  'jar.body': () => lathe([[0, 0], [.042, 0], [.044, .11], [.036, .125], [0, .125]]),
  'jar.lid': () => cyl(.038, .038, .016, .123),
  'milk.body': () => bx(.07, .19, .07),
  'milk.band': () => bx(.072, .07, .072, .05),
  'milk.roof': () => roof(.07, .035, .07, .19),
  'juice.body': () => bx(.06, .2, .09),
  'juice.cap': () => cyl(.012, .012, .015, .2),
  'cup.body': () => cyl(.036, .03, .075, 0, 8),
  'cup.lid': () => cyl(.037, .037, .004, .075, 8),
  'cheese.body': () => bx(.12, .06, .08),
  'butter.body': () => bx(.1, .035, .05),
  'tray.body': () => bx(.2, .025, .14),
  'tray.meat': () => bx(.17, .035, .11, .015),
  'sausage.body': () => capX(.028, .18),
  'loaf.body': () => capX(.055, .13, .75),
  'baguette.body': () => capX(.03, .38),
  'bun.body': () => sph(.045, 1, .7, 1),
  'donut.body': () => { const g = new THREE.TorusGeometry(.038, .018, 6, 12); g.rotateX(Math.PI / 2); g.translate(0, .018, 0); return g; },
  'cereal.body': () => bx(.19, .27, .06),
  'pasta.body': () => bx(.12, .21, .05),
  'flour.body': () => bx(.12, .2, .08),
  'spice.body': () => bx(.06, .1, .03),
  'tea.body': () => bx(.13, .08, .07),
  'candybox.body': () => bx(.22, .15, .03),
  'choco.body': () => bx(.16, .06, .1),
  'chips.body': () => bx(.15, .22, .06),
  'grain.body': () => bx(.13, .2, .06),
  'nuts.body': () => bx(.1, .15, .03),
  'coffee.body': () => bx(.11, .2, .06),
  'eggs.body': () => bx(.3, .07, .11),
  'eggs.top': () => bx(.28, .012, .1, .07),
  'cookies.body': () => bx(.18, .05, .07),
  'detergent.body': () => bx(.12, .26, .07),
  'detergent.cap': () => cyl(.02, .02, .03, .26),
  'shampoo.body': () => lathe([[0, 0], [.03, 0], [.03, .17], [.02, .19], [0, .19]]),
  'shampoo.cap': () => cyl(.015, .018, .035, .19),
  'sauce.body': () => lathe([[0, 0], [.03, 0], [.032, .12], [.02, .16], [0, .16]]),
  'sauce.cap': () => cyl(.018, .018, .025, .16),
  'babyjar.body': () => cyl(.03, .03, .07),
  'babyjar.lid': () => cyl(.031, .031, .012, .07),
  'diapers.body': () => bx(.3, .25, .18),
  'tissue.body': () => bx(.25, .22, .2),
  'tissue.band': () => bx(.252, .05, .202, .1),
  'pet.body': () => bx(.25, .35, .1),
  'frozen.body': () => bx(.2, .045, .28),
  'icebox.body': () => bx(.1, .045, .18),
  'icecup.body': () => cyl(.05, .045, .07),
  'cake.body': () => cyl(.1, .1, .07, 0, 16),
  'cake.top': () => cyl(.095, .095, .012, .07, 16),
  'salad.body': () => bx(.13, .05, .1),
  'salad.lid': () => bx(.132, .012, .102, .05),
  'cig.body': () => bx(.055, .088, .022),
  'carton.body': () => bx(.2, .16, .14),
  'apple': () => sph(.038), 'orange': () => sph(.041), 'lemon': () => sph(.032, 1.3, 1, 1),
  'pear': () => sph(.036, 1, 1.3, 1), 'potato': () => sph(.034, 1.35, .8, 1), 'tomato': () => sph(.035, 1, .8, 1),
  'onion': () => sph(.035, 1, .95, 1), 'cabbage': () => sph(.08, 1, .9, 1, 10),
  'cucumber': () => capX(.02, .14), 'banana': () => capX(.02, .15), 'carrot': () => { const g = new THREE.ConeGeometry(.018, .16, 6); g.rotateZ(Math.PI / 2); g.translate(0, .018, 0); return g; },
};
const geoCache = new Map();
function geo(key) {
  if (!geoCache.has(key)) geoCache.set(key, GEO_DEF[key]());
  return geoCache.get(key);
}

// ---------------------------------------------------------------- палитры
const P = {
  bright: ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#00acc1', '#d81b60', '#6d4c41', '#f4f4f4'],
  water: ['#1e88e5', '#43a047', '#e3f2fd', '#0d47a1', '#26c6da', '#ffffff'],
  soda: ['#e53935', '#fb8c00', '#7cb342', '#fdd835', '#8e24aa', '#1e88e5', '#d81b60'],
  sodaGlass: ['#d6ecf5', '#f3d9b0', '#d8f0c8', '#f7e6a6', '#e7c7e8'],
  beerGlass: ['#5d3a1a', '#2e5e2a', '#6b4423', '#4a2f17'],
  beerLabel: ['#f5f0e1', '#c62828', '#1a237e', '#ffd54f', '#2e7d32', '#212121'],
  wineGlass: ['#1b3b23', '#3e0f1a', '#2d3a1f', '#5b2333', '#203020'],
  wineLabel: ['#f5ecd7', '#ffffff', '#e8dcc0', '#1d1d1d', '#d9c9a3'],
  caps: ['#c62828', '#d4af37', '#1d1d1d', '#5d1a2a', '#e0e0e0'],
  vodkaGlass: ['#e8f1f5', '#dfe8ec', '#eef3f5'],
  label: ['#ffffff', '#1a237e', '#c62828', '#d4af37', '#212121', '#0d47a1'],
  amber: ['#b5651d', '#8b4513', '#c68642', '#7b3f00'],
  dairy: ['#1e88e5', '#e53935', '#43a047', '#fdd835', '#90caf9', '#ef9a9a', '#ff8a65'],
  pastel: ['#f8bbd0', '#fff59d', '#c5e1a5', '#b3e5fc', '#ffe0b2', '#e1bee7', '#ffffff'],
  cheese: ['#ffd54f', '#ffca28', '#fff176', '#ffb300', '#ffe082'],
  butter: ['#ffd54f', '#1e88e5', '#43a047', '#fff8e1'],
  meat: ['#c62828', '#d84343', '#e57373', '#ad1457', '#f48fb1'],
  sausage: ['#8d3b2f', '#b5523b', '#c97b63', '#6d2c22', '#d7a48a'],
  bread: ['#c68642', '#a0612b', '#d9a066', '#8b5a2b', '#e0b277'],
  donut: ['#d9a066', '#f48fb1', '#6d4c41', '#fff59d'],
  kraft: ['#d7b98e', '#c8a165', '#8d6e63', '#a1887f'],
  choc: ['#5d4037', '#3e2723', '#c62828', '#1565c0', '#6a1b9a', '#d4af37'],
  tea: ['#2e7d32', '#c62828', '#1a237e', '#f9a825', '#4e342e', '#00695c'],
  coffee: ['#3e2723', '#4e342e', '#212121', '#bf360c', '#b71c1c'],
  chem: ['#1e88e5', '#fdd835', '#e53935', '#43a047', '#8e24aa', '#ffffff', '#ff7043', '#00bcd4'],
  frozen: ['#1565c0', '#29b6f6', '#e53935', '#43a047', '#ffffff', '#ff8f00'],
  ice: ['#f48fb1', '#fff59d', '#81d4fa', '#a5d6a7', '#ffffff', '#8d6e63'],
  cig: ['#ffffff', '#c62828', '#1a237e', '#d4af37', '#212121', '#90a4ae'],
  eggs: ['#e8d3b0', '#f5ead6', '#d7b98e'],
  white: ['#f5f5f5'],
  salad: ['#7cb342', '#ffb74d', '#e57373', '#fff176', '#a1887f'],
  cake: ['#fce4ec', '#5d4037', '#fff8e1', '#f8bbd0', '#ffffff'],
  cakeTop: ['#e91e63', '#3e2723', '#ff7043', '#ab47bc', '#fdd835'],
  pet: ['#e53935', '#1565c0', '#2e7d32', '#6a1b9a', '#ff8f00'],
  baby: ['#81d4fa', '#f8bbd0', '#fff59d', '#c5e1a5'],
};

// Вид товара: габариты упаковки (м) и детали [геометрия, цвета].
// stack — сколько слоев можно ставить друг на друга, lay — лежит (для ларей).
const A = {
  water: { w: .095, d: .095, h: .30, c: [['water.body', '#cfe9f7'], ['water.label', P.water], ['water.cap', P.water]] },
  soda: { w: .085, d: .085, h: .27, c: [['soda.body', P.sodaGlass], ['soda.label', P.soda], ['soda.cap', P.soda]] },
  juice: { w: .065, d: .095, h: .22, c: [['juice.body', P.soda], ['juice.cap', '#ffffff']] },
  energy: { w: .07, d: .07, h: .125, stack: 2, c: [['can.body', ['#212121', '#1e88e5', '#43a047', '#e53935', '#fdd835']], ['can.top', '#c0c0c0']] },
  beer: { w: .068, d: .068, h: .24, c: [['beer.body', P.beerGlass], ['beer.label', P.beerLabel], ['beer.cap', P.caps]] },
  beercan: { w: .07, d: .07, h: .125, stack: 2, c: [['can.body', ['#1a237e', '#c62828', '#2e7d32', '#d4af37', '#212121', '#e0e0e0']], ['can.top', '#c0c0c0']] },
  wine: { w: .078, d: .078, h: .31, c: [['wine.body', P.wineGlass], ['wine.label', P.wineLabel], ['wine.cap', P.caps]] },
  sparkling: { w: .082, d: .082, h: .31, c: [['wine.body', ['#1b3b23', '#203020', '#2b2b2b']], ['wine.label', P.wineLabel], ['wine.cap', ['#d4af37', '#c0c0c0', '#c62828']]] },
  vodka: { w: .085, d: .085, h: .3, c: [['vodka.body', P.vodkaGlass], ['vodka.label', P.label], ['vodka.cap', P.caps]] },
  whisky: { w: .085, d: .085, h: .27, c: [['whisky.body', P.amber], ['whisky.neck', P.amber], ['whisky.label', P.label]] },
  oil: { w: .088, d: .088, h: .29, c: [['oil.body', ['#f4c430', '#e8b400', '#f7d560']], ['oil.label', P.bright], ['oil.cap', P.bright]] },
  sauce: { w: .068, d: .068, h: .19, c: [['sauce.body', ['#d32f2f', '#fffde7', '#ffe082', '#8d6e63']], ['sauce.cap', P.bright]] },
  tin: { w: .085, d: .085, h: .11, stack: 3, c: [['tin.body', '#c0c0c0'], ['tin.label', P.bright]] },
  jar: { w: .09, d: .09, h: .14, stack: 2, c: [['jar.body', ['#c62828', '#7cb342', '#ff8f00', '#8d6e63', '#fdd835']], ['jar.lid', ['#d4af37', '#e53935', '#43a047', '#c0c0c0']]] },
  preserve: { w: .09, d: .09, h: .14, stack: 2, c: [['jar.body', ['#e57373', '#ffb74d', '#bcaaa4', '#ff8a65']], ['jar.lid', ['#1565c0', '#c0c0c0', '#c62828']]] },
  milk: { w: .075, d: .075, h: .225, c: [['milk.body', '#fbfbfb'], ['milk.band', P.dairy], ['milk.roof', '#f0f0f0']] },
  yogurt: { w: .078, d: .078, h: .08, stack: 3, c: [['cup.body', P.pastel], ['cup.lid', ['#e0e0e0', '#ffffff', '#c0c0c0']]] },
  cheese: { w: .125, d: .085, h: .062, stack: 3, c: [['cheese.body', P.cheese]] },
  butter: { w: .105, d: .055, h: .037, stack: 4, c: [['butter.body', P.butter]] },
  meattray: { w: .205, d: .145, h: .05, stack: 2, c: [['tray.body', '#f5f5f5'], ['tray.meat', P.meat]] },
  sausage: { w: .26, d: .06, h: .056, stack: 3, c: [['sausage.body', P.sausage]] },
  loaf: { w: .25, d: .11, h: .085, stack: 2, c: [['loaf.body', P.bread]] },
  baguette: { w: .45, d: .065, h: .06, stack: 3, c: [['baguette.body', P.bread]] },
  bun: { w: .095, d: .095, h: .065, stack: 2, c: [['bun.body', P.bread]] },
  donut: { w: .115, d: .115, h: .04, stack: 3, c: [['donut.body', P.donut]] },
  cereal: { w: .195, d: .065, h: .27, c: [['cereal.body', P.bright]] },
  pasta: { w: .125, d: .055, h: .21, c: [['pasta.body', ['#1565c0', '#c62828', '#fdd835', '#2e7d32', '#ffffff']]] },
  grain: { w: .135, d: .065, h: .2, c: [['grain.body', ['#fff8e1', '#ffe0b2', '#d7ccc8', '#c8e6c9', '#ffffff']]] },
  flour: { w: .125, d: .085, h: .2, c: [['flour.body', ['#ffffff', '#e3f2fd', '#fff3e0', '#1565c0']]] },
  spice: { w: .065, d: .035, h: .1, stack: 2, c: [['spice.body', P.bright]] },
  noodle: { w: .135, d: .065, h: .2, c: [['grain.body', ['#fdd835', '#e53935', '#ff8f00', '#43a047']]] },
  eggs: { w: .305, d: .115, h: .085, stack: 3, c: [['eggs.body', P.eggs], ['eggs.top', ['#1565c0', '#43a047', '#e53935', '#fdd835']]] },
  chips: { w: .155, d: .065, h: .22, c: [['chips.body', ['#fdd835', '#e53935', '#1e88e5', '#43a047', '#ff8f00', '#6a1b9a']]] },
  nuts: { w: .105, d: .035, h: .15, c: [['nuts.body', P.kraft.concat(['#2e7d32', '#c62828'])]] },
  cookies: { w: .185, d: .075, h: .052, stack: 4, c: [['cookies.body', P.bright]] },
  candybox: { w: .225, d: .035, h: .15, c: [['candybox.body', ['#c62828', '#1a237e', '#d4af37', '#4a148c', '#3e2723']]] },
  choco: { w: .165, d: .105, h: .062, stack: 3, c: [['choco.body', P.choc]] },
  tea: { w: .135, d: .075, h: .082, stack: 3, c: [['tea.body', P.tea]] },
  coffee: { w: .115, d: .065, h: .2, c: [['coffee.body', P.coffee]] },
  babyjar: { w: .065, d: .065, h: .082, stack: 2, c: [['babyjar.body', ['#ffb74d', '#aed581', '#e57373', '#fff176']], ['babyjar.lid', P.baby]] },
  diapers: { w: .305, d: .185, h: .25, c: [['diapers.body', P.baby]] },
  detergent: { w: .125, d: .075, h: .29, c: [['detergent.body', P.chem], ['detergent.cap', P.chem]] },
  shampoo: { w: .065, d: .065, h: .225, c: [['shampoo.body', P.chem], ['shampoo.cap', ['#ffffff', '#212121', '#c0c0c0']]] },
  tissue: { w: .255, d: .205, h: .22, c: [['tissue.body', '#fafafa'], ['tissue.band', P.chem]] },
  pet: { w: .255, d: .105, h: .35, c: [['pet.body', P.pet]] },
  frozen: { w: .205, d: .285, h: .046, stack: 4, lay: true, c: [['frozen.body', P.frozen]] },
  icebox: { w: .105, d: .185, h: .046, stack: 4, lay: true, c: [['icebox.body', P.ice]] },
  icecup: { w: .105, d: .105, h: .07, stack: 3, lay: true, c: [['icecup.body', P.ice]] },
  cake: { w: .205, d: .205, h: .085, stack: 2, c: [['cake.body', P.cake], ['cake.top', P.cakeTop]] },
  salad: { w: .135, d: .105, h: .062, stack: 3, c: [['salad.body', P.salad], ['salad.lid', '#e8f4fb']] },
  cig: { w: .058, d: .024, h: .09, stack: 2, c: [['cig.body', P.cig]] },
  carton: { w: .205, d: .145, h: .16, stack: 2, c: [['carton.body', ['#c8a165', '#d7b98e', '#bcaaa4']]] },
};

// Лицевая полоса-этикетка для коробок и пакетов: без нее упаковки выглядят как кубики
const BAND = ['#ffffff', '#fff59d', '#212121', '#ffcc80', '#e3f2fd'];
for (const name of ['cereal', 'pasta', 'grain', 'flour', 'noodle', 'chips', 'coffee', 'tea', 'choco', 'candybox', 'cookies', 'detergent', 'diapers', 'pet', 'juice', 'nuts', 'spice', 'frozen', 'icebox']) {
  const a = A[name], body = a.c[0][0];
  const p = GEO_DEF[body]();
  p.computeBoundingBox();
  const bb = p.boundingBox, w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y, d = bb.max.z - bb.min.z;
  p.dispose();
  const key = name + '.band';
  GEO_DEF[key] = a.lay ? () => bx(w * 0.6, h * 1.02, d * 1.01, -h * 0.01) : () => bx(w * 1.02, h * 0.28, d * 1.04, h * 0.42);
  a.c.push([key, BAND]);
}

// ---------------------------------------------------------------- категории выкладки -> товары
const CAT = {
  'Хлеб': ['loaf', 'baguette', 'loaf'], 'Донаты': ['donut', 'bun'],
  'Снеки': ['chips'], 'Орехи, сухофрукты': ['nuts'],
  'Консервы овощ/фрукты': ['jar'], 'Консервы мясо/рыба': ['tin'], 'Макароны': ['pasta'], 'Крупы': ['grain'],
  'Растительное масло': ['oil'], 'Соусы': ['sauce'], 'Специи': ['spice'], 'Мука, соль, сахар': ['flour'], 'Продукты б/п': ['noodle'], 'Яйцо': ['eggs'],
  'Сухие завтраки': ['cereal'], 'МТМ': ['grain'], 'Диетическое питание': ['cereal'],
  'Детское питание': ['babyjar'], 'Детская гигиена': ['diapers'],
  'Мучная кондитерка': ['cookies'], 'Конфеты фас': ['nuts'], 'Коробки конфет': ['candybox'], 'Сладости': ['chips'], 'Кофе': ['coffee'], 'Чай': ['tea'], 'Шоколад': ['choco'],
  'Бытовая химия': ['detergent'], 'Хоз. товары': ['tissue'], 'Гигиена': ['shampoo'], 'Косметика': ['shampoo'], 'ТНП': ['tissue'], 'Товары для животных': ['pet'],
  'Вода': ['water'], 'Лимонады': ['soda'], 'Соки': ['juice'], 'Энергетики': ['energy'],
  'Пиво': ['beer', 'beercan'], 'САН': ['beercan'], 'Импортное пиво': ['beer'],
  'Вино': ['wine'], 'Вино игристое': ['sparkling'], 'Вермуты': ['wine'],
  'Крепкий алкоголь': ['vodka', 'whisky'], 'Водка': ['vodka'], 'Ликеры': ['whisky'],
  'Молочная гастрономия (традиц.)': ['milk'], 'Йогурты': ['yogurt'], 'Детское молочное': ['yogurt'], 'Масло, маргарин': ['butter'], 'Сгущенка': ['tin'], 'Сыры': ['cheese'],
  'Рыбная гастрономия (пресервы)': ['preserve'], 'Икорник': ['preserve'], 'Майонез': ['sauce'],
  'Мясо, птица охлажденные': ['meattray'], 'Мясная гастрономия': ['sausage', 'meattray'],
  'ОИФ горка': ['salad'], 'Соленья': ['jar'], 'FTG (готовая еда)': ['salad'], 'Торты и пирожные': ['cake'],
  'ОИФ + ПФ замороженные': ['frozen'], 'Рыба замороженная': ['frozen'], 'Мороженое': ['icecup', 'icebox'],
  'Сезонный товар': ['candybox', 'cookies'],
};
const KEYWORDS = [
  [/алког|водк/i, ['vodka', 'whisky']], [/табак/i, ['cig']], [/пепси|кола|балтик|импорт|drinks/i, ['soda', 'energy']],
  [/промо|сезон/i, ['chips', 'cookies']], [/^[АВ]$/, ['choco', 'nuts']],
];

export function goodsPlan(p, n) {
  let names = (p.cats || []).flatMap(c => CAT[c] || []);
  if (!names.length) {
    const txt = `${p.sign || ''} ${p.label || ''}`;
    for (const [re, v] of KEYWORDS) if (re.test(txt)) { names = v; break; }
  }
  if (!names.length) names = ['carton'];
  // каждой полке свой вид товара; если видов меньше полок, повторяем по кругу
  const out = [];
  for (let i = 0; i < n; i++) out.push(names.length >= n ? names[Math.floor(i * names.length / n)] : names[i % names.length]);
  return out;
}
export const PRODUCE = {
  'Овощи': ['potato', 'tomato', 'cucumber', 'onion', 'carrot', 'cabbage'],
  'Фрукты': ['apple', 'orange', 'banana', 'lemon', 'pear', 'appleG'],
};
const PRODUCE_LOOK = {
  apple: { g: 'apple', r: .038, c: ['#c62828', '#d84315', '#b71c1c'] }, appleG: { g: 'apple', r: .038, c: ['#9ccc65', '#aed581', '#c5e1a5'] },
  orange: { g: 'orange', r: .041, c: ['#fb8c00', '#ff9800', '#f57c00'] }, lemon: { g: 'lemon', r: .042, c: ['#fdd835', '#ffee58'] },
  pear: { g: 'pear', r: .036, c: ['#c0ca33', '#d4e157', '#afb42b'] }, banana: { g: 'banana', r: .1, c: ['#fdd835', '#ffeb3b', '#f9e04b'] },
  potato: { g: 'potato', r: .045, c: ['#bf9a6a', '#a1887f', '#c8a879'] }, tomato: { g: 'tomato', r: .035, c: ['#e53935', '#d32f2f', '#f44336'] },
  cucumber: { g: 'cucumber', r: .09, c: ['#2e7d32', '#388e3c', '#43a047'] }, onion: { g: 'onion', r: .035, c: ['#c58b4c', '#d7a26a', '#b0743a'] },
  carrot: { g: 'carrot', r: .09, c: ['#ef6c00', '#f57c00', '#fb8c00'] }, cabbage: { g: 'cabbage', r: .08, c: ['#aed581', '#c5e1a5', '#9ccc65'] },
};

// ---------------------------------------------------------------- сборщик экземпляров
const baseMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const _c = new THREE.Color();

export class Stock {
  constructor(seed = 1) {
    this.buf = new Map();
    let s = (seed >>> 0) || 1;
    this.rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }
  put(key, x, y, z, rotY, sc, color, light = 0.05) {
    if (!this.buf.has(key)) this.buf.set(key, { m: [], c: [] });
    const b = this.buf.get(key);
    _p.set(x, y, z); _e.set(0, rotY, 0); _q.setFromEuler(_e); _s.setScalar(sc);
    b.m.push(_m.compose(_p, _q, _s).clone());
    _c.set(color); _c.offsetHSL(0, -0.12, (this.rnd() - 0.5) * light);
    b.c.push(_c.clone());
  }
  pick(spec, sku, i) { return typeof spec === 'string' ? spec : spec[(sku * 7 + i * 3) % spec.length]; }

  // Заполнить полку: x0..x1 по ширине, zFront..zBack по глубине, от y вверх, не выше maxH
  shelf(name, x0, x1, y, zFront, zBack, maxH, { rows = 4, fill = 1 } = {}) {
    const a = A[name] || A.carton;
    const s = Math.min(1, (maxH * 0.88) / a.h);
    const gap = 0.006;
    const w = a.w * s, d = a.d * s, h = a.h * s;
    const nW = Math.max(1, Math.floor((x1 - x0 + gap) / (w + gap)));
    const nD = Math.max(1, Math.min(rows, Math.floor((zFront - zBack) / (d + 0.004))));
    const layers = Math.max(1, Math.min(a.stack || 1, Math.floor((maxH * 0.9) / h)));
    const used = nW * (w + gap) - gap, start = x0 + (x1 - x0 - used) / 2 + w / 2;
    let sku = Math.floor(this.rnd() * 97), run = 0;
    for (let i = 0; i < nW; i++) {
      if (run <= 0) { sku = Math.floor(this.rnd() * 97); run = 2 + Math.floor(this.rnd() * 3); }
      run--;
      const x = start + i * (w + gap);
      for (let j = 0; j < nD; j++) {
        if (j > 0 && this.rnd() > fill) continue;
        const z = zFront - d / 2 - j * (d + 0.004);
        for (let l = 0; l < layers; l++) {
          if (l > 0 && this.rnd() < 0.15) break;
          const rot = a.lay ? (this.rnd() - 0.5) * 0.3 : (this.rnd() - 0.5) * 0.12;
          const jx = (this.rnd() - 0.5) * 0.004;
          a.c.forEach(([key, spec], k) => this.put(key, x + jx, y + l * h, z, rot, s, this.pick(spec, sku, k)));
        }
      }
    }
  }
  // Навалом в ящике (фрукты, овощи)
  pile(name, x0, x1, z0, z1, y) {
    const look = PRODUCE_LOOK[name];
    const r = look.r;
    const step = r * 2.05;
    for (let layer = 0; layer < 2; layer++) {
      const off = layer ? step / 2 : 0;
      for (let x = x0 + r + off; x <= x1 - r; x += step) for (let z = z0 + r + off; z <= z1 - r; z += step) {
        if (layer && this.rnd() < 0.35) continue;
        const col = look.c[Math.floor(this.rnd() * look.c.length)];
        this.put(look.g, x + (this.rnd() - .5) * r * .3, y + layer * r * 1.2, z + (this.rnd() - .5) * r * .3, this.rnd() * 6.28, 1, col, 0.08);
      }
    }
  }
  build() {
    const g = new THREE.Group();
    for (const [key, b] of this.buf) {
      const im = new THREE.InstancedMesh(geo(key), baseMat, b.m.length);
      b.m.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, b.c[i]); });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      g.add(im);
    }
    return g;
  }
}
