/**
 * Pure scoring for reference plates.
 * Land and naval units must read as a side profile. Fighters and bombers must
 * read as a top-down T: a thin fuselage crossed by a thin wing.
 */

const GLOBAL_REJECT = [
  "flag of",
  "coat of arms",
  "signature",
  "logo",
  "insignia",
  "badge",
  "locator map",
  "location map",
  "street map",
  "geograph",
  "commons logo",
  "oojs",
  "symbol list",
  "symbol category",
  "north dakota",
  "highlighted",
  "box art",
  "boxart",
  "bundesarchiv",
  "operators",
  "hierarchy",
];

export function foldName(value) {
  return String(value)
    .replace(/^File:/i, "")
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[_\-+/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function squash(value) {
  return foldName(value).replace(/\s+/g, "");
}

/** Phrase match that does not let "Il-2" hit "Il-28" or "Yak-3" hit "Yak-30". */
function boundedIncludes(haystack, needle) {
  if (!needle) return false;
  const padded = ` ${haystack} `;
  let from = 0;
  while (from < padded.length) {
    const at = padded.indexOf(needle, from);
    if (at < 0) return false;
    const before = padded[at - 1];
    const after = padded[at + needle.length];
    if (!/[0-9a-z]/i.test(before) && !/[0-9]/.test(after ?? " ")) return true;
    from = at + 1;
  }
  return false;
}

function hasPhrase(name, phrase) {
  const needle = foldName(phrase);
  if (!needle) return false;
  return boundedIncludes(foldName(name), needle) || boundedIncludes(squash(name), squash(phrase));
}

const STOP_WORDS = new Set([
  "army",
  "aircraft",
  "betty",
  "class",
  "drawing",
  "from",
  "gun",
  "half",
  "inch",
  "line",
  "mark",
  "ship",
  "side",
  "soldier",
  "tank",
  "track",
  "type",
  "view",
  "with",
  "world",
  "zero",
]);

function mentionsSubject(name, target) {
  if ((target.phrases ?? []).some((phrase) => hasPhrase(name, phrase))) return true;
  const folded = foldName(name);
  for (const phrase of target.phrases ?? []) {
    for (const word of foldName(phrase).split(" ")) {
      if (word.length >= 4 && !STOP_WORDS.has(word) && boundedIncludes(folded, word)) return true;
    }
  }
  return false;
}

export function scoreTitle(title, target) {
  const name = foldName(title);
  if (!name) return null;
  if ((target.curatedTitles ?? []).some((curated) => foldName(curated) === name)) return 95;
  const banned = [...GLOBAL_REJECT, ...(target.rejectAny ?? [])];
  if (banned.some((phrase) => phrase && hasPhrase(name, phrase))) return null;
  if ((target.requireAny ?? []).length > 0 && !target.requireAny.some((phrase) => hasPhrase(name, phrase))) {
    return null;
  }
  const matched = (target.phrases ?? []).filter((phrase) => hasPhrase(name, phrase));
  if (!matched.length && !mentionsSubject(name, target)) return null;

  let score = 30 + matched.length * 8;
  for (const phrase of target.prefer ?? []) {
    if (hasPhrase(name, phrase)) score += 14;
  }
  if (/\.svg$/i.test(title) || name.endsWith("svg")) score += 18;
  else if (/\.png$/i.test(title)) score += 6;

  const topWord = /(planform|plan view|top view|top down|3 view|three view)/.test(name);
  const sideWord = /(side view|side profile|elevation|line drawing|profile|diagram|silhouette)/.test(name);
  if (target.camera === "top") {
    if (/(side view|side profile|side elevation)/.test(name) && !topWord) return null;
    if (topWord) score += 22;
  } else {
    if (/(front view|rear view|head on|planform|top view)/.test(name) && !sideWord) return null;
    if (sideWord) score += 16;
  }
  if (/(photo|bundesarchiv|museum|proving ground|flickr)/.test(name)) score -= 12;
  if (/cutaway|interior|cockpit|engine/.test(name)) score -= 18;
  return score;
}

export function toDark(data, width, height) {
  const dark = new Uint8Array(width * height);
  for (let pixel = 0, index = 0; pixel < dark.length; pixel += 1, index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    if (alpha < 24) continue;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const luminance = (red + green + blue) / 3;
    if (luminance < 206 || (saturation > 0.28 && luminance < 246)) dark[pixel] = 1;
  }
  return dark;
}

export function borderWhiteFraction(data, width, height) {
  let white = 0;
  let total = 0;
  const sample = (x, y) => {
    const index = (y * width + x) * 4;
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    total += 1;
    if (alpha < 20) {
      white += 1;
      return;
    }
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const luminance = (red + green + blue) / 3;
    if (luminance >= 226 && saturation <= 0.16) white += 1;
  };
  for (let x = 0; x < width; x += 1) {
    sample(x, 0);
    if (height > 1) sample(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    sample(0, y);
    if (width > 1) sample(width - 1, y);
  }
  return total ? white / total : 0;
}

/**
 * Mean count of distinct luminance levels along a sample row.
 * A line drawing stays in the tens. A photograph climbs past 60.
 */
export function toneVariety(data, width, height) {
  let levels = 0;
  let rows = 0;
  const stride = Math.max(1, Math.floor(height / 12));
  for (let y = Math.floor(height * 0.15); y < height * 0.85; y += stride) {
    const seen = new Uint8Array(256);
    let unique = 0;
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * 4;
      const luminance = (data[index] + data[index + 1] + data[index + 2]) / 3 | 0;
      if (!seen[luminance]) {
        seen[luminance] = 1;
        unique += 1;
      }
    }
    levels += unique;
    rows += 1;
  }
  return rows ? levels / rows : 255;
}

/** Share of pixels between paper white and solid ink. Photographs are mostly midtones. */
export function midtoneFraction(data, width, height) {
  let mid = 0;
  let samples = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * 4;
      const luminance = (data[index] + data[index + 1] + data[index + 2]) / 3;
      samples += 1;
      if (luminance > 90 && luminance < 235) mid += 1;
    }
  }
  return samples ? mid / samples : 1;
}

