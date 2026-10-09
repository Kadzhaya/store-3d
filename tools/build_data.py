"""Генератор data/store.json из технологической схемы (PDF).

Запуск:  python3 tools/build_data.py путь/к/схеме.pdf
PDF в репозиторий не кладется: сайт публичный.

Координаты плана: мм, начало в левом верхнем углу контура здания,
ось x вправо, ось y вниз (в 3D это ось Z).
"""
import json, math, sys, os
import pymupdf
from shapely.geometry import Polygon, box, LineString
from shapely.ops import unary_union

S = 15.6783          # мм в одном пункте PDF (подобрано по 40+ размерным цепочкам, ошибка < 1 мм)
X0, Y0 = 503, 288    # левый верхний угол контура здания на листе 1, пт
CEIL = 4400
PLAN = pymupdf.Rect(480, 270, 1380, 1080)

def col(c):
    return tuple(round(v, 2) for v in c) if c else None

def polys_of(x):
    out, cur = [], []
    for it in x["items"]:
        if it[0] == "re":
            out.append(box(*it[1]))
        elif it[0] == "qu":
            q = it[1]; out.append(Polygon([q.ul, q.ur, q.lr, q.ll]))
        elif it[0] == "l":
            if not cur: cur = [it[1]]
            cur.append(it[2])
        elif it[0] == "c":
            if not cur: cur = [it[1]]
            cur.append(it[4])
    if len(cur) >= 3:
        out.append(Polygon([(a.x, a.y) for a in cur]).buffer(0))
    return [p for p in out if p.is_valid and p.area > 0]

def to_mm(g):
    from shapely import affinity
    g = affinity.translate(g, -X0, -Y0)
    return affinity.scale(g, S, S, origin=(0, 0))

def ring(r):
    return [[round(x), round(y)] for x, y in list(r.coords)[:-1]]

# ---------------------------------------------------------------- стены
def walls(page):
    D = page.get_drawings()
    by = {"gray": [], "blue": [], "purple": []}
    cmap = {(0.5, 0.5, 0.5): "gray", (0.0, 0.0, 1.0): "blue", (0.65, 0.0, 0.65): "purple"}
    for x in D:
        k = cmap.get(col(x.get("fill")))
        if k and x["rect"].intersects(PLAN) and x["rect"].width < 800:
            by[k] += polys_of(x)
    gray = unary_union(by["gray"])
    # серые элементы, которые на самом деле оборудование (задние панели стеллажей, шкафы):
    # оставляем только крупные куски конструкций
    keep = [g for g in gray.geoms if g.area > 500 and min(g.bounds[2]-g.bounds[0], g.bounds[3]-g.bounds[1]) > 8
            and abs(g.bounds[0] - 720) > 3 and abs(g.bounds[0] - 538) > 3]  # алко/табачный шкаф, стол упаковки
    keep += [g for g in gray.geoms if (930 <= g.bounds[0] <= 931) or (1123 <= g.bounds[0] <= 1124)]  # простенки фасада
    struct = unary_union(keep)
    # тонкие линии (полотна дверей) убираем морфологическим раскрытием
    blue = unary_union(by["blue"]).buffer(-1.6, join_style=2).buffer(1.6, join_style=2)
    purple = unary_union(by["purple"]).buffer(-1.6, join_style=2).buffer(1.6, join_style=2)
    res = []
    for kind, g, h in (("struct", struct, CEIL), ("part", blue.difference(struct), CEIL)):
        for pg in getattr(g, "geoms", [g]):
            pg = to_mm(pg).simplify(8)
            if pg.area < 20000: continue
            res.append({"kind": kind, "h": h, "pts": ring(pg.exterior), "holes": [ring(i) for i in pg.interiors]})
    for pg in getattr(purple, "geoms", [purple]):
        pg = to_mm(pg).simplify(8)
        if pg.area < 20000: continue
        # противопожарная перегородка зала по примечанию идет не до потолка (зазор 400 мм)
        top = pg.bounds[1] < 9500
        res.append({"kind": "fire", "h": CEIL - 400 if top else CEIL, "pts": ring(pg.exterior),
                    "holes": [ring(i) for i in pg.interiors],
                    "note": "Перегородка не до потолка, зазор не менее 400 мм" if top else ""})
    allw = unary_union([to_mm(struct), to_mm(blue), to_mm(purple)])
    return res, allw

