import { useEffect, useRef, useState } from "react";
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
import { FACTION_MILITARY_MAPPINGS } from "./starterParts";
import type { UnitPaintDocument } from "./pixelPaint";

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

export function UnitBakeReviewPanel() {
  const [doc, setDoc] = useState<UnitPaintDocument | null>(null);
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

  return (
    <section className="unit-bake-review" aria-label="Sprite editor">
      <style>{PANEL_CSS}</style>
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
