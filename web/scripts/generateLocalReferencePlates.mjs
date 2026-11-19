/**
 * Offline orthographic reference plate generator for Axis & Allies 1940.
 *
 *   npm run gen:plates
 *
 * Writes 70 crisp 256×256 PNGs (14 combat units × 5 major powers) to
 * web/reference_plates/<factionId>/<unitTypeId>.png and builds the
 * 14 × 5 visual contact sheet + Retro Diffusion prompt guide at
 * web/reference_plates/index.html.
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { renderPlateSvg } from "./referencePlateSvg.mjs";
import { FACTION_IDS, REFERENCE_MATRIX, UNIT_TYPES } from "./referenceQueries.mjs";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_ROOT = path.join(WEB_ROOT, "reference_plates");
const PLATE_SIZE = 256;

const FACTION_LABEL = {
  GER: "Germany (Wehrmacht / Kriegsmarine / Luftwaffe)",
  USSR: "Soviet Union (Red Army / VVS / VMF)",
  UK: "United Kingdom (British Army / RAF / Royal Navy)",
  US: "United States (US Army / USAAF / US Navy)",
  JAP: "Imperial Japan (IJA / IJN)",
};

const FACTION_PALETTE_HINT = {
  GER: "feldgrau grey-green",
  USSR: "Soviet olive drab",
  UK: "British khaki and slate grey",
  US: "American olive drab and navy grey",
  JAP: "Imperial khaki and IJN slate",
};

export function retroDiffusionPrompt(factionId, unitTypeId) {
  const entry = REFERENCE_MATRIX[factionId]?.[unitTypeId];
  if (!entry) throw new Error(`Missing target ${factionId}:${unitTypeId}`);
  const color = FACTION_PALETTE_HINT[factionId];
  if (entry.domain === "air") {
    return `WWII ${entry.className}, top-down orthographic planform, nose pointing right, crisp pixel art sprite, ${color}, isolated on pure white #FFFFFF background, no shadows, no text.`;
  }
  return `WWII ${entry.className}, strict side profile facing right, crisp pixel art sprite, ${color}, isolated on pure white #FFFFFF background, no ground, no shadows, no text.`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function renderContactSheetHtml(entries) {
  const byKey = new Map(entries.map((entry) => [`${entry.factionId}:${entry.unitTypeId}`, entry]));
  const rows = UNIT_TYPES.map((unit) => {
    const cells = FACTION_IDS.map((factionId) => {
      const entry = byKey.get(`${factionId}:${unit.unitTypeId}`);
      const imgSrc = `${factionId}/${unit.unitTypeId}.png`;
      const downloadName = `${factionId}_${unit.unitTypeId}.png`;
      return `<td data-faction="${escapeHtml(factionId)}">
        <div class="card">
          <a class="thumb-link" href="${escapeHtml(imgSrc)}" data-full="${escapeHtml(imgSrc)}" data-dl="${escapeHtml(downloadName)}" data-title="${escapeHtml(`${factionId} · ${entry.className}`)}" title="Click to inspect 256×256">
            <img src="${escapeHtml(imgSrc)}" width="128" height="128" alt="${escapeHtml(entry.className)}"/>
          </a>
          <div class="name">${escapeHtml(entry.className)}</div>
          <div class="actions">
            <a class="btn btn-dl" href="${escapeHtml(imgSrc)}" download="${escapeHtml(downloadName)}">Download PNG</a>
            <button type="button" class="btn btn-copy" data-prompt="${escapeHtml(entry.prompt)}">Copy prompt</button>
          </div>
          <textarea readonly rows="3" onclick="this.select()">${escapeHtml(entry.prompt)}</textarea>
        </div>
      </td>`;
    }).join("\n");
    const camNote = unit.camera === "top"
      ? "Top-down T (nose right, centered)"
      : "Side profile (facing right, y=200)";
    return `<tr data-domain="${escapeHtml(unit.domain)}">
      <th><code>${escapeHtml(unit.unitTypeId)}</code><br/><span>${escapeHtml(unit.domain)} · ${escapeHtml(camNote)}</span></th>
      ${cells}
    </tr>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Axis &amp; Allies 1940 Local Reference Plates (70)</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 24px; font: 13px/1.4 system-ui, -apple-system, sans-serif; color: #1c1c1c; background: #f4f1ea; }
  h1 { margin: 0 0 6px; font-size: 20px; }
  p.lead { margin: 0 0 14px; max-width: 960px; color: #444; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
  .toolbar button { border: 1px solid #cfc8ba; background: #fff; color: #222; padding: 5px 10px; border-radius: 4px; cursor: pointer; font: inherit; font-size: 12px; }
  .toolbar button.active { background: #2b2b2b; color: #fff; border-color: #2b2b2b; }
  table { border-collapse: collapse; background: #fff; width: 100%; }
  th, td { border: 1px solid #d7d2c8; padding: 8px; vertical-align: top; }
  thead th { background: #2b2b2b; color: #fff; text-align: left; font-size: 12px; position: sticky; top: 0; z-index: 2; }
  tbody th { width: 165px; background: #faf8f4; text-align: left; }
  tbody th span { font-weight: 400; color: #666; font-size: 11px; }
  .card { display: flex; flex-direction: column; gap: 6px; width: 192px; }
  .thumb-link { display: inline-block; width: 128px; height: 128px; border: 1px solid #e6e2da; background: #fff; cursor: zoom-in; }
  .card img { display: block; width: 100%; height: 100%; }
  .name { font-weight: 600; font-size: 12px; }
  .actions { display: flex; gap: 6px; }
  .btn { display: inline-block; padding: 4px 8px; border-radius: 4px; border: 1px solid #cfc8ba; background: #faf8f4; color: #1c1c1c; text-decoration: none; font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; }
  .btn:hover { background: #ece7dc; }
  .btn-dl { background: #2b2b2b; color: #fff; border-color: #2b2b2b; }
  .btn-dl:hover { background: #444; }
  textarea { width: 100%; font: 11px/1.3 ui-monospace, SFMono-Regular, monospace; color: #2b2b2b; background: #faf9f6; border: 1px solid #ddd8ce; border-radius: 4px; padding: 4px 6px; resize: vertical; }
  dialog { border: 1px solid #cfc8ba; border-radius: 8px; padding: 16px; background: #fff; max-width: 340px; }
  dialog::backdrop { background: rgba(0,0,0,0.45); }
  .modal-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; font-weight: 600; }
  .modal-img { display: block; width: 256px; height: 256px; border: 1px solid #ddd8ce; background: #fff; margin: 0 auto 12px; }
  .modal-foot { display: flex; justify-content: space-between; align-items: center; }
</style>
</head>
<body>
<h1>Axis &amp; Allies 1940 Orthographic Reference Plates (${entries.length})</h1>
<p class="lead">256×256 PNGs on pure <code>#FFFFFF</code> with 14% margins. Land and naval plates face right on baseline <code>y = 200</code>; air plates are top-down T planforms centered at <code>(128, 128)</code> with nose pointing right. Click any thumbnail to inspect at 1:1 (256×256) or use <strong>Download PNG</strong> for the individual file.</p>
<div class="toolbar">
  <span>Domain:</span>
  <button type="button" class="active" data-filter-domain="all">All (14)</button>
  <button type="button" data-filter-domain="land">Land (5)</button>
  <button type="button" data-filter-domain="sea">Sea (6)</button>
  <button type="button" data-filter-domain="air">Air (3)</button>
</div>
<table>
  <thead>
    <tr>
      <th>Unit</th>
      ${FACTION_IDS.map((f) => `<th>${escapeHtml(f)}<br/><small>${escapeHtml(FACTION_LABEL[f])}</small></th>`).join("")}
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>
<dialog id="lightbox">
  <div class="modal-head">
    <span id="lb-title"></span>
    <button type="button" class="btn" id="lb-close">Close</button>
  </div>
  <img id="lb-img" class="modal-img" width="256" height="256" alt=""/>
  <div class="modal-foot">
    <code id="lb-path"></code>
    <a id="lb-dl" class="btn btn-dl" href="#" download>Download PNG</a>
  </div>
</dialog>
<script>
  const dlg = document.getElementById("lightbox");
  const lbImg = document.getElementById("lb-img");
  const lbTitle = document.getElementById("lb-title");
  const lbPath = document.getElementById("lb-path");
  const lbDl = document.getElementById("lb-dl");
  document.getElementById("lb-close").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  document.addEventListener("click", (e) => {
    const thumb = e.target.closest(".thumb-link");
    if (thumb) {
      e.preventDefault();
      lbImg.src = thumb.dataset.full;
      lbTitle.textContent = thumb.dataset.title;
      lbPath.textContent = thumb.dataset.full;
      lbDl.href = thumb.dataset.full;
      lbDl.download = thumb.dataset.dl;
      dlg.showModal();
      return;
    }
    const copyBtn = e.target.closest(".btn-copy");
    if (copyBtn) {
      navigator.clipboard?.writeText(copyBtn.dataset.prompt);
      const prev = copyBtn.textContent;
      copyBtn.textContent = "Copied";
      setTimeout(() => { copyBtn.textContent = prev; }, 900);
    }
  });
  document.querySelectorAll("[data-filter-domain]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-filter-domain]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const val = btn.dataset.filterDomain;
      document.querySelectorAll("tbody tr").forEach((tr) => {
        tr.style.display = val === "all" || tr.dataset.domain === val ? "" : "none";
      });
    });
  });
</script>
</body>
</html>`;
}

async function cleanStalePngs(factionDir) {
  let names = [];
  try {
    names = await readdir(factionDir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name.endsWith(".png"))
      .map((name) => rm(path.join(factionDir, name))),
  );
}

export async function generateAllLocalPlates() {
  const started = performance.now();
  await mkdir(OUT_ROOT, { recursive: true });
  await Promise.all(FACTION_IDS.map((factionId) => cleanStalePngs(path.join(OUT_ROOT, factionId))));
  await Promise.all(FACTION_IDS.map((factionId) => mkdir(path.join(OUT_ROOT, factionId), { recursive: true })));

  const jobs = [];
  const entries = [];
  for (const unit of UNIT_TYPES) {
    for (const factionId of FACTION_IDS) {
      const target = REFERENCE_MATRIX[factionId][unit.unitTypeId];
      const svg = renderPlateSvg(factionId, unit.unitTypeId);
      const outFile = path.join(OUT_ROOT, factionId, `${unit.unitTypeId}.png`);
      entries.push({
        factionId,
        unitTypeId: unit.unitTypeId,
        className: target.className,
        domain: unit.domain,
        camera: unit.camera,
        prompt: retroDiffusionPrompt(factionId, unit.unitTypeId),
      });
      jobs.push(
        sharp(Buffer.from(svg))
          .resize(PLATE_SIZE, PLATE_SIZE)
          .flatten({ background: "#ffffff" })
          .png({ compressionLevel: 9 })
          .toFile(outFile),
      );
    }
  }

  await Promise.all(jobs);
  await writeFile(path.join(OUT_ROOT, "index.html"), renderContactSheetHtml(entries), "utf8");
  const elapsedMs = Math.round(performance.now() - started);
  return { count: entries.length, elapsedMs, outRoot: OUT_ROOT };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  generateAllLocalPlates()
    .then(({ count, elapsedMs, outRoot }) => {
      console.log(`Generated ${count} local reference plates in ${elapsedMs}ms -> ${outRoot}`);
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
