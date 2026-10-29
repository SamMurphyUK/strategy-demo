// Builds demomap01.json in the land SVG's coordinate space.
// Projection fitted to ne_110m_land_adjsut.svg: Mercator, lon_0 = 60, 800px = 360°,
// equator at y = 355. Anchors are checked against the SVG land mask before the file is written.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const svg = readFileSync(resolve(root, "web/public/assets/ne_110m_land_adjsut.svg"), "utf8");
const paths = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);

function ringOf(part) {
  const nums = part
    .replace(/[MZ]/gi, " ")
    .trim()
    .split(/[\s,]+/)
    .filter((s) => s !== "")
    .map(Number);
  const pts = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i], y = nums[i + 1];
    pts.push([x, y]);
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { pts, minX, minY, maxX, maxY };
}

const groups = paths.map((d) => {
  const rings = d.trim().split(/(?=M)/i).filter((s) => s.trim() !== "").map(ringOf);
  return {
    rings,
    minX: Math.min(...rings.map((r) => r.minX)),
    minY: Math.min(...rings.map((r) => r.minY)),
    maxX: Math.max(...rings.map((r) => r.maxX)),
    maxY: Math.max(...rings.map((r) => r.maxY)),
  };
});

function insideRing(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const landBits = new Uint8Array(800 * 504);
{
  // Rasterise the land SVG once (even-odd per path, pixel centres), so land tests are lookups.
  for (const group of groups) {
    const y0 = Math.max(0, Math.floor(group.minY));
    const y1 = Math.min(503, Math.ceil(group.maxY));
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      const xs = [];
      for (const ring of group.rings) {
        if (py < ring.minY || py > ring.maxY) continue;
        const pts = ring.pts;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i];
          const [xj, yj] = pts[j];
          if (yi > py !== yj > py) xs.push(((xj - xi) * (py - yi)) / (yj - yi) + xi);
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.ceil(xs[k] - 0.5));
        const to = Math.min(799, Math.ceil(xs[k + 1] - 0.5) - 1);
        for (let x = from; x <= to; x++) landBits[y * 800 + x] = 1;
      }
    }
  }
}
function isLand(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix > 799 || iy > 503) return false;
  return landBits[iy * 800 + ix] === 1;
}

const K = 800 / 360;
const LON0 = 60;
const OX = 400;
const OY = 355;
function merc(lat) {
  const phi = (lat * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + phi / 2)) * (180 / Math.PI);
}
function proj(lon, lat) {
  return [round((lon - LON0) * K + OX), round(OY - merc(lat) * K)];
}
function round(n) {
  return Math.round(n * 100) / 100;
}

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Cutter polygons, in SVG pixels. Each is a rough outline: the web app clips it against the land SVG,
// so land cutters only have to enclose their landmass (and never slice a coastline tip) and sea cutters
// only have to cover their water. Together the land cutters must leave no land unclaimed.
//
// The Atlantic seaboard of this "adjusted" SVG is displaced against a true Mercator grid (Britain,
// Ireland, Iberia and the mainland west coast sit 15-30px west of their lon/lat), so that fringe is
// authored in raw pixels read off the SVG. Everywhere else lon/lat lines up and `ll` is used.
const X = (lon) => proj(lon, 0)[0];
const Y = (lat) => proj(0, lat)[1];
const ll = (...pts) => pts.map(([lon, lat]) => proj(lon, lat));
const SEAM = 691.5; // x where Siberia ends and Alaska begins (the Bering Strait)
const JAPAN_TOP = 241.3; // between Sakhalin's southern tip (240.7) and Hokkaido's northern tip (242.0)
const FAR_EAST = 558.5; // east of Korea and Primorye, west of the Japanese islands
const ARCTIC = 0; // the map's top edge: cutters run to it so the Arctic islands are claimed

