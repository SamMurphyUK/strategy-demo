/**
 * Flat unit lighting without heightmaps: multiply sky ambient, then a soft sun/moon side glow.
 * Cut back to the sprite's own alpha so clear pixels stay clear.
 */

export type UnitLightRGB = readonly [number, number, number];

export interface UnitSkyLight {
  ambient: UnitLightRGB;
  /** Screen glows; k is strength 0–1. x is board space (only used to pick the lit side). */
  rims: readonly { x: number; color: UnitLightRGB; k: number }[];
  key: string;
}

function rgbStr(c: UnitLightRGB, a = 1): string {
  return a === 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

/** Strongest rim, or null when the sky is flat. */
function primaryRim(light: UnitSkyLight): { color: UnitLightRGB; k: number; x: number } | null {
  let best: { color: UnitLightRGB; k: number; x: number } | null = null;
  for (const rim of light.rims) {
    if (rim.k < 0.01) {
      continue;
    }
    if (!best || rim.k > best.k) {
      best = { color: rim.color, k: rim.k, x: rim.x };
    }
  }
  return best;
}

/**
 * Lights a drawn sprite into a fresh canvas. Caller draws the result with the same dest size.
 * `unitBoardX` picks whether the glow falls from the left or right of the unit.
 */
export function lightUnitSprite(
  source: CanvasImageSource,
  width: number,
  height: number,
  light: UnitSkyLight,
  unitBoardX: number,
): HTMLCanvasElement | null {
  if (typeof document === "undefined" || !(width > 0) || !(height > 0)) {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const g = canvas.getContext("2d");
  if (!g) {
    return null;
  }
  g.imageSmoothingEnabled = true;
  g.globalCompositeOperation = "copy";
  g.drawImage(source, 0, 0, canvas.width, canvas.height);
  g.globalCompositeOperation = "multiply";
  g.fillStyle = rgbStr(light.ambient);
  g.fillRect(0, 0, canvas.width, canvas.height);
  const rim = primaryRim(light);
  if (rim) {
    g.globalCompositeOperation = "screen";
    const fromLeft = rim.x < unitBoardX;
    const grad = g.createLinearGradient(fromLeft ? 0 : canvas.width, 0, fromLeft ? canvas.width : 0, canvas.height * 0.35);
    const k = Math.min(0.55, rim.k * 1.4);
    grad.addColorStop(0, `rgba(${rim.color[0]},${rim.color[1]},${rim.color[2]},${k})`);
    grad.addColorStop(0.55, `rgba(${rim.color[0]},${rim.color[1]},${rim.color[2]},${k * 0.35})`);
    grad.addColorStop(1, `rgba(${rim.color[0]},${rim.color[1]},${rim.color[2]},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, canvas.width, canvas.height);
  }
  g.globalCompositeOperation = "destination-in";
  g.drawImage(source, 0, 0, canvas.width, canvas.height);
  g.globalCompositeOperation = "source-over";
  return canvas;
}

/**
 * Lights whatever opaque pixels already sit in the local rect (procedural units).
 * Multiply ambient, then a soft side screen. Transparent stays transparent under multiply/screen.
 */
export function lightDrawnUnitRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  light: UnitSkyLight,
  unitBoardX: number,
): void {
  if (!(w > 0) || !(h > 0)) {
    return;
  }
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = rgbStr(light.ambient);
  ctx.fillRect(x, y, w, h);
  const rim = primaryRim(light);
  if (rim) {
    ctx.globalCompositeOperation = "screen";
    const fromLeft = rim.x < unitBoardX;
    const grad = ctx.createLinearGradient(fromLeft ? x : x + w, y, fromLeft ? x + w : x, y + h * 0.4);
    const k = Math.min(0.45, rim.k * 1.2);
    grad.addColorStop(0, `rgba(${rim.color[0]},${rim.color[1]},${rim.color[2]},${k})`);
    grad.addColorStop(0.5, `rgba(${rim.color[0]},${rim.color[1]},${rim.color[2]},${k * 0.3})`);
    grad.addColorStop(1, `rgba(${rim.color[0]},${rim.color[1]},${rim.color[2]},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}