# ---------------------------------------------------------------- проемы фасада
WINDOWS = [
    # x0, x1, y (линия остекления), низ, высота, тип
    {"x0": 502, "x1": 2807, "y": 12060, "sill": 0, "h": 3610, "kind": "storefront", "door": [1150, 2650],
     "note": "Входная группа (вход и разгрузка)"},
    {"x0": 3841, "x1": 6695, "y": 10420, "sill": 500, "h": 3110, "kind": "window", "note": "Открытый фасад"},
    {"x0": 7322, "x1": 9721, "y": 11990, "sill": 500, "h": 3110, "kind": "window", "note": ""},
    {"x0": 10552, "x1": 12935, "y": 11990, "sill": 500, "h": 3110, "kind": "window", "note": ""},
]
GLASS_PARTS = [  # стеклянная перегородка тамбура
    {"x0": 497, "x1": 1389, "y": 10320, "sill": 0, "h": 2600, "kind": "glass", "note": "Тамбур"},
]
# Двери: на схеме проемы нарисованы поверх сплошных перегородок, поэтому проемы
# вырезаются из стен здесь. a-b — проем по грани стены, hinge — петля,
# swing — куда открывается полотно (по дуге на схеме), into — направление в толщу стены.
DOORS = [
    {"id": "d-evac", "a": [8878, 9256], "b": [9878, 9256], "hinge": [9878, 9256], "swing": [9878, 8256], "into": [0, 1], "t": 120,
     "top": CEIL - 400, "kind": "fire", "label": "Служебный вход · эвакуационный выход", "w": 1000},
    {"id": "d-kpp", "a": [8735, 9376], "b": [8735, 10176], "hinge": [8735, 9376], "swing": [7935, 9376], "into": [1, 0], "t": 120,
     "top": CEIL, "kind": "service", "label": "КПП", "w": 800},
    {"id": "d-wc", "a": [9244, 10446], "b": [9944, 10446], "hinge": [9244, 10446], "swing": [9244, 9746], "into": [0, 1], "t": 120,
     "top": CEIL, "kind": "service", "label": "С/У", "w": 700},
    {"id": "d-srv", "a": [10240, 10446], "b": [11040, 10446], "hinge": [10240, 10446], "swing": [10240, 9646], "into": [0, 1], "t": 120,
     "top": CEIL, "kind": "service", "label": "Аппаратная", "w": 800},
    {"id": "d-cash", "a": [11282, 10446], "b": [12182, 10446], "hinge": [12182, 10446], "swing": [12182, 9546], "into": [0, 1], "t": 120,
     "top": CEIL, "kind": "service", "label": "Главная касса", "w": 900},
    {"id": "d-tambour", "a": [1389, 10290], "b": [2807, 10290], "into": [0, 1], "t": 60, "top": 2600, "kind": "glass2",
     "out": [0, 1], "label": "", "w": 1418, "transom": True},
    {"id": "d-main", "a": [1150, 12030], "b": [2650, 12030], "into": [0, 1], "t": 60, "top": 3610, "kind": "glass2",
     "out": [0, 1], "label": "", "w": 1500, "transom": False},
]

def cut_doors(wl):
    cuts = []
    for d in DOORS:
        if d["kind"] == "glass2": continue
        (ax, ay), (bx, by) = d["a"], d["b"]
        nx, ny = d["into"]
        if ay == by:
            cuts.append(box(min(ax, bx), ay - 40 + min(0, ny) * d["t"], max(ax, bx), ay + 40 + max(0, ny) * d["t"]))
        else:
            cuts.append(box(ax - 40 + min(0, nx) * d["t"], min(ay, by), ax + 40 + max(0, nx) * d["t"], max(ay, by)))
    cut = unary_union(cuts)
    out = []
    for w in wl:
        pg = Polygon(w["pts"], w["holes"]).buffer(0)
        if not pg.intersects(cut):
            out.append(w); continue
        rest = pg.difference(cut)
        for g in getattr(rest, "geoms", [rest]):
            if g.area < 5000: continue
            q = dict(w); q["pts"] = ring(g.exterior); q["holes"] = [ring(i) for i in g.interiors]
            out.append(q)
    return out

# Фасад со стороны входа (по фото на листе 1): белые пилоны, графитовые панели,
# белый пояс над первым этажом, остекленные лоджии выше.
FACADE = {
    "y": 12101, "x0": -600, "x1": 14080,
    "pylons": [[0, 502, "white"], [2807, 3841, "white"], [6695, 7322, "white"], [9721, 10552, "dark"], [12935, 13484, "dark"]],
    "railing": [3841, 6695],
    "band": [4400, 4900], "floors": 3, "floorH": 3000,
    "sign": {"x0": 900, "x1": 2900, "y0": 3700, "y1": 4250, "text": "ПРОДУКТЫ"},
}

LINTELS = [  # перемычки над проемами (H проема 2100 по схеме)
    {"x0": 6960, "x1": 7100, "y0": 3800, "y1": 4900, "y0h": 2100},
]

# ---------------------------------------------------------------- оборудование
# Части задаются в координатах плана (bbox мм) — генератор сам переводит
# в локальные координаты объекта. front — куда смотрит лицевая сторона.
FRONT_ROT = {"+y": 0, "+x": 90, "-x": -90, "-y": 180}
DIRV = {"+x": (1, 0), "-x": (-1, 0), "+y": (0, 1), "-y": (0, -1)}

CATS = {
    "4Х": ["Хлеб", "Донаты"],
    "6С": ["Снеки", "Орехи, сухофрукты"],
    "7ОК": ["Консервы овощ/фрукты", "Консервы мясо/рыба", "Макароны", "Крупы"],
    "6КМ": ["Растительное масло", "Соусы", "Специи", "Мука, соль, сахар", "Продукты б/п", "Яйцо"],
    "6Т1": ["Сухие завтраки", "МТМ", "Диетическое питание"],
    "7Д": ["Детское питание", "Детская гигиена"],
    "5МК": ["Мучная кондитерка", "Конфеты фас", "Коробки конфет", "Сладости", "Кофе", "Чай"],
    "3Ш": ["Шоколад"],
    "6БХ": ["Бытовая химия", "Хоз. товары", "Гигиена", "Косметика", "ТНП", "Товары для животных"],
    "4В": ["Вода"],
    "5Л": ["Лимонады", "Соки", "Энергетики"],
    "5П": ["Пиво", "САН"],
    "4ВН": ["Вино"],
    "4ВНи": ["Вино игристое", "Вермуты"],
    "5Н": ["Крепкий алкоголь"],
    "5М1": ["Молочная гастрономия (традиц.)", "Йогурты", "Детское молочное", "Масло, маргарин", "Сгущенка", "Сыры"],
    "5Пр": ["Рыбная гастрономия (пресервы)", "Икорник", "Майонез"],
    "6МЯ": ["Мясо, птица охлажденные"],
    "5К": ["Мясная гастрономия"],
    "5О": ["ОИФ горка", "Соленья"],
    "5F": ["FTG (готовая еда)", "Торты и пирожные"],
    "3О": ["Овощи"], "3Оф": ["Фрукты"],
    "ЗАМ": ["ОИФ + ПФ замороженные", "Рыба замороженная"],
    "МОР": ["Мороженое"],
}

