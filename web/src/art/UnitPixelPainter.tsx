import { useEffect, useRef, useState, type PointerEvent } from "react";
import { MILITARY } from "../ui/theme/militaryPalette";
import { SPRITE_BAKE } from "../ui/map/figureGround";
import { FACTION_MILITARY_MAPPINGS, STARTER_BLUEPRINTS, STARTER_PARTS } from "./starterParts";
import { blitBlueprintToSheet80x56, rasterBlueprintAlbedo } from "./blockoutCompiler";
import {
  PALETTE_SLOT_KEYS,
  ROSTER_FACTIONS,
  SLOT_LABEL,
  blankDocument,
  documentFromBlueprint,
  flattenBlockout,
  flattenRgba,
  fromPaintFile,
  paintAt,
  placeGroundOrigin,
  placeMuzzle,
  slotHex,
  toPaintFile,
  withEditingNode,
  withFaction,
  type Brush,
  type UnitPaintDocument,
} from "./pixelPaint";
import type { MilitaryStripKey, RosterFactionId } from "./skeletonSchema";

const GRID = 48;
const GRID_SCALE = 8;

export interface PaintCommand {
  id: number;
  action: "edit" | "candidate";
  blueprintId: string;
  candidateBase64?: string | null;
}

export function UnitPixelPainter({ command }: { command: PaintCommand | null }) {
  const [doc, setDoc] = useState<UnitPaintDocument>(() => documentFromBlueprint(STARTER_BLUEPRINTS[0], STARTER_PARTS));
  const [backup, setBackup] = useState<UnitPaintDocument | null>(null);
  const [brush, setBrush] = useState<Brush>("primary_uniform_or_hull");
  const [tool, setTool] = useState<"brush" | "ground" | "muzzle">("brush");
  const [note, setNote] = useState("");
  const [sheetNote, setSheetNote] = useState("");
  const gridRef = useRef<HTMLCanvasElement>(null);
  const pinRef = useRef<HTMLCanvasElement>(null);
  const sheetRef = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);

  useEffect(() => {
    if (!command || command.id === 0) {
      return;
    }
    const blueprint = STARTER_BLUEPRINTS.find((item) => item.blueprintId === command.blueprintId);
    if (!blueprint) {
      return;
    }
    const next = documentFromBlueprint(blueprint, STARTER_PARTS);
    if (command.action === "candidate" && command.candidateBase64) {
      const base64 = command.candidateBase64;
      void flattenCandidate(base64, next)
        .then((flat) => {
          setBackup(next);
          setDoc(flat);
          setNote("Flattened the candidate onto the grid. Part articulation is in Restore parts.");
        })
        .catch((error: unknown) => {
          setNote(error instanceof Error ? error.message : String(error));
        });
      return;
    }
    setBackup(null);
    setDoc(next);
    setNote(`Editing ${blueprint.blueprintId}.`);
  }, [command]);

  useEffect(() => {
    drawGrid(gridRef.current, pinRef.current, doc);
    drawSheet(sheetRef.current, doc, setSheetNote);
  }, [doc]);

  const mapping = FACTION_MILITARY_MAPPINGS[doc.blueprint.factionId];

  const applyPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = gridRef.current;
    if (!canvas) {
      return;
    }
    const point = pixelOf(canvas, event.clientX, event.clientY);
    if (!point) {
      return;
    }
    if (tool === "ground") {
      setDoc((current) => placeGroundOrigin(current, point.x, point.y));
      return;
    }
    if (tool === "muzzle") {
      setDoc((current) => placeMuzzle(current, point.x, point.y));
      return;
    }
    setDoc((current) => paintAt(current, point.x, point.y, brush));
  };

  const flatten = () => {
    setBackup(doc.flat ? backup : doc);
    setDoc(flattenBlockout(doc));
    setNote("Flattened the blockout. Part articulation is in Restore parts.");
  };

  const restore = () => {
    if (!backup) {
      return;
    }
    setDoc(backup);
    setBackup(null);
    setNote("Restored the part grids.");
  };

  const save = async () => {
    try {
      const response = await fetch("/__dev/save-unit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPaintFile(doc)),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.ok === false) {
        throw new Error(json.error || `Save failed with ${response.status}`);
      }
      setNote(`Saved ${json.path}.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(toPaintFile(doc), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${doc.blueprint.blueprintId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      setBackup(null);
      setDoc(fromPaintFile(parsed));
      setNote(`Imported ${file.name}.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  };

  const loadPromoted = async () => {
    const url = `/assets/units/promoted/${doc.blueprint.factionId}/${doc.blueprint.blueprintId}.png`;
    try {
      const image = await rgbaFromUrl(url);
      setBackup(doc.flat ? backup : doc);
      setDoc(flattenRgba(doc, image.data, image.width, image.height, mapping));
      setNote("Flattened the promoted candidate.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="unit-pixel-painter" aria-label="Unit pixel painter">
      <style>{PAINTER_CSS}</style>
      <div className="unit-pixel-tools">
        <label>
          Faction
          <select
            value={doc.blueprint.factionId}
            onChange={(event) => setDoc(withFaction(doc, event.target.value as RosterFactionId))}
          >
            {ROSTER_FACTIONS.map((faction) => (
              <option key={faction} value={faction}>
                {faction}
              </option>
            ))}
          </select>
        </label>
        <label>
          Part
          <select value={doc.editingNodeId} onChange={(event) => setDoc(withEditingNode(doc, event.target.value))}>
            {doc.blueprint.nodes.map((node) => (
              <option key={node.nodeId} value={node.nodeId}>
                {doc.parts[node.partId]?.label ?? node.nodeId}
                {node.articulation ? ` · ${node.articulation.role}` : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setDoc(blankDocument(doc.blueprint.factionId))}>
          New 48×48
        </button>
        <button type="button" onClick={flatten}>
          Flatten blockout
        </button>
        <button type="button" onClick={loadPromoted}>
          Flatten promoted
        </button>
        <button type="button" onClick={restore} disabled={backup === null}>
          Restore parts
        </button>
      </div>
      <div className="unit-pixel-swatches" role="group" aria-label="Semantic brush palette">
        {PALETTE_SLOT_KEYS.map((slot) => (
          <button
            key={slot}
            type="button"
            aria-pressed={tool === "brush" && brush === slot}
            style={{ background: slotHex(mapping, slot), color: inkFor(slotHex(mapping, slot)) }}
            onClick={() => {
              setTool("brush");
              setBrush(slot);
            }}
          >
            {SLOT_LABEL[slot]}
            <span>{slotHex(mapping, slot)}</span>
          </button>
        ))}
        <button
          type="button"
          aria-pressed={tool === "brush" && brush === "eraser"}
          onClick={() => {
            setTool("brush");
            setBrush("eraser");
          }}
        >
          Eraser
        </button>
        <button type="button" aria-pressed={tool === "ground"} onClick={() => setTool("ground")}>
          Feet pin
        </button>
        <button type="button" aria-pressed={tool === "muzzle"} onClick={() => setTool("muzzle")}>
          Muzzle pin
        </button>
      </div>
      <div className="unit-pixel-stage-row">
        <figure>
          <figcaption>
            {doc.flat ? "Whole unit" : "Part grid"} · feet ({doc.blueprint.groundOrigin.x}, {doc.blueprint.groundOrigin.y})
            {doc.blueprint.muzzlePoint ? ` · muzzle (${doc.blueprint.muzzlePoint.x}, ${doc.blueprint.muzzlePoint.y})` : ""}
          </figcaption>
          <div className="unit-pixel-stage">
            <canvas
              ref={gridRef}
              width={GRID}
              height={GRID}
              aria-label="48 by 48 pixel grid"
              onPointerDown={(event) => {
                painting.current = true;
                event.currentTarget.setPointerCapture(event.pointerId);
                applyPointer(event);
              }}
              onPointerMove={(event) => {
                if (painting.current) {
                  applyPointer(event);
                }
              }}
              onPointerUp={() => {
                painting.current = false;
              }}
            />
            <canvas ref={pinRef} width={GRID} height={GRID} />
          </div>
        </figure>
        <figure>
          <figcaption>Sheet (40, 52)</figcaption>
          <canvas ref={sheetRef} width={SPRITE_BAKE.width} height={SPRITE_BAKE.height} className="unit-pixel-sheet" />
          <p>{sheetNote}</p>
        </figure>
      </div>
      <div className="unit-pixel-tools">
        {import.meta.env.DEV && (
          <button type="button" onClick={save}>
            Save to Repo
          </button>
        )}
        <button type="button" onClick={exportJson}>
          Export Unit JSON
        </button>
        <label className="unit-pixel-import">
          Import Unit JSON
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              void importJson(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        <p>{note}</p>
      </div>
    </div>
  );
}

function drawGrid(grid: HTMLCanvasElement | null, pins: HTMLCanvasElement | null, doc: UnitPaintDocument): void {
  if (!grid || !pins) {
    return;
  }
  const parts = new Map(Object.values(doc.parts).map((part) => [part.partId, part]));
  const mapping = FACTION_MILITARY_MAPPINGS[doc.blueprint.factionId];
  let keys: (MilitaryStripKey | null)[] = [];
  try {
    keys = rasterBlueprintAlbedo(doc.blueprint, parts, mapping).albedoKeys;
  } catch {
    keys = [];
  }
  const ctx = grid.getContext("2d");
  const pinCtx = pins.getContext("2d");
  if (!ctx || !pinCtx) {
    return;
  }
  const image = ctx.createImageData(GRID, GRID);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key == null) {
      continue;
    }
    const rgb = Number.parseInt(MILITARY[key].slice(1), 16);
    const offset = i * 4;
    image.data[offset] = (rgb >> 16) & 255;
    image.data[offset + 1] = (rgb >> 8) & 255;
    image.data[offset + 2] = rgb & 255;
    image.data[offset + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  pinCtx.clearRect(0, 0, GRID, GRID);
  stampPin(pinCtx, doc.blueprint.groundOrigin.x, doc.blueprint.groundOrigin.y, "#f5f0e6");
  if (doc.blueprint.muzzlePoint) {
    stampPin(pinCtx, doc.blueprint.muzzlePoint.x, doc.blueprint.muzzlePoint.y, "#9c524e");
  }
}

function drawSheet(
  canvas: HTMLCanvasElement | null,
  doc: UnitPaintDocument,
  setSheetNote: (note: string) => void,
): void {
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.clearRect(0, 0, SPRITE_BAKE.width, SPRITE_BAKE.height);
  try {
    const parts = new Map(Object.values(doc.parts).map((part) => [part.partId, part]));
    const sheet = blitBlueprintToSheet80x56(doc.blueprint, parts, FACTION_MILITARY_MAPPINGS[doc.blueprint.factionId]);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet, 0, 0);
    setSheetNote("");
  } catch (error) {
    setSheetNote(error instanceof Error ? error.message : String(error));
  }
}

function stampPin(ctx: CanvasRenderingContext2D, x: number, y: number, hex: string): void {
  ctx.fillStyle = hex;
  ctx.fillRect(x, y, 1, 1);
  ctx.fillRect(x - 1, y, 1, 1);
  ctx.fillRect(x + 1, y, 1, 1);
  ctx.fillRect(x, y - 1, 1, 1);
  ctx.fillRect(x, y + 1, 1, 1);
}

function pixelOf(canvas: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return null;
  }
  const x = Math.floor(((clientX - rect.left) / rect.width) * canvas.width);
  const y = Math.floor(((clientY - rect.top) / rect.height) * canvas.height);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
    return null;
  }
  return { x, y };
}

async function flattenCandidate(base64: string, source: UnitPaintDocument): Promise<UnitPaintDocument> {
  const image = await rgbaFromUrl(`data:image/png;base64,${base64}`);
  return flattenRgba(source, image.data, image.width, image.height, FACTION_MILITARY_MAPPINGS[source.blueprint.factionId]);
}

async function rgbaFromUrl(url: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("The candidate image could not be read.");
  }
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: imageData.data };
}

function inkFor(hex: string): string {
  const rgb = Number.parseInt(hex.slice(1), 16);
  const luma = (0.2126 * ((rgb >> 16) & 255) + 0.7152 * ((rgb >> 8) & 255) + 0.0722 * (rgb & 255)) / 255;
  return luma > 0.55 ? "#1c1917" : "#f5f0e6";
}

const PAINTER_CSS = `
.unit-pixel-painter {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid #4b3d44;
}
.unit-pixel-tools, .unit-pixel-swatches, .unit-pixel-stage-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.unit-pixel-swatches button {
  min-width: 72px;
  border: 1px solid #1c1917;
}
.unit-pixel-swatches button[aria-pressed="true"], .unit-pixel-tools button[aria-pressed="true"] {
  outline: 2px solid #f5f0e6;
}
.unit-pixel-stage {
  position: relative;
  width: ${GRID * GRID_SCALE}px;
  height: ${GRID * GRID_SCALE}px;
  background-image: linear-gradient(45deg, #2a2622 25%, transparent 25%), linear-gradient(-45deg, #2a2622 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2622 75%), linear-gradient(-45deg, transparent 75%, #2a2622 75%);
  background-size: ${GRID_SCALE * 2}px ${GRID_SCALE * 2}px;
  background-position: 0 0, 0 ${GRID_SCALE}px, ${GRID_SCALE}px ${-GRID_SCALE}px, ${-GRID_SCALE}px 0;
}
.unit-pixel-stage canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}
.unit-pixel-stage canvas:last-child {
  pointer-events: none;
}
.unit-pixel-sheet {
  width: ${SPRITE_BAKE.width * 4}px;
  height: ${SPRITE_BAKE.height * 4}px;
  image-rendering: pixelated;
  background: #3a342c;
}
.unit-pixel-import input {
  display: block;
}
.unit-pixel-painter figure {
  margin: 0;
}
`;
