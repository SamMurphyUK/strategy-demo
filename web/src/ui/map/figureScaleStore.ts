import { clampFigureScale, DEFAULT_FIGURE_SCALE, figureClassOf, type FigureClass } from "./figureScale";

let scales: Record<FigureClass, number> = { ...DEFAULT_FIGURE_SCALE };
let rev = 0;
const listeners = new Set<() => void>();

function publish(): void {
  rev += 1;
  for (const listener of [...listeners]) {
    listener();
  }
}

export function getFigureScales(): Record<FigureClass, number> {
  return scales;
}

export function getFigureScale(unitType: string): number {
  return scales[figureClassOf(unitType)];
}

export function getFigureScaleRev(): number {
  return rev;
}

export function subscribeFigureScale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setFigureClassScale(cls: FigureClass, value: number): void {
  const next = clampFigureScale(value);
  if (scales[cls] === next) {
    return;
  }
  scales = { ...scales, [cls]: next };
  publish();
}

export function resetFigureScales(): void {
  scales = { ...DEFAULT_FIGURE_SCALE };
  publish();
}