C = {  # цвета
    "shelf": "#c9d6df", "dry": "#c9d6df", "alc": "#b9b0d6", "drinks": "#a9d0e6", "fresh": "#5cc95c",
    "cold": "#9fb3ff", "meat": "#ff9fc4", "dairy": "#c7c7ff", "frozen": "#9fdcff", "bread": "#f39a2c",
    "red": "#c0272d", "wood": "#a8763e", "dark": "#4a4a4a", "white": "#f2f2f2", "gray": "#9a9a9a",
    "green": "#7da600", "brand": "#b77cff", "radiator": "#c9a79a", "beige": "#e9d8b8", "orange": "#ffb27a",
}

def P(x0, y0, x1, y1, h, kind, color=None, y0h=0, face=None, label=None, cats=None, shelves=None, sign=None):
    d = {"b": [x0, y0, x1, y1], "h": h, "kind": kind, "y0": y0h}
    if color: d["color"] = color
    if face: d["face"] = face
    if label: d["label"] = label
    if cats: d["cats"] = cats
    if shelves: d["shelves"] = shelves
    if sign: d["sign"] = sign
    return d

ITEMS = []
def I(id, name, code, front, parts, group, hsrc="схема", spec=None, temp=None, note=None, fixed=False, cats=None):
    ITEMS.append(dict(id=id, name=name, code=code, front=front, parts=parts, group=group, hsrc=hsrc,
                      spec=spec, temp=temp, note=note, fixed=fixed, cats=cats))

