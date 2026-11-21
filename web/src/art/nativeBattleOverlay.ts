import { rosterUnitType, UNIT_TYPE_LABEL } from "./archetypeLayers";
import { PLATE_DRAW_SCALE } from "./pixelGrain";
import { beatGrid } from "./layeredUnit";
import { slotHex, type UnitPaintDocument } from "./pixelPaint";
import { POSE_FPS, poseStep, type PlaybackBeat } from "./motionPreview";
import { FACTION_MILITARY_MAPPINGS } from "./starterParts";
import { UNIT_DEFINITIONS, type CombatUnit, type UnitType } from "../ui/battle/combatTypes";
import { laneScale, SHADOW_ALPHA, SHADOW_RGB } from "../ui/battle/scenery/perspective";

/** The battle board. A plate pixel is one of these pixels. */
export const BATTLE_BOARD = { width: 1280, height: 720 } as const;

/**
 * Attacker file, first column. These are the numbers the battle uses for a unit that has not
 * marched, cheered, or staggered: x = 102, land and air rows from 160 by 46, sea rows from 565 by 38.
 */
export function attackerStation(category: "land" | "air" | "sea", rowIndex: number): { x: number; y: number } {
  return {
    x: 102,
    y: category === "sea" ? 565 + rowIndex * 38 : 160 + rowIndex * 46,
  };
}

/** A mid-field land row, and the first sea row, where the comparison stands. */
export const COMPARE_ROW = 3;

/** The gallery picture to open on the battle map, if one was picked in the editor. */
export const FIELD_PICK_KEY = "field-pick";

/** Menu jumps. The wheel can stop anywhere between the min and the max. */
export const FIELD_VIEW_SCALES = [1, 2, 3, 4] as const;

/** Closest and furthest the wheel may take the board. 1 is one screen pixel per battle pixel. */
export const FIELD_ZOOM_MIN = 0.25;
export const FIELD_ZOOM_MAX = 8;

/** The same wheel curve as the campaign map: a small trackpad tick is under one percent. */
const FIELD_WHEEL_GAIN = 0.0018;
const FIELD_WHEEL_CAP = 400;

/** A scale the board will actually use. Anything outside the wheel's range is pulled back in. */
export function fieldViewScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return 1;
  }
  return Math.min(FIELD_ZOOM_MAX, Math.max(FIELD_ZOOM_MIN, scale));
}

/** How big the 1280×720 board is drawn. The buffer stays 1280×720 either way. */
export function fieldViewSize(scale: number): { width: number; height: number } {
  const step = fieldViewScale(scale);
  return { width: BATTLE_BOARD.width * step, height: BATTLE_BOARD.height * step };
}

/** A short label for the live magnification. */
export function fieldZoomLabel(scale: number): string {
  const shown = fieldViewScale(scale);
  if (Math.abs(shown - 1) < 0.001) {
    return "1× native";
  }
  const text = Math.abs(shown - Math.round(shown)) < 0.05 ? String(Math.round(shown)) : shown.toFixed(1);
  return `${text}×`;
}

/**
 * The scale after one wheel event. Positive `deltaY` zooms out, as on the campaign map.
 * `deltaMode` 1 is lines and 2 is pages.
 */
export function fieldWheelZoom(scale: number, deltaY: number, deltaMode = 0): number {
  const lines = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 100 : deltaY;
  const capped = Math.min(FIELD_WHEEL_CAP, Math.max(-FIELD_WHEEL_CAP, lines));
  return fieldViewScale(fieldViewScale(scale) * Math.exp(-capped * FIELD_WHEEL_GAIN));
}

/** One frame of the campaign map's zoom glide. `dtMs` is the time since the previous frame. */
export function fieldDampZoom(current: number, target: number, dtMs: number): number {
  const dt = Math.max(0, dtMs) / 1000;
  const t = 1 - Math.exp(-dt * 18);
  return current + (target - current) * t;
}

