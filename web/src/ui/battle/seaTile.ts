/** The sea is one repeating strip per colour. A frame scrolls that strip instead of painting every dash. */

export interface OceanWaveColors {
  tickA: string;
  tickB: string;
  foam: string;
}

export interface CoastalWaveColors {
  wave: string;
  foam: string;
}

interface Strip {
  canvas: HTMLCanvasElement;
  period: number;
  view: number;
}

const strips = new Map<string, Strip>();

/** Wrap a scroll into [0, period). */
export function loopOffset(shift: number, period: number): number {
  if (!(period > 0) || !Number.isFinite(shift)) return 0;
  const wrapped = shift % period;
  return wrapped < 0 ? wrapped + period : wrapped;
}

interface OceanRow {
  /** Dash offset, including the swell. */
  shift: number;
  /** Foam offset. The foam leads the dashes. */
  foam: number;
}

/**
 * Offsets of one open-ocean row. With the scroll off, time is ignored and the row keeps the shape it
 * has at the start of the cycle.
 */
export function oceanRow(time: number, y: number, swellScale: number, phase: number, animated: boolean): OceanRow {
  const t = animated ? time : 0;
  const swell = (Math.sin(t * 2.1 + y * 0.045 + phase) * 10 + Math.cos(t * 1.4 + y * 0.02 + phase) * 6) * swellScale;
  const speed = (14 + ((y * 7) % 18)) * swellScale;
  const scroll = (t * speed) % 44;
  return {shift: scroll + swell, foam: scroll * 1.2 + swell};
}

function repeatingStrip(
  key: string,
  viewWidth: number,
  period: number,
  height: number,
  paintCell: (ctx: CanvasRenderingContext2D, x: number) => void,
): Strip | null {
  const view = Math.max(1, Math.ceil(viewWidth));
  const fullKey = `${key}|${view}`;
  const hit = strips.get(fullKey);
  if (hit) return hit;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = view + period;
  canvas.height = height;
  const g = canvas.getContext("2d");
  if (!g) return null;
  for (let x = 0; x < canvas.width; x += period) paintCell(g, x);
  const strip: Strip = {canvas, period, view};
  strips.set(fullKey, strip);
  while (strips.size > 12) {
    const oldest = strips.keys().next().value;
    if (oldest === undefined) break;
    strips.delete(oldest);
  }
  return strip;
}

function blitStrip(ctx: CanvasRenderingContext2D, strip: Strip, shift: number, y: number): void {
  const sx = loopOffset(shift, strip.period);
  ctx.drawImage(strip.canvas, sx, 0, strip.view, strip.canvas.height, 0, y, strip.view, strip.canvas.height);
}

function dashStrip(color: string, parity: number, viewWidth: number): Strip | null {
  return repeatingStrip(`dash|${color}|${parity}`, viewWidth, 38, 4, (g, x) => {
    g.fillStyle = color;
    g.fillRect(x, 0, 14, 2);
    if ((Math.floor(x / 4) + parity) % 2 === 0) {
      g.fillRect(x + 2, 2, 2, 2);
      g.fillRect(x + 8, 2, 2, 2);
    }
  });
}

function foamStrip(color: string, viewWidth: number): Strip | null {
  return repeatingStrip(`foam|${color}`, viewWidth, 64, 3, (g, x) => {
    g.fillStyle = color;
    g.fillRect(x + 5, 0, 4, 1);
    g.fillRect(x + 3, 1, 8, 1);
  });
}

function coastWaveStrip(color: string, viewWidth: number): Strip | null {
  return repeatingStrip(`coast|${color}`, viewWidth, 36, 3, (g, x) => {
    g.fillStyle = color;
    g.fillRect(x, 0, 18, 3);
  });
}

function coastFoamStrip(color: string, viewWidth: number): Strip | null {
  return repeatingStrip(`coast-foam|${color}`, viewWidth, 48, 3, (g, x) => {
    g.fillStyle = color;
    g.fillRect(x + 3, 0, 4, 1);
    g.fillRect(x, 1, 10, 2);
  });
}

/** Open-ocean dashes and foam. One blit per row when a strip can be built, otherwise the old rectangles. */
export function drawOceanWaveRows(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  horizonY: number,
  time: number,
  swellScale: number,
  phase: number,
  colors: OceanWaveColors,
  animated: boolean,
): void {
  for (let y = horizonY + 6; y < height; y += 10) {
    const row = oceanRow(time, y, swellScale, phase, animated);
    const parity = Math.floor(y / 10);
    const color = parity % 2 === 0 ? colors.tickA : colors.tickB;
    const dash = dashStrip(color, parity, width);
    if (dash) {
      blitStrip(ctx, dash, row.shift - 50, y);
    } else {
      ctx.fillStyle = color;
      for (let x = -50; x < width + 50; x += 38) {
        const wx = Math.round(x + row.shift);
        ctx.fillRect(wx, y, 14, 2);
        if ((Math.floor(wx / 4) + parity) % 2 === 0) {
          ctx.fillRect(wx + 2, y + 2, 2, 2);
          ctx.fillRect(wx + 8, y + 2, 2, 2);
        }
      }
    }
    if (parity % 3 !== 0) continue;
    const foam = foamStrip(colors.foam, width);
    if (foam) {
      blitStrip(ctx, foam, row.foam - 30, y - 2);
    } else {
      ctx.fillStyle = colors.foam;
      for (let x = -30; x < width + 50; x += 64) {
        const fx = Math.round(x + row.foam);
        ctx.fillRect(fx + 3, y - 1, 8, 1);
        ctx.fillRect(fx + 5, y - 2, 4, 1);
      }
    }
  }
}

/** Coastal dashes. The scroll is the sine that used to move every rectangle. */
export function drawCoastalWaveRows(
  ctx: CanvasRenderingContext2D,
  width: number,
  seaTop: number,
  height: number,
  time: number,
  colors: CoastalWaveColors,
  animated: boolean,
): void {
  const t = animated ? time : 0;
  const wave = coastWaveStrip(colors.wave, width);
  for (let y = seaTop + 24; y < height; y += 22) {
    const waveShift = Math.sin(t * 1.8 + y * 0.08) * 16;
    if (wave) {
      blitStrip(ctx, wave, waveShift - 20, y);
    } else {
      ctx.fillStyle = colors.wave;
      for (let x = -20; x < width + 40; x += 36) ctx.fillRect(x + waveShift, y, 18, 3);
    }
  }
  const foam = coastFoamStrip(colors.foam, width);
  for (let y = seaTop + 34; y < height; y += 30) {
    const foamShift = Math.cos(t * 2.1 + y * 0.07) * 20;
    if (foam) {
      blitStrip(ctx, foam, foamShift + 10, y - 1);
    } else {
      ctx.fillStyle = colors.foam;
      for (let x = 10; x < width + 40; x += 48) {
        ctx.fillRect(x + foamShift, y, 10, 2);
        ctx.fillRect(x + foamShift + 3, y - 1, 4, 1);
      }
    }
  }
}