TYP = "типовое"
# --- Холодная комната (верх слева)
I("cold-meat-pres", "Встроенный холод: мясо и пресервы", "6МЯ + 5П", "+y", [
    P(942, 271, 1899, 1091, 2100, "cold", C["meat"], face="+y", label="6МЯ Мясо, птица", cats=CATS["6МЯ"], sign="Мясо"),
    P(1899, 271, 2857, 1091, 2100, "cold", C["dairy"], face="+y", label="5П Пресервы", cats=CATS["5Пр"], sign="Пресервы"),
], "fresh", hsrc=TYP, spec="L=1875 / W=820, с дверями", temp="0…+2 °C")
I("sh-6km", "Пристенный стеллаж", "6ЯЙ (6КМ)", "+x", [
    P(298, 1101, 884, 2410, 2250, "shelf", C["dry"], face="+x", cats=CATS["6КМ"], sign="Масло · Мука · Яйцо"),
], "dry", spec="1250 × 500, 7 полок")
I("sh-7ok", "Пристенный стеллаж", "7ОК", "-x", [
    P(2929, 1125, 3402, 1820, 2250, "shelf", C["dry"], face="-x", cats=CATS["7ОК"], sign="Консервы · Крупы"),
], "dry", spec="650 × 400")
I("sh-6s", "Пристенный стеллаж", "6С", "-x", [
    P(2929, 1820, 3402, 2500, 2250, "shelf", C["dry"], face="-x", cats=CATS["6С"], sign="Снеки · Орехи"),
], "dry", spec="650 × 400")
I("sh-6t1", "Пристенный стеллаж", "6Т1", "-x", [
    P(2929, 2500, 3402, 3195, 2250, "shelf", C["dry"], face="-x", cats=CATS["6Т1"], sign="Завтраки · МТМ"),
], "dry", spec="650 × 400")
I("fr-pepsi", "Холодильник №11 ПепсиКо (узкий)", "Х-к №11", "+y", [
    P(2921, 3201, 3406, 3666, 1800, "fridge", "#1f5fbf", face="+y", sign="ПепсиКо"),
], "drinks", hsrc=TYP, spec="485 × 465")
I("fresh-veg", "Фреш-горка: овощи", "3ОФ", "+x", [
    P(878, 2434, 1744, 3715, 1625, "fresh", C["fresh"], face="+x", cats=CATS["3О"], sign="Овощи"),
], "fresh", spec="1282 × 865")
I("fresh-fruit", "Фреш-горка: фрукты", "3ОФ", "+x", [
    P(878, 3718, 1744, 4999, 1625, "fresh", "#ffb347", face="+x", cats=CATS["3Оф"], sign="Фрукты"),
], "fresh", spec="1282 × 865")
I("cold-oif", "Встроенный холод: ОИФ, FTG и торты", "5О + 5F", "+x", [
    P(894, 5024, 1714, 6001, 2100, "cold", C["fresh"], face="+x", label="5О ОИФ горка", cats=CATS["5О"], sign="ОИФ"),
    P(894, 6001, 1714, 6979, 2100, "cold", "#7fd6c8", face="+x", label="5F FTG + торты", cats=CATS["5F"], sign="FTG · Торты"),
], "fresh", hsrc=TYP, spec="L=1875 / W=820, с дверями", temp="+3…+5 °C")
# --- Центральная часть
I("sh-bread", "Стеллаж хлебный", "4Х", "-x", [
    P(2878, 4934, 3418, 6244, 1850, "shelf", C["bread"], face="-x", cats=CATS["4Х"], sign="Хлеб"),
], "dry", spec="1250 × 500")
I("sh-5n-vodka", "Стеллаж алкогольный", "5Н", "+x", [
    P(3418, 4934, 3858, 6244, 1850, "shelf", C["alc"], face="+x", cats=["Водка"] + CATS["5Н"], sign="Водка"),
], "alc", spec="1250 × 400")
I("sh-5n-liq", "Стеллаж алкогольный", "5Н", "-x", [
    P(4968, 5121, 5440, 5831, 2250, "shelf", C["alc"], face="-x", cats=["Крепкий алкоголь", "Ликеры"], sign="Кр. алк · Ликеры"),
], "alc", spec="650 × 400")
I("chest-ice", "Ларь «Мороженое» с суперструктурой «Шоколад»", "3Ш", "+y", [
    P(5381, 5945, 6181, 6545, 850, "chest", C["frozen"], face="+y", label="Ларь мороженое", cats=CATS["МОР"], sign="Мороженое"),
    P(5466, 5947, 6116, 6247, 1850, "shelf", C["dry"], y0h=850, face="+y", label="3Ш суперструктура", cats=CATS["3Ш"], sign="Шоколад"),
], "frozen", spec="ларь L=800 / W=800; суперструктура 650 × 500, h=1850", temp="−18…−20 °C")
I("stand-a", "Промо-стойка «А»", "А · Промо", "-x", [
    P(4970, 5880, 5363, 6540, 1400, "promo", "#ff7a00", face="-x", cats=["Снеки", "Сладости", "Орехи, сухофрукты"], sign="ПРОМО"),
], "promo", hsrc=TYP, spec="напольная картонная стойка")
I("kso", "Касса самообслуживания (КСО) со стойками А и В", "КСО", "+x", [
    P(600, 7330, 1329, 8030, 1450, "kiosk", C["gray"], face="+x", label="КСО"),
    P(808, 7003, 988, 7330, 1400, "shelf", C["orange"], face="+x", label="Стойка В для КСО", sign="В"),
    P(808, 8030, 988, 8341, 1400, "shelf", C["orange"], face="+x", label="Стойка А для КСО", sign="А"),
], "cash", hsrc=TYP, spec="КСО 0,74 м²; прикассовые стойки 230 × 187")
I("coffee", "Кофе-точка: кофемашина и сиропы", "Кофе СП", "+x", [
    P(636, 8397, 1236, 8655, 900, "counter", C["wood"], face="+x", label="Место под сиропы"),
    P(636, 8655, 1236, 9255, 900, "counter", C["wood"], face="+x", label="Стеллаж под кофемашину"),
    P(686, 8705, 1186, 9205, 600, "coffee", "#2b2b2b", y0h=900, face="+x", label="Кофемашина"),
    P(686, 8410, 1186, 8645, 350, "syrups", "#7b1f1f", y0h=900, face="+x", label="Сиропы, стаканы, крышки"),
], "cash", hsrc=TYP)
I("pack-table", "Стол для упаковки", "Стол для сбора", "+x", [
    P(549, 9282, 1050, 10285, 850, "counter", C["dark"], face="+x"),
], "cash", hsrc=TYP, spec="1000 × 500")
I("baskets", "Корзины покупателей", "Корзины", "+x", [
    P(2508, 9094, 2838, 9549, 850, "baskets", "#d32f2f", face="+x"),
], "cash", hsrc=TYP)
I("brand-wall", "Бренд-стена", "Бренд-стена", "+x", [
    P(2854, 7729, 2974, 10293, 2500, "panel", C["brand"], face="+x", sign="Бренд-стена 2564 мм"),
    # уголок покупателя на стороне, обращенной ко входу
    P(2824, 9150, 2854, 10150, 1150, "infoboard", "#1e5bd8", y0h=850, face="-x", label="Уголок покупателя"),
], "decor", hsrc=TYP, note="Высокое оборудование: предусмотреть декор", fixed=True)
# --- Алкотабакошоп
I("cash-alc", "Касса с лентопротягом (алкотабакошоп)", "Касса", "-y", [
    # Покупатель подходит из зала, выкладывает товар на ленту справа, оплачивает в центре и забирает
    # покупки слева, откуда короткий путь к выходу. Над столешницей ничего нет, кроме низкого экрана
    # из оргстекла: кассир и покупатель видят друг друга. Импульсный товар на полочках на лицевой
    # панели ленты ниже столешницы. Проход кассира справа от ленты (около 650 мм) свободен.
    P(4460, 7955, 5760, 8685, 900, "belt", "#5f6669", face="-y", label="Лента с полочками импульсного товара"),
    P(3860, 8065, 4460, 8685, 900, "checkout", "#5f6669", face="-y", label="Модуль кассира: сканер, монитор, терминал"),
    P(3345, 8065, 3860, 8685, 900, "bagging", "#5f6669", face="-y", label="Накопитель"),
    P(4460, 8685, 4860, 9035, 850, "pedestal", "#5f6669", face="-x", label="Тумба кассира"),
    P(4500, 8720, 4830, 9000, 120, "box", "#f7d58c", y0h=850, label="Весы"),
    P(3940, 8760, 4380, 9200, 1050, "officechair", "#33475b", face="-y", label="Кресло кассира"),
], "cash", hsrc=TYP, spec="касса 2,3 м широкая, 2,59 м²")
I("gillette", "Диспенсер Gillette (на стене за кассиром)", "Gillette", "+x", [
    P(3345, 8950, 3485, 9450, 650, "box", "#f5e6c8", y0h=950, face="+x", sign="Gillette"),
], "cash", hsrc=TYP, note="Перенесен на стену за кассиром: доступ только у кассира")
I("cab-alc", "Алкогольный шкаф с 2 навесными полками", "Алкошкаф", "-y", [
    P(4659, 9673, 5859, 10065, 2000, "shelf", C["alc"], face="-y", cats=["Крепкий алкоголь"], sign="Алкоголь"),
], "alc", hsrc=TYP, spec="1200 × 440")
I("cab-tob", "Табачный шкаф 180 слотов", "Табачный шкаф", "-y", [
    P(3409, 9673, 4659, 10065, 2000, "tobacco", C["dark"], face="-y", sign="Табак"),
], "alc", hsrc=TYP, spec="1250 × 400")
I("um-desk", "Рабочее место УМ", "УМ", "-y", [
    P(5920, 9565, 6580, 10065, 750, "counter", C["white"], face="-y", label="Стол"),
    P(6110, 9150, 6510, 9560, 1050, "officechair", "#33475b", face="+y", label="Кресло"),
], "staff", hsrc=TYP)
# --- Правый зал
I("sh-4vn-1", "Пристенный стеллаж", "4ВН", "+y", [
    P(7086, 3606, 8381, 4085, 2250, "shelf", C["alc"], face="+y", cats=CATS["4ВНи"], sign="Вино игр. · Вермуты"),
], "alc", spec="1250 × 400")
I("sh-4vn-2", "Пристенный стеллаж", "4ВН", "+y", [
    P(8381, 3606, 9661, 4085, 2250, "shelf", C["alc"], face="+y", cats=CATS["4ВН"], sign="Вино"),
], "alc", spec="1250 × 400")
I("sh-5p-1", "Пристенный стеллаж", "5П", "+y", [
    P(9661, 3606, 10956, 4085, 2250, "shelf", C["drinks"], face="+y", cats=CATS["5П"], sign="Пиво · САН"),
], "drinks", spec="1250 × 400")
I("sh-5p-2", "Пристенный стеллаж", "5П", "-x", [
    P(11284, 3836, 11758, 5146, 2250, "shelf", C["drinks"], face="-x", cats=CATS["5П"], sign="Пиво · САН"),
], "drinks", spec="1250 × 400")
I("sh-4v", "Пристенный стеллаж", "4В", "-x", [
    P(10410, 5172, 10897, 5881, 2250, "shelf", C["drinks"], face="-x", cats=CATS["4В"], sign="Вода"),
], "drinks", spec="650 × 400")
I("drinks-stand", "Стойка / препак DRINKS: снеки к пиву", "Стойка DRINKS", "-y", [
    P(7068, 5307, 7468, 5607, 1400, "shelf", "#ff8000", face="-y", cats=["Снеки к пиву"], sign="К пиву"),
], "promo", spec="400 × 300 × 1400")
I("cold-dairy", "Встроенный холод: молочная гастрономия", "5М1 + 5М1", "+x", [
    P(7482, 5329, 8302, 7869, 2100, "cold", C["dairy"], face="+x", cats=CATS["5М1"], sign="Молочная гастрономия"),
], "fresh", hsrc=TYP, spec="L=2500 / W=820, двери-купе", temp="+2…+4 °C")
I("cold-meatg", "Встроенный холод: мясная гастрономия", "5К", "+x", [
    P(7482, 7869, 8302, 9219, 2100, "cold", C["meat"], face="+x", cats=CATS["5К"], sign="Мясная гастрономия"),
], "fresh", hsrc=TYP, spec="L=1250 / W=820, с дверями", temp="+2…+4 °C")
I("island", "Островной стеллаж", "5Л + 5Л / 7ДПГ + 6НФ", "+y", [
    P(9451, 6883, 10130, 7283, 1850, "shelf", C["drinks"], face="-y", label="5Л", cats=CATS["5Л"], sign="Лимонады · Соки"),
    P(10130, 6883, 10840, 7283, 1850, "shelf", C["drinks"], face="-y", label="5Л", cats=CATS["5Л"], sign="Соки · Энергетики"),
    P(9451, 7283, 10130, 7363, 1850, "spine", C["gray"]),
    P(10130, 7283, 10840, 7363, 1850, "spine", C["gray"]),
    P(9451, 7363, 10130, 7763, 1850, "shelf", C["dry"], face="+y", label="7ДПГ", cats=CATS["7Д"], sign="Детское"),
    P(10130, 7363, 10840, 7763, 1850, "shelf", C["dry"], face="+y", label="6НФ", cats=CATS["6БХ"], sign="Non Food"),
], "dry", spec="2 × 650 × 400 с каждой стороны")
I("sh-5mk", "Пристенный стеллаж", "5МК + 5МК", "-y", [
    P(10013, 8776, 10707, 9250, 2250, "shelf", C["dry"], face="-y", label="5МК 650", cats=CATS["5МК"], sign="Кондитерка · Кофе"),
    P(10707, 8776, 12002, 9250, 2250, "shelf", C["dry"], face="-y", label="5МК 1250", cats=CATS["5МК"], sign="Кондитерка · Чай"),
], "dry", spec="650 × 400 + 1250 × 400")
I("frozen", "Заморозка: бонета с шкафом-надстройкой", "Витрина + ларь", "-x", [
    P(12071, 6817, 12936, 8667, 850, "chest", C["frozen"], face="-x", label="Бонета", cats=CATS["ЗАМ"], sign="Заморозка"),
    P(12436, 6752, 13188, 8732, 1250, "fridge", "#7cc7f0", y0h=850, face="-x", label="Шкаф-надстройка", cats=CATS["ЗАМ"]),
], "frozen", hsrc=TYP, spec="ларь L=1850 / W=865; надстройка L=1980 / W=817", temp="−18…−20 °C")
I("fr-import", "Холодильник №1 «Импорт»", "Х-к №1", "-x", [
    P(12304, 5989, 13154, 6727, 2000, "fridge", "#2f7d5b", face="-x", cats=["Импортное пиво"], sign="Импорт"),
], "drinks", hsrc=TYP, spec="738 × 850")
I("unk-green", "Стеллаж складской с коробками", "Склад", "-x", [
    P(12708, 9640, 13208, 10240, 1800, "storage", "#3d5a80", face="-x"),
], "staff", hsrc=TYP, note="На схеме зеленый объект без подписи, показан как складской стеллаж")
# --- Инженерия (зафиксировано)
I("el-panel", "Электрощит", "ЭЩ", "+y", [
    P(3906, 3524, 4506, 3924, 1800, "box", C["red"], y0h=300, face="+y", sign="⚡"),
], "eng", hsrc=TYP, fixed=True)
I("pk-1", "Пожарный кран (шкаф ПК)", "ПК", "+y", [
    P(5033, 3514, 5833, 3764, 1000, "box", C["red"], y0h=900, face="+y", sign="ПК"),
], "eng", hsrc=TYP, note="Собственник предоставит любое место для переноса")
I("pk-2", "Пожарный кран (шкаф ПК)", "ПК", "+y", [
    P(5873, 3514, 6673, 3764, 1000, "box", C["red"], y0h=900, face="+y", sign="ПК"),
], "eng", hsrc=TYP, note="Собственник предоставит любое место для переноса")
for i, (b, lab) in enumerate([((6445, 6913, 6645, 7113), "Вентиляция"), ((6445, 7413, 6645, 7613), "Канализация"),
                              ((6483, 8043, 6683, 8243), "Вентиляция")]):
    I(f"riser-{i+1}", f"Стояк: {lab.lower()}", "В" if lab == "Вентиляция" else "К", "-x", [
        P(*b, CEIL, "box", "#3a3f8f" if lab == "Вентиляция" else "#2aa14a"),
    ], "eng", fixed=True)