const lands = [
  // --- Western Europe (raw px) ---
  land("United Kingdom", "UK", 8, true, true, [-1.5, 53], [
    [213, 150.5], [249.9, 150.5], [249.9, 210], [213, 210],
  ]),
  land("France", "GER", 4, false, false, [2.3, 46.5], [
    [250, 188.5], [X(8), 188.5], [X(8), Y(47)], [268, Y(47)], [268, 241], [257, 241], [257, 238.5], [230, 238.5], [230, 210], [250, 210],
  ]),
  land("Spain", "Neutral", 1, false, false, [-4.5, 40], [
    [213, 237], [230, 237], [230, 238.5], [257, 238.5], [257, 272.5], [213, 272.5],
  ]),
  land("Germany", "GER", 8, true, true, [11, 51], ll([8, 55], [15, 55], [15, 47], [8, 47])),
  land("Southern Europe", "GER", 3, false, false, [12.5, 43.5], [
    [268, Y(47)], ...ll([8, 47], [15, 47], [20, 47], [20, 37]), [268, Y(37)],
  ]),
  land("Scandinavia", "GER", 2, false, false, [15, 62], [
    [257, ARCTIC], [X(32), ARCTIC], ...ll([32, 70], [32, 60], [32, 55], [15, 55], [8, 55]), [X(8), 188.5], [257, 188.5],
  ]),
  land("Eastern Europe", "GER", 3, false, false, [22, 51], ll([15, 47], [32, 47], [32, 50], [32, 55], [15, 55])),
  land("Balkans", "Neutral", 1, false, false, [26, 41], [
    ...ll([20, 47], [32, 47], [32, 50], [36, 50], [36, 40], [38, 40]),
    [X(38), Y(32)], [X(38), 284.5], [337.8, 284.5], [337.8, Y(32)], [X(25), Y(32)], [X(25), 276], [316, 276], [316, Y(37)], [X(20), Y(37)],
  ]),
  land("Iceland", "Neutral", 1, false, false, [-19, 65], [
    [226.5, 118], [254, 118], [254, 144], [226.5, 144],
  ]),
  land("Greenland", "Neutral", 1, false, false, [-40, 72], [
    [146, ARCTIC], [245, ARCTIC], [245, 112], [226, 112], [226, 150], [200, 150], [200, 197.5], [135, 197.5], [135, 104], [102, 104], [102, 72],
    [103, 64], [108, 56], [115, 48], [115.5, 40], [121.5, 32], [123, 24], [132, 16],
  ]),
  // --- Russia and Central Asia ---
  land("Karelia", "USSR", 2, false, false, [40, 64], [
    [X(32), ARCTIC], [423, ARCTIC], [423, Y(60)], ...ll([60, 60], [52, 60], [32, 60]),
  ]),
  land("Moscow", "USSR", 8, true, true, [40, 55], ll([32, 50], [36, 50], [55, 50], [60, 50], [60, 60], [52, 60], [32, 60], [32, 55])),
  land("Caucasus", "USSR", 3, false, false, [45, 44], ll([36, 40], [38, 40], [55, 40], [55, 50], [36, 50])),
  land("Siberia", "USSR", 2, false, false, [90, 60], [
    ...ll([60, 50], [60, 60]), [423, Y(60)], [423, ARCTIC], [SEAM, ARCTIC], [SEAM, JAPAN_TOP], [FAR_EAST, JAPAN_TOP], [FAR_EAST, Y(50)],
  ]),
  land("Central Asia", "Neutral", 1, false, false, [68, 44], [
    ...ll([55, 40], [68, 40], [68, 32], [92, 32]), [X(92), Y(50)], ...ll([60, 50], [55, 50]),
  ]),
  land("Mongolia", "Neutral", 1, false, false, [105, 47], [
    [X(92), Y(50)], [X(118), Y(50)], [X(118), Y(42)], [X(92), Y(42)],
  ]),
  // --- Africa and the Middle East ---
  land("North Africa", "GER", 2, false, false, [8, 28], [
    [213, 272.5], [257, 272.5], [257, Y(37)], [316, Y(37)], [316, 276], [X(25), 276], [X(25), Y(32)], [X(25), Y(20)], [213, Y(20)],
  ]),
  land("Egypt", "UK", 2, false, false, [30, 26], [
    [X(25), Y(18)], [X(25), Y(20)], [X(25), Y(32)], [337.8, Y(32)], [337.8, 284.5], [X(38), 284.5], [X(38), Y(18)],
  ]),
  land("Middle East", "UK", 2, false, false, [48, 30], [
    [X(38), Y(16)], [X(42), Y(16)], [X(42), Y(12.2)], [X(60), Y(12.2)], [X(60), Y(16)], ...ll([68, 16], [68, 32], [68, 40], [55, 40], [38, 40], [38, 32], [38, 18]),
  ]),
  land("South Africa", "UK", 2, false, false, [25, -10], [
    [213, Y(20)], [X(25), Y(20)], [X(25), Y(18)], [X(38), Y(18)], [X(38), Y(16)], [X(42), Y(16)], [X(42), Y(12.2)], [X(60), Y(12.2)], [X(60), 441], [425, 441], [425, 484], [213, 484],
  ]),
  // --- South and East Asia ---
  land("India", "UK", 3, true, false, [78, 23], [
    [X(68), 343], [X(68), Y(16)], [X(68), Y(32)], [X(92), Y(32)], [X(92), Y(24)], [X(92), 343],
  ]),
  land("China", "USA", 3, false, false, [108, 32], [
    [X(92), Y(42)], [X(118), Y(42)], [X(118), Y(33)], [540, Y(33)], [540, 306.5], [X(112), 306.5], [X(112), Y(24)], [X(108), Y(24)], [X(96), Y(24)], [X(92), Y(24)],
  ]),
  land("Southeast Asia", "JAP", 2, false, false, [100, 16], [
    [X(92), Y(24)], [X(96), Y(24)], [X(108), Y(24)], [X(112), Y(24)], [X(112), 312], [X(112), 336.7], [X(92), 336.7],
  ]),
  land("Manchuria", "JAP", 3, false, false, [124, 42], [
    [X(118), Y(50)], [FAR_EAST, Y(50)], [FAR_EAST, 273.5], [553.5, 273.5], [553.5, Y(33)], [540, Y(33)], [X(118), Y(33)], [X(118), Y(42)],
  ]),
  land("Japan", "JAP", 8, true, true, [138, 36], [
    [FAR_EAST, JAPAN_TOP], [593, JAPAN_TOP], [593, 286], [553.5, 286], [553.5, 273.5], [FAR_EAST, 273.5],
  ]),
  land("East Indies", "JAP", 3, false, false, [118, 0], [
    [476, 336.7], [X(112), 336.7], [X(112), 312], [556.1, 312], [556.1, 359], [557.5, 359], [557.5, 364.5], [556.1, 364.5], [556.1, 378.6], [476, 378.6],
  ]),
  land("Papua and Melanesia", "Neutral", 1, false, false, [141, -5], [
    [556.1, 350], [668, 350], [668, 408], [609.5, 408], [609.5, 378.65], [556.1, 378.65], [556.1, 364.5], [557.5, 364.5], [557.5, 359], [556.1, 359],
  ]),
  land("Australia", "UK", 2, false, false, [134, -25], [
    [517, 378.65], [609, 378.65], [609, 463], [517, 463],
  ]),
  land("New Zealand", "Neutral", 1, false, false, [172, -42], [
    [630, 430], [668, 430], [668, 474], [630, 474],
  ]),
  // --- The Americas ---
  land("Hawaii", "Neutral", 1, false, false, [-155.5, 19.7], [
    [708, 302], [724, 302], [724, 315], [708, 315],
  ]),
  land("Alaska", "Neutral", 1, false, false, [-150, 64], [
    [SEAM, 70], [800, 70], [800, 282], [SEAM, 282],
  ]),
  land("Canada", "UK", 2, false, false, [-95, 55], [
    [0, ARCTIC], [146, ARCTIC], [132, 16], [123, 24], [121.5, 32], [115.5, 40], [115, 48], [108, 56], [103, 64], [102, 72], [102, 104], [135, 104], [135, 197.5], [153, 197.5],
    [153, 250], [X(-67), 250], [X(-67), Y(49)], [X(-102), Y(49)], [0, Y(49)],
  ]),
  land("Western United States", "USA", 4, true, false, [-112, 40], [
    [0, Y(49)], [X(-102), Y(49)], [X(-102), Y(31)], [0, Y(31)],
  ]),
  land("Eastern United States", "USA", 10, true, true, [-82, 38], [
    [X(-102), Y(24)], [X(-102), Y(31)], [X(-102), Y(49)], [X(-67), Y(49)], [X(-67), Y(24)],
  ]),
  land("Mexico", "Neutral", 1, false, false, [-102, 22], [
    [0, Y(31)], [X(-102), Y(31)], [X(-102), Y(24)], [X(-67), Y(24)], [X(-64), Y(24)], [X(-64), Y(13)], [X(-91), Y(13)], [X(-102), Y(8)], [0, Y(8)],
  ]),
  land("South America", "Neutral", 2, false, false, [-58, -12], [
    [X(-91), Y(13)], [X(-34), Y(13)], [X(-34), 503.9], [X(-80), 503.9], [X(-102), Y(8)],
  ]),
];