/** Stage scroll that keeps a battle pixel under the pointer after the board changes size. */
export function fieldScrollForZoom(
  board: { x: number; y: number },
  pointer: { x: number; y: number },
  scale: number,
): { left: number; top: number } {
  const shown = fieldViewScale(scale);
  return {
    left: board.x * shown - pointer.x,
    top: board.y * shown - pointer.y,
  };
}

export interface FieldPiece {
  width: number;
  height: number;
  /** Feet inside the picture. The row places this point on the battle line. */
  footX: number;
  category: "land" | "air" | "sea";
  /** Empty pixels after this picture, before the next one on the same row. */
  gap: number;
}

/** A stable gap, 24 to 80 battle pixels, so a row is not a stiff grid. */
export function fieldGap(seed: number): number {
  const wave = Math.abs(Math.sin(seed * 12.9898));
  return 24 + Math.floor(wave * 57);
}

/**
 * The battle's rows, widened for a picture at its own size.
 * Aircraft take the top land line, vehicles the mid-field line, ships the sea line.
 * A picture that would run off the right starts the next row of that kind.
 */
export function fieldRows(pieces: readonly FieldPiece[]): { x: number; y: number }[] {
  const right = BATTLE_BOARD.width - 16;
  const lanes = {
    air: { left: 102, y: attackerStation("land", 0).y, rowHeight: 0 },
    land: { left: 102, y: attackerStation("land", COMPARE_ROW).y, rowHeight: 0 },
    sea: { left: 102, y: attackerStation("sea", 0).y, rowHeight: 0 },
  };
  return pieces.map((piece) => {
    const laneKey = piece.category === "sea" ? "sea" : piece.category === "air" ? "air" : "land";
    const lane = lanes[laneKey];
    const width = Math.max(1, Math.ceil(piece.width));
    const height = Math.max(1, Math.ceil(piece.height));
    const foot = Math.min(width - 1, Math.max(0, Math.round(piece.footX)));
    const pitch = laneKey === "sea" ? 38 : 46;
    if (lane.left > 102 && lane.left + width > right) {
      lane.y += Math.max(pitch, height, lane.rowHeight);
      lane.left = 102;
      lane.rowHeight = 0;
    }
    const x = lane.left + foot;
    const y = lane.y;
    lane.left += width + Math.max(0, Math.round(piece.gap));
    lane.rowHeight = Math.max(lane.rowHeight, height);
    return { x, y };
  });
}

const UNIT_TYPE_KEYS = new Set<string>(Object.keys(UNIT_DEFINITIONS));

/** The battle's unit type for a sprite. Names from the art notes are turned into roster keys first. */
export function battleUnitType(unitTypeId: string): UnitType {
  const roster = rosterUnitType(unitTypeId);
  if (UNIT_TYPE_KEYS.has(roster)) {
    return roster as UnitType;
  }
  return "tank";
}

export function battleCategory(unitTypeId: string): "land" | "air" | "sea" {
  return UNIT_DEFINITIONS[battleUnitType(unitTypeId)].category;
}

/** Sizes a picture can be drawn at. 1 is its own pixels. The map zoom is separate. */
export const FIELD_UNIT_SCALES = [0.125, 0.25, 0.5, 1, 2, 3, 4] as const;

export function fieldUnitScaleLabel(scale: number): string {
  if (scale === 0.125) {
    return "1/8×";
  }
  if (scale === 0.25) {
    return "1/4×";
  }
  if (scale === 0.5) {
    return "1/2×";
  }
  if (scale === 1) {
    return "1× native";
  }
  return `${scale}×`;
}

