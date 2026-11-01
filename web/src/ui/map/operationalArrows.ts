// Operational arrows for a movement phase. Pure geometry: the canvas only fills the polygons.
//
// Each order approaches its target along the last border it crosses. Origins within 95° share one
// master arrow, and a target never grows a fourth. Tributaries meet the trunk between 20% and 65%
// of its length, tangent to the shaft, so the head stays a single point.
import type { Vec2 } from "./geometry";
import { TOKEN_WORLD } from "./unitSlots";
import { type View, worldToScreen, worldTokenPx } from "./viewMath";

export const APPROACH_GAP = (95 * Math.PI) / 180;
export const MAX_MASTER_ARROWS = 3;
export const JOIN_T_MIN = 0.2;
export const JOIN_T_MAX = 0.65;

export const ARROW_INK = "#4B3D44";
export const COMBAT_ARROW = "#9C524E";
export const ARROW_BRASS = "#AAA25D";
export const NONCOMBAT_ARROW = "#CCA87B";

const TAU = Math.PI * 2;
const BASE_NECK_PX = 10;
const HEAD_PX = 16;
const CASING_PX = 3;
/** Attacking ribbons are a third thinner than a noncombat move. */
export const ATTACK_WIDTH = 2 / 3;
/** A source this close to the trunk is already on it, so it does not grow a second ribbon. */
const ON_TRUNK = 2;

/** The sword badge at full token size: 44×22, the combat marker's original box. */
const BADGE_W = 44;
const BADGE_H = 22;
const TOKEN_PX = 32;

/** How large the sword badge is, relative to its size beside a full-size token. */
export function battleBadgeScale(viewK: number): number {
  return worldTokenPx(viewK, TOKEN_WORLD) / TOKEN_PX;
}

/** Half-diagonal of the sword badge, in screen pixels. It shrinks with the map. */
export function battleIconRadius(viewK: number): number {
  const scale = battleBadgeScale(viewK);
  return Math.hypot((BADGE_W / 2) * scale, (BADGE_H / 2) * scale);
}

/** Screen-pixel half extents of the sword badge at this zoom. */
export function battleBadgeHalf(viewK: number): { halfW: number; halfH: number } {
  const scale = battleBadgeScale(viewK);
  return { halfW: (BADGE_W / 2) * scale, halfH: (BADGE_H / 2) * scale };
}

/** Half the tail width, in screen pixels, so a shaft can start clear of the yellow ring. */
export function shaftClearancePx(widthScale: number): number {
  return (BASE_NECK_PX * 2.2 * widthScale) / 2;
}

export interface OperationalOrder {
  id: string;
  fromRegionId: string;
  toRegionId: string;
  path: readonly number[];
  faction: string;
  unitType?: string;
  shipInstanceIds?: readonly string[];
  /** How many units this order sends. The battle badge adds these up. */
  count?: number;
  /** Combat move into a hostile region: the arrow leaves the unit and ends on the battle icon. */
  attack?: boolean;
}

/** Where an attacking stack is standing, and how far the shaft should step off it. */
export interface ArrowStart {
  at: Vec2;
  clearance: number;
}

export interface AngleMember<T> {
  angle: number;
  item: T;
}

export interface AngleCluster<T> {
  members: AngleMember<T>[];
  /** Circular mean, in radians. */
  mean: number;
}

export interface Spine {
  at(t: number): Vec2;
  tangent(t: number): Vec2;
  /** Closest point on the spine. `t` is arc length, 0 at the source and 1 at the tip. */
  project(point: Vec2): { t: number; distance: number };
}

export interface PlannedTributary {
  sourceId: string;
  joinT: number;
  source: Vec2;
  join: Vec2;
  tangent: Vec2;
  c1: Vec2;
  c2: Vec2;
  spine: Spine;
}

export interface PlannedArrow {
  targetId: string;
  faction: string;
  mean: number;
  /** Approach-origin region ids, in cluster order. */
  originIds: string[];
  spine: Spine;
  neckScale: number;
  tip: Vec2;
  target: Vec2;
  /** This arrow ends on a battle icon. */
  battle: boolean;
  tributaries: PlannedTributary[];
}

export function operationalFill(phase: string): string | null {
  if (phase === "combat_move") {
    return COMBAT_ARROW;
  }
  if (phase === "noncombat_move") {
    return NONCOMBAT_ARROW;
  }
  return null;
}

/** +12% of neck width for each merged tributary, and never more than one and a half. */
export function neckScaleFor(tributaryCount: number): number {
  return Math.min(1.5, 1 + 0.12 * Math.max(0, tributaryCount));
}