// Sea cutters overlap the coasts (they are differenced against the land). Shared corners are the
// sea-to-sea borders. The west Atlantic ones are raw pixels, for the displaced seaboard.
const seas = [
  sea("West US Coast", [-119.4, 37], ll([-120, 30], [-108, 30], [-108, 50], [-120, 50])),
  sea("East US Coast", [-62, 36], ll([-88, 25], [-55, 25], [-48, 25], [-48, 47], [-88, 47])),
  sea("Caribbean", [-75, 16], ll([-95, 8], [-60, 8], [-40, 8], [-40, 18], [-60, 18], [-60, 25], [-88, 25], [-95, 25])),
  sea("North Atlantic", [-30, 48], [
    [X(-48), Y(28)], [228, Y(28)], [228, 226], [228, 207], [228, Y(66)], [X(-20), Y(66)], [X(-48), Y(66)], [X(-48), Y(47)],
  ]),
  sea("South Atlantic", [-15, -15], ll([-40, -42], [20, -42], [36, -42], [36, -18], [15, -18], [15, 8], [-40, 8])),
  sea("English Channel", [-2, 50.5], [[228, 207], [262, 207], [262, 226], [228, 226]]),
  sea("North Sea", [14, 57], [[250, Y(66)], [320, Y(66)], [320, 207], [262, 207], [250, 207]]),
  sea("Barents Sea", [20, 70], [[X(-20), Y(66)], [X(-8), Y(66)], [X(6), Y(66)], [X(40), Y(66)], [X(40), Y(74)], [X(-20), Y(74)]]),
  sea("Mediterranean", [15, 37], [[228, Y(44)], [X(4), Y(44)], [X(36), Y(44)], [X(36), Y(32)], [X(36), Y(30)], [228, Y(30)]]),
  sea("Indian Ocean", [70, -10], ll([36, -42], [100, -42], [100, 16], [68, 16], [36, 16], [36, -18])),
  sea("East Indies Sea", [118, -2], ll([100, -14], [140, -14], [140, 8], [112, 8], [112, 16], [100, 16])),
  sea("Sea of Japan", [132, 37], ll([128, 30], [142, 30], [148, 34], [148, 46], [130, 46], [128, 40])),
  sea("Central Pacific", [175, 20], ll([148, 0], [210, 0], [210, 40], [148, 40], [148, 34])),
  sea("South Pacific", [175, -22], ll([140, -42], [210, -42], [210, 0], [148, 0], [140, -14])),
  sea("North Pacific", [175, 52], ll([148, 40], [210, 40], [210, 66], [150, 66], [148, 46])),
  sea("Arctic Ocean", [90, 73], ll([40, 66], [150, 66], [150, 75], [40, 75])),
];

