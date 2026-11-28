// The pixel zoom tier's mark for a territory: its owner's roundel, a smaller GDP coin tucked under and to the side of it, and on a
// Victory City a red star. Pure geometry in screen px; the canvas drawing is in mapRenderer.ts.
//
//        ★            the star takes the first free spot round the roundel, so no unit token covers it
//      ( roundel )
//          ( 6 )      the coin peeks out from beneath the roundel, offset down and to the right
import type { Vec2 } from "./geometry";

export interface Disc {
  x: number;
  y: number;
  /** Diameter. */
  d: number;
}

export interface EmblemLayout {
  roundel: Disc;
  /** Drawn first, so the roundel lies over it. */
  coin: Disc;
  /** The star's centre and its outer diameter, or null on a territory that is not a Victory City. */
  star: Disc | null;
}

/** A unit token on the screen, as a circle. */
export interface TokenCircle {
  x: number;
  y: number;
  r: number;
}

/** The coin's diameter against the roundel's. */
export const COIN_SHARE = 0.52;
/** The star's against the roundel's. */
export const STAR_SHARE = 0.62;

function overlaps(a: Disc, circles: readonly TokenCircle[], pad: number): boolean {
  const reach = a.d / 2 + pad;
  return circles.some((c) => Math.hypot(c.x - a.x, c.y - a.y) < reach + c.r);
}

/**
 * Where the three marks sit round a centre. `ratio` is how much the ground is foreshortened by the camera's tilt (1 from straight
 * above, less as it tips): the coin's offset down the screen follows it, so it lies under the roundel the way a thing on the ground
 * would and never rides up into it. `tokens` are the unit tokens in the territory, which the star keeps clear of.
 */
export function emblemLayout(centre: Vec2, d: number, ratio: number, tokens: readonly TokenCircle[], victory: boolean): EmblemLayout {
  const tilt = Math.max(0.3, Math.min(1, ratio));
  const roundel: Disc = { x: centre.x, y: centre.y, d };
  const coinD = d * COIN_SHARE;
  const coin: Disc = { x: centre.x + d * 0.4, y: centre.y + d * 0.1 + d * 0.34 * tilt, d: coinD };
  if (!victory) {
    return { roundel, coin, star: null };
  }
  const starD = d * STAR_SHARE;
  // Round the roundel, starting above it and working out: north, the two shoulders, the west side, then clear of the unit tokens' cluster above.
  const spots: Vec2[] = [
    { x: 0, y: -d * 0.92 },
    { x: d * 0.78, y: -d * 0.74 },
    { x: -d * 0.78, y: -d * 0.74 },
    { x: -d * 0.92, y: -d * 0.05 },
    { x: 0, y: -d * 1.35 },
    { x: -d * 0.9, y: d * 0.55 },
  ];
  for (const spot of spots) {
    const star: Disc = { x: centre.x + spot.x, y: centre.y + spot.y, d: starD };
    if (!overlaps(star, tokens, 1) && Math.hypot(star.x - coin.x, star.y - coin.y) >= (starD + coinD) / 2) {
      return { roundel, coin, star };
    }
  }
  return { roundel, coin, star: { x: centre.x, y: centre.y - d * 0.92, d: starD } };
}

/** The five-pointed star's corners, one tip straight up. */
export function starPoints(cx: number, cy: number, outer: number): Vec2[] {
  const inner = outer * 0.382;
  const points: Vec2[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return points;
}