for i, (b, lab) in enumerate([((226, 6392, 430, 7393), "Радиатор"), ((3842, 10088, 6236, 10288), "Радиатор"),
                              ((7329, 11701, 9723, 11901), "Радиатор"), ((10545, 11701, 12939, 11901), "Радиатор"),
                              ((13052, 10498, 13256, 11499), "Радиатор"), ((12282, 5465, 13282, 5665), "Гребенка отопления")]):
    I(f"rad-{i+1}", lab, "О", "+y", [P(*b, 600, "radiator", C["radiator"], y0h=150)], "eng", hsrc=TYP, fixed=True)
# --- Служебные помещения
I("kpp-fridge", "Холодильник бытовой с печью СВЧ", "КПП", "+x", [
    P(7068, 9376, 7668, 9976, 1850, "box", C["white"], face="+x", label="Холодильник"),
    P(7118, 9476, 7618, 9876, 300, "box", "#333", y0h=1850, label="Печь СВЧ"),
], "staff", hsrc=TYP)
I("kpp-dish", "Шкаф для посуды", "КПП", "+x", [
    P(7068, 9976, 7368, 10576, 2000, "cupboard", "#d8c08a", face="+x"),
], "staff", hsrc=TYP)
I("kpp-table", "Стол обеденный со стульями", "КПП", "+y", [
    P(7750, 11050, 8550, 11650, 750, "table", C["white"], face="+y", label="Стол"),
    P(7340, 11160, 7720, 11540, 900, "chair", "#cfcfcf", face="+x", label="Стул"),
    P(7960, 10640, 8340, 11020, 900, "chair", "#cfcfcf", face="+y", label="Стул"),
    P(7790, 11050, 8140, 11650, 450, "monoblock", "#2b2e33", y0h=750, face="-x", label="Моноблок"),
], "staff", hsrc=TYP)
I("wc-toilet", "Унитаз", "С/У", "-y", [P(9466, 11020, 9826, 11700, 830, "toilet", C["white"], face="-y")], "staff", hsrc=TYP)
I("wc-sink", "Раковина с зеркалом", "С/У", "+x", [P(8860, 10650, 9280, 11150, 1550, "sink", C["white"], face="+x")], "staff", hsrc=TYP)
I("srv-rack", "Серверный шкаф", "Серверная", "-y", [P(10340, 11050, 10940, 11650, 2000, "rack", "#222", face="-y")], "staff", hsrc=TYP)
I("mc-rack", "Стеллаж складской с коробками", "Склад", "+y", [
    P(12230, 10600, 13030, 11100, 1800, "storage", "#3d5a80", face="+y"),
], "staff", hsrc=TYP, note="Поставлен вместо стола и тумбы главной кассы")
I("mc-adm", "АДМ (депозитарная машина)", "АДМ", "-y", [P(11300, 11177, 11760, 11704, 1500, "box", "#5a6a7a", face="-y", sign="АДМ")], "staff", hsrc=TYP)
I("mc-safe", "Сейф", "Сейф", "-y", [P(11880, 11335, 12305, 11680, 1200, "box", "#555", face="-y")], "staff", hsrc=TYP)

