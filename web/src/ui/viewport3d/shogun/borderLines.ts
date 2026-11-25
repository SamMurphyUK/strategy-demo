// Which borders lie inside one faction's land, and border segments joined into long lines. Pure.
//
// A border between two territories of the same faction is drawn faint, so an empire reads as one
// landmass. Who is at war is the engine's answer and arrives as frontline segments; nothing here
// decides it.
import { type Seam, sharedEdges } from "../../map/mapBakeMath";
import type { MultiPolygon } from "../../map/regionClip";

export type Segment = [number, number, number, number];
export type Polyline = [number, number][];

export interface OwnedShape {
  owner: string;
  shape: MultiPolygon;
}

/** True for an owner that is a faction. Unowned, neutral, and independent land is no one's empire. */
export function isFactionOwner(owner: string | null | undefined): boolean {
  const id = String(owner ?? "").trim().toLowerCase();
  return id !== "" && id !== "neutral" && id !== "independent";
}

/** Borders shared by two territories of one faction, minus edges on the world's seam. */
export function friendlyBorders(shapes: readonly OwnedShape[], seam: Seam | null): Segment[] {
  const byOwner = new Map<string, MultiPolygon[]>();
  for (const item of shapes) {
    if (!isFactionOwner(item.owner)) {
      continue;
    }
    const owner = item.owner.trim().toLowerCase();
    const list = byOwner.get(owner);
    if (list) {
      list.push(item.shape);
    } else {
      byOwner.set(owner, [item.shape]);
    }
  }
  const out: Segment[] = [];
  for (const list of byOwner.values()) {
    if (list.length >= 2) {
      out.push(...sharedEdges(list, seam, 2));
    }
  }
  return out;
}

const KEY_EPS = 1e-3;

function pointKey(x: number, y: number): string {
  return `${Math.round(x / KEY_EPS)},${Math.round(y / KEY_EPS)}`;
}

/**
 * Joins segments that meet end to end into polylines, so a dash pattern runs along a border
 * without starting again at every vertex. A line stops where three or more segments meet. A closed
 * loop comes back with its first point repeated at the end.
 */
export function chainSegments(segments: readonly Segment[]): Polyline[] {
  const ends = new Map<string, number[]>();
  const note = (key: string, index: number) => {
    const list = ends.get(key);
    if (list) {
      list.push(index);
    } else {
      ends.set(key, [index]);
    }
  };
  const keys: [string, string][] = segments.map(([x1, y1, x2, y2], index) => {
    const a = pointKey(x1, y1);
    const b = pointKey(x2, y2);
    note(a, index);
    note(b, index);
    return [a, b];
  });
  const used = new Array<boolean>(segments.length).fill(false);
  const lines: Polyline[] = [];

  const walk = (start: number, fromKey: string): Polyline => {
    const line: Polyline = [];
    let index = start;
    let key = fromKey;
    for (let guard = 0; guard <= segments.length; guard++) {
      used[index] = true;
      const [x1, y1, x2, y2] = segments[index];
      const forward = keys[index][0] === key;
      if (line.length === 0) {
        line.push(forward ? [x1, y1] : [x2, y2]);
      }
      line.push(forward ? [x2, y2] : [x1, y1]);
      key = forward ? keys[index][1] : keys[index][0];
      const meeting = ends.get(key) ?? [];
      // Carry on only through a plain joint: exactly two segments, the other one unused.
      const next = meeting.length === 2 ? meeting.find((other) => other !== index && !used[other]) : undefined;
      if (next === undefined) {
        break;
      }
      index = next;
    }
    return line;
  };

  // Lines that have an end: start from a point where one segment, or three or more, meet.
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) {
      continue;
    }
    for (const key of keys[i]) {
      if (!used[i] && (ends.get(key) ?? []).length !== 2) {
        lines.push(walk(i, key));
      }
    }
  }
  // What is left is closed loops.
  for (let i = 0; i < segments.length; i++) {
    if (!used[i]) {
      lines.push(walk(i, keys[i][0]));
    }
  }
  return lines;
}
