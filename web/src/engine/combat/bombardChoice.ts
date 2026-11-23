import { GameEvent, GameEventType } from "../model/event";
import type { GameState } from "../model/game_state";
import { classifyUnit } from "../types/ruleset";
import {
  preparatoryActive,
  runIndustrialBombing,
  runInterdiction,
  suppressionHitOn,
} from "../rules/optional/bombingResolver";
import { coverOf } from "../rules/optional/terrainResolver";

export const BOMBARD_TARGETS = ["factory", "airbase", "harbor", "URBAN", "FOREST"] as const;
export type BombardTarget = (typeof BOMBARD_TARGETS)[number];

export function bombardLabel(target: BombardTarget): string {
  switch (target) {
    case "factory":
      return "Factory";
    case "airbase":
      return "Airbase";
    case "harbor":
      return "Harbor";
    case "URBAN":
      return "City";
    case "FOREST":
      return "Wood";
  }
}

function isBombardTarget(value: string): value is BombardTarget {
  return (BOMBARD_TARGETS as readonly string[]).includes(value);
}

/** Targets this unit may bombard in a hostile region. Empty means the drop is only an attack. */
export function bombardTargets(
  state: GameState,
  factionId: string,
  regionId: string,
  unitTypeId: string,
): BombardTarget[] {
  const region = state.regions[regionId];
  if (region == null || !region.isLandRegion() || !state.isRegionHostileTo(regionId, factionId)) {
    return [];
  }
  const kind = classifyUnit(unitTypeId);
  const targets: BombardTarget[] = [];
  if (kind === "HEAVY_BOMBER" && (region.has_factory || region.major_factory)) {
    targets.push("factory");
  }
  if (state.rulesetConfig.facilitiesAndPatrols) {
    if ((kind === "HEAVY_BOMBER" || kind === "TACTICAL_BOMBER") && region.airbase) {
      targets.push("airbase");
    }
    if ((kind === "HEAVY_BOMBER" || kind === "TACTICAL_BOMBER") && region.harbor) {
      targets.push("harbor");
    }
  }
  if ((kind === "ARTILLERY" || kind === "HEAVY_BOMBER") && preparatoryActive(state, regionId)) {
    const cover = coverOf(state, regionId);
    if (cover === "URBAN" || cover === "FOREST") {
      targets.push(cover);
    }
  }
  return targets;
}

function sitOut(state: GameState, factionId: string, regionId: string, unitTypeId: string, count: number): void {
  const stay = Math.max(0, Math.trunc(count));
  if (stay <= 0) {
    return;
  }
  const key = state.movementStackKey(factionId, regionId, unitTypeId);
  state.bombardSatOut[key] = (state.bombardSatOut[key] ?? 0) + stay;
}

function takeFromStack(state: GameState, regionId: string, factionId: string, unitTypeId: string, count: number): void {
  let left = Math.max(0, Math.trunc(count));
  const units = state.region_units[regionId] ?? [];
  for (let i = units.length - 1; i >= 0 && left > 0; i--) {
    const entry = units[i];
    if (entry == null || entry.faction_id !== factionId || entry.instance_id || entry.unit_type_id !== unitTypeId) {
      continue;
    }
    const have = Math.max(0, Math.trunc(Number(entry.count ?? 0)));
    if (have > left) {
      entry.count = have - left;
      left = 0;
    } else {
      left -= have;
      units.splice(i, 1);
    }
  }
}

function dieFace(roll: () => number): number {
  const face = Math.trunc(roll());
  if (face < 1) {
    return 1;
  }
  return face > 6 ? 6 : face;
}

/**
 * Run every bombard order after the units have entered the territory and before any battle.
 * A unit that bombards sits out the fight.
 */
export function resolveOrderedBombardments(state: GameState, roll: () => number): GameEvent[] {
  const events: GameEvent[] = [];
  for (const order of state.phase_orders) {
    const target = order.bombard;
    if (target == null || !isBombardTarget(target)) {
      continue;
    }
    const count = Math.max(0, Math.trunc(order.count));
    if (count <= 0) {
      continue;
    }
    const factionId = order.faction;
    const regionId = order.toRegionId;
    const unitTypeId = order.unitType;
    if (target === "factory") {
      const region = state.regions[regionId];
      if (state.rulesetConfig.facilitiesAndPatrols && region?.major_factory) {
        const raid = runIndustrialBombing(state, factionId, regionId, 0, roll, count);
        if ("error" in raid) {
          continue;
        }
        sitOut(state, factionId, regionId, unitTypeId, count - raid.bomberLosses);
        events.push(
          GameEvent.create(GameEventType.INCOME_COLLECTED, {
            faction_id: factionId,
            amount: -raid.damage,
            reason: "strategic_bomb",
            region_id: regionId,
          }, 0),
        );
        continue;
      }
      if (region == null || (!region.has_factory && !region.major_factory)) {
        continue;
      }
      let damage = 0;
      for (let i = 0; i < count; i++) {
        damage += dieFace(roll);
      }
      if (region.owner_faction_id !== "") {
        state.modifyIpc(region.owner_faction_id, -damage);
      }
      sitOut(state, factionId, regionId, unitTypeId, count);
      events.push(
        GameEvent.create(GameEventType.INCOME_COLLECTED, {
          faction_id: factionId,
          amount: -damage,
          reason: "strategic_bomb",
          region_id: regionId,
        }, 0),
      );
      continue;
    }
    if (target === "airbase" || target === "harbor") {
      const kind = classifyUnit(unitTypeId) === "HEAVY_BOMBER" ? "HEAVY_BOMBER" : "TACTICAL_BOMBER";
      const raid = runInterdiction(state, factionId, regionId, target, roll, count, kind);
      if ("error" in raid) {
        continue;
      }
      sitOut(state, factionId, regionId, unitTypeId, count);
      events.push(
        GameEvent.create(GameEventType.INCOME_COLLECTED, {
          faction_id: factionId,
          amount: 0,
          reason: "tactical_interdiction",
          region_id: regionId,
          facility: target,
        }, 0),
      );
      continue;
    }
    if (!preparatoryActive(state, regionId) || coverOf(state, regionId) !== target) {
      continue;
    }
    const plane = classifyUnit(unitTypeId) === "HEAVY_BOMBER";
    let losses = 0;
    if (plane) {
      for (let i = 0; i < count; i++) {
        if (dieFace(roll) <= 1) {
          losses += 1;
        }
      }
      takeFromStack(state, regionId, factionId, unitTypeId, losses);
    }
    let suppressed = false;
    const rank = suppressionHitOn(target, unitTypeId);
    for (let i = 0; i < count - losses; i++) {
      if (dieFace(roll) <= rank) {
        suppressed = true;
      }
    }
    if (suppressed) {
      state.terrainSuppressed[regionId] = state.game_round;
    }
    sitOut(state, factionId, regionId, unitTypeId, count - losses);
    events.push(
      GameEvent.create(GameEventType.INCOME_COLLECTED, {
        faction_id: factionId,
        amount: 0,
        reason: "preparatory_bombardment",
        region_id: regionId,
        cover: target,
        suppressed,
      }, 0),
    );
  }
  return events;
}