function wrapAngle(angle: number): number {
  const turned = angle % TAU;
  return turned < 0 ? turned + TAU : turned;
}

function gapForward(from: number, to: number): number {
  return (wrapAngle(to) - wrapAngle(from) + TAU) % TAU;
}

function circularMean(angles: number[]): number {
  let sin = 0;
  let cos = 0;
  for (const angle of angles) {
    sin += Math.sin(angle);
    cos += Math.cos(angle);
  }
  return Math.atan2(sin, cos);
}

function angularDistance(a: number, b: number): number {
  const delta = Math.abs(wrapAngle(a) - wrapAngle(b));
  return Math.min(delta, TAU - delta);
}

/**
 * Group approach angles around a target. Neighbours closer than `gap` share a cluster, including
 * across 0°. More than `maxClusters` collapses by merging the tightest remaining pair.
 */
export function clusterApproachAngles<T>(
  members: AngleMember<T>[],
  gap = APPROACH_GAP,
  maxClusters = MAX_MASTER_ARROWS,
): AngleCluster<T>[] {
  if (members.length === 0) {
    return [];
  }
  const sorted = [...members].sort((a, b) => wrapAngle(a.angle) - wrapAngle(b.angle));
  if (sorted.length === 1) {
    return [{ members: sorted, mean: circularMean([sorted[0].angle]) }];
  }

  const gaps = sorted.map((member, index) => gapForward(member.angle, sorted[(index + 1) % sorted.length].angle));
  let start = 0;
  for (let i = 0; i < gaps.length; i++) {
    if (gaps[i] >= gap) {
      start = (i + 1) % sorted.length;
      break;
    }
  }

  const clusters: AngleMember<T>[][] = [];
  let current: AngleMember<T>[] = [];
  for (let step = 0; step < sorted.length; step++) {
    const index = (start + step) % sorted.length;
    if (step > 0 && gaps[(index - 1 + sorted.length) % sorted.length] >= gap) {
      clusters.push(current);
      current = [];
    }
    current.push(sorted[index]);
  }
  if (current.length > 0) {
    clusters.push(current);
  }

  while (clusters.length > maxClusters) {
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      const from = clusters[i][clusters[i].length - 1];
      const to = clusters[(i + 1) % clusters.length][0];
      const opening = gapForward(from.angle, to.angle);
      if (opening < bestGap) {
        bestGap = opening;
        best = i;
      }
    }
    const next = (best + 1) % clusters.length;
    const merged = clusters[best].concat(clusters[next]);
    if (next > best) {
      clusters.splice(next, 1);
      clusters.splice(best, 1, merged);
    } else {
      clusters.splice(best, 1);
      clusters.splice(next, 1, merged);
    }
  }

  return clusters.map((group) => ({ members: group, mean: circularMean(group.map((member) => member.angle)) }));
}

function dedupe(points: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const point of points) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(point.x - prev.x, point.y - prev.y) > 1e-4) {
      out.push(point);
    }
  }
  return out;
}

function polylineSpine(points: Vec2[]): Spine {
  const pts = points.length > 0 ? points : [{ x: 0, y: 0 }];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cum[cum.length - 1] || 1;
  const at = (t: number): Vec2 => {
    if (pts.length === 1) {
      return pts[0];
    }
    const dist = Math.min(1, Math.max(0, t)) * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < dist) {
      i += 1;
    }
    const span = cum[i] - cum[i - 1] || 1;
    const u = (dist - cum[i - 1]) / span;
    return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * u };
  };
  return {
    at,
    tangent(t: number): Vec2 {
      const a = at(Math.max(0, t - 0.008));
      const b = at(Math.min(1, t + 0.008));
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    },
    project(point: Vec2): { t: number; distance: number } {
      if (pts.length < 2) {
        return { t: 0, distance: Math.hypot(point.x - pts[0].x, point.y - pts[0].y) };
      }
      let bestD = Infinity;
      let bestLen = 0;
      for (let i = 1; i < pts.length; i++) {
        const ax = pts[i - 1].x;
        const ay = pts[i - 1].y;
        const dx = pts[i].x - ax;
        const dy = pts[i].y - ay;
        const len2 = dx * dx + dy * dy || 1;
        const u = Math.min(1, Math.max(0, ((point.x - ax) * dx + (point.y - ay) * dy) / len2));
        const px = ax + dx * u;
        const py = ay + dy * u;
        const d = (px - point.x) ** 2 + (py - point.y) ** 2;
        if (d < bestD) {
          bestD = d;
          bestLen = cum[i - 1] + Math.hypot(px - ax, py - ay);
        }
      }
      return { t: bestLen / total, distance: Math.sqrt(bestD) };
    },
  };
}