const manual = [
  ["Central Pacific", "West US Coast"], // date line
  ["Caribbean", "West US Coast"], // Panama
  ["Mediterranean", "Indian Ocean"], // Suez
  ["Alaska", "Canada"], // across the map's seam
  ["Alaska", "Western United States"], // across the map's seam
];

// Cutters that touch across water, or only share a border because of how the boxes were drawn.
const unlink = [
  ["United Kingdom", "France"],
  ["Greenland", "Canada"],
  ["Greenland", "Iceland"],
  ["Alaska", "Siberia"],
  ["Japan", "Siberia"],
  ["Japan", "Manchuria"],
  ["East Indies", "Australia"],
  ["East Indies", "Southeast Asia"],
  ["Papua and Melanesia", "Australia"],
  ["Spain", "North Africa"],
  ["North Africa", "Southern Europe"],
  ["Scandinavia", "France"],
];

function land(id, owner, ipc, factory, capital, hint, ring) {
  return { id, owner, ipc, factory, capital, sea: false, hint, ring };
}
function sea(id, hint, ring) {
  return { id, owner: "Neutral", ipc: 0, factory: false, capital: false, sea: true, hint, ring };
}

const regions = [...lands, ...seas];
const problems = [];

for (const region of regions) {
  region.polygon = region.ring;
  const anchor = findAnchor(region);
  if (!anchor) {
    problems.push(`no ${region.sea ? "water" : "land"} anchor in ${region.id}`);
    region.anchor = proj(region.hint[0], region.hint[1]);
  } else {
    region.anchor = anchor;
  }
  for (const [x, y] of region.polygon) {
    if (x < -2 || x > 802 || y < -2 || y > 506) {
      problems.push(`${region.id} vertex ${x},${y} outside the viewBox`);
    }
  }
}