/** Fraction of coarse color buckets among samples. Photos are high, line art is low. */
export function colorVariety(data, width, height) {
  const buckets = new Set();
  const step = Math.max(1, Math.round(Math.sqrt((width * height) / 1800)));
  let samples = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * 4;
      const key = ((data[index] >> 4) << 8) | ((data[index + 1] >> 4) << 4) | (data[index + 2] >> 4);
      buckets.add(key);
      samples += 1;
    }
  }
  return samples ? buckets.size / samples : 1;
}

function dilate(dark, width, height, radius) {
  const grown = new Uint8Array(dark.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = 0;
      for (let dy = -radius; dy <= radius && !on; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (dark[ny * width + nx]) {
            on = 1;
            break;
          }
        }
      }
      grown[y * width + x] = on;
    }
  }
  return grown;
}

function labelComponents(dark, width, height) {
  const seen = new Uint8Array(dark.length);
  const components = [];
  const stack = [];
  for (let start = 0; start < dark.length; start += 1) {
    if (!dark[start] || seen[start]) continue;
    let count = 0;
    let x0 = width;
    let y0 = height;
    let x1 = 0;
    let y1 = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const pixel = stack.pop();
      count += 1;
      const x = pixel % width;
      const y = (pixel - x) / width;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (!dark[next] || seen[next]) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    if (count >= 30) components.push({ x0, y0, x1, y1, count });
  }
  return components;
}

export function measure(dark, width, component) {
  const boxWidth = component.x1 - component.x0 + 1;
  const boxHeight = component.y1 - component.y0 + 1;
  const rowMin = new Int32Array(boxHeight).fill(boxWidth);
  const rowMax = new Int32Array(boxHeight).fill(-1);
  const colMin = new Int32Array(boxWidth).fill(boxHeight);
  const colMax = new Int32Array(boxWidth).fill(-1);
  let ink = 0;
  for (let y = component.y0; y <= component.y1; y += 1) {
    for (let x = component.x0; x <= component.x1; x += 1) {
      if (!dark[y * width + x]) continue;
      ink += 1;
      const row = y - component.y0;
      const col = x - component.x0;
      if (col < rowMin[row]) rowMin[row] = col;
      if (col > rowMax[row]) rowMax[row] = col;
      if (row < colMin[col]) colMin[col] = row;
      if (row > colMax[col]) colMax[col] = row;
    }
  }
  let maxRow = 0;
  let maxCol = 0;
  for (let row = 0; row < boxHeight; row += 1) {
    if (rowMax[row] < 0) continue;
    maxRow = Math.max(maxRow, rowMax[row] - rowMin[row] + 1);
  }
  for (let col = 0; col < boxWidth; col += 1) {
    if (colMax[col] < 0) continue;
    maxCol = Math.max(maxCol, colMax[col] - colMin[col] + 1);
  }
  let longRows = 0;
  let tallCols = 0;
  for (let row = 0; row < boxHeight; row += 1) {
    if (rowMax[row] < 0) continue;
    if (rowMax[row] - rowMin[row] + 1 > maxRow * 0.65) longRows += 1;
  }
  for (let col = 0; col < boxWidth; col += 1) {
    if (colMax[col] < 0) continue;
    if (colMax[col] - colMin[col] + 1 > maxCol * 0.65) tallCols += 1;
  }
  return {
    bw: boxWidth,
    bh: boxHeight,
    ink,
    maxRow,
    maxCol,
    longRows,
    tallCols,
    fill: ink / (boxWidth * boxHeight),
  };
}

