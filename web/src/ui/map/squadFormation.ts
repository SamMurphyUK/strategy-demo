// Where the figures of a stack stand on a base of the board's own. Pure.
//
// The base is a disc, drawn on the board in its own perspective. Its inner faction ring is 0.62 of
// its radius, and every pair of boots or tracks must sit inside that ring, with none overhanging onto
// the grass. A stack of one stands at the middle. A pair stands on an echeloned diagonal, one behind
// and to the left, one in front and to the right, so the two read apart. Three or more stand in a
// tight wedge: one lead at the front and middle, two flanking behind it.
//
// Offsets are in pixels on the screen, from the centre of the base. `radiusPx` is the base's
// across-the-screen radius, `spread` the slider's scaling of the formation, and `ratio` the ground's
// squash (1 looking straight down, less as the camera tilts), which squashes the formation with the
// disc so it stays inside the ring as the ring is foreshortened.

export interface Spot {
  x: number;
  y: number;
}

/** The inner ring, as a share of the base's radius. */
export const INNER_RING = 0.62;
/** The most of the ring a figure's feet may reach: a share of the ring's radius, kept clear of the line. */
export const RING_ROOM = 0.8;

/** The formation as shares of the ring's radius across and down, for a stack of `count`. */
export function formationShares(count: number): Spot[] {
  if (count >= 3) {
    return [
      { x: -0.5, y: -0.36 },
      { x: 0.5, y: -0.36 },
      { x: 0, y: 0.46 },
    ];
  }
  if (count === 2) {
    return [
      { x: -0.42, y: -0.3 },
      { x: 0.42, y: 0.3 },
    ];
  }
  return [{ x: 0, y: 0 }];
}

/** The figures' places on the base, in pixels from its centre, back to front. */
export function formationOnBase(count: number, radiusPx: number, spread: number, ratio: number): Spot[] {
  const ring = radiusPx * INNER_RING;
  const squash = Math.min(1, Math.max(0.2, ratio));
  return formationShares(count).map((spot) => ({
    x: spot.x * ring * spread,
    y: spot.y * ring * spread * squash,
  }));
}

/** Whether a foot at `spot` lies inside the inner ring (an ellipse of the ring's radius and squash). */
export function insideRing(spot: Spot, radiusPx: number, ratio: number, room = RING_ROOM): boolean {
  const ring = radiusPx * INNER_RING * room;
  const squash = Math.min(1, Math.max(0.2, ratio));
  return (spot.x / ring) ** 2 + (spot.y / (ring * squash)) ** 2 <= 1;
}
