/**
 * Fetch and normalize Axis & Allies 1940 reference plates from Wikimedia Commons.
 *
 *   npm run fetch:plates
 *   npm run fetch:plates -- --self-test
 *   npm run fetch:plates -- --only GER:tank
 *
 * Land and naval plates are side profiles facing right. Air plates are top-down
 * T silhouettes with the nose to the right, or upward when the drawing is taller
 * than it is wide. Every kept plate is a 256×256 white square with a 12% margin.
 *
 * Writes web/reference_plates/ and ~/Downloads/Reference Images/.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { borderWhiteFraction, chooseCrop, colorVariety, midtoneFraction, selfTest, scoreTitle, toDark, toneVariety } from "./referencePlateFilter.mjs";
import { CAMERA_RULES, FACTION_IDS, UNIT_TYPES, listTargets } from "./referenceQueries.mjs";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLATE_SIZE = 256;
const MARGIN = 0.12;
const INNER = Math.round(PLATE_SIZE * (1 - MARGIN * 2));
const UA = "AxisAlliesReferencePlates/1.0 (educational local script; Axis and Allies unit reference plates)";
const API = "https://commons.wikimedia.org/w/api.php";

const OUTPUTS = [
  path.join(WEB_ROOT, "reference_plates"),
  path.join(os.homedir(), "Downloads", "Reference Images"),
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createLimiter(delayMs) {
  let next = 0;
  return async function limit() {
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + delayMs;
    if (wait) await sleep(wait);
  };
}

function cachePath(root, kind, key) {
  const digest = createHash("sha1").update(key).digest("hex").slice(0, 20);
  return path.join(root, ".cache", kind, `${digest}.json`);
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function cachedApi(root, key, url, limiter, refresh) {
  const file = cachePath(root, "api", key);
  if (!refresh) {
    const cached = await readJson(file);
    if (cached) return cached;
  }
  const json = await apiGet(url, limiter);
  if (!json.error) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(json));
  }
  return json;
}

async function apiGet(url, limiter, attempt = 0) {
  await limiter();
  const response = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
  const text = await response.text();
  const busy = response.status === 429 || response.status === 503 || text.startsWith("You are making") || /too busy|ratelimit/i.test(text.slice(0, 240));
  if (busy) {
    if (attempt >= 5) throw new Error("Wikimedia rate limit did not clear");
    const retry = Number(response.headers.get("retry-after")) || 15 * (attempt + 1);
    console.log(`rate limited, waiting ${retry}s`);
    await sleep(retry * 1000);
    return apiGet(url, limiter, attempt + 1);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    if (attempt >= 4) throw new Error(`Commons returned non-JSON (${response.status})`);
    await sleep(8000);
    return apiGet(url, limiter, attempt + 1);
  }
  const info = `${json.error?.code ?? ""} ${json.error?.info ?? ""}`;
  if (json.error && /busy|ratelimit|maxlag/i.test(info)) {
    if (attempt >= 5) throw new Error(info);
    const retry = 15 * (attempt + 1);
    console.log(`search busy, waiting ${retry}s`);
    await sleep(retry * 1000);
    return apiGet(url, limiter, attempt + 1);
  }
  return json;
}

function commonsUrl(params) {
  const url = new URL(API);
  url.searchParams.set("format", "json");
  url.searchParams.set("maxlag", "5");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

function infoFromPage(page) {
  const info = page?.imageinfo?.[0];
  if (!info?.mime || !String(info.mime).startsWith("image/")) return null;
  const thumbUrl = info.thumburl || (info.mime === "image/svg+xml" ? null : info.url);
  if (!thumbUrl) return null;
  return {
    title: page.title,
    mime: info.mime,
    width: info.thumbwidth || info.width || 0,
    height: info.thumbheight || info.height || 0,
    thumbUrl,
    pageUrl: `https://commons.wikimedia.org/wiki/${encodeURI(page.title.replace(/ /g, "_"))}`,
  };
}

async function imageInfo(root, titles, limiter, refresh) {
  const found = new Map();
  for (let offset = 0; offset < titles.length; offset += 40) {
    const batch = titles.slice(offset, offset + 40);
    const url = commonsUrl({
      action: "query",
      titles: batch.join("|"),
      redirects: "1",
      prop: "imageinfo",
      iiprop: "url|mime|size",
      iiurlwidth: "960",
    });
    const json = await cachedApi(root, `info:${batch.join("|")}`, url, limiter, refresh);
    for (const page of Object.values(json.query?.pages ?? {})) {
      if (page.missing !== undefined) continue;
      const info = infoFromPage(page);
      if (info) found.set(page.title, info);
    }
  }
  return found;
}

async function searchCommons(root, query, limiter, refresh) {
  const url = commonsUrl({
    action: "query",
    generator: "search",
    gsrnamespace: "6",
    gsrlimit: "16",
    gsrsearch: query,
    prop: "imageinfo",
    iiprop: "url|mime|size",
    iiurlwidth: "960",
  });
  const json = await cachedApi(root, `search:${query}`, url, limiter, refresh);
  if (json.error) {
    console.log(`search failed: ${json.error.info ?? json.error.code}`);
    return [];
  }
  return Object.values(json.query?.pages ?? {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map(infoFromPage)
    .filter(Boolean);
}

const CATEGORY_PAGES = {
  "Category:Line drawings of tanks": 5,
  "Category:Side views of tanks": 4,
  "Category:Orthographic elevations of vehicles": 4,
  "Category:Line drawings of naval ships": 6,
  "Category:Line drawings of ships": 4,
  "Category:Side views of ships": 2,
  "Category:Orthographic plan views of aircraft": 2,
  "Category:Orthographic plans of aircraft": 2,
};

async function categoryMembers(root, title, pages, limiter, refresh) {
  const files = [];
  const subcats = [];
  let cont = null;
  for (let page = 0; page < pages; page += 1) {
    const params = {
      action: "query",
      list: "categorymembers",
      cmtitle: title,
      cmtype: "file|subcat",
      cmlimit: "50",
    };
    if (cont) params.cmcontinue = cont;
    const url = commonsUrl(params);
    const json = await cachedApi(root, `cat:${title}:${cont ?? "start"}`, url, limiter, refresh);
    if (json.error) return { files, subcats, missing: true };
    for (const member of json.query?.categorymembers ?? []) {
      if (member.title.startsWith("Category:")) subcats.push(member.title);
      else if (member.title.startsWith("File:")) files.push(member.title);
    }
    cont = json.continue?.cmcontinue;
    if (!cont) break;
  }
  return { files, subcats, missing: false };
}

function categoryMatches(title, targets) {
  const folded = title.toLowerCase();
  return targets.some((target) => target.phrases.some((phrase) => folded.includes(phrase.toLowerCase().slice(0, 18))));
}

async function gatherCategoryTitles(root, targets, limiter, refresh) {
  const titles = new Set();
  const categories = new Map();
  for (const target of targets) {
    for (const category of target.categories) categories.set(category, Math.max(categories.get(category) ?? 0, CATEGORY_PAGES[category] ?? 2));
  }
  for (const [category, pages] of categories) {
    const listed = await categoryMembers(root, category, pages, limiter, refresh);
    if (listed.missing) {
      console.log(`skip missing ${category}`);
      continue;
    }
    for (const file of listed.files) titles.add(file);
    if (listed.files.length < 8 && listed.subcats.length) {
      const wanted = listed.subcats.filter((sub) => categoryMatches(sub, targets)).slice(0, 12);
      for (const sub of wanted) {
        const nested = await categoryMembers(root, sub, 1, limiter, refresh);
        for (const file of nested.files) titles.add(file);
      }
    }
    console.log(`${category}: ${listed.files.length} files`);
  }
  return [...titles];
}

function soften(phrase) {
  return phrase
    .replace(/(\d)\.(\d)/g, "$1POINT$2")
    .replace(/\./g, "")
    .replace(/POINT/g, ".")
    .replace(/["']/g, "");
}

function queriesFor(target) {
  const phrase = soften(target.phrases[0]);
  const hint = target.searchHint ? ` ${target.searchHint}` : "";
  const rule = CAMERA_RULES[target.camera];
  const queries = [`${phrase}${hint} ${rule.fileQuery}`];
  if (target.camera === "top") queries.unshift(`${phrase} 3-view`);
  if (target.phrases[1]) queries.push(`${soften(target.phrases[1])}${hint}`);
  return queries;
}

function rankTitles(candidates, target) {
  const ranked = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidate.title.toLowerCase();
    if (seen.has(key)) continue;
    const score = scoreTitle(candidate.title, target);
    if (score === null) continue;
    seen.add(key);
    ranked.push({ ...candidate, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

async function downloadThumb(url, attempt = 0) {
  await sleep(250);
  const response = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(45000) });
  if ((response.status === 429 || response.status === 503) && attempt < 4) {
    await sleep(4000 * (attempt + 1));
    return downloadThumb(url, attempt + 1);
  }
  if (!response.ok) throw new Error(`download ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function normalizePlate(buffer, target) {
  const prepared = await sharp(buffer).rotate().flatten({ background: "#ffffff" }).png().toBuffer();
  const analysis = await sharp(prepared)
    .resize({ width: 420, height: 420, fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = analysis.info.width;
  const height = analysis.info.height;
  const data = analysis.data;
  const border = borderWhiteFraction(data, width, height);
  if (border < 0.7) return { ok: false, reason: "background is not white" };
  const variety = colorVariety(data, width, height);
  const tones = toneVariety(data, width, height);
  const midtones = midtoneFraction(data, width, height);
  if (variety > 0.48 || (tones > 54 && midtones > 0.16)) return { ok: false, reason: "looks like a photograph" };
  const dark = toDark(data, width, height);
  const crop = chooseCrop(dark, width, height, target);
  if (!crop.ok) return { ok: false, reason: crop.reason };

  const full = await sharp(prepared).metadata();
  const scaleX = full.width / width;
  const scaleY = full.height / height;
  let left = Math.floor(crop.x0 * scaleX) - 4;
  let top = Math.floor(crop.y0 * scaleY) - 4;
  let right = Math.ceil((crop.x1 + 1) * scaleX) + 4;
  let bottom = Math.ceil((crop.y1 + 1) * scaleY) + 4;
  left = Math.max(0, Math.min(left, full.width - 2));
  top = Math.max(0, Math.min(top, full.height - 2));
  right = Math.max(left + 1, Math.min(right, full.width));
  bottom = Math.max(top + 1, Math.min(bottom, full.height));

  let pipeline = sharp(prepared).extract({ left, top, width: right - left, height: bottom - top });
  if (crop.flipH) pipeline = pipeline.flop();
  if (crop.flipV) pipeline = pipeline.flip();
  const extracted = await pipeline.png().toBuffer();
  let trimmed = extracted;
  try {
    const next = await sharp(extracted).trim({ background: "#ffffff", threshold: 12 }).png().toBuffer();
    const trimmedMeta = await sharp(next).metadata();
    if ((trimmedMeta.width ?? 0) >= 8 && (trimmedMeta.height ?? 0) >= 8) trimmed = next;
  } catch {
    trimmed = extracted;
  }
  const fitted = await sharp(trimmed)
    .resize(INNER, INNER, { fit: "inside", background: "#ffffff" })
    .png()
    .toBuffer();
  const fittedMeta = await sharp(fitted).metadata();
  const padX = PLATE_SIZE - fittedMeta.width;
  const padY = PLATE_SIZE - fittedMeta.height;
  const png = await sharp(fitted)
    .extend({
      left: Math.floor(padX / 2),
      right: padX - Math.floor(padX / 2),
      top: Math.floor(padY / 2),
      bottom: padY - Math.floor(padY / 2),
      background: "#ffffff",
    })
    .png()
    .toBuffer();
  return { ok: true, png, flipH: crop.flipH, flipV: crop.flipV, kind: crop.kind };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function renderHtml(records) {
  const byKey = new Map(records.map((record) => [`${record.factionId}:${record.unitTypeId}`, record]));
  const rows = UNIT_TYPES.map((unit) => {
    const cells = FACTION_IDS.map((factionId) => {
      const record = byKey.get(`${factionId}:${unit.unitTypeId}`);
      const images = (record?.plates ?? []).map((plate) => {
        const src = `${record.factionId}/${plate.file}`;
        const flip = plate.flipH || plate.flipV ? " mirrored" : "";
        return `<figure><img src="${escapeHtml(src)}" width="128" height="128" alt="${escapeHtml(record.className)}"><figcaption>${escapeHtml(plate.title)}${flip}</figcaption></figure>`;
      }).join("");
      const empty = images ? "" : `<p class="missing">No clean plate</p>`;
      return `<td><strong>${escapeHtml(record?.className ?? "")}</strong>${images}${empty}</td>`;
    }).join("");
    const rule = CAMERA_RULES[unit.camera].label;
    return `<tr><th>${escapeHtml(unit.unitTypeId)}<br><span>${escapeHtml(unit.domain)} · ${escapeHtml(rule)}</span></th>${cells}</tr>`;
  }).join("");
  const ready = records.filter((record) => record.plates.length > 0).length;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Axis &amp; Allies 1940 reference plates</title>
<style>
  body { margin: 24px; font: 14px/1.4 Georgia, serif; color: #1c1c1c; background: #f4f1ea; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  p.note { max-width: 820px; }
  table { border-collapse: collapse; background: white; }
  th, td { border: 1px solid #d5d0c6; vertical-align: top; padding: 8px; }
  th { text-align: left; width: 140px; background: #faf8f4; }
  th span { font-weight: normal; color: #666; }
  figure { margin: 6px 0; }
  img { display: block; background: white; border: 1px solid #eee; image-rendering: auto; }
  figcaption { max-width: 180px; font: 11px/1.3 sans-serif; color: #444; word-break: break-word; }
  .missing { color: #8a3b2a; font: 12px sans-serif; }
</style>
</head>
<body>
<h1>Axis &amp; Allies 1940 reference plates</h1>
<p class="note">${ready} of ${records.length} faction units have at least one plate. Each file is 256×256 on white with a 12% margin. Land and naval units are side profiles facing right. Fighters, tactical bombers, and strategic bombers are top-down T silhouettes, nose right or nose up.</p>
<table>
<thead><tr><th>Unit</th>${FACTION_IDS.map((faction) => `<th>${faction}</th>`).join("")}</tr></thead>
<tbody>${rows}</tbody>
</table>
</body>
</html>`;
}

async function clearUnitFiles(factionId, unitTypeId) {
  for (const root of OUTPUTS) {
    const directory = path.join(root, factionId);
    let names = [];
    try {
      names = await readdir(directory);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.startsWith(`${unitTypeId}_`) && name.endsWith(".png")) {
        await rm(path.join(directory, name));
      }
    }
  }
}

async function writeOutputs(relative, contents) {
  for (const root of OUTPUTS) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
}

function parseArgs(argv) {
  const args = { only: null, delay: 3500, refresh: false, keep: 3, attempts: 8, selfTest: false, missing: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--self-test") args.selfTest = true;
    else if (arg === "--refresh") args.refresh = true;
    else if (arg === "--missing") args.missing = true;
    else if (arg === "--only") args.only = argv[++index];
    else if (arg === "--delay") args.delay = Number(argv[++index]);
    else if (arg === "--keep") args.keep = Number(argv[++index]);
    else if (arg === "--attempts") args.attempts = Number(argv[++index]);
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!Number.isFinite(args.delay) || args.delay < 0) throw new Error("--delay must be a number of milliseconds");
  return args;
}

function selectedTargets(only) {
  const targets = listTargets();
  if (!only) return targets;
  const [faction, unit] = only.split(":");
  return targets.filter((target) => {
    const factionOk = !faction || faction === "*" || target.factionId === faction;
    const unitOk = !unit || unit === "*" || target.unitTypeId === unit;
    return factionOk && unitOk;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    const errors = selfTest();
    if (errors.length) {
      for (const error of errors) console.error(error);
      process.exitCode = 1;
      return;
    }
    console.log("self-test passed");
    return;
  }

  let targets = selectedTargets(args.only);
  let prior = [];
  if (args.missing) {
    prior = JSON.parse(await readFile(path.join(OUTPUTS[0], "plates.json"), "utf8"));
    const have = new Set(prior.filter((record) => record.plates.length > 0).map((record) => `${record.factionId}:${record.unitTypeId}`));
    targets = targets.filter((target) => !have.has(`${target.factionId}:${target.unitTypeId}`));
  }
  if (!targets.length) throw new Error(args.missing ? "Every selected unit already has a plate" : `No targets matched ${args.only}`);
  const limiter = createLimiter(args.delay);
  const cacheRoot = OUTPUTS[0];
  await mkdir(path.join(cacheRoot, ".cache"), { recursive: true });

  console.log(`Gathering Commons categories for ${targets.length} targets`);
  const categoryTitles = await gatherCategoryTitles(cacheRoot, targets, limiter, args.refresh);
  const curated = [...new Set(targets.flatMap((target) => target.curatedTitles))];
  const info = await imageInfo(cacheRoot, [...new Set([...categoryTitles, ...curated])], limiter, args.refresh);
  const fromCategories = [...info.values()].map((item) => ({ ...item, source: "category" }));

  const records = [];
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const tried = new Set();
    const plates = [];
    const rejected = [];
    let cleared = false;

    const consider = async (ranked) => {
      let attempts = 0;
      for (const candidate of ranked) {
        if (plates.length >= args.keep || attempts >= args.attempts) break;
        const key = candidate.title.toLowerCase();
        if (tried.has(key)) continue;
        tried.add(key);
        attempts += 1;
        try {
          const buffer = await downloadThumb(candidate.thumbUrl);
          const plate = await normalizePlate(buffer, target);
          if (!plate.ok) {
            rejected.push({ title: candidate.title, reason: plate.reason });
            continue;
          }
          if (!cleared) {
            cleared = true;
            await clearUnitFiles(target.factionId, target.unitTypeId);
          }
          const file = `${target.unitTypeId}_${plates.length + 1}.png`;
          await writeOutputs(path.join(target.factionId, file), plate.png);
          plates.push({
            file,
            title: candidate.title,
            pageUrl: candidate.pageUrl,
            score: candidate.score,
            source: candidate.source,
            flipH: plate.flipH,
            flipV: plate.flipV,
            kind: plate.kind,
          });
        } catch (error) {
          rejected.push({ title: candidate.title, reason: error.message });
        }
      }
    };

    await consider(rankTitles(fromCategories, target));
    if (plates.length < args.keep) {
      let ranked = rankTitles(fromCategories, target);
      for (const query of queriesFor(target)) {
        if (plates.length >= args.keep) break;
        const found = await searchCommons(cacheRoot, query, limiter, args.refresh);
        ranked = rankTitles([...ranked, ...found.map((item) => ({ ...item, source: "search" }))], target);
        await consider(ranked);
      }
    }

    records.push({
      factionId: target.factionId,
      unitTypeId: target.unitTypeId,
      className: target.className,
      camera: target.camera,
      domain: target.domain,
      plates,
      rejected: rejected.slice(0, 8),
    });
    console.log(`[${index + 1}/${targets.length}] ${target.factionId} ${target.unitTypeId}: ${plates.length} plate(s)`);
  }

  let sheet = records;
  if (prior.length) {
    const fresh = new Map(records.map((record) => [`${record.factionId}:${record.unitTypeId}`, record]));
    sheet = prior.map((record) => fresh.get(`${record.factionId}:${record.unitTypeId}`) ?? record);
  }
  await writeOutputs("plates.json", JSON.stringify(sheet, null, 2));
  await writeOutputs("index.html", renderHtml(sheet));
  records.splice(0, records.length, ...sheet);
  const ready = records.filter((record) => record.plates.length > 0).length;
  console.log(`${ready}/${records.length} units have a plate`);
  for (const root of OUTPUTS) console.log(root);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
