import { plateDocument, type UnitPaintDocument } from "../../src/art/pixelPaint";
import type { BrushSlotKey, RosterFactionId } from "../../src/art/skeletonSchema";
import { FACTION_MILITARY_MAPPINGS } from "../../src/art/starterParts";
import { MILITARY } from "../../src/ui/theme/militaryPalette";

export interface Box {
  slot: BrushSlotKey;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A picture made of filled boxes in a faction's own colours, later boxes over earlier ones. */
export function boxPicture(factionId: RosterFactionId, width: number, height: number, boxes: readonly Box[]) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const mapping = FACTION_MILITARY_MAPPINGS[factionId];
  for (const box of boxes) {
    const rgb = Number.parseInt(MILITARY[mapping[box.slot]].slice(1), 16);
    for (let y = box.y; y < box.y + box.h; y += 1) {
      for (let x = box.x; x < box.x + box.w; x += 1) {
        const offset = (y * width + x) * 4;
        rgba[offset] = (rgb >> 16) & 255;
        rgba[offset + 1] = (rgb >> 8) & 255;
        rgba[offset + 2] = rgb & 255;
        rgba[offset + 3] = 255;
      }
    }
  }
  return { rgba, width, height };
}

/** The parts of the test tank, in picture pixels. The turret is drawn four rows into the hull. */
export const TANK_PARTS = {
  tracks: { slot: "metallic_brass_or_track", x: 6, y: 24, w: 96, h: 12 },
  hull: { slot: "primary_uniform_or_hull", x: 0, y: 12, w: 108, h: 12 },
  turret: { slot: "secondary_trim_or_webbing", x: 36, y: 0, w: 36, h: 16 },
  barrel: { slot: "wood_or_leather", x: 72, y: 3, w: 48, h: 3 },
} as const satisfies Record<string, Box>;

/** The pad plateDocument puts round a 120×36 picture: its rough divisor is 2. */
export const TANK_PAD = 16;

/** A 120×36 tank in four colours, opened as a plate. Everything is on the hull layer. */
export function tankPlate(factionId: RosterFactionId = "UK"): UnitPaintDocument {
  const picture = boxPicture(factionId, 120, 36, [TANK_PARTS.tracks, TANK_PARTS.hull, TANK_PARTS.turret, TANK_PARTS.barrel]);
  return plateDocument({ factionId, unitTypeId: "tank", ...picture });
}

/** A 140×20 slab of hull, opened as a destroyer. Its divisor is 2 and its pad is 16. */
export function shipPlate(factionId: RosterFactionId = "UK"): UnitPaintDocument {
  const picture = boxPicture(factionId, 140, 20, [{ slot: "primary_uniform_or_hull", x: 0, y: 0, w: 140, h: 20 }]);
  return plateDocument({ factionId, unitTypeId: "destroyer", ...picture });
}

/** A part's box on the plate canvas, as the two corners a box selection takes. */
export function partCorners(part: Box): [{ x: number; y: number }, { x: number; y: number }] {
  return [
    { x: part.x + TANK_PAD, y: part.y + TANK_PAD },
    { x: part.x + part.w - 1 + TANK_PAD, y: part.y + part.h - 1 + TANK_PAD },
  ];
}