function cubicPoint(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * p0.x + 3 * uu * t * c1.x + 3 * u * tt * c2.x + tt * t * p3.x,
    y: uu * u * p0.y + 3 * uu * t * c1.y + 3 * u * tt * c2.y + tt * t * p3.y,
  };
}

export function cubicSpine(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2): Spine {
  const steps = 32;
  const points: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    points.push(cubicPoint(p0, c1, c2, p3, i / steps));
  }
  return polylineSpine(points);
}

/** A cubic (or a straight cubic) through the waypoints, arc-length parameterized from 0 to 1. */
export function spineThrough(points: Vec2[]): Spine {
  const clean = dedupe(points);
  if (clean.length <= 1) {
    return polylineSpine(clean);
  }
  if (clean.length === 2) {
    const p0 = clean[0];
    const p3 = clean[1];
    return cubicSpine(
      p0,
      { x: p0.x + (p3.x - p0.x) / 3, y: p0.y + (p3.y - p0.y) / 3 },
      { x: p0.x + (2 * (p3.x - p0.x)) / 3, y: p0.y + (2 * (p3.y - p0.y)) / 3 },
      p3,
    );
  }
  const samples: Vec2[] = [];
  const steps = 12;
  for (let i = 0; i < clean.length - 1; i++) {
    const p0 = clean[Math.max(0, i - 1)];
    const p1 = clean[i];
    const p2 = clean[i + 1];
    const p3 = clean[Math.min(clean.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    for (let s = 0; s < steps; s++) {
      samples.push(cubicPoint(p1, c1, c2, p2, s / steps));
    }
  }
  samples.push(clean[clean.length - 1]);
  return polylineSpine(samples);
}

/** The region the order actually enters from: the last border on a multi-hop path, otherwise the origin. */
export function approachOriginId(order: OperationalOrder, regionIds: readonly string[]): string {
  if (order.path.length > 2) {
    const id = regionIds[order.path[order.path.length - 2]];
    if (id) {
      return id;
    }
  }
  return order.fromRegionId;
}

/** Join parameter for a tributary. The raw projection is forced into [0.20, 0.65]. */
export function tributaryJoinT(spine: Spine, source: Vec2): number {
  return Math.min(JOIN_T_MAX, Math.max(JOIN_T_MIN, spine.project(source).t));
}

/** Cubic controls whose arrival (C2 → join) lies on the trunk tangent. */
export function tributaryHandles(source: Vec2, join: Vec2, tangent: Vec2): { c1: Vec2; c2: Vec2 } {
  const dist = Math.hypot(join.x - source.x, join.y - source.y);
  const handle = Math.max(dist * 0.35, 1e-6);
  const c2 = { x: join.x - tangent.x * handle, y: join.y - tangent.y * handle };
  const c1 = { x: source.x + (c2.x - source.x) * 0.5, y: source.y + (c2.y - source.y) * 0.5 };
  return { c1, c2 };
}

interface Approach {
  order: OperationalOrder;
  originId: string;
  angle: number;
}

function tipToward(target: Vec2, from: Vec2, inset: number): Vec2 {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    return { x: target.x, y: target.y };
  }
  const pull = Math.min(Math.max(0, inset), len * 0.4);
  return { x: target.x - (dx / len) * pull, y: target.y - (dy / len) * pull };
}

function depart(from: Vec2, toward: Vec2, clearance: number): Vec2 {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6 || clearance <= 0) {
    return from;
  }
  const step = Math.min(clearance, len * 0.35);
  return { x: from.x + (dx / len) * step, y: from.y + (dy / len) * step };
}

function waypoints(
  order: OperationalOrder,
  regionIds: readonly string[],
  anchors: ReadonlyMap<string, Vec2>,
  tip: Vec2,
  start?: ArrowStart,
): Vec2[] {
  const ids: string[] = [];
  if (order.path.length >= 2) {
    for (const index of order.path) {
      const id = regionIds[index];
      if (id) {
        ids.push(id);
      }
    }
  }
  if (ids.length < 2) {
    ids.length = 0;
    ids.push(order.fromRegionId, order.toRegionId);
  }
  const points: Vec2[] = [];
  for (let i = 0; i < ids.length - 1; i++) {
    const point = anchors.get(ids[i]);
    if (point) {
      points.push(point);
    }
  }
  points.push(tip);
  if (start && points.length > 1) {
    points[0] = depart(start.at, points[1], start.clearance);
  }
  return points;
}

