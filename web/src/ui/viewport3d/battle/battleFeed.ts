// The one-way feed from the battle screen to the 3D stage. The battle screen's own refs are read, never written:
// `snapshotOf` copies what the stage draws (who stands where in which lane, who fired, who is hurt) and `diffSnapshots` turns two
// snapshots into the events the stage plays. The stage cannot change a die, a hit point or a casualty. Pure.
import { isHeavyHit } from "./battleFx";
import type { Side } from "./battleLanes";

/** The fields of a battle unit the stage reads. `CombatUnit` satisfies it, so the screen passes its own units straight in. */
export interface FeedUnit {
  uid: string;
  type: string;
  side: Side;
  currentHp: number;
  maxHp: number;
  status: "alive" | "downed" | "dead";
  isDestroyed: boolean;
  hasFiredThisRound?: boolean;
  animRecoil?: number;
  fadeAlpha?: number;
  /** Set by a campaign promotion: the stage plays its star flash. Absent in the sandbox. */
  promoted?: boolean;
  effectiveRank?: number;
  colIndex?: number;
  rowIndex?: number;
  pairedWithUid?: string;
}

export interface StageUnit {
  uid: string;
  type: string;
  side: Side;
  hp: number;
  maxHp: number;
  alive: boolean;
  fade: number;
  fired: boolean;
  recoil: number;
  promoted: boolean;
  effectiveRank?: number;
  colIndex?: number;
  rowIndex?: number;
  pairedWithUid?: string;
}

export interface StageSnapshot {
  units: StageUnit[];
}

export type StageEvent =
  | { kind: "fire"; uid: string; side: Side; type: string }
  | { kind: "hit"; uid: string; side: Side; type: string; damage: number; destroyed: boolean; heavy: boolean }
  | { kind: "promotion"; uid: string; side: Side };

export function snapshotOf(units: readonly FeedUnit[]): StageSnapshot {
  return {
    units: units.map((u) => ({
      uid: u.uid,
      type: u.type,
      side: u.side,
      hp: u.currentHp,
      maxHp: u.maxHp,
      alive: u.status === "alive" && !u.isDestroyed,
      fade: u.fadeAlpha ?? 1,
      fired: Boolean(u.hasFiredThisRound),
      recoil: u.animRecoil ?? 0,
      promoted: Boolean(u.promoted),
      effectiveRank: u.effectiveRank,
      colIndex: u.colIndex,
      rowIndex: u.rowIndex,
      pairedWithUid: u.pairedWithUid,
    })),
  };
}

/** A recoil above this, reached from below it, is a shot. */
const RECOIL_SHOT = 0.3;

/** The events between two snapshots. A new unit raises none: it is the first time the stage has seen it. */
export function diffSnapshots(prev: StageSnapshot | null, next: StageSnapshot): StageEvent[] {
  const events: StageEvent[] = [];
  if (!prev) {
    return events;
  }
  const before = new Map(prev.units.map((u) => [u.uid, u]));
  for (const u of next.units) {
    const p = before.get(u.uid);
    if (!p) {
      continue;
    }
    if ((u.fired && !p.fired) || (u.recoil > RECOIL_SHOT && p.recoil <= RECOIL_SHOT)) {
      events.push({ kind: "fire", uid: u.uid, side: u.side, type: u.type });
    }
    const damage = Math.max(0, p.hp - u.hp);
    const destroyed = p.alive && !u.alive;
    if (damage > 0 || destroyed) {
      const dealt = Math.max(1, damage);
      events.push({ kind: "hit", uid: u.uid, side: u.side, type: u.type, damage: dealt, destroyed, heavy: isHeavyHit(u.type, dealt, destroyed) });
    }
    if (u.promoted && !p.promoted) {
      events.push({ kind: "promotion", uid: u.uid, side: u.side });
    }
  }
  return events;
}

/**
 * Picks the unit a shot is aimed at: a live unit of the other side, chosen from the shooter's and the step's own numbers so the same
 * snapshot always aims the same way. The frontline takes most of the fire; artillery and aircraft may reach the rear.
 */
export function pickTarget(snapshot: StageSnapshot, shooter: { uid: string; side: Side; type: string }, salt: number): StageUnit | null {
  const foes = snapshot.units.filter((u) => u.side !== shooter.side && u.alive);
  if (foes.length === 0) {
    return null;
  }
  const reach = shooter.type === "artillery" || shooter.type.includes("bomber") || shooter.type === "fighter";
  const pool = reach ? foes : foes.filter((u) => !(u.type === "artillery" || u.type === "aa" || u.type === "aaa" || u.type.includes("bomber") || u.type === "fighter"));
  const from = pool.length > 0 ? pool : foes;
  let h = salt >>> 0;
  for (let i = 0; i < shooter.uid.length; i++) {
    h = Math.imul(h ^ shooter.uid.charCodeAt(i), 16777619) >>> 0;
  }
  return from[h % from.length];
}