export interface NativeStamp {
  /** Battle pixels covered by one art pixel. 1 draws the picture at its own size. */
  scale: number;
  /** Top left of the plate on the battle board. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Place a plate so its ground point stands on `station`.
 * `drawScale` is how many battle pixels one art pixel covers. 1 leaves the picture at its own size.
 */
export function nativeStamp(
  size: { width: number; height: number },
  ground: { x: number; y: number },
  station: { x: number; y: number },
  drawScale: number = PLATE_DRAW_SCALE,
): NativeStamp {
  const scale = drawScale > 0 && Number.isFinite(drawScale) ? drawScale : PLATE_DRAW_SCALE;
  return {
    scale,
    x: station.x - ground.x * scale,
    y: station.y - ground.y * scale,
    width: size.width * scale,
    height: size.height * scale,
  };
}

/**
 * A unit's size on its lane: the size it was given times the lane's depth multiplier,
 * about 0.85 on the back lane and 1.05 on the front. The multiplier is anchored at the feet,
 * because `nativeStamp` and `fieldBlit` place the plate by its ground point.
 * Sea scenes have no depth to read, so they pass `depth` false and keep the given size.
 */
export function depthUnitScale(unitScale: number, stationY: number, depth = true): number {
  return depth ? unitScale * laneScale(stationY) : unitScale;
}

export interface Footprint {
  /** First and last opaque column of the lowest rows, in art pixels. */
  left: number;
  right: number;
  /** Columns between them, counting both ends. */
  width: number;
  /** Halfway between them. */
  centre: number;
}

/** Share of the picture's opaque height that counts as its footprint. */
const FOOTPRINT_SHARE = 0.12;

/**
 * The strip a unit stands on: the columns covered by the lowest 12% of its opaque rows.
 * A tank's tracks give its length, and an antenna or a barrel does not widen it.
 * A picture with nothing opaque gets half its width, centred.
 */
export function footprintSpan(rgba: Uint8ClampedArray, width: number, height: number): Footprint {
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((rgba[(y * width + x) * 4 + 3] ?? 0) >= 128) {
        if (top < 0) {
          top = y;
        }
        bottom = y;
        break;
      }
    }
  }
  if (bottom < 0) {
    const span = Math.max(1, Math.round(width / 2));
    const left = Math.floor((width - span) / 2);
    return { left, right: left + span - 1, width: span, centre: left + (span - 1) / 2 };
  }
  const band = Math.max(1, Math.round((bottom - top + 1) * FOOTPRINT_SHARE));
  let left = width;
  let right = -1;
  for (let y = bottom - band + 1; y <= bottom; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((rgba[(y * width + x) * 4 + 3] ?? 0) >= 128) {
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
  }
  return { left, right, width: right - left + 1, centre: (left + right) / 2 };
}

export interface ContactShadow {
  /** Centre on the board. */
  x: number;
  y: number;
  /** Half width and half height of the oval, in battle pixels. */
  rx: number;
  ry: number;
}

/** The oval is a little wider than the feet and about a fifth as tall as it is wide. */
const SHADOW_SPREAD = 1.1;
const SHADOW_FLATNESS = 0.2;

/**
 * The soft oval under a unit. It grows with the unit's width and its lane's depth scale,
 * and sits on the ground point, shifted to the middle of the footprint.
 */
export function contactShadow(
  footprint: Footprint,
  feet: { x: number; y: number },
  station: { x: number; y: number },
  scale: number,
): ContactShadow {
  const rx = Math.max(2, (footprint.width * scale * SHADOW_SPREAD) / 2);
  return {
    x: station.x + (footprint.centre - feet.x) * scale,
    y: station.y,
    rx,
    ry: Math.max(1.5, rx * SHADOW_FLATNESS),
  };
}

/** The shadow colour at a share of full strength. Full strength is 0.32. */
export function shadowColor(strength: number): string {
  const share = Math.min(1, Math.max(0, strength));
  return `rgba(${SHADOW_RGB}, ${Math.round(SHADOW_ALPHA * share * 1000) / 1000})`;
}

/**
 * Units from the back lane to the front. A unit on a lower lane is drawn later, so it covers
 * the one behind it. Units on the same lane keep the order they were placed in.
 */