/** 1 when a thin fuselage is crossed by a thin wing. */
export function planformScore(metrics) {
  if (metrics.bw < 24 || metrics.bh < 16 || metrics.ink < 40) return 0;
  // A real planform's wingspan and length are close. Head-on and side views are long strips.
  const aspect = Math.max(metrics.bw, metrics.bh) / Math.min(metrics.bw, metrics.bh);
  if (aspect > 2.15) return 0;
  const longFrac = metrics.longRows / metrics.bh;
  const tallFrac = metrics.tallCols / metrics.bw;
  const rowReach = metrics.maxRow / metrics.bw;
  const colReach = metrics.maxCol / metrics.bh;
  if (rowReach < 0.62 || colReach < 0.55) return 0;
  // Filled wings are a band, not a hairline, so longFrac can reach the high 0.3s.
  // A side-on fuselage is thicker than that, or its columns fill the whole height.
  if (longFrac > 0.4 || tallFrac > 0.36 || tallFrac < 0.02) return 0;
  const balance = 1 - Math.abs(tallFrac - 0.12) / 0.36;
  return Math.max(0, Math.min(1, rowReach * colReach * (1 - longFrac) * Math.max(0.15, balance)));
}

/** 1 when the ink is a long hull, hull-and-turret, or gun trail rather than a cross. */
export function sideScore(metrics) {
  if (metrics.bw < 28 || metrics.bh < 8 || metrics.ink < 40) return 0;
  const ratio = metrics.bw / metrics.bh;
  if (ratio < 1.12) return 0;
  const longFrac = metrics.longRows / metrics.bh;
  const tallFrac = metrics.tallCols / metrics.bw;
  const rowReach = metrics.maxRow / metrics.bw;
  if (rowReach < 0.68 || longFrac < 0.1) return 0;
  if (tallFrac > 0.14 && metrics.maxCol / metrics.bh > 0.8 && longFrac < 0.18) return 0.05;
  return Math.min(1, longFrac * 1.35 * rowReach * Math.min(1, ratio / 2.2));
}

export function figureScore(metrics) {
  if (metrics.ink < 40) return 0;
  const ratio = metrics.bh / metrics.bw;
  if (ratio < 1.2 || ratio > 4.8) return 0;
  if (metrics.fill < 0.05 || metrics.fill > 0.8) return 0;
  return Math.min(1, 0.35 + (ratio - 1) * 0.28);
}

function capSpan(dark, width, component, edge) {
  const boxWidth = component.x1 - component.x0 + 1;
  const boxHeight = component.y1 - component.y0 + 1;
  const cutX = Math.max(2, Math.round(boxWidth * 0.16));
  const cutY = Math.max(2, Math.round(boxHeight * 0.16));
  let x0 = component.x0;
  let x1 = component.x1;
  let y0 = component.y0;
  let y1 = component.y1;
  if (edge === "left") x1 = component.x0 + cutX - 1;
  if (edge === "right") x0 = component.x1 - cutX + 1;
  if (edge === "top") y1 = component.y0 + cutY - 1;
  if (edge === "bottom") y0 = component.y1 - cutY + 1;
  let count = 0;
  let minA = Infinity;
  let maxA = -1;
  const vertical = edge === "left" || edge === "right";
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (!dark[y * width + x]) continue;
      count += 1;
      const axis = vertical ? y : x;
      if (axis < minA) minA = axis;
      if (axis > maxA) maxA = axis;
    }
  }
  return { count, span: maxA < 0 ? 0 : maxA - minA + 1 };
}

function facing(dark, width, component, kind) {
  const boxWidth = component.x1 - component.x0 + 1;
  const boxHeight = component.y1 - component.y0 + 1;
  if (kind === "top" && boxHeight > boxWidth * 1.05) {
    const top = capSpan(dark, width, component, "top");
    const bottom = capSpan(dark, width, component, "bottom");
    return { flipH: false, flipV: bottom.span > 0 && bottom.span < top.span * 0.8 };
  }
  const left = capSpan(dark, width, component, "left");
  const right = capSpan(dark, width, component, "right");
  const leftIsNose = left.span > 0 && left.span < right.span * 0.8 && left.count <= right.count * 1.08;
  return { flipH: leftIsNose, flipV: false };
}