# --- Не удалось разместить (палитра)
TEMPLATES = [
    {"tid": "fr-baltika", "group": "Не удалось разместить", "name": "Холодильник №10 Балтика (узкий)", "code": "Х-к №10",
     "parts": [{"x": 0, "z": 0, "w": 485, "d": 465, "h": 1800, "y0": 0, "kind": "fridge", "color": "#1b3f8f", "face": "+z", "sign": "Балтика"}], "spec": "485 × 465", "hsrc": TYP, "g": "drinks"},
    {"tid": "fr-cola", "group": "Не удалось разместить", "name": "Холодильник №7 Кока-Кола", "code": "Х-к №7",
     "parts": [{"x": 0, "z": 0, "w": 765, "d": 810, "h": 2000, "y0": 0, "kind": "fridge", "color": "#d0021b", "face": "+z", "sign": "Кока-Кола"}], "spec": "765 × 810", "hsrc": TYP, "g": "drinks"},
    {"tid": "sh-3ps", "group": "Не удалось разместить", "name": "Стеллаж «Сезон»", "code": "3ПС",
     "parts": [{"x": 0, "z": 0, "w": 1250, "d": 500, "h": 1850, "y0": 0, "kind": "shelf", "color": C["dry"], "face": "+z", "sign": "Сезон", "cats": ["Сезонный товар"]}], "spec": "1250 × 500", "hsrc": TYP, "g": "promo"},
    {"tid": "roll", "group": "Не удалось разместить", "name": "Ролл-контейнер", "code": "Ролл",
     "parts": [{"x": 0, "z": 0, "w": 800, "d": 720, "h": 1800, "y0": 0, "kind": "roll", "color": "#e8b4b4", "face": "+z"}], "spec": "h = 1,8 м (на схеме 4 шт.)", "hsrc": "схема", "g": "staff"},
    {"tid": "rack-980", "group": "Не удалось разместить", "name": "Стеллаж 980 × 600", "code": "980×600",
     "parts": [{"x": 0, "z": 0, "w": 980, "d": 600, "h": 1800, "y0": 0, "kind": "shelf", "color": "#ddd", "face": "+z"}], "spec": "980 × 600 (на схеме 2 шт.)", "hsrc": TYP, "g": "staff"},
    {"tid": "tbo", "group": "Не удалось разместить", "name": "Контейнер ТБО", "code": "ТБО",
     "parts": [{"x": 0, "z": 0, "w": 600, "d": 550, "h": 1000, "y0": 0, "kind": "box", "color": "#b9cf8f", "face": "+z", "sign": "ТБО"}], "hsrc": TYP, "g": "staff"},
    {"tid": "promo-basket", "group": "Не удалось разместить", "name": "Корзина «Промо»", "code": "Корзина Промо",
     "parts": [{"x": 0, "z": 0, "w": 600, "d": 600, "h": 800, "y0": 0, "kind": "bin", "color": "#ffcc33", "face": "+z", "sign": "Промо"}], "spec": "600 × 600 (на схеме 2 шт.)", "hsrc": "схема", "g": "promo"},
    {"tid": "t-wall-650", "group": "Типовое оборудование", "name": "Пристенный стеллаж 650", "code": "650×400",
     "parts": [{"x": 0, "z": 0, "w": 710, "d": 480, "h": 2250, "y0": 0, "kind": "shelf", "color": C["dry"], "face": "+z"}], "spec": "650 × 400, h=2250", "hsrc": "схема", "g": "dry"},
    {"tid": "t-wall-1250", "group": "Типовое оборудование", "name": "Пристенный стеллаж 1250", "code": "1250×400",
     "parts": [{"x": 0, "z": 0, "w": 1310, "d": 480, "h": 2250, "y0": 0, "kind": "shelf", "color": C["dry"], "face": "+z"}], "spec": "1250 × 400, h=2250", "hsrc": "схема", "g": "dry"},
    {"tid": "t-island", "group": "Типовое оборудование", "name": "Островной стеллаж 2 × 650", "code": "Остров",
     "parts": [{"x": 0, "z": -240, "w": 1390, "d": 400, "h": 1850, "y0": 0, "kind": "shelf", "color": C["dry"], "face": "-z"},
               {"x": 0, "z": 0, "w": 1390, "d": 80, "h": 1850, "y0": 0, "kind": "spine", "color": C["gray"]},
               {"x": 0, "z": 240, "w": 1390, "d": 400, "h": 1850, "y0": 0, "kind": "shelf", "color": C["dry"], "face": "+z"}], "spec": "h=1850", "hsrc": "схема", "g": "dry"},
    {"tid": "t-pallet", "group": "Типовое оборудование", "name": "Промо-паллета", "code": "Паллета",
     "parts": [{"x": 0, "z": 0, "w": 800, "d": 1200, "h": 1200, "y0": 0, "kind": "pallet", "color": "#e8c07a", "face": "+z", "sign": "Промо"}], "spec": "800 × 1200", "hsrc": TYP, "g": "promo"},
    {"tid": "t-chest", "group": "Типовое оборудование", "name": "Морозильный ларь", "code": "Ларь",
     "parts": [{"x": 0, "z": 0, "w": 1500, "d": 800, "h": 850, "y0": 0, "kind": "chest", "color": C["frozen"], "face": "+z"}], "spec": "1500 × 800", "hsrc": TYP, "g": "frozen"},
    {"tid": "t-fridge", "group": "Типовое оборудование", "name": "Холодильник однодверный", "code": "Х-к",
     "parts": [{"x": 0, "z": 0, "w": 660, "d": 735, "h": 2000, "y0": 0, "kind": "fridge", "color": "#1f5fbf", "face": "+z"}], "spec": "660 × 735", "hsrc": TYP, "g": "drinks"},
]