export function depthOrder<T extends { station: { y: number } }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.station.y - b.item.station.y || a.index - b.index)
    .map((entry) => entry.item);
}

/** Logical coordinate whose image under `dpr * viewScale` is a whole device pixel. */
export function snapDeviceOrigin(logical: number, dpr: number, viewScale: number): number {
  const span = dpr * viewScale;
  if (!(span > 0) || !Number.isFinite(logical)) {
    return logical;
  }
  return Math.round(logical * span) / span;
}

export interface FieldBlit {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a beat bitmap is copied.
 * A half bitmap at unit scale 1/2 and below is copied 1:1 (each reduced pixel covers `unitScale / 0.5` battle pixels).
 * Any other bitmap fills the logical stamp. A pixel picture's origin is snapped onto a whole device pixel.
 * A vector keeps the fractional place, so a march can slide instead of jumping a pixel at a time.
 */
export function fieldBlit(
  bitmap: { width: number; height: number },
  size: { width: number; height: number },
  ground: { x: number; y: number },
  station: { x: number; y: number },
  unitScale: number,
  viewScale: number,
  dpr: number,
  half: boolean,
  snap = true,
): FieldBlit {
  const stamp = nativeStamp(size, ground, station, unitScale);
  let width = stamp.width;
  let height = stamp.height;
  let x = stamp.x;
  let y = stamp.y;
  if (half && unitScale <= 0.5) {
    const cover = unitScale / 0.5;
    width = bitmap.width * cover;
    height = bitmap.height * cover;
    x = station.x - (ground.x / 2) * cover;
    y = station.y - (ground.y / 2) * cover;
  }
  return {
    x: snap ? snapDeviceOrigin(x, dpr, viewScale) : x,
    y: snap ? snapDeviceOrigin(y, dpr, viewScale) : y,
    width,
    height,
  };
}

function beatLuminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * A 2×2 reduction that keeps the pixel farthest from the block's mean luminance.
 * A block with no opaque pixel (alpha below 128) is left clear. Ties keep the darker pixel.
 */
export function downsampleBeatHalf(source: OffscreenCanvas): OffscreenCanvas {
  const sw = source.width;
  const sh = source.height;
  const dw = Math.max(1, Math.ceil(sw / 2));
  const dh = Math.max(1, Math.ceil(sh / 2));
  const srcCtx = source.getContext("2d", { willReadFrequently: true });
  const dest = new OffscreenCanvas(dw, dh);
  const destCtx = dest.getContext("2d");
  if (!srcCtx || !destCtx || sw < 1 || sh < 1) {
    return dest;
  }
  const src = srcCtx.getImageData(0, 0, sw, sh).data;
  const image = destCtx.createImageData(dw, dh);
  const out = image.data;
  for (let by = 0; by < dh; by += 1) {
    for (let bx = 0; bx < dw; bx += 1) {
      const samples: { r: number; g: number; b: number; a: number; L: number }[] = [];
      for (let oy = 0; oy < 2; oy += 1) {
        for (let ox = 0; ox < 2; ox += 1) {
          const x = bx * 2 + ox;
          const y = by * 2 + oy;
          if (x >= sw || y >= sh) {
            continue;
          }
          const i = (y * sw + x) * 4;
          const a = src[i + 3] ?? 0;
          if (a < 128) {
            continue;
          }
          const r = src[i] ?? 0;
          const g = src[i + 1] ?? 0;
          const b = src[i + 2] ?? 0;
          samples.push({ r, g, b, a, L: beatLuminance(r, g, b) });
        }
      }
      const o = (by * dw + bx) * 4;
      if (samples.length < 1) {
        out[o] = 0;
        out[o + 1] = 0;
        out[o + 2] = 0;
        out[o + 3] = 0;
        continue;
      }
      const mean = samples.reduce((sum, sample) => sum + sample.L, 0) / samples.length;
      let best = samples[0];
      let bestDev = best ? Math.abs(best.L - mean) : 0;
      for (let index = 1; index < samples.length; index += 1) {
        const sample = samples[index];
        if (!sample || !best) {
          continue;
        }
        const dev = Math.abs(sample.L - mean);
        const tied = Math.abs(dev - bestDev) <= 1e-6;
        if (dev > bestDev + 1e-6 || (tied && sample.L < best.L)) {
          best = sample;
          bestDev = dev;
        }
      }
      if (!best) {
        continue;
      }
      out[o] = best.r;
      out[o + 1] = best.g;
      out[o + 2] = best.b;
      out[o + 3] = best.a;
    }
  }
  destCtx.putImageData(image, 0, 0);
  return dest;
}

/** True when the point is inside the picture's rectangle, including its clear padding. */
export function stampHolds(stamp: { x: number; y: number; width: number; height: number }, point: { x: number; y: number }): boolean {
  return point.x >= stamp.x && point.y >= stamp.y && point.x < stamp.x + stamp.width && point.y < stamp.y + stamp.height;
}

/** A pointer position on the canvas, in battle pixels. `view` is the canvas on screen, which the zoom changes. */
export function boardPoint(local: { x: number; y: number }, view: { width: number; height: number }): { x: number; y: number } {
  const width = view.width > 0 ? view.width : BATTLE_BOARD.width;
  const height = view.height > 0 ? view.height : BATTLE_BOARD.height;
  return {
    x: (local.x / width) * BATTLE_BOARD.width,
    y: (local.y / height) * BATTLE_BOARD.height,
  };
}

/** The feet after a drag. `grab` is where the pointer sat relative to the feet when the drag began. */
export function draggedStation(grab: { x: number; y: number }, point: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.round(Math.min(BATTLE_BOARD.width, Math.max(0, point.x - grab.x))),
    y: Math.round(Math.min(BATTLE_BOARD.height, Math.max(0, point.y - grab.y))),
  };
}

