/**
 * One picture for a clip folder: an SVG image at the size the caller asks for.
 * The battle and the zoomed map both build these and hand them to the same stage.
 */

import type { VehicleSvgUnit } from "./fieldVehicleStage";
import type { QuickClipRef } from "./quickUnitCatalog";

export interface QuickSvgPlacement {
  id: string;
  clip: QuickClipRef;
  href: string;
  /** Feet, in the same pixels as the stage viewBox. */
  x: number;
  y: number;
  /** CSS pixels (or board pixels) per sprite pixel. */
  unitScale: number;
  face?: 1 | -1;
  turnDeg?: number;
  /** Sprite-pixel shift of the picture before it is scaled. Defaults to the feet. */
  rootX?: number;
  rootY?: number;
}

export function quickSvgFigure(place: QuickSvgPlacement): VehicleSvgUnit {
  return {
    id: place.id,
    x: place.x,
    y: place.y,
    unitScale: place.unitScale,
    rootX: place.rootX ?? -place.clip.feet.x,
    rootY: place.rootY ?? -place.clip.feet.y,
    face: place.face ?? 1,
    turnDeg: place.turnDeg ?? 0,
    parts: [
      {
        role: "torso",
        href: place.href,
        x: 0,
        y: 0,
        width: place.clip.width,
        height: place.clip.height,
        resolution: place.clip.resolution,
      },
    ],
  };
}

let recording = false;
let recorded: VehicleSvgUnit[] = [];

/** The battle frame records figures here instead of rasterizing them into the board. */
export function beginQuickFigures(): void {
  recording = true;
  recorded = [];
}

export function quickFiguresOpen(): boolean {
  return recording;
}

export function pushQuickFigure(unit: VehicleSvgUnit): void {
  if (recording) {
    recorded.push(unit);
  }
}

export function takeQuickFigures(): VehicleSvgUnit[] {
  recording = false;
  const frame = recorded;
  recorded = [];
  return frame;
}
