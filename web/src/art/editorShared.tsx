import { useEffect, useRef, type HTMLAttributes } from "react";
import { MILITARY } from "../ui/theme/militaryPalette";
import { stripKeyOfSlot, type FactionMilitaryMapping, type SpriteFrameGrid } from "./skeletonSchema";

/**
 * The pieces the infantry editor and the vehicle editor both use: the colour palette, the preview
 * of a picture that is about to be sent for a new part, and the helpers that turn pixels into a PNG.
 */

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not open ${src}.`));
    image.src = src;
  });
}

export function imageRgba(image: HTMLImageElement): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("The browser would not open a canvas.");
  }
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

export function putRgba(canvas: HTMLCanvasElement | null, rgba: Uint8ClampedArray, width: number, height: number): void {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx || width < 1 || height < 1) {
    return;
  }
  canvas.width = width;
  canvas.height = height;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
}

export async function pngBlob(rgba: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  putRgba(canvas, rgba, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    throw new Error("The picture could not be turned into a PNG.");
  }
  return blob;
}

export async function pngBase64(rgba: Uint8ClampedArray, width: number, height: number): Promise<string> {
  const bytes = new Uint8Array(await (await pngBlob(rgba, width, height)).arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function pictureCount(count: number): string {
  return count === 1 ? "1 picture" : `${count} pictures`;
}

/** A grid of slots in a country's colours, as straight RGBA. Empty cells stay clear. */
export function slotGridRgba(grid: SpriteFrameGrid, mapping: FactionMilitaryMapping): Uint8ClampedArray {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const out = new Uint8ClampedArray(width * height * 4);
  const colours = new Map<string, number>();
  for (let y = 0; y < height; y += 1) {
    const row = grid[y] ?? [];
    for (let x = 0; x < width; x += 1) {
      const slot = row[x];
      if (slot == null) {
        continue;
      }
      let rgb = colours.get(slot);
      if (rgb === undefined) {
        rgb = Number.parseInt(MILITARY[stripKeyOfSlot(mapping, slot)].slice(1), 16);
        colours.set(slot, rgb);
      }
      const offset = (y * width + x) * 4;
      out[offset] = (rgb >> 16) & 255;
      out[offset + 1] = (rgb >> 8) & 255;
      out[offset + 2] = rgb & 255;
      out[offset + 3] = 255;
    }
  }
  return out;
}

/** Turns a line of help into the props that show it: a tooltip, and the editor's help line while the pointer is over the control. */
export type EditorHint = (text: string) => HTMLAttributes<HTMLElement>;

export interface Swatch<Key extends string | number> {
  key: Key;
  label: string;
  hex: string;
  /** Shown after the name of the picked colour. */
  detail?: string;
  /** The tooltip. The name is used when there is none. */
  help?: string;
}

/** The colours the pencil can paint, as a grid of squares with the picked one named underneath. */
export function SwatchPalette<Key extends string | number>({
  swatches,
  picked,
  onPick,
  hint,
}: {
  swatches: readonly Swatch<Key>[];
  picked: Key | null;
  onPick: (key: Key) => void;
  hint?: EditorHint;
}) {
  const current = swatches.find((item) => item.key === picked) ?? null;
  return (
    <>
      <div className="editor-swatches" role="group" aria-label="Colours">
        {swatches.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={picked === item.key}
            aria-label={item.label}
            title={item.help ?? item.label}
            {...(hint ? hint(item.help ?? item.label) : {})}
            style={{ background: item.hex }}
            onClick={() => onPick(item.key)}
          />
        ))}
      </div>
      <p className="editor-swatch-name">{current ? `${current.label}${current.detail ? ` ${current.detail}` : ""}` : "No colour picked"}</p>
    </>
  );
}

/** What is sent for a new part: the picture, and the pixels its mask opens. */
export interface SentSheet {
  width: number;
  height: number;
  input: Uint8ClampedArray;
  mask: Uint8ClampedArray;
}

/** The picture with everything outside the mask dimmed, so the open pixels stand out. */
function openPixelsRgba(sheet: SentSheet): Uint8ClampedArray {
  const out = new Uint8ClampedArray(sheet.input);
  for (let offset = 0; offset < out.length; offset += 4) {
    if ((sheet.mask[offset + 3] ?? 0) > 12) {
      continue;
    }
    out[offset] = Math.round((out[offset] ?? 0) * 0.22 + 22);
    out[offset + 1] = Math.round((out[offset + 1] ?? 0) * 0.22 + 20);
    out[offset + 2] = Math.round((out[offset + 2] ?? 0) * 0.22 + 18);
  }
  return out;
}

export function SentPicture({ sheet }: { sheet: SentSheet }) {
  const sentRef = useRef<HTMLCanvasElement>(null);
  const openRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    putRgba(sentRef.current, sheet.input, sheet.width, sheet.height);
    putRgba(openRef.current, openPixelsRgba(sheet), sheet.width, sheet.height);
  }, [sheet]);
  const style = { width: sheet.width * 2, height: sheet.height * 2 };
  return (
    <div className="editor-sent">
      <figure>
        <canvas ref={sentRef} style={style} aria-label="The picture that is sent" />
        <figcaption>
          Sent, {sheet.width}×{sheet.height}
        </figcaption>
      </figure>
      <figure>
        <canvas ref={openRef} style={style} aria-label="The pixels open to repainting" />
        <figcaption>Open to repainting</figcaption>
      </figure>
    </div>
  );
}

/** Rules for the shared pieces. Each editor adds them to its own style sheet. */
export const EDITOR_SHARED_CSS = `
.editor-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.editor-swatches.editor-swatches button {
  width: 28px;
  height: 28px;
  min-height: 0;
  padding: 0;
  border: 1px solid #4b3d44;
}
.editor-swatches.editor-swatches button[aria-pressed="true"] {
  border-color: #ddcf99;
  outline: 2px solid #ddcf99;
  outline-offset: 1px;
}
.editor-swatch-name {
  margin: 0;
  color: #a99c8d;
}
.editor-sent {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.editor-sent figure {
  margin: 0;
}
.editor-sent canvas {
  display: block;
  image-rendering: pixelated;
  box-shadow: 0 0 0 1px #4b3d44;
}
.editor-sent figcaption {
  margin-top: 4px;
  color: #a99c8d;
}
.editor-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.editor-panel select,
.editor-panel input[type="text"],
.editor-panel input[type="number"] {
  font: 13px/1.3 "Segoe UI", sans-serif;
  padding: 6px 10px;
  background: #1c1917;
  color: #f5f0e6;
  border: 1px solid #4b3d44;
}
.editor-panel input[type="number"] {
  width: 84px;
}
.editor-panel input.editor-wide {
  width: 380px;
  max-width: 100%;
}
.editor-panel input[type="text"]::placeholder {
  color: #a99c8d;
}
.editor-panel label {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  color: #f5f0e6;
}
.editor-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.editor-parts {
  padding: 8px 10px;
  background: #2a2420;
  box-shadow: 0 0 0 1px #4b3d44;
}
.editor-parts strong {
  font-weight: 600;
  color: #ddcf99;
}
.editor-shelf {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.editor-shelf.editor-shelf button.editor-part {
  flex: none;
  padding: 4px;
}
.editor-shelf canvas {
  display: block;
  image-rendering: pixelated;
  background: #2f2925;
}
.editor-shelf small {
  display: block;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #ddcf99;
}
.editor-candidate {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.editor-gen {
  padding: 10px;
  background: #241f1c;
  box-shadow: 0 0 0 1px #4b3d44;
}
.editor-gen h3 {
  margin: 0;
  font: 600 13px/1.4 "Segoe UI", sans-serif;
  letter-spacing: 0;
  text-transform: none;
  color: #ddcf99;
}
.editor-note {
  margin: 0;
  max-width: 640px;
  color: #a99c8d;
}
`;