/** Where one art pixel lands on the board. At scale 1 the next art pixel is the next battle pixel. */
export function battlePixel(stamp: NativeStamp, source: { x: number; y: number }): { x: number; y: number } {
  return { x: stamp.x + source.x * stamp.scale, y: stamp.y + source.y * stamp.scale };
}

/**
 * The plate stands to the right of the vector unit, on the same ground line.
 * Its left edge clears the vector's station by 24 battle pixels.
 */
export function besideStation(vector: { x: number; y: number }, plateWidth: number): { x: number; y: number } {
  return { x: vector.x + Math.ceil(plateWidth / 2) + 24, y: vector.y };
}

export interface NativeBeat {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/** One beat, painted at the plate's own size. Empty cells stay clear. */
export function nativeBeatPixels(doc: UnitPaintDocument, beat: PlaybackBeat): NativeBeat {
  const grid = beatGrid(doc, beat);
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const mapping = FACTION_MILITARY_MAPPINGS[doc.blueprint.factionId];
  for (let y = 0; y < height; y += 1) {
    const row = grid[y] ?? [];
    for (let x = 0; x < width; x += 1) {
      const slot = row[x];
      if (slot == null) {
        continue;
      }
      const rgb = Number.parseInt(slotHex(mapping, slot).slice(1), 16);
      const offset = (y * width + x) * 4;
      rgba[offset] = (rgb >> 16) & 255;
      rgba[offset + 1] = (rgb >> 8) & 255;
      rgba[offset + 2] = rgb & 255;
      rgba[offset + 3] = 255;
    }
  }
  return { width, height, rgba };
}

/** A living attacker the battle drawer can paint. Recoil and the march are set for the beat on show. */
export function vectorStandIn(unitType: UnitType, recoil: number, marching: boolean): CombatUnit {
  return {
    uid: "native-compare",
    type: unitType,
    side: "attacker",
    currentHp: 1,
    maxHp: 1,
    effectiveRank: 1,
    hasSynergyBonus: false,
    hasFiredThisRound: false,
    isPendingCasualty: false,
    isDestroyed: false,
    status: "alive",
    animRecoil: recoil,
    animBobOffset: 0.4,
    animAnticipation: 0,
    animAimTilt: 0,
    animRevEngine: 0,
    damageSmokeParticles: false,
    colIndex: 0,
    rowIndex: COMPARE_ROW,
    isMarching: marching,
  };
}

/**
 * Which frame of a walk to show. The walk plays in order and then starts again.
 * The shot still takes the first two ticks of every 16, the same ticks as a plate.
 * Those ticks are not walk frames. Counting them as walk frames skips the first two
 * pictures of an eight-frame cycle, so the last frame joins the third instead of the first.
 */
export function walkFrameAt(
  time: number,
  walkCount: number,
  fireCount: number,
): { clip: "walk" | "fire" | "idle"; index: number; firing: boolean; label: string } {
  const step = poseStep(time);
  if (fireCount > 0 && step % 16 < 2) {
    return { clip: "fire", index: 0, firing: true, label: "Firing" };
  }
  if (walkCount > 0) {
    const walkTicks = fireCount > 0 ? Math.floor(step / 16) * 14 + (step % 16) - 2 : step;
    const index = ((walkTicks % walkCount) + walkCount) % walkCount;
    return { clip: "walk", index, firing: false, label: `Walking ${index + 1}` };
  }
  return { clip: "idle", index: 0, firing: false, label: "Idle" };
}

/**
 * One frame of a clip played on its own. The frame after the last one is the first.
 * Marching uses `walkFrameAt` instead, so the shot can take its two ticks.
 */
export function heldClipAt(
  time: number,
  count: number,
  clip: "idle" | "fire" | "damaged",
): { clip: "idle" | "fire" | "damaged"; index: number; firing: boolean; label: string } {
  const index = count > 0 ? ((poseStep(time) % count) + count) % count : 0;
  const title = clip === "fire" ? "Firing" : clip === "damaged" ? "Falling" : "Idle";
  return { clip, index, firing: clip === "fire", label: count > 1 ? `${title} ${index + 1}` : title };
}

/**
 * Picture-pixels per second on a march.
 * The old pace was one pixel for each walk frame that was shown. Fourteen of every sixteen
 * pose ticks are walk frames. This is that pace, a fifth quicker, and it does not wait for the frame.
 */
export const MARCH_PIXELS_PER_SECOND = (POSE_FPS * 14 * 1.2) / 16;

/** How far a march travels in `seconds`, in picture-pixels. */
export function marchDistance(seconds: number): number {
  if (!(seconds > 0)) {
    return 0;
  }
  return seconds * MARCH_PIXELS_PER_SECOND;
}

/** The bottom row of opaque pixels, halfway between the outer ones. */
export function opaqueFeet(rgba: Uint8ClampedArray, width: number, height: number): { x: number; y: number } {
  for (let y = height - 1; y >= 0; y -= 1) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x += 1) {
      if ((rgba[(y * width + x) * 4 + 3] ?? 0) >= 128) {
        if (left < 0) {
          left = x;
        }
        right = x;
      }
    }
    if (left >= 0) {
      return { x: Math.round((left + right) / 2), y };
    }
  }
  return { x: Math.floor(width / 2), y: Math.max(0, height - 1) };
}

/** The name a batch picture gets in the sprite menu. */
export function pictureLabel(row: { factionId: string; unitTypeId: string; seed?: number; grade?: string }): string {
  const type = UNIT_TYPE_LABEL[row.unitTypeId] ?? row.unitTypeId;
  const seed = typeof row.seed === "number" ? ` ${row.seed}` : "";
  const grade = row.grade === "outlined" ? ", outlines" : "";
  return `${row.factionId} ${type}${seed}${grade}`;
}