function preferApproach(current: Approach, next: Approach, mean: number): Approach {
  const here = angularDistance(current.angle, mean);
  const there = angularDistance(next.angle, mean);
  if (Math.abs(here - there) > 1e-6) {
    return here < there ? current : next;
  }
  if (current.order.path.length !== next.order.path.length) {
    return current.order.path.length > next.order.path.length ? current : next;
  }
  return current.order.id <= next.order.id ? current : next;
}

/**
 * One master arrow per cluster on each target. `tipInset` is how far, in world units, the head stops
 * short of the target anchor so it can sit on the battle-vector icon.
 */
export interface ArrowPlanOptions {
  /** Token positions of attacking stacks. The shaft leaves that point. */
  starts?: ReadonlyMap<string, ArrowStart>;
  /** Targets that receive a battle icon. Only those arrows stop short of the anchor. */
  battleTargets?: ReadonlySet<string>;
  /** Targets that receive a move icon. Those arrows stop short of the anchor too. */
  badgeTargets?: ReadonlySet<string>;
  /** Screen-pixel half extents of the sword badge, so the tip stops on its edge. */
  badge?: { halfW: number; halfH: number; viewK: number };
}

/** World distance from the target anchor to the badge edge, along the approach. */
function badgeEdgeInset(
  from: Vec2,
  target: Vec2,
  badge: { halfW: number; halfH: number; viewK: number },
): number {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6 || badge.viewK <= 0) {
    return 0;
  }
  const ax = Math.abs(dx / len);
  const ay = Math.abs(dy / len);
  const hitX = ax > 1e-8 ? badge.halfW / ax : Number.POSITIVE_INFINITY;
  const hitY = ay > 1e-8 ? badge.halfH / ay : Number.POSITIVE_INFINITY;
  return Math.min(hitX, hitY) / badge.viewK;
}

export function planOperationalArrows(
  orders: readonly OperationalOrder[],
  regionIds: readonly string[],
  anchors: ReadonlyMap<string, Vec2>,
  tipInset = 0,
  options?: ArrowPlanOptions,
): PlannedArrow[] {
  const grouped = new Map<string, Approach[]>();
  for (const order of orders) {
    const target = anchors.get(order.toRegionId);
    if (!target) {
      continue;
    }
    const originId = approachOriginId(order, regionIds);
    const origin = anchors.get(originId);
    if (!origin) {
      continue;
    }
    if (Math.hypot(target.x - origin.x, target.y - origin.y) < 1e-4) {
      continue;
    }
    const angle = Math.atan2(target.y - origin.y, target.x - origin.x);
    const list = grouped.get(order.toRegionId);
    const approach = { order, originId, angle };
    if (list) {
      list.push(approach);
    } else {
      grouped.set(order.toRegionId, [approach]);
    }
  }

  const planned: PlannedArrow[] = [];
  for (const [targetId, approaches] of grouped) {
    const target = anchors.get(targetId);
    if (!target) {
      continue;
    }
    const clusters = clusterApproachAngles(approaches.map((approach) => ({ angle: approach.angle, item: approach })));
    for (const cluster of clusters) {
      let primary = cluster.members[0].item;
      for (let i = 1; i < cluster.members.length; i++) {
        primary = preferApproach(primary, cluster.members[i].item, cluster.mean);
      }
      const origin = anchors.get(primary.originId);
      if (!origin) {
        continue;
      }
      const battle = options?.battleTargets ? options.battleTargets.has(targetId) : false;
      const marked = battle || (options?.badgeTargets?.has(targetId) ?? false);
      const badgeInset = marked && options?.badge ? badgeEdgeInset(origin, target, options.badge) : 0;
      const inset = badgeInset > 0 ? badgeInset : options?.battleTargets || options?.badgeTargets ? (marked ? tipInset : 0) : tipInset;
      const tip = tipToward(target, origin, inset);
      const spine = spineThrough(
        waypoints(primary.order, regionIds, anchors, tip, options?.starts?.get(primary.order.id)),
      );
      const tributaries: PlannedTributary[] = [];
      const seen = new Set<string>([primary.order.fromRegionId]);
      for (const member of cluster.members) {
        const sourceId = member.item.order.fromRegionId;
        if (member.item.order.id === primary.order.id || seen.has(sourceId)) {
          continue;
        }
        seen.add(sourceId);
        const start = options?.starts?.get(member.item.order.id);
        const source = start ? depart(start.at, target, start.clearance) : anchors.get(sourceId);
        if (!source) {
          continue;
        }
        const closest = spine.project(source);
        if (closest.distance < ON_TRUNK) {
          continue;
        }
        const joinT = tributaryJoinT(spine, source);
        const join = spine.at(joinT);
        const tangent = spine.tangent(joinT);
        const handles = tributaryHandles(source, join, tangent);
        tributaries.push({
          sourceId,
          joinT,
          source,
          join,
          tangent,
          c1: handles.c1,
          c2: handles.c2,
          spine: cubicSpine(source, handles.c1, handles.c2, join),
        });
      }
      planned.push({
        targetId,
        faction: primary.order.faction,
        mean: cluster.mean,
        originIds: cluster.members.map((member) => member.item.originId),
        spine,
        neckScale: neckScaleFor(tributaries.length),
        tip,
        target,
        battle,
        tributaries,
      });
    }
  }
  planned.sort((a, b) => (a.targetId === b.targetId ? a.mean - b.mean : a.targetId < b.targetId ? -1 : 1));
  return planned;
}

