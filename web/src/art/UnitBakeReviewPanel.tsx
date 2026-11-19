import { useEffect, useMemo, useRef, useState } from "react";
import { MILITARY } from "../ui/theme/militaryPalette";
import { rasterBlueprintAlbedo } from "./blockoutCompiler";
import {
  bakePrompt,
  factionHeroBlueprintId,
  freshSeeds,
  promotedPublicUrl,
  referencePlatesFor,
} from "./bakeReview";
import type { MilitaryStripKey, UnitSkeletonBlueprint } from "./skeletonSchema";
import { FrameEditor } from "./FrameEditor";
import { UnitPixelPainter, type PaintCommand } from "./UnitPixelPainter";
import { FIELD_PICK_KEY } from "./nativeBattleOverlay";
import { FACTION_MILITARY_MAPPINGS } from "./starterParts";
import type { UnitPaintDocument } from "./pixelPaint";
import { candidateShelf, groupShelf, shelfUnits, vectorShelf, type ShelfUnit } from "./unitShelf";
import { SpriteStampPanel } from "./SpriteStampPanel";

interface BakedSeed {
  seed: number;
  silhouetteIoU: number;
  quantizedBase64: string;
}

function paintAlbedo(canvas: HTMLCanvasElement, keys: readonly (MilitaryStripKey | null)[], width: number, height: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const offset = i * 4;
    if (key == null) {
      continue;
    }
    const rgb = Number.parseInt(MILITARY[key].slice(1), 16);
    image.data[offset] = (rgb >> 16) & 255;
    image.data[offset + 1] = (rgb >> 8) & 255;
    image.data[offset + 2] = rgb & 255;
    image.data[offset + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

async function canvasPngBase64(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    throw new Error("The drawing could not be sent");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

interface SavedCandidate {
  factionId: string;
  unitTypeId?: string;
  blueprintId: string;
  seed: number;
  quantized: string;
  width?: number;
  height?: number;
  promptStyle?: string;
  grade?: string;
  silhouetteIoU: number | null;
  promoted?: boolean;
}

export function UnitBakeReviewPanel() {
  const [doc, setDoc] = useState<UnitPaintDocument | null>(null);
  const [saved, setSaved] = useState<SavedCandidate[]>([]);
  /** Undefined until the vector manifest has answered. */
  const [vectorManifest, setVectorManifest] = useState<unknown>(undefined);
  /** Bumped after Bake now, to read the manifest again and skip cached pictures. */
  const [shelfTick, setShelfTick] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [galleryKey, setGalleryKey] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<BakedSeed[]>([]);
  const [selectedSeed, setSelectedSeed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [help, setHelp] = useState<string | null>(null);
  const [paintCommand, setPaintCommand] = useState<PaintCommand | null>(null);
  const [blockoutOpen, setBlockoutOpen] = useState(false);
  const candidateRef = useRef<HTMLCanvasElement>(null);
  const blueprintId = doc?.blueprint.blueprintId ?? "";
  const openedId = useRef(blueprintId);
  const selected = candidates.find((item) => item.seed === selectedSeed) ?? null;

  useEffect(() => {
    let cancel = false;
    fetch("/__dev/bake-candidates")
      .then((response) => response.json())
      .then((json) => {
        if (!cancel && Array.isArray(json.candidates)) {
          setSaved(json.candidates);
        }
      })
      .catch(() => undefined);
    fetch("/assets/units/vector/manifest.json", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (!cancel) {
          setVectorManifest(json ?? null);
        }
      })
      .catch(() => {
        if (!cancel) {
          setVectorManifest(null);
        }
      });
    return () => {
      cancel = true;
    };
  }, [shelfTick]);

  useEffect(() => {
    if (openedId.current === blueprintId) {
      return;
    }
    openedId.current = blueprintId;
    setCandidates([]);
    setSelectedSeed(null);
    setNote("");
  }, [blueprintId]);

  useEffect(() => {
    const canvas = candidateRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!selected) {
      return;
    }
    const image = new Image();
    image.onload = () => {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const next = canvas.getContext("2d");
      if (!next) {
        return;
      }
      next.imageSmoothingEnabled = false;
      next.drawImage(image, 0, 0);
    };
    image.src = `data:image/png;base64,${selected.quantizedBase64}`;
  }, [selected]);

  const bakeThree = async () => {
    if (!doc) {
      return;
    }
    setBusy(true);
    setNote("Asking for three pictures of the drawing on the canvas…");
    try {
      const blueprint = doc.blueprint;
      const mapping = FACTION_MILITARY_MAPPINGS[blueprint.factionId];
      const raster = rasterBlueprintAlbedo(blueprint, mapping);
      const blockout = document.createElement("canvas");
      blockout.width = blueprint.canvasSize.width;
      blockout.height = blueprint.canvasSize.height;
      paintAlbedo(blockout, raster.albedoKeys, blockout.width, blockout.height);
      const heroUrl = promotedPublicUrl(blueprint.factionId, factionHeroBlueprintId(blueprint.factionId));
      const hero = await fetch(heroUrl, { method: "HEAD" }).then((response) => response.ok).catch(() => false);
      const blockoutBase64 = await canvasPngBase64(blockout);
      const baked: BakedSeed[] = [];
      for (const seed of freshSeeds(3)) {
        const response = await fetch("/__dev/bake-unit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bakeBody(blueprint, seed, blockoutBase64, raster.albedoKeys, hero)),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || json.ok === false) {
          throw new Error(json.error || `The request failed (${response.status}).`);
        }
        baked.push({
          seed: json.seed,
          silhouetteIoU: json.silhouetteIoU,
          quantizedBase64: json.quantizedBase64,
        });
      }
      setCandidates(baked);
      setSelectedSeed(baked[0]?.seed ?? null);
      setNote("Three pictures came back. Pick one, then keep it or paint over it.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const promote = async () => {
    if (!doc || !selected) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/__dev/promote-candidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factionId: doc.blueprint.factionId,
          blueprintId: doc.blueprint.blueprintId,
          seed: selected.seed,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.ok === false) {
        throw new Error(json.error || `Keeping the picture failed (${response.status}).`);
      }
      setNote("Kept that picture in the project. Open kept picture can load it onto the canvas.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const hint = (text: string) => ({
    title: text,
    onMouseEnter: () => setHelp(text),
    onMouseLeave: () => setHelp(null),
    onFocus: () => setHelp(text),
    onBlur: () => setHelp(null),
  });

  const library = useMemo(() => [...vectorShelf(vectorManifest), ...candidateShelf(saved)], [vectorManifest, saved]);
  const shown = useMemo(() => shelfUnits(library, showAll), [library, showAll]);
  const grouped = useMemo(() => groupShelf(shown), [shown]);
  const polishedCount = useMemo(() => shelfUnits(library, false).length, [library]);
  const galleryPick = shown.find((item) => item.key === galleryKey) ?? null;
  const savedByPath = useMemo(() => new Map(saved.map((item) => [item.quantized, item])), [saved]);

  return (
    <section className="unit-bake-review" aria-label="Sprite editor">
      <style>{PANEL_CSS}</style>
      <div className="bake-field-bar">
        <button
          type="button"
          onClick={() => {
            if (galleryPick?.fieldPick) {
              sessionStorage.setItem(FIELD_PICK_KEY, galleryPick.fieldPick);
            } else {
              sessionStorage.removeItem(FIELD_PICK_KEY);
            }
            window.location.assign("/?bake=1&field=1");
          }}
          {...hint(
            galleryPick?.fieldPick
              ? `Open ${galleryPick.polished ? "the polished pixels of " : ""}the selected unit on a battle map at its real size. Add more units there. The map starts at one screen pixel per pixel.`
              : "Open a battle map at native size. The Japanese walk starts on it, and you can add any sprite beside it.",
          )}
        >
          On a battle map
        </button>
        <p>Native size on the map. Scale the view up once you are there.</p>
      </div>
      <details className="overnight-gallery" open>
        <summary>
          {showAll ? `All units (${shown.length})` : `Polished vectors (${shown.length})`}
        </summary>
        <label className="unit-shelf-all" {...hint("Off: only units traced from a polished PNG. On: every vector and every overnight picture. Nothing is moved or deleted either way.")}>
          <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
          Show all units
        </label>
        {shown.length === 0 && (
          <p className="sprite-generate-lead">
            {vectorManifest === undefined
              ? "Reading the vector manifest…"
              : showAll
                ? "No units yet."
                : "No polished vectors yet. Run npm run vectorize:units -- --polished."}
          </p>
        )}
        {!showAll && polishedCount > 0 && (
          <p className="sprite-generate-lead">
            {library.length - polishedCount} other pictures and vectors are hidden. They are still in their folders.
          </p>
        )}
        {grouped.map((group) => (
          <div key={group.factionId}>
            <h2>{group.factionId}</h2>
            <div className="unit-shelf-types">
              {group.types.map((type) => (
                <div key={type.unitTypeId} className="unit-shelf-type">
                  <h3>{type.label}</h3>
                  <div className="overnight-row">
                    {type.units.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        title={item.label}
                        aria-label={item.label}
                        aria-pressed={item.key === galleryKey}
                        onClick={() => setGalleryKey(item.key)}
                      >
                        <img className={item.vectorised ? "unit-shelf-vector" : undefined} src={item.preview} alt="" />
                        <small>{shelfCaption(item, savedByPath.get(item.picture ?? ""))}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {galleryPick && (
          <figure className="unit-shelf-pick">
            <figcaption>
              {galleryPick.label}
              {galleryPick.width ? ` · ${galleryPick.width}×${galleryPick.height}` : ""}
              {galleryPick.kind === "clips" ? " · idle frame" : ""}
            </figcaption>
            <img className={galleryPick.vectorised ? "unit-shelf-vector" : undefined} src={`${galleryPick.preview}${shelfTick ? `${galleryPick.preview.includes("?") ? "&" : "?"}v=${shelfTick}` : ""}`} alt="" {...galleryZoom(galleryPick)} />
            {galleryPick.vectorised && galleryPick.picture && (
              <>
                <figcaption>
                  {galleryPick.stamped ? "Stamped pixels" : galleryPick.polished ? "Polished pixels" : "Pixels"} it was traced from. On a battle map opens these.
                </figcaption>
                <img src={`/__dev/bake-file?path=${encodeURIComponent(galleryPick.picture)}${shelfTick ? `&v=${shelfTick}` : ""}`} alt="" {...galleryZoom(galleryPick)} />
              </>
            )}
            {galleryPick.kind === "vector" && galleryPick.stampSource && (
              <SpriteStampPanel
                key={galleryPick.stampSource}
                source={galleryPick.stampSource}
                factionId={galleryPick.factionId}
                onBaked={(svg) => {
                  if (svg) {
                    setGalleryKey(`vec:${svg}`);
                  }
                  setShelfTick((tick) => tick + 1);
                }}
              />
            )}
            {galleryPick.kind === "clips" && (
              <figcaption>On a battle map opens the polished walk, drawn from its PNG frames. The walk takes no stamp: a soldier wore no national emblem on his body.</figcaption>
            )}
          </figure>
        )}
      </details>
      <FrameEditor />
      <button
        type="button"
        className="sprite-blockout-toggle"
        aria-expanded={blockoutOpen}
        onClick={() => setBlockoutOpen((open) => !open)}
      >
        {blockoutOpen ? "Hide the 48 × 48 blockout editor" : "48 × 48 blockout editor"}
      </button>
      {blockoutOpen && (
        <>
          <UnitPixelPainter command={paintCommand} onDocument={setDoc} />
          <details className="sprite-generate">
            <summary
              {...hint(
                "Optional. Sends the drawing on the canvas to Retro Diffusion and brings back three recoloured attempts. The canvas stays as it is until you choose Paint over this picture.",
              )}
            >
              Generate pictures from this drawing
            </summary>
            <p className="sprite-generate-lead">
              This asks for three variations of the figure on the canvas. Pick one, keep it in the project, or paint over it by hand.
              The dev server needs an API token, and a request spends credits.
            </p>
            <div className="sprite-generate-actions">
              <button
                type="button"
                onClick={() => void bakeThree()}
                disabled={busy || doc === null}
                {...hint(
                  "Send the current 48 by 48 drawing and ask for three pictures. They show up here. Your canvas is left alone.",
                )}
              >
                {busy ? "Working…" : "Generate 3 pictures"}
              </button>
              <button
                type="button"
                onClick={() => void promote()}
                disabled={busy || selected === null}
                {...hint(
                  "Copy the selected picture into the project as the kept PNG for this unit. Later, Open kept picture can load it back onto the canvas.",
                )}
              >
                Keep this picture
              </button>
              <button
                type="button"
                disabled={selected === null}
                {...hint(
                  "Flatten the selected picture onto the 48 by 48 canvas so you can correct pixels with the pencil. Put the parts back returns to the separate pieces.",
                )}
                onClick={() => {
                  if (!doc || !selected) {
                    return;
                  }
                  setPaintCommand({
                    id: Date.now(),
                    action: "candidate",
                    blueprintId: doc.blueprint.blueprintId,
                    candidateBase64: selected.quantizedBase64,
                  });
                }}
              >
                Paint over this picture
              </button>
            </div>
            {candidates.length > 0 && (
              <div className="sprite-generate-seeds" role="group" aria-label="Generated pictures">
                {candidates.map((item, index) => (
                  <button
                    key={item.seed}
                    type="button"
                    aria-pressed={item.seed === selectedSeed}
                    {...hint(
                      `Picture ${index + 1}. Outline match ${item.silhouetteIoU.toFixed(2)}. 1.00 means the silhouette matches your drawing. Lower means the picture grew or shrank past it.`,
                    )}
                    onClick={() => setSelectedSeed(item.seed)}
                  >
                    Picture {index + 1}
                    <small>match {item.silhouetteIoU.toFixed(2)}</small>
                  </button>
                ))}
              </div>
            )}
            <figure>
              <figcaption>{selected ? "Selected picture" : "A generated picture shows here"}</figcaption>
              <canvas ref={candidateRef} width={48} height={48} />
            </figure>
            <p className="sprite-generate-help">{help ?? note}</p>
          </details>
        </>
      )}
      <div className="sprite-editor-end" aria-hidden="true" />
    </section>
  );
}

const PANEL_CSS = `
.unit-bake-review {
  position: fixed;
  z-index: 40;
  top: 12px;
  right: 12px;
  bottom: 96px;
  left: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 16px 0;
  background: #1c1917;
  color: #f5f0e6;
  overflow: auto;
  box-shadow: 0 0 0 1px #4b3d44;
}
.sprite-editor-end {
  flex: none;
  height: 220px;
}
.bake-field-bar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding: 4px 0 8px;
  background: #1c1917;
}
.bake-field-bar button {
  font: 600 13px/1.3 "Segoe UI", sans-serif;
  letter-spacing: 0;
  text-transform: none;
  padding: 6px 10px;
  background: #ddcf99;
  color: #1c1917;
  border: 1px solid #ddcf99;
}
.bake-field-bar p {
  margin: 0;
  color: #a99c8d;
  font: 13px/1.3 "Segoe UI", sans-serif;
}
.overnight-gallery { flex: none; }
.overnight-gallery h2 { margin: 12px 0 6px; font: 600 14px/1.2 "Segoe UI", sans-serif; }
.overnight-gallery summary { cursor: pointer; font: 600 15px/1.4 "Segoe UI", sans-serif; }
.overnight-row { display: flex; flex-wrap: wrap; gap: 8px; }
.overnight-row button { width: 96px; padding: 4px; background: #2a2420; color: #f5f0e6; border: 1px solid #4b3d44; }
.overnight-row button[aria-pressed="true"] { border-color: #ddcf99; }
.overnight-row img, .overnight-gallery figure img { image-rendering: pixelated; background: #c8c2b6; }
.overnight-row img { display: block; width: 86px; height: 48px; object-fit: contain; }
.overnight-gallery figure img { max-width: 100%; height: auto; }
.overnight-row small { display: block; color: #ddcf99; font-size: 10px; }
.overnight-row img.unit-shelf-vector, .overnight-gallery figure img.unit-shelf-vector { image-rendering: auto; }
.unit-shelf-all { display: flex; gap: 6px; align-items: center; margin: 8px 0 0; font: 13px/1.3 "Segoe UI", sans-serif; color: #f5f0e6; cursor: pointer; }
.unit-shelf-types { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: flex-start; }
.unit-shelf-type h3 { margin: 8px 0 4px; color: #a99c8d; font: 600 12px/1.2 "Segoe UI", sans-serif; }
.unit-shelf-pick { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.unit-shelf-pick figcaption { color: #a99c8d; font: 13px/1.3 "Segoe UI", sans-serif; }
.sprite-blockout-toggle {
  flex: none;
  align-self: flex-start;
  font: 600 13px/1.3 "Segoe UI", sans-serif;
  letter-spacing: 0;
  text-transform: none;
  padding: 6px 10px;
  background: #2a2420;
  color: #f5f0e6;
  border: 1px solid #4b3d44;
}
.sprite-generate {
  flex: none;
  overflow: visible;
  border-top: 1px solid #4b3d44;
  padding-top: 8px;
}
.sprite-generate summary {
  cursor: pointer;
  font: 600 15px/1.4 "Segoe UI", sans-serif;
  letter-spacing: 0;
}
.sprite-generate-lead, .sprite-generate-help, .sprite-generate figcaption {
  margin: 8px 0;
  color: #a99c8d;
  font: 13px/1.4 "Segoe UI", sans-serif;
}
.sprite-generate-actions, .sprite-generate-seeds {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.sprite-generate button {
  font: 13px/1.3 "Segoe UI", sans-serif;
  letter-spacing: 0;
  text-transform: none;
  padding: 6px 10px;
  background: #2a2420;
  color: #f5f0e6;
  border: 1px solid #4b3d44;
}
.sprite-generate button:hover:not(:disabled) {
  border-color: #ddcf99;
}
.sprite-generate button[aria-pressed="true"] {
  border-color: #ddcf99;
  background: #4b3d44;
}
.sprite-generate button small {
  display: block;
  color: #ddcf99;
  font-size: 11px;
}
.sprite-generate canvas {
  width: 192px;
  height: 192px;
  image-rendering: pixelated;
  background: #c8c2b6;
  box-shadow: inset 0 0 0 1px #1c1917;
}
.sprite-generate figure {
  margin: 8px 0 0;
}
.sprite-generate-help {
  min-height: 2.8em;
  padding: 8px 10px;
  background: #2a2420;
  color: #f5f0e6;
}
`;

/** The card line under a unit. An overnight picture keeps its match score, size and style. */
function shelfCaption(item: ShelfUnit, row: SavedCandidate | undefined): string {
  const seed = typeof item.seed === "number" ? ` ${item.seed}` : "";
  const kind = item.kind === "clips" ? "walk, " : "";
  if (item.vectorised) {
    return `${kind}${item.stamped ? "stamped vector" : item.polished ? "polished vector" : "vector"}${seed}${item.width ? ` · ${item.width}×${item.height}` : ""}`;
  }
  const parts = [`picture${seed}`];
  if (row?.silhouetteIoU != null) {
    parts.push(row.silhouetteIoU.toFixed(2));
  }
  if (item.width) {
    parts.push(`${item.width}×${item.height}`);
  }
  if (row?.promptStyle && row.promptStyle !== "rd_fast__default") {
    parts.push(row.promptStyle);
  }
  if (row?.grade === "outlined") {
    parts.push("outlines");
  }
  return parts.join(" · ");
}

/** Older pictures are 48 square and carry no size. */
function galleryZoom(item: { width?: number; height?: number }): { width: number; height: number } {
  const width = item.width ?? 48;
  const height = item.height ?? 48;
  const zoom = Math.max(1, Math.min(4, Math.floor(1024 / width)));
  return { width: width * zoom, height: height * zoom };
}

function bakeBody(
  blueprint: UnitSkeletonBlueprint,
  seed: number,
  blockoutBase64: string,
  albedoKeys: readonly (MilitaryStripKey | null)[],
  heroAvailable: boolean,
) {
  return {
    factionId: blueprint.factionId,
    blueprintId: blueprint.blueprintId,
    width: blueprint.canvasSize.width,
    height: blueprint.canvasSize.height,
    prompt: bakePrompt(blueprint),
    blockoutBase64,
    albedoKeys,
    referencePlatePaths: referencePlatesFor(blueprint, heroAvailable),
    seed,
    dryRunOnly: false,
  };
}
