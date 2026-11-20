import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { EMBLEMS, UNSUPPORTED_FACTIONS, emblemById, emblemForFaction, type EmblemId } from "./emblems";
import type { RosterFactionId } from "./skeletonSchema";
import {
  EMBLEM_HEX,
  compositeStamps,
  opaquePixelCount,
  placementCells,
  spriteSilhouette,
  stampsPathFor,
  suggestEmblemSize,
  type SpritePixels,
  type StampPlacement,
  type StampSidecar,
} from "./spriteStamps";

const ZOOMS = [1, 2, 3, 4] as const;

function defaultEmblem(factionId: string): EmblemId | null {
  return emblemForFaction(factionId as RosterFactionId)?.id ?? null;
}

function loadSprite(path: string): Promise<SpritePixels> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("The browser would not open a canvas."));
        return;
      }
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resolve({ width: canvas.width, height: canvas.height, data: pixels.data });
    };
    image.onerror = () => reject(new Error("The polished PNG could not be opened."));
    image.src = `/__dev/bake-file?path=${encodeURIComponent(path)}`;
  });
}

function stampLine(stamp: StampPlacement): string {
  const extras = [stamp.turn ? "on its side" : "", stamp.flip ? "flipped" : "", stamp.onlyOnSprite ? "" : "may spill"].filter(Boolean);
  return `${emblemById(stamp.emblem)?.name ?? stamp.emblem} ${stamp.size}, at ${stamp.x}, ${stamp.y}${extras.length ? `, ${extras.join(", ")}` : ""}`;
}

/**
 * Places emblems and markings on a large polished sprite. The PNG is not changed: the placements are saved beside it
 * and baked into a separate stamped PNG and SVG.
 */