// The unit anchor: the point with the most room around it, on land for land regions and on open water for
// sea regions, inside the cutter. Ties go to the point nearest the hint.
function findAnchor(region) {
  const b = bounds(region.polygon);
  const want = region.sea ? false : true;
  const [hx, hy] = proj(region.hint[0], region.hint[1]);
  const ok = (x, y) => inPoly(x, y, region.polygon) && isLand(x, y) === want;
  let best = null;
  let bestClear = -1;
  let bestDist = Infinity;
  for (let y = Math.ceil(b.y0); y <= b.y1; y += 2) {
    for (let x = Math.ceil(b.x0); x <= b.x1; x += 2) {
      if (!ok(x, y)) continue;
      let clear = 0;
      for (let r = 2; r <= 14; r += 2) {
        let all = true;
        for (let k = 0; k < 8 && all; k++) {
          const a = (k / 8) * Math.PI * 2;
          all = ok(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        if (!all) break;
        clear = r;
      }
      const dist = Math.hypot(x - hx, y - hy);
      if (clear > bestClear || (clear === bestClear && dist < bestDist)) {
        best = [x, y];
        bestClear = clear;
        bestDist = dist;
      }
    }
  }
  return best;
}

// Interior overlap: a point well inside two land polygons.
for (let i = 0; i < lands.length; i++) {
  for (let j = i + 1; j < lands.length; j++) {
    const a = lands[i].polygon;
    const b = lands[j].polygon;
    const box = intersection(a, b);
    if (!box) continue;
    let hits = 0;
    for (let y = box.y0 + 3; y <= box.y1 - 3; y += 6) {
      for (let x = box.x0 + 3; x <= box.x1 - 3; x += 6) {
        if (inPoly(x, y, a) && inPoly(x, y, b)) hits++;
      }
    }
    if (hits > 2) problems.push(`overlap ${lands[i].id} / ${lands[j].id} (${hits} samples)`);
  }
}

const links = new Set();
function addLink(a, b) {
  if (a === b) return;
  links.add(a < b ? `${a}|${b}` : `${b}|${a}`);
}

for (let i = 0; i < regions.length; i++) {
  for (let j = i + 1; j < regions.length; j++) {
    const a = regions[i];
    const b = regions[j];
    if (a.sea === b.sea) {
      if (sameDomain(a.polygon, b.polygon)) addLink(a.id, b.id);
    } else if (coastal(a.sea ? b : a, a.sea ? a : b)) {
      addLink(a.id, b.id);
    }
  }
}
for (const [a, b] of manual) addLink(a, b);
for (const [a, b] of unlink) links.delete(a < b ? `${a}|${b}` : `${b}|${a}`);

function sameDomain(a, b) {
  const eps = 1.5;
  let shared = 0;
  for (const p of a) {
    if (b.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= eps)) shared++;
  }
  if (shared >= 2) return true;
  return sharesEdge(a, b, eps);
}
function sharesEdge(a, b, eps) {
  const edgeOn = (poly, other) => {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= eps * 2) continue;
      for (let j = 0; j < other.length; j++) {
        const s = other[j];
        const t = other[(j + 1) % other.length];
        if (distToSeg(p, s, t) <= eps && distToSeg(q, s, t) <= eps) return true;
      }
    }
    return false;
  };
  return edgeOn(a, b) || edgeOn(b, a);
}
function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}
function coastal(landRegion, seaRegion) {
  const lb = bounds(landRegion.polygon);
  const sb = bounds(seaRegion.polygon);
  const reach = 3;
  const step = 2;
  const x0 = Math.max(lb.x0, sb.x0) - reach;
  const y0 = Math.max(lb.y0, sb.y0) - reach;
  const x1 = Math.min(lb.x1, sb.x1) + reach;
  const y1 = Math.min(lb.y1, sb.y1) + reach;
  if (x0 > x1 || y0 > y1) return false;
  const landPts = [];
  const waterPts = [];
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      if (isLand(x, y)) {
        if (inPoly(x, y, landRegion.polygon)) landPts.push([x, y]);
      } else if (inPoly(x, y, seaRegion.polygon)) {
        waterPts.push([x, y]);
      }
    }
  }
  for (const p of landPts) {
    for (const q of waterPts) {
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= reach + step) return true;
    }
  }
  return false;
}
function bounds(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}
function intersection(a, b) {
  const ba = bounds(a);
  const bb = bounds(b);
  const x0 = Math.max(ba.x0, bb.x0);
  const y0 = Math.max(ba.y0, bb.y0);
  const x1 = Math.min(ba.x1, bb.x1);
  const y1 = Math.min(ba.y1, bb.y1);
  if (x0 > x1 || y0 > y1) return null;
  return { x0, y0, x1, y1 };
}