ROUTES = [
    {"name": "Эвакуация: дальний холодный зал → эвакуационный выход", "from": [2100, 1700], "to": [9370, 9150], "width": 1000},
    {"name": "Эвакуация: заморозка → главный вход", "from": [11500, 7900], "to": [1900, 9900], "width": 1000},
    {"name": "Транспортный коридор: вход → встроенный холод «Мясо»", "from": [1900, 9900], "to": [1900, 1600], "width": 1200},
    {"name": "Транспортный коридор: вход → молочная гастрономия", "from": [1900, 9900], "to": [8950, 6600], "width": 1200},
    {"name": "Транспортный коридор: вход → заморозка", "from": [1900, 9900], "to": [11500, 7900], "width": 1200},
]

LABELS = [
    {"t": "Торговый зал", "x": 5200, "y": 4700, "s": 1},
    {"t": "Холодная зона", "x": 2100, "y": 1900, "s": 0.8},
    {"t": "Алкотабакошоп", "x": 4600, "y": 7600, "s": 0.8},
    {"t": "Вход / разгрузка", "x": 1650, "y": 11300, "s": 0.8},
    {"t": "КПП (комната приема пищи)", "x": 8000, "y": 10300, "s": 0.6},
    {"t": "Эвакуационный выход", "x": 9400, "y": 10500, "s": 0.55},
    {"t": "С/У", "x": 9400, "y": 11050, "s": 0.7},
    {"t": "Аппаратная / серверная", "x": 10640, "y": 11080, "s": 0.55},
    {"t": "Главная касса", "x": 12200, "y": 11200, "s": 0.6},
    {"t": "Коридор", "x": 11000, "y": 9850, "s": 0.6},
]
DECALS = [
    {"kind": "evac", "b": [9258, 9356, 9557, 10505]},
    {"kind": "mat", "b": [1680, 10536, 2675, 11535]},
]