export function SpriteStampPanel({ source, factionId, onBaked }: { source: string; factionId: string; onBaked?: (svg: string | null) => void }) {
  const [sprite, setSprite] = useState<SpritePixels | null>(null);
  const [stamps, setStamps] = useState<StampPlacement[]>([]);
  const [savedJson, setSavedJson] = useState("[]");
  const [history, setHistory] = useState<StampPlacement[][]>([]);
  const [emblemId, setEmblemId] = useState<EmblemId | null>(() => defaultEmblem(factionId));
  const [size, setSize] = useState<number | null>(null);
  const [flip, setFlip] = useState(false);
  const [turn, setTurn] = useState(false);
  const [onlyOnSprite, setOnlyOnSprite] = useState(true);
  const [showOriginal, setShowOriginal] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const sidecarPath = useMemo(() => stampsPathFor(source), [source]);
  const minor = UNSUPPORTED_FACTIONS.includes(factionId as RosterFactionId);

  useEffect(() => {
    let cancel = false;
    setSprite(null);
    setStamps([]);
    setSavedJson("[]");
    setHistory([]);
    setHover(null);
    setSize(null);
    setEmblemId(defaultEmblem(factionId));
    setNote("Opening the polished PNG…");
    void (async () => {
      try {
        const [pixels, saved] = await Promise.all([
          loadSprite(source),
          fetch(`/__dev/unit-stamps?path=${encodeURIComponent(source)}`).then((response) => response.json()),
        ]);
        if (cancel) {
          return;
        }
        const list: StampPlacement[] = saved?.ok && saved.file ? (saved.file as StampSidecar).stamps.map((stamp) => ({ flip: false, turn: false, onlyOnSprite: true, ...stamp })) : [];
        setSprite(pixels);
        setStamps(list);
        setSavedJson(JSON.stringify(list));
        const room = frameRef.current?.clientWidth ?? 880;
        setZoom(Math.max(1, Math.min(4, Math.floor(room / pixels.width))));
        setNote(list.length > 0 ? `${list.length} saved stamp${list.length === 1 ? "" : "s"} from ${saved.path}.` : "No stamps yet. Hover the sprite to see the emblem, click to place it.");
      } catch (error) {
        if (!cancel) {
          setNote(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [source, factionId]);

  const emblem = emblemId ? emblemById(emblemId) : null;
  const opaque = useMemo(() => (sprite ? opaquePixelCount(sprite) : 0), [sprite]);
  const suggested = emblem && sprite ? suggestEmblemSize(emblem, { width: sprite.width, height: sprite.height, opaque }) : null;
  const activeSize = emblem && size !== null && emblem.sizes.some((item) => item.size === size) ? size : suggested;
  const onSprite = useMemo(() => (sprite ? spriteSilhouette(sprite) : () => false), [sprite]);
  const composite = useMemo(() => (sprite ? compositeStamps(sprite, showOriginal ? [] : stamps).data : null), [sprite, stamps, showOriginal]);
  const dirty = JSON.stringify(stamps) !== savedJson;

  const placementAt = (x: number, y: number): StampPlacement | null =>
    emblem && activeSize ? { emblem: emblem.id, size: activeSize, x, y, flip, turn, onlyOnSprite } : null;

  const preview = useMemo(() => {
    if (!sprite || !hover || showOriginal || !emblem || !activeSize) {
      return [];
    }
    return placementCells(sprite, { emblem: emblem.id, size: activeSize, x: hover.x, y: hover.y, flip, turn, onlyOnSprite }, onSprite);
  }, [sprite, hover, emblem, activeSize, flip, turn, onlyOnSprite, onSprite, showOriginal]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sprite || !composite) {
      return;
    }
    canvas.width = sprite.width;
    canvas.height = sprite.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const image = ctx.createImageData(sprite.width, sprite.height);
    image.data.set(composite);
    ctx.putImageData(image, 0, 0);
    ctx.globalAlpha = 0.75;
    for (const { x, y, slot } of preview) {
      ctx.fillStyle = EMBLEM_HEX[slot];
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;
  }, [sprite, composite, preview]);

  const pixelUnder = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !sprite) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * sprite.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * sprite.height);
    return x >= 0 && y >= 0 && x < sprite.width && y < sprite.height ? { x, y } : null;
  };

  const change = (next: StampPlacement[]) => {
    setHistory((past) => [...past, stamps]);
    setStamps(next);
  };

  const place = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = pixelUnder(event);
    if (!point || !sprite) {
      return;
    }
    if (showOriginal) {
      setNote("The stamps are hidden. Untick Show the polished PNG to place one.");
      return;
    }
    const placement = placementAt(point.x, point.y);
    if (!placement) {
      setNote(minor ? "Minor powers have no emblem. Pick one only if this unit belongs to another country." : "Pick an emblem first.");
      return;
    }
    if (placementCells(sprite, placement, onSprite).length === 0) {
      setNote("Nothing to stamp there: no part of the sprite is under the emblem. Untick Only on the sprite to stamp on empty pixels.");
      return;
    }
    change([...stamps, placement]);
    setNote(`${stampLine(placement)}. Save stamps to keep it.`);
  };

  const save = async (): Promise<boolean> => {
    if (!sprite) {
      return false;
    }
    const file: StampSidecar = { kind: "unit-stamps", version: 1, source, width: sprite.width, height: sprite.height, stamps };
    const response = await fetch("/__dev/unit-stamps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(file) });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.ok === false) {
      setNote(json.error || `Saving failed (${response.status}).`);
      return false;
    }
    setSavedJson(JSON.stringify(stamps));
    setNote(`Saved ${stamps.length} stamp${stamps.length === 1 ? "" : "s"} to ${json.path}.`);
    return true;
  };

  const bake = async () => {
    setBusy(true);
    try {
      if (dirty && !(await save())) {
        return;
      }
      setNote("Baking: compositing the stamped PNG, then tracing it. A bomber takes about a minute.");
      const response = await fetch("/__dev/bake-stamps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: source }) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.ok === false) {
        setNote(`${json.error || `Baking failed (${response.status}).`} ${json.output ?? ""}`.trim());
        return;
      }
      setNote(json.svg ? `Baked. The gallery and the battle map now show ${json.svg}.` : "Baked. No stamps, so the stamped vector was dropped.");
      onBaked?.(json.svg ?? null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sprite-stamp" aria-label="Stamp emblems">
      <style>{STAMP_CSS}</style>
      <h3>Stamp</h3>
      <p className="sprite-stamp-lead">You choose where it goes; nothing is placed for you. Warships and submarines mostly wore no national marking on the hull.</p>
      <div className="sprite-stamp-controls">
        <label>
          Emblem
          <select
            value={emblemId ?? ""}
            onChange={(event) => {
              setEmblemId((event.target.value || null) as EmblemId | null);
              setSize(null);
            }}
          >
            {(minor || emblemId === null) && <option value="">No emblem: minor powers have none</option>}
            {EMBLEMS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.kind === "marking" ? item.name : `${item.faction}: ${item.name}`}
              </option>
            ))}
          </select>
        </label>
        {emblem && (
          <div className="sprite-stamp-row" role="group" aria-label="Emblem size">
            {emblem.sizes.map((item) => (
              <button
                key={item.size}
                type="button"
                aria-pressed={activeSize === item.size}
                title={`${item.label}: ${item.width} by ${item.height} pixels, drawn by hand at this size.${item.size === suggested ? " Suggested for this sprite." : ""}`}
                onClick={() => setSize(item.size)}
              >
                {item.size}
                <small>
                  {item.width}×{item.height}
                  {item.size === suggested ? " · suggested" : ""}
                </small>
              </button>
            ))}
          </div>
        )}
        <div className="sprite-stamp-row">
          <label title="Mirror the emblem left to right.">
            <input type="checkbox" checked={flip} onChange={(event) => setFlip(event.target.checked)} />
            Flip
          </label>
          <label title="Swap rows and columns so the emblem stands on its side. The star and bars then run up and down, along a wing drawn upright.">
            <input type="checkbox" checked={turn} onChange={(event) => setTurn(event.target.checked)} />
            On its side
          </label>
          <label title="Write only where the sprite already has a pixel, so the emblem cannot hang off the edge.">
            <input type="checkbox" checked={onlyOnSprite} onChange={(event) => setOnlyOnSprite(event.target.checked)} />
            Only on the sprite
          </label>
          <label title="Hide the stamps to compare with the polished PNG.">
            <input type="checkbox" checked={showOriginal} onChange={(event) => setShowOriginal(event.target.checked)} />
            Show the polished PNG
          </label>
        </div>
        <div className="sprite-stamp-row" role="group" aria-label="Zoom">
          {ZOOMS.map((step) => (
            <button key={step} type="button" aria-pressed={zoom === step} onClick={() => setZoom(step)}>
              {step}×
            </button>
          ))}
          {sprite && (
            <span>
              {sprite.width}×{sprite.height}
              {hover ? ` · pixel ${hover.x}, ${hover.y}` : ""}
            </span>
          )}
        </div>
      </div>
      <div className="sprite-stamp-frame" ref={frameRef}>
        {sprite && (
          <canvas
            ref={canvasRef}
            style={{ width: sprite.width * zoom, height: sprite.height * zoom }}
            onPointerMove={(event) => setHover(pixelUnder(event))}
            onPointerLeave={() => setHover(null)}
            onPointerDown={place}
          />
        )}
      </div>
      <div className="sprite-stamp-row">
        <button type="button" disabled={history.length === 0} onClick={() => {
          setStamps(history[history.length - 1] ?? []);
          setHistory((past) => past.slice(0, -1));
          setNote("Undone.");
        }}>
          Undo
        </button>
        <button type="button" disabled={!sprite || busy || !dirty} onClick={() => void save()}>
          Save stamps
        </button>
        <button type="button" disabled={!sprite || busy} onClick={() => void bake()} title="Saves, then runs npm run stamp:units and npm run vectorize:units -- --stamped for this unit only.">
          {busy ? "Baking…" : "Bake now"}
        </button>
        {dirty && <span>Unsaved changes</span>}
      </div>
      {stamps.length > 0 && (
        <ol className="sprite-stamp-list">
          {stamps.map((stamp, index) => (
            <li key={`${index}-${stamp.x}-${stamp.y}`}>
              {stampLine(stamp)}
              <button type="button" onClick={() => change(stamps.filter((_, other) => other !== index))}>
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="sprite-stamp-lead">
        Save stamps writes {sidecarPath}; the polished PNG is not changed. To bake by hand, run npm run stamp:units, then npm run vectorize:units -- --stamped.
      </p>
      <p className="sprite-stamp-note" role="status">
        {note}
      </p>
    </section>
  );
}

const STAMP_CSS = `
.sprite-stamp { display: flex; flex-direction: column; gap: 8px; align-self: stretch; padding-top: 8px; border-top: 1px solid #4b3d44; }
.sprite-stamp h3 { margin: 0; font: 600 14px/1.2 "Segoe UI", sans-serif; color: #f5f0e6; }
.sprite-stamp-lead, .sprite-stamp-note { margin: 0; color: #a99c8d; font: 13px/1.4 "Segoe UI", sans-serif; }
.sprite-stamp-note { min-height: 1.4em; padding: 6px 8px; background: #2a2420; color: #f5f0e6; }
.sprite-stamp-controls { display: flex; flex-direction: column; gap: 8px; }
.sprite-stamp-controls > label { display: flex; gap: 8px; align-items: center; font: 13px/1.3 "Segoe UI", sans-serif; color: #f5f0e6; }
.sprite-stamp-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font: 13px/1.3 "Segoe UI", sans-serif; color: #f5f0e6; }
.sprite-stamp-row label { display: flex; gap: 4px; align-items: center; cursor: pointer; }
.sprite-stamp-row span { color: #a99c8d; }
.sprite-stamp button { font: 13px/1.3 "Segoe UI", sans-serif; letter-spacing: 0; text-transform: none; padding: 4px 8px; background: #2a2420; color: #f5f0e6; border: 1px solid #4b3d44; }
.sprite-stamp button:hover:not(:disabled) { border-color: #ddcf99; }
.sprite-stamp button[aria-pressed="true"] { border-color: #ddcf99; background: #4b3d44; }
.sprite-stamp button small { display: block; color: #ddcf99; font-size: 11px; }
.sprite-stamp select { font: 13px/1.3 "Segoe UI", sans-serif; background: #2a2420; color: #f5f0e6; border: 1px solid #4b3d44; padding: 3px 4px; }
.sprite-stamp-frame { max-width: 100%; max-height: 70vh; overflow: auto; background: #c8c2b6; box-shadow: inset 0 0 0 1px #1c1917; }
.sprite-stamp-frame canvas { display: block; image-rendering: pixelated; cursor: crosshair; }
.sprite-stamp-list { margin: 0; padding-left: 20px; color: #f5f0e6; font: 13px/1.6 "Segoe UI", sans-serif; }
.sprite-stamp-list button { margin-left: 8px; padding: 1px 6px; }
`;