/**
 * Pick the ink cluster that matches the camera, and say whether to mirror it
 * so a side profile faces right or a planform's nose points right or up.
 */
export function chooseCrop(dark, width, height, target) {
  const grown = dilate(dark, width, height, target.camera === "top" ? 1 : 2);
  const components = labelComponents(grown, width, height);
  if (!components.length) return { ok: false, reason: "no ink" };
  const scored = components
    .map((component) => {
      const metrics = measure(dark, width, component);
      return {
        component,
        metrics,
        plan: planformScore(metrics),
        side: sideScore(metrics),
        figure: figureScore(metrics),
      };
    })
    .filter((row) => row.metrics.ink >= 50);
  if (!scored.length) return { ok: false, reason: "ink is too faint" };
  const mostInk = Math.max(...scored.map((row) => row.metrics.ink));
  let usable = scored.filter((row) => row.metrics.ink >= mostInk * 0.22);
  if (target.camera === "side" && target.unitTypeId !== "infantry") {
    usable = usable.filter((row) => row.metrics.bh >= 18 && row.metrics.bw >= 36);
  }

  if (target.camera === "top") {
    usable.sort((a, b) => b.plan - a.plan || b.metrics.ink - a.metrics.ink);
    const best = usable[0];
    if (!best || best.plan < 0.34) return { ok: false, reason: "no top-down T silhouette" };
    return finishCrop(dark, width, best, "top");
  }

  if (target.unitTypeId === "infantry") {
    usable.sort((a, b) => b.figure - a.figure || b.metrics.ink - a.metrics.ink);
    const best = usable[0];
    if (!best || best.figure < 0.35) return { ok: false, reason: "no standing figure" };
    return finishCrop(dark, width, best, "figure");
  }

  usable.sort((a, b) => b.side - a.side || b.metrics.ink - a.metrics.ink);
  const best = usable[0];
  if (!best || best.side < 0.28) return { ok: false, reason: "no side profile" };
  if (best.plan > 0.5 && best.plan > best.side) return { ok: false, reason: "silhouette is top-down" };
  const ratio = best.metrics.bw / best.metrics.bh;
  const minimum = target.unitTypeId === "aaa" ? 0.72 : target.domain === "sea" ? 1.35 : 1.12;
  if (ratio < minimum) return { ok: false, reason: "proportions are not a side profile" };
  return finishCrop(dark, width, best, "side");
}

function finishCrop(dark, width, best, kind) {
  const flip = facing(dark, width, best.component, kind);
  return {
    ok: true,
    ...best.component,
    ...flip,
    kind,
    scores: { plan: best.plan, side: best.side, figure: best.figure },
  };
}

function paint(width, height, plot) {
  const dark = new Uint8Array(width * height);
  plot((x, y) => {
    if (x >= 0 && y >= 0 && x < width && y < height) dark[y * width + x] = 1;
  });
  return dark;
}