interface ScreenSample {
  t: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
}

function sampleScreen(spine: Spine, view: View, steps: number): ScreenSample[] {
  const out: ScreenSample[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const point = worldToScreen(view, spine.at(t));
    const tangent = spine.tangent(t);
    const len = Math.hypot(tangent.x, tangent.y) || 1;
    out.push({ t, x: point.x, y: point.y, nx: -tangent.y / len, ny: tangent.x / len });
  }
  return out;
}

function smooth(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
}

/** Tapered ribbons for one master arrow. `casing` widens every ribbon by the ink margin. */
export function arrowPolygons(arrow: PlannedArrow, view: View, casing: boolean, widthScale = 1): Vec2[][] {
  const extra = casing ? CASING_PX * widthScale : 0;
  const neck = BASE_NECK_PX * arrow.neckScale * widthScale + extra;
  const tail = BASE_NECK_PX * arrow.neckScale * 2.2 * widthScale + extra;
  const samples = sampleScreen(arrow.spine, view, 28);
  if (samples.length < 2) {
    return [];
  }
  let neckIndex = samples.length - 2;
  let back = HEAD_PX * widthScale;
  for (let i = samples.length - 1; i > 0; i--) {
    back -= Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
    neckIndex = i - 1;
    if (back <= 0) {
      break;
    }
  }
  neckIndex = Math.max(0, Math.min(neckIndex, samples.length - 2));
  const neckT = samples[neckIndex].t || 1;
  const widthAt = (t: number): number => {
    const u = neckT > 0 ? t / neckT : 1;
    return (tail + (neck - tail) * smooth(u)) / 2;
  };

  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let i = 0; i <= neckIndex; i++) {
    const sample = samples[i];
    const half = widthAt(sample.t);
    left.push({ x: sample.x + sample.nx * half, y: sample.y + sample.ny * half });
    right.push({ x: sample.x - sample.nx * half, y: sample.y - sample.ny * half });
  }
  const neckSample = samples[neckIndex];
  const tip = samples[samples.length - 1];
  const flare = (neck * 1.45) / 2;
  const polys: Vec2[][] = [
    [
      ...left,
      { x: neckSample.x + neckSample.nx * flare, y: neckSample.y + neckSample.ny * flare },
      { x: tip.x, y: tip.y },
      { x: neckSample.x - neckSample.nx * flare, y: neckSample.y - neckSample.ny * flare },
      ...right.reverse(),
    ],
  ];

  for (const tributary of arrow.tributaries) {
    const branch = sampleScreen(tributary.spine, view, 18);
    if (branch.length < 2) {
      continue;
    }
    const endWidth = widthAt(tributary.joinT);
    const startWidth = (tail * 0.72) / 2;
    const branchLeft: Vec2[] = [];
    const branchRight: Vec2[] = [];
    for (let i = 0; i < branch.length; i++) {
      const sample = branch[i];
      const half = startWidth + (endWidth - startWidth) * smooth(sample.t);
      branchLeft.push({ x: sample.x + sample.nx * half, y: sample.y + sample.ny * half });
      branchRight.push({ x: sample.x - sample.nx * half, y: sample.y - sample.ny * half });
    }
    polys.push([...branchLeft, ...branchRight.reverse()]);
  }
  return polys;
}
