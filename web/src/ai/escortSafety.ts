import { canReturnAfter } from "../engine/air/air_fuel";
import type { GameState } from "../engine/model/game_state";
import type { UnitStackEntry } from "../engine/model/types";
import { classifyUnit } from "../engine/types/ruleset";
import { campaignRuleFlags, shouldRunEvaluator } from "./ruleFlags";

export interface EscortSafety {
  escortScore: number;
  incomingThreatScore: number;
  safe: boolean;
}

function remainingHp(state: GameState, entry: UnitStackEntry): number {
  const unit = state.unit_types[String(entry.unit_type_id ?? "")];
  const max = unit?.special?.takes_two_hits === true ? 2 : 1;
  const damage = Math.max(0, Math.trunc(Number(entry.damage ?? 0)));
  return Math.max(0, max - damage);
}

function bodies(state: GameState, entry: UnitStackEntry, attack: boolean): number {
  const unit = state.unit_types[String(entry.unit_type_id ?? "")];
  if (unit == null) {
    return 0;
  }
  const stat = attack ? unit.attack : unit.defense;
  const count = Math.max(0, Math.trunc(Number(entry.count ?? 0)));
  return count * Math.max(0, stat);
}

function seaWithin(state: GameState, origin: string, hops: number): string[] {
  const seen = new Set<string>([origin]);
  let ring = [origin];
  for (let step = 0; step < hops; step += 1) {
    const next: string[] = [];
    for (const current of ring) {
      for (const neighbor of state.getAdjacentRegions(current)) {
        if (seen.has(neighbor) || state.regions[neighbor]?.isSeaRegion() !== true) {
          continue;
        }
        seen.add(neighbor);
        next.push(neighbor);
      }
    }
    ring = next;
  }
  return [...seen];
}

function entryScore(state: GameState, entry: UnitStackEntry, attack: boolean, hpWeight: number): number {
  const count = Math.max(0, Math.trunc(Number(entry.count ?? 0)));
  return bodies(state, entry, attack) * 1.5 + remainingHp(state, entry) * count * hpWeight;
}

export function evaluateSeaZoneEscortSafety(state: GameState, factionId: string, seaId: string): EscortSafety {
  let escortScore = 0;
  let friendlySubs = 0;
  for (const entry of state.getUnitsInRegion(seaId)) {
    const owner = String(entry.faction_id ?? "");
    if (owner === "" || !state.sameTeam(owner, factionId)) {
      continue;
    }
    const kind = classifyUnit(String(entry.unit_type_id ?? ""));
    if (kind === "TRANSPORT") {
      continue;
    }
    if (kind === "SUBMARINE") {
      friendlySubs += Math.max(0, Math.trunc(Number(entry.count ?? 0)));
    }
    const sea = state.unit_types[String(entry.unit_type_id ?? "")]?.category === "sea";
    const air = state.unit_types[String(entry.unit_type_id ?? "")]?.category === "air";
    if (!sea && !air) {
      continue;
    }
    escortScore += entryScore(state, entry, false, 2);
  }
  const zone = new Set(seaWithin(state, seaId, 2));
  let incomingThreatScore = 0;
  let enemyDestroyers = 0;
  const airThreat: UnitStackEntry[] = [];
  for (const regionId of Object.keys(state.region_units)) {
    for (const entry of state.getUnitsInRegion(regionId)) {
      const owner = String(entry.faction_id ?? "");
      if (owner === "" || state.sameTeam(owner, factionId)) {
        continue;
      }
      const unit = state.unit_types[String(entry.unit_type_id ?? "")];
      if (unit == null || unit.movement <= 0) {
        continue;
      }
      const kind = classifyUnit(String(entry.unit_type_id ?? ""));
      if (unit.category === "sea") {
        if (!zone.has(regionId)) {
          continue;
        }
        if (kind === "DESTROYER") {
          enemyDestroyers += Math.max(0, Math.trunc(Number(entry.count ?? 0)));
        }
        incomingThreatScore += entryScore(state, entry, true, 1.5);
        continue;
      }
      if (unit.category === "air" && canReturnAfter(state, owner, String(entry.unit_type_id), regionId, seaId, 1)) {
        airThreat.push(entry);
      }
    }
  }
  const discountAir = friendlySubs > 0 && enemyDestroyers === 0;
  if (!discountAir) {
    for (const entry of airThreat) {
      incomingThreatScore += entryScore(state, entry, true, 1.5);
    }
  }
  const safe = incomingThreatScore === 0 || escortScore >= incomingThreatScore * 1.15;
  return { escortScore, incomingThreatScore, safe };
}

export function isPeacetimePower(state: GameState, factionId: string): boolean {
  const flags = campaignRuleFlags(state);
  if (!shouldRunEvaluator(flags, "mobilization")) {
    return false;
  }
  const id = factionId.trim().toLowerCase();
  if (id !== "united_states" && id !== "usa" && id !== "soviet_union" && id !== "ussr") {
    return false;
  }
  return state.warStatus[factionId] === "PEACETIME" && state.game_round <= 2;
}

function teamTuv(state: GameState, team: "axis" | "allies"): number {
  let total = 0;
  for (const entries of Object.values(state.region_units)) {
    for (const entry of entries ?? []) {
      const owner = String(entry.faction_id ?? "");
      if (state.factions[owner]?.team !== team) {
        continue;
      }
      const cost = Math.max(0, state.unit_types[String(entry.unit_type_id ?? "")]?.cost ?? 0);
      total += cost * Math.max(0, Math.trunc(Number(entry.count ?? 0)));
    }
  }
  return total;
}

export function shouldTriggerEarlyWar(state: GameState, factionId: string): boolean {
  if (!isPeacetimePower(state, factionId)) {
    return false;
  }
  const id = factionId.trim().toLowerCase();
  const allies = teamTuv(state, "allies");
  const axis = teamTuv(state, "axis");
  if (id === "united_states" || id === "usa") {
    const fallen = ["moscow", "london", "cairo"].some((regionId) => {
      const owner = state.regions[regionId]?.owner_faction_id ?? "";
      return owner !== "" && state.factions[owner]?.team === "axis";
    });
    if (fallen || (axis > 0 && allies < axis * 0.72)) {
      return true;
    }
    return false;
  }
  return false;
}

export function convoySnipeMultiplier(state: GameState, attackerId: string, seaId: string): number {
  const attacker = attackerId.trim().toLowerCase();
  if (attacker !== "japan" && attacker !== "jap" && attacker !== "germany" && attacker !== "ger") {
    return 1;
  }
  if (state.warStatus.united_states !== "PEACETIME" && state.warStatus.usa !== "PEACETIME") {
    return 1;
  }
  let loaded = 0;
  for (const transport of Object.values(state.transport_instances)) {
    if (String(transport.region_id ?? "") !== seaId) {
      continue;
    }
    const cargo = (transport.cargo ?? []).reduce((sum, line) => sum + Math.max(0, Math.trunc(Number(line.count ?? 0))), 0);
    if (cargo > 0) {
      loaded += 1;
    }
  }
  if (loaded < 2) {
    return 1;
  }
  const safety = evaluateSeaZoneEscortSafety(state, "united_states", seaId);
  if (safety.incomingThreatScore <= 0) {
    return 1;
  }
  return safety.escortScore < safety.incomingThreatScore * 0.75 ? 3 : 1;
}