def beams(page):
    out = []
    for x in page.get_drawings():
        if col(x.get("fill")) == (0.99, 0.87, 0.01) and PLAN.contains(x["rect"]) and len(x["items"]) == 1:
            r = x["rect"]
            out.append([round((r.x0 - X0) * S), round((r.y0 - Y0) * S), round((r.x1 - X0) * S), round((r.y1 - Y0) * S)])
    return out

def build_item(it):
    rot = FRONT_ROT[it["front"]]
    t = math.radians(rot)
    xs = [p["b"][0] for p in it["parts"]] + [p["b"][2] for p in it["parts"]]
    ys = [p["b"][1] for p in it["parts"]] + [p["b"][3] for p in it["parts"]]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    parts = []
    for p in it["parts"]:
        x0, y0, x1, y1 = p["b"]
        wx, wz = (x0 + x1) / 2 - cx, (y0 + y1) / 2 - cy
        lx = wx * math.cos(t) - wz * math.sin(t)
        lz = wx * math.sin(t) + wz * math.cos(t)
        ex, ez = x1 - x0, y1 - y0
        if rot in (90, -90): ex, ez = ez, ex
        q = {"x": round(lx), "z": round(lz), "w": round(ex), "d": round(ez), "h": p["h"], "y0": p["y0"], "kind": p["kind"],
             "color": p.get("color", "#ccc")}
        if "face" in p:
            vx, vz = DIRV[p["face"]]
            fx = vx * math.cos(t) - vz * math.sin(t)
            fz = vx * math.sin(t) + vz * math.cos(t)
            q["face"] = ("+x" if fx > .5 else "-x") if abs(fx) > .5 else ("+z" if fz > .5 else "-z")
        for k in ("label", "cats", "sign"):
            if k in p: q[k] = p[k]
        parts.append(q)
    W = max(abs(q["x"]) + q["w"] / 2 for q in parts) * 2
    Dd = max(abs(q["z"]) + q["d"] / 2 for q in parts) * 2
    H = max(q["y0"] + q["h"] for q in parts)
    out = {"id": it["id"], "name": it["name"], "code": it["code"], "g": it["group"], "x": round(cx), "y": round(cy),
           "rot": rot, "w": round(W), "d": round(Dd), "h": H, "hsrc": it["hsrc"], "fixed": it["fixed"], "parts": parts}
    for k in ("spec", "temp", "note"):
        if it.get(k): out[k] = it[k]
    cats = []
    for q in parts:
        for c in q.get("cats", []):
            if c not in cats: cats.append(c)
    if cats: out["cats"] = cats
    return out

def floor_poly(allw):
    b = allw.bounds
    closed = unary_union([allw] + [LineString([(w["x0"] - 50, w["y"]), (w["x1"] + 50, w["y"])]).buffer(60) for w in WINDOWS]).buffer(120).buffer(-120)
    free = box(*b).difference(closed)
    inner = [g for g in getattr(free, "geoms", [free])
             if g.bounds[0] > b[0] + 1 and g.bounds[1] > b[1] + 1 and g.bounds[2] < b[2] - 1 and g.bounds[3] < b[3] - 1]
    fl = unary_union(inner + [allw]).buffer(30).buffer(-30)
    fl = max(getattr(fl, "geoms", [fl]), key=lambda g: g.area)
    return {"pts": ring(fl.exterior.simplify(10)), "area_inner_m2": round(sum(g.area for g in inner) / 1e6, 1)}

def main(pdf):
    doc = pymupdf.open(pdf)
    page = doc[0]
    wl, allw = walls(page)
    wl = cut_doors(wl)
    fl = floor_poly(allw)
    b = allw.bounds
    data = {
        "meta": {"name": "Магазин №1", "ceiling": CEIL, "bounds": [round(v) for v in b],
                 "source": "Технологическая схема, лист 1 и обмерная схема, лист 3; масштаб 15,678 мм/пт",
                 "floorArea": fl["area_inner_m2"]},
        "walls": wl, "floor": fl["pts"], "windows": WINDOWS + GLASS_PARTS, "lintels": LINTELS, "doors": DOORS, "facade": FACADE,
        "beams": [{"b": bb, "y0": CEIL - 600} for bb in beams(page)],  # глубина ригеля на схеме не указана
        "labels": LABELS, "decals": DECALS, "routes": ROUTES,
        "items": [build_item(i) for i in ITEMS], "templates": TEMPLATES,
    }
    os.makedirs(os.path.join(os.path.dirname(__file__), "..", "data"), exist_ok=True)
    out = os.path.join(os.path.dirname(__file__), "..", "data", "store.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("walls", len(wl), "items", len(data["items"]), "beams", len(data["beams"]), "floor m2", fl["area_inner_m2"], "->", out)

if __name__ == "__main__":
    main(sys.argv[1])
