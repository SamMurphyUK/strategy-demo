// Where the region roundels stand, and how big they are at a zoom. Pure.
//
// Every land territory with an IPC value gets one flat roundel of its owner's faction, set just under the size of an
// infantry base and kept under whatever stands on it. A territory with no IPC value has none. Each has the key
// `roundel:<territory>`, so the placement editor can move, resize, turn and lock it like a landmark (see placements.ts).
import { type RoundelId, roundelFor } from "../../components/ui/RoundelBadge";
import type { RegionShape } from "../map/geometry";
import type { BoardFrame } from "../map/boardLayer";
import { applyEdit, type Placements } from "./placements";
import { plinthRadius } from "./plinthPlacement";
import type { PropInstance } from "./propPlan";

/** The edit scale a roundel starts at. An edit multiplies it, so 1.5x the roundel reads as 1.5 x this. */
export const ROUNDEL_REF = 5;
/** Just under an infantry base's width: the share of it a roundel takes at the shipped setting. */
export const ROUNDEL_SHARE = 0.82;

export interface PlacedRoundel {
  key: string;
  regionId: string;
  /** The editor's name for it. */
  label: string;
  /** Which roundel art it wears: its owner's. */
  roundel: RoundelId;
  /** Where it stands, in map coordinates. `scale` is ROUNDEL_REF times the edit's size. */
  instance: PropInstance;
}

export function roundelKey(regionId: string): string {
  return `roundel:${regionId}`;
}

/** Whether a territory carries a roundel: land, with an IPC value. */
export function hasRoundel(region: Pick<RegionShape, "type" | "ipc">): boolean {
  return region.type === "land" && region.ipc > 0;
}

/** The roundels of a map, in territory order, each in its owner's colours and with its edit applied. */
export function placeRoundels(
  regions: readonly RegionShape[],
  ownerOf: (regionId: string) => string | undefined,
  placements: Placements,
): PlacedRoundel[] {
  const placed: PlacedRoundel[] = [];
  for (const region of regions) {
    if (!hasRoundel(region)) {
      continue;
    }
    const key = roundelKey(region.id);
    const base: PropInstance = {
      x: region.anchor.x,
      y: region.anchor.y,
      scale: ROUNDEL_REF,
      height: ROUNDEL_REF,
      turn: 0,
      tint: [1, 1, 1],
      snow: 0,
    };
    placed.push({
      key,
      regionId: region.id,
      label: `Roundel, ${region.id}`,
      roundel: roundelFor(ownerOf(region.id)),
      instance: applyEdit(base, placements[key]),
    });
  }
  return placed;
}

/** What the instanced meshes of one roundel art are written into. */
export interface RoundelBuffer {
  /** Sixteen numbers each, column-major. */
  matrices: Float32Array;
  /** Two each: the range's two shapes under the disc (see mountainRelief.ts). */
  rises: Float32Array;
  count: number;
}

export function roundelBuffer(capacity: number): RoundelBuffer {
  return { matrices: new Float32Array(capacity * 16), rises: new Float32Array(capacity * 2), count: 0 };
}

export interface RoundelLook {
  /** Height of the disc against its radius. */
  heightRatio: number;
  /** How much of an infantry base's width it takes. */
  share: number;
}

/** A roundel's radius in world units at a zoom: the infantry base's, times the share, times the edit's size. */
export function roundelRadius(tokenPx: number, k: number, share: number, instanceScale: number): number {
  const infantry = plinthRadius(tokenPx, k, 1, { pair: 1, crowd: 1, vehicleRadius: 1 }, "infantry");
  return infantry * share * (instanceScale / ROUNDEL_REF);
}

/**
 * Writes every roundel into the buffer of its art and returns the buffers' counts. `riseAt` reads the sculpted ranges, so a
 * disc on one stands on it, and `dropAt` how far an island's ground has been lowered. A disc is lifted a hair so it never fights the ground.
 */
export function writeRoundels(
  buffers: ReadonlyMap<RoundelId, RoundelBuffer>,
  roundels: readonly PlacedRoundel[],
  frame: Pick<BoardFrame, "view" | "tokenPx">,
  look: RoundelLook,
  riseAt: (x: number, y: number) => { dome: number; ridge: number },
  dropAt?: (x: number, y: number) => number,
): void {
  for (const buffer of buffers.values()) {
    buffer.count = 0;
  }
  for (const item of roundels) {
    const buffer = buffers.get(item.roundel);
    if (!buffer || buffer.count * 16 >= buffer.matrices.length) {
      continue;
    }
    const { instance } = item;
    const radius = roundelRadius(frame.tokenPx, frame.view.k, look.share, instance.scale);
    const cos = Math.cos(instance.turn) * radius;
    const sin = Math.sin(instance.turn) * radius;
    const m = buffer.count * 16;
    buffer.matrices.fill(0, m, m + 16);
    buffer.matrices[m] = cos;
    buffer.matrices[m + 1] = sin;
    buffer.matrices[m + 4] = -sin;
    buffer.matrices[m + 5] = cos;
    buffer.matrices[m + 10] = radius * look.heightRatio;
    buffer.matrices[m + 12] = instance.x;
    buffer.matrices[m + 13] = -instance.y;
    buffer.matrices[m + 14] = -(dropAt?.(instance.x, instance.y) ?? 0) + (instance.lift ?? 0) + 0.01;
    buffer.matrices[m + 15] = 1;
    const under = riseAt(instance.x, instance.y);
    buffer.rises[buffer.count * 2] = under.dome;
    buffer.rises[buffer.count * 2 + 1] = under.ridge;
    buffer.count += 1;
  }
}