const neighbors = {};
for (const region of regions) neighbors[region.id] = [];
for (const key of links) {
  const [a, b] = key.split("|");
  neighbors[a].push(b);
  neighbors[b].push(a);
}
for (const id of Object.keys(neighbors)) neighbors[id].sort();

function seaComponents() {
  const ids = seas.map((s) => s.id);
  const seen = new Set();
  const comps = [];
  for (const start of ids) {
    if (seen.has(start)) continue;
    const comp = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const id = stack.pop();
      comp.push(id);
      for (const n of neighbors[id]) {
        if (!seen.has(n) && seas.some((s) => s.id === n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    comps.push(comp);
  }
  return comps;
}

const required = [
  ["France", "Germany"],
  ["Moscow", "Eastern Europe"],
  ["Manchuria", "China"],
  ["United Kingdom", "English Channel"],
  ["Japan", "Sea of Japan"],
  ["Eastern United States", "East US Coast"],
  ["Western United States", "West US Coast"],
  ["India", "Indian Ocean"],
  ["Australia", "East Indies Sea"],
  ["Scandinavia", "North Sea"],
  ["Karelia", "Scandinavia"],
  ["Alaska", "Canada"],
  ["Greenland", "North Atlantic"],
  ["Mexico", "Caribbean"],
  ["Balkans", "Mediterranean"],
];
for (const [a, b] of required) {
  if (!neighbors[a]?.includes(b)) problems.push(`missing link ${a} — ${b}`);
}
const comps = seaComponents();
if (comps.length !== 1) {
  problems.push(`sea zones split into ${comps.length} webs: ${comps.map((c) => c[0]).join(", ")}`);
}

const income = {};
for (const region of lands) income[region.owner] = (income[region.owner] ?? 0) + region.ipc;

const factions = [
  { id: "ussr", name: "Soviet Union", color: "#9A4E48", team: "allies", turn_order: 1, starting_ipc: income.USSR },
  { id: "ger", name: "Germany", color: "#857577", team: "axis", turn_order: 2, starting_ipc: income.GER },
  { id: "uk", name: "United Kingdom", color: "#9E7F55", team: "allies", turn_order: 3, starting_ipc: income.UK },
  { id: "jap", name: "Japan", color: "#B77958", team: "axis", turn_order: 4, starting_ipc: income.JAP },
  { id: "usa", name: "United States", color: "#72745C", team: "allies", turn_order: 5, starting_ipc: income.USA },
];

const startingUnits = [
  ["Moscow", "ussr", "infantry", 6], ["Moscow", "ussr", "artillery", 2], ["Moscow", "ussr", "tank", 1],
  ["Karelia", "ussr", "infantry", 4], ["Karelia", "ussr", "artillery", 1],
  ["Caucasus", "ussr", "infantry", 3], ["Caucasus", "ussr", "tank", 1],
  ["Siberia", "ussr", "infantry", 2],
  ["Germany", "ger", "infantry", 4], ["Germany", "ger", "tank", 2], ["Germany", "ger", "artillery", 1], ["Germany", "ger", "fighter", 1],
  ["France", "ger", "infantry", 3], ["France", "ger", "tank", 1], ["France", "ger", "fighter", 1],
  ["Eastern Europe", "ger", "infantry", 5], ["Eastern Europe", "ger", "tank", 2], ["Eastern Europe", "ger", "artillery", 1],
  ["Southern Europe", "ger", "infantry", 2], ["Southern Europe", "ger", "tank", 1],
  ["Scandinavia", "ger", "infantry", 2],
  ["North Africa", "ger", "infantry", 2], ["North Africa", "ger", "tank", 1],
  ["North Sea", "ger", "battleship", 1], ["North Sea", "ger", "submarine", 1], ["North Sea", "ger", "transport", 1],
  ["United Kingdom", "uk", "infantry", 3], ["United Kingdom", "uk", "fighter", 1], ["United Kingdom", "uk", "artillery", 1],
  ["English Channel", "uk", "battleship", 1], ["English Channel", "uk", "destroyer", 1], ["English Channel", "uk", "transport", 1],
  ["Mediterranean", "uk", "cruiser", 1], ["Mediterranean", "uk", "transport", 1],
  ["Egypt", "uk", "infantry", 2], ["Egypt", "uk", "artillery", 1],
  ["India", "uk", "infantry", 2], ["India", "uk", "fighter", 1],
  ["Australia", "uk", "infantry", 2],
  ["South Africa", "uk", "infantry", 1],
  ["Middle East", "uk", "infantry", 1],
  ["Canada", "uk", "infantry", 1],
  ["Japan", "jap", "infantry", 2], ["Japan", "jap", "fighter", 1],
  ["Sea of Japan", "jap", "carrier", 1], ["Sea of Japan", "jap", "battleship", 1], ["Sea of Japan", "jap", "destroyer", 1], ["Sea of Japan", "jap", "transport", 1],
  ["Manchuria", "jap", "infantry", 4], ["Manchuria", "jap", "artillery", 1], ["Manchuria", "jap", "tank", 1],
  ["Southeast Asia", "jap", "infantry", 2],
  ["East Indies", "jap", "infantry", 2],
  ["Eastern United States", "usa", "infantry", 2], ["Eastern United States", "usa", "fighter", 1],
  ["East US Coast", "usa", "battleship", 1], ["East US Coast", "usa", "destroyer", 1], ["East US Coast", "usa", "transport", 1],
  ["Western United States", "usa", "infantry", 2],
  ["West US Coast", "usa", "carrier", 1], ["West US Coast", "usa", "destroyer", 1], ["West US Coast", "usa", "transport", 1],
  ["China", "usa", "infantry", 3],
  ["Spain", "neutral", "infantry", 2],
  ["South America", "neutral", "infantry", 2],
].map(([region_id, faction_id, unit_type_id, count]) => ({ region_id, faction_id, unit_type_id, count }));

const doc = {
  version: 2,
  name: "DEMO - TEST RUN",
  coord_space: "svg",
  land_mask: "assets/ne_110m_land_adjsut.svg",
  projection: { type: "mercator", lon_0: 60, px_per_degree: round(K), origin: [OX, OY] },
  base_map: "",
  faction_colors: {
    USSR: [0.604, 0.306, 0.282, 0.55],
    UK: [0.62, 0.498, 0.333, 0.55],
    USA: [0.447, 0.455, 0.361, 0.55],
    GER: [0.522, 0.459, 0.467, 0.55],
    JAP: [0.718, 0.475, 0.345, 0.55],
    Neutral: [0.65, 0.612, 0.565, 0.4],
  },
  factions,
  turn_order: ["ussr", "ger", "uk", "jap", "usa"],
  neighbor_overrides: { add: manual.map((p) => [...p].sort()), remove: [] },
  starting_units: startingUnits,
  regions: regions.map((region) => ({
    anchors: [{ capacity: 8, type: "unit", x: region.anchor[0], y: region.anchor[1] }],
    metadata: {
      region_id: region.id,
      name: region.id,
      faction: region.owner,
      factory: region.factory,
      ipc: region.ipc,
      victory: region.capital,
      type: region.sea ? "sea" : "land",
      is_sea: region.sea,
    },
    polygon: region.polygon,
    neighbors: neighbors[region.id],
  })),
};

console.log(`regions ${regions.length} links ${links.size} income`, income);
console.log("sea webs", comps.map((c) => `${c.length}:${c.join(", ")}`).join("\n"));
if (problems.length) {
  console.log(problems.join("\n"));
  process.exit(1);
}

const text = JSON.stringify(doc, null, 2).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, "[$1, $2]") + "\n";
writeFileSync(resolve(root, "demomap01.json"), text);
console.log("wrote demomap01.json", text.length);