export function selfTest() {
  const errors = [];
  const expect = (condition, message) => {
    if (!condition) errors.push(message);
  };

  const cross = paint(120, 80, (dot) => {
    for (let x = 8; x <= 112; x += 1) {
      dot(x, 38);
      dot(x, 39);
      dot(x, 40);
    }
    for (let y = 8; y <= 72; y += 1) {
      for (let x = 46; x <= 55; x += 1) dot(x, y);
    }
  });
  const crossMetrics = measure(cross, 120, { x0: 8, y0: 8, x1: 112, y1: 72, count: 1 });
  expect(planformScore(crossMetrics) >= 0.34, "a wing-and-fuselage cross should score as a planform");
  const strip = paint(180, 36, (dot) => {
    for (let y = 10; y <= 26; y += 1) {
      for (let x = 4; x <= 174; x += 1) dot(x, y);
    }
  });
  const stripMetrics = measure(strip, 180, { x0: 4, y0: 10, x1: 174, y1: 26, count: 1 });
  expect(planformScore(stripMetrics) === 0, "a long side silhouette is not a planform");
  expect(sideScore(crossMetrics) < 0.28, "a wing-and-fuselage cross should not score as a hull");
  const crossCrop = chooseCrop(cross, 120, 80, { camera: "top", unitTypeId: "fighter", domain: "air" });
  expect(crossCrop.ok, "top camera accepts the cross");
  const crossRejected = chooseCrop(cross, 120, 80, { camera: "side", unitTypeId: "tank", domain: "land" });
  expect(!crossRejected.ok, "side camera rejects the cross");

  const hull = paint(150, 48, (dot) => {
    for (let y = 18; y <= 32; y += 1) {
      for (let x = 6; x <= 142; x += 1) dot(x, y);
    }
  });
  const hullCrop = chooseCrop(hull, 150, 48, { camera: "side", unitTypeId: "destroyer", domain: "sea" });
  expect(hullCrop.ok, "a long hull is a side profile");
  const hullTop = chooseCrop(hull, 150, 48, { camera: "top", unitTypeId: "bomber", domain: "air" });
  expect(!hullTop.ok, "a hull is not a top-down aircraft");

  const figure = paint(40, 96, (dot) => {
    for (let y = 4; y <= 16; y += 1) {
      for (let x = 15; x <= 25; x += 1) dot(x, y);
    }
    for (let y = 18; y <= 52; y += 1) {
      for (let x = 13; x <= 27; x += 1) dot(x, y);
    }
    for (let y = 54; y <= 90; y += 1) {
      for (let x = 14; x <= 18; x += 1) dot(x, y);
      for (let x = 22; x <= 26; x += 1) dot(x, y);
    }
    for (let x = 27; x <= 38; x += 1) {
      dot(x, 30);
      dot(x, 31);
    }
  });
  const figureCrop = chooseCrop(figure, 40, 96, { camera: "side", unitTypeId: "infantry", domain: "land" });
  expect(figureCrop.ok, "a standing rifleman is infantry");
  expect(figureCrop.flipH === false, "a rifle pointing right stays facing right");

  const tank = {
    camera: "side",
    phrases: ["panzer iv", "panzerkampfwagen iv"],
    prefer: ["ausf h"],
    requireAny: [],
    rejectAny: [],
  };
  expect(scoreTitle("File:Panzer IV G.svg", tank) > 40, "Panzer IV G is a tank plate");
  expect(scoreTitle("File:Flag of Germany.svg", tank) === null, "flags are rejected");
  const fighter = {
    camera: "top",
    phrases: ["spitfire", "supermarine spitfire"],
    prefer: [],
    requireAny: ["supermarine", "spitfire mk", "aircraft"],
    rejectAny: ["triumph", "automobile"],
  };
  expect(scoreTitle("File:Supermarine Spitfire Mk Vb 3-view.svg", fighter) > 0, "Spitfire 3-view is a fighter plate");
  expect(scoreTitle("File:Triumph Spitfire 4 MK2 colors.svg", fighter) === null, "the Triumph car is rejected");
  expect(scoreTitle("File:Bismarck North Dakota US street map.svg", {
    camera: "side",
    phrases: ["bismarck"],
    requireAny: ["battleship", "ship"],
    rejectAny: [],
  }) === null, "Bismarck, North Dakota is rejected");
  expect(scoreTitle("File:Yakovlev Yak-30.svg", {
    camera: "top",
    phrases: ["Yak-3"],
    requireAny: [],
    rejectAny: [],
  }) === null, "Yak-30 is not a Yak-3");
  expect(scoreTitle("File:Ilyushin Il-2m.svg", {
    camera: "top",
    phrases: ["Il-2"],
    requireAny: [],
    rejectAny: [],
  }) > 0, "Il-2m still counts as an Il-2");
  expect(scoreTitle("File:Bundesarchiv Bild Panzer IV.jpg", tank) === null, "Bundesarchiv photos are rejected");

  const gradient = new Uint8Array(80 * 20 * 4);
  for (let y = 0; y < 20; y += 1) {
    for (let x = 0; x < 80; x += 1) {
      const index = (y * 80 + x) * 4;
      gradient[index] = x * 3;
      gradient[index + 1] = x * 3;
      gradient[index + 2] = x * 3;
      gradient[index + 3] = 255;
    }
  }
  expect(toneVariety(gradient, 80, 20) > 30, "a gradient reads as a photograph");
  expect(midtoneFraction(gradient, 80, 20) > 0.16, "a gradient is mostly midtones");
  const line = new Uint8Array(80 * 20 * 4).fill(255);
  for (let x = 4; x < 76; x += 1) {
    const index = (10 * 80 + x) * 4;
    line[index] = 0;
    line[index + 1] = 0;
    line[index + 2] = 0;
  }
  expect(toneVariety(line, 80, 20) < 12, "a line on white stays flat");

  return errors;
}
