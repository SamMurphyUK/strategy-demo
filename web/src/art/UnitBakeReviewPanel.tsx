import { useEffect, useMemo, useRef, useState } from "react";
import { MILITARY } from "../ui/theme/militaryPalette";
import { SPRITE_BAKE } from "../ui/map/figureGround";
import { blitBlueprintToSheet80x56, rasterBlueprintAlbedo } from "./blockoutCompiler";
import {
  bakePrompt,
  factionHeroBlueprintId,
  freshSeeds,
  promotedPublicUrl,
  referencePlatesFor,
} from "./bakeReview";
import type { MilitaryStripKey, UnitSkeletonBlueprint } from "./skeletonSchema";
import { UnitPixelPainter, type PaintCommand } from "./UnitPixelPainter";
import { FACTION_MILITARY_MAPPINGS, STARTER_BLUEPRINTS, STARTER_PARTS } from "./starterParts";

interface BakedSeed {
  seed: number;
  silhouetteIoU: number;
  quantizedBase64: string;
}

const PARTS = new Map(Object.values(STARTER_PARTS).map((part) => [part.partId, part]));

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
    throw new Error("The blockout canvas is empty");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function UnitBakeReviewPanel() {
  const [blueprintId, setBlueprintId] = useState(STARTER_BLUEPRINTS[0]?.blueprintId ?? "");
  const [candidates, setCandidates] = useState<BakedSeed[]>([]);
  const [selectedSeed, setSelectedSeed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [paintCommand, setPaintCommand] = useState<PaintCommand | null>(null);
  const blockoutRef = useRef<HTMLCanvasElement>(null);
  const candidateRef = useRef<HTMLCanvasElement>(null);
  const sheetRef = useRef<HTMLCanvasElement>(null);
  const blueprint = useMemo(
    () => STARTER_BLUEPRINTS.find((item) => item.blueprintId === blueprintId) ?? STARTER_BLUEPRINTS[0],
    [blueprintId],
  );
  const selected = candidates.find((item) => item.seed === selectedSeed) ?? null;

  useEffect(() => {
    if (!blueprint) {
      return;
    }
    const blockout = blockoutRef.current;
    const sheet = sheetRef.current;
    if (!blockout || !sheet) {
      return;
    }
    try {
      const mapping = FACTION_MILITARY_MAPPINGS[blueprint.factionId];
      const raster = rasterBlueprintAlbedo(blueprint, PARTS, mapping);
      paintAlbedo(blockout, raster.albedoKeys, blueprint.canvasSize.width, blueprint.canvasSize.height);
      const baked = blitBlueprintToSheet80x56(blueprint, PARTS, mapping);
      const ctx = sheet.getContext("2d");
      if (!ctx) {
        return;
      }
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, SPRITE_BAKE.width, SPRITE_BAKE.height);
      ctx.drawImage(baked, 0, 0);
      setCandidates([]);
      setSelectedSeed(null);
      setNote("");
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  }, [blueprint]);

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
    if (!blueprint || !blockoutRef.current) {
      return;
    }
    setBusy(true);
    setNote("Baking 3 seeds…");
    try {
      const heroUrl = promotedPublicUrl(blueprint.factionId, factionHeroBlueprintId(blueprint.factionId));
      const hero = await fetch(heroUrl, { method: "HEAD" }).then((response) => response.ok).catch(() => false);
      const raster = rasterBlueprintAlbedo(blueprint, PARTS, FACTION_MILITARY_MAPPINGS[blueprint.factionId]);
      const blockoutBase64 = await canvasPngBase64(blockoutRef.current);
      const baked: BakedSeed[] = [];
      for (const seed of freshSeeds(3)) {
        const response = await fetch("/__dev/bake-unit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bakeBody(blueprint, seed, blockoutBase64, raster.albedoKeys, hero)),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || json.ok === false) {
          throw new Error(json.error || `Bake failed with ${response.status}`);
        }
        baked.push({
          seed: json.seed,
          silhouetteIoU: json.silhouetteIoU,
          quantizedBase64: json.quantizedBase64,
        });
      }
      setCandidates(baked);
      setSelectedSeed(baked[0]?.seed ?? null);
      setNote(`${baked.length} candidates saved.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const promote = async () => {
    if (!blueprint || !selected) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/__dev/promote-candidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factionId: blueprint.factionId,
          blueprintId: blueprint.blueprintId,
          seed: selected.seed,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.ok === false) {
        throw new Error(json.error || `Promote failed with ${response.status}`);
      }
      setNote(`Promoted ${blueprint.blueprintId} from seed ${selected.seed}.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!blueprint) {
    return null;
  }

  const width = blueprint.canvasSize.width;
  const height = blueprint.canvasSize.height;

  return (
    <section className="unit-bake-review" aria-label="Unit bake review">
      <style>{PANEL_CSS}</style>
      <header className="unit-bake-review-bar">
        <label>
          Blueprint
          <select value={blueprint.blueprintId} onChange={(event) => setBlueprintId(event.target.value)}>
            {STARTER_BLUEPRINTS.map((item) => (
              <option key={item.blueprintId} value={item.blueprintId}>
                {item.blueprintId}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={bakeThree} disabled={busy}>
          Bake 3 Seeds
        </button>
        <button type="button" onClick={promote} disabled={busy || selected === null}>
          Promote
        </button>
        <button
          type="button"
          onClick={() =>
            setPaintCommand({
              id: Date.now(),
              action: "edit",
              blueprintId: blueprint.blueprintId,
            })
          }
        >
          Edit parts
        </button>
        <button
          type="button"
          disabled={selected === null}
          onClick={() =>
            setPaintCommand({
              id: Date.now(),
              action: "candidate",
              blueprintId: blueprint.blueprintId,
              candidateBase64: selected?.quantizedBase64 ?? null,
            })
          }
        >
          Touch up candidate
        </button>
        <p>{note}</p>
      </header>
      {candidates.length > 1 && (
        <div className="unit-bake-review-seeds" role="group" aria-label="Seeds">
          {candidates.map((item) => (
            <button
              key={item.seed}
              type="button"
              aria-pressed={item.seed === selectedSeed}
              onClick={() => setSelectedSeed(item.seed)}
            >
              Seed {item.seed} · {item.silhouetteIoU.toFixed(3)}
            </button>
          ))}
        </div>
      )}
      <div className="unit-bake-review-row">
        <figure>
          <figcaption>Blockout</figcaption>
          <canvas ref={blockoutRef} width={width} height={height} style={pixelSize(width, height)} />
        </figure>
        <figure>
          <figcaption>
            Candidate
            {selected ? ` · silhouette IoU ${selected.silhouetteIoU.toFixed(3)}` : ""}
          </figcaption>
          <canvas ref={candidateRef} width={width} height={height} style={pixelSize(width, height)} />
        </figure>
        <figure>
          <figcaption>Sheet (40, 52)</figcaption>
          <canvas
            ref={sheetRef}
            width={SPRITE_BAKE.width}
            height={SPRITE_BAKE.height}
            style={pixelSize(SPRITE_BAKE.width, SPRITE_BAKE.height)}
          />
        </figure>
      </div>
      <UnitPixelPainter command={paintCommand} />
    </section>
  );
}

const PANEL_CSS = `
.unit-bake-review {
  position: fixed;
  z-index: 40;
  inset: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: #1c1917;
  color: #f5f0e6;
  overflow: auto;
}
.unit-bake-review-bar, .unit-bake-review-seeds, .unit-bake-review-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.unit-bake-review figure {
  margin: 0;
}
.unit-bake-review figcaption {
  margin-bottom: 6px;
}
.unit-bake-review canvas {
  background: #3a342c;
  image-rendering: pixelated;
}
.unit-bake-review button[aria-pressed="true"] {
  outline: 2px solid #ddcf99;
}
`;

function pixelSize(width: number, height: number): { width: number; height: number; imageRendering: "pixelated" } {
  return { width: width * 4, height: height * 4, imageRendering: "pixelated" };
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
    prompt: bakePrompt(blueprint, STARTER_PARTS),
    blockoutBase64,
    albedoKeys,
    referencePlatePaths: referencePlatesFor(blueprint, heroAvailable),
    seed,
    dryRunOnly: false,
  };
}
