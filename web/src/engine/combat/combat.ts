import { GameEvent, GameEventType } from "../model/event";
import type { GameState } from "../model/game_state";
import type { UnitStackEntry } from "../model/types";
import type { Unit } from "../model/unit";
import type { PCG } from "../rng/pcg";

export interface Battle {
  region_id: string;
  attacker_faction_id: string;
  defender_faction_id: string;
  battle_type: "naval" | "land";
}

export const MAX_BATTLE_ROUNDS = 100;

export class CombatEngine {
  private _seq = 0;

  constructor(
    public state: GameState,
    public rng: PCG,
  ) {}

  setSequence(seq: number): void {
    this._seq = seq;
  }

  private nextSeq(): number {
    this._seq += 1;
    return this._seq;
  }

  resolveAllBattles(attackerFactionId: string): GameEvent[] {
    const events: GameEvent[] = [];
    for (const battle of this.identifyBattles(attackerFactionId)) {
      events.push(...this.resolveBattle(battle));
    }
    return events;
  }

  identifyBattles(attackerFactionId: string): Battle[] {
    const battles: Battle[] = [];
    const state = this.state;

    for (const regionId of Object.keys(state.region_units)) {
      const region = state.regions[regionId];
      if (region == null) {
        continue;
      }

      const attackerUnits = this.getCombatUnits(regionId, attackerFactionId);
      if (attackerUnits.length === 0) {
        continue;
      }

      let defenderFactionId = "";
      for (const unitEntry of state.region_units[regionId]) {
        if (unitEntry.faction_id !== attackerFactionId) {
          const u = state.unit_types[unitEntry.unit_type_id];
          if (u && this.isCombatUnit(u)) {
            defenderFactionId = unitEntry.faction_id;
            break;
          }
        }
      }

      if (defenderFactionId === "") {
        continue;
      }

      const defenderUnits = this.getCombatUnits(regionId, defenderFactionId);
      if (defenderUnits.length === 0) {
        continue;
      }

      battles.push({
        region_id: regionId,
        attacker_faction_id: attackerFactionId,
        defender_faction_id: defenderFactionId,
        battle_type: region.isSeaRegion() ? "naval" : "land",
      });
    }
    return battles;
  }

  private resolveBattle(battle: Battle): GameEvent[] {
    const events: GameEvent[] = [];
    const regionId = battle.region_id;
    const attackerId = battle.attacker_faction_id;
    const defenderId = battle.defender_faction_id;

    events.push(
      GameEvent.create(
        GameEventType.BATTLE_STARTED,
        { region_id: regionId, attacker: attackerId, defender: defenderId },
        this.nextSeq(),
      ),
    );

    let roundNum = 0;
    while (roundNum < MAX_BATTLE_ROUNDS) {
      roundNum += 1;

      const attackerUnits = this.getCombatUnits(regionId, attackerId);
      const defenderUnits = this.getCombatUnits(regionId, defenderId);
      if (attackerUnits.length === 0 || defenderUnits.length === 0) {
        break;
      }

      const attackerHits = this.rollHits(attackerUnits, true);
      const defenderHits = this.rollHits(defenderUnits, false);

      events.push(
        GameEvent.create(
          GameEventType.DICE_ROLLED,
          { region_id: regionId, round: roundNum, attacker_hits: attackerHits, defender_hits: defenderHits },
          this.nextSeq(),
        ),
      );

      this.applyCasualties(regionId, attackerId, defenderHits);
      this.applyCasualties(regionId, defenderId, attackerHits);
    }

    const remainingAttackers = this.getCombatUnits(regionId, attackerId);
    const remainingDefenders = this.getCombatUnits(regionId, defenderId);

    let result = "draw";
    if (remainingAttackers.length > 0 && remainingDefenders.length === 0) {
      result = "attacker_won";
      const region = this.state.regions[regionId];
      if (region.isLandRegion()) {
        region.owner_faction_id = attackerId;
      }
    } else if (remainingDefenders.length > 0 && remainingAttackers.length === 0) {
      result = "defender_won";
    } else if (remainingAttackers.length === 0 && remainingDefenders.length === 0) {
      result = "mutual_destruction";
    }

    events.push(
      GameEvent.create(
        GameEventType.BATTLE_FINISHED,
        { region_id: regionId, result, rounds: roundNum },
        this.nextSeq(),
      ),
    );
    return events;
  }

  getCombatUnits(regionId: string, factionId: string): UnitStackEntry[] {
    const combatUnits: UnitStackEntry[] = [];
    for (const unitEntry of this.state.region_units[regionId] ?? []) {
      if (unitEntry.faction_id !== factionId) {
        continue;
      }
      const u = this.state.unit_types[unitEntry.unit_type_id];
      if (u == null) {
        continue;
      }
      if (this.isCombatUnit(u)) {
        combatUnits.push(unitEntry);
      }
    }
    return combatUnits;
  }

  private isCombatUnit(u: Unit): boolean {
    return u.attack > 0 || u.defense > 0;
  }

  /** Uses `(nextInt() % 6) + 1`, not `rollD6()`. The determinism tests lock this stream. */
  private rollHits(units: UnitStackEntry[], isAttacker: boolean): number {
    let hits = 0;
    for (const unitEntry of units) {
      const u = this.state.unit_types[unitEntry.unit_type_id];
      if (u == null) {
        continue;
      }
      const count = unitEntry.count ?? 1;
      const targetValue = isAttacker ? u.attack : u.defense;
      for (let i = 0; i < count; i++) {
        const roll = (this.rng.nextInt() % 6) + 1;
        if (roll <= targetValue) {
          hits += 1;
        }
      }
    }
    return hits;
  }

  /** Cheapest cost first. Array.sort is stable, matching Godot's insertion sort for arrays under 16 entries. */
  private applyCasualties(regionId: string, factionId: string, hits: number): void {
    if (hits <= 0) {
      return;
    }
    const regionUnits = this.state.region_units[regionId] ?? [];

    const factionUnits: { entry: UnitStackEntry; cost: number }[] = [];
    for (const unitEntry of regionUnits) {
      if (unitEntry.faction_id === factionId) {
        const u = this.state.unit_types[unitEntry.unit_type_id];
        if (u && this.isCombatUnit(u)) {
          factionUnits.push({ entry: unitEntry, cost: u.cost });
        }
      }
    }
    factionUnits.sort((a, b) => a.cost - b.cost);

    let remainingHits = hits;
    for (const item of factionUnits) {
      if (remainingHits <= 0) {
        break;
      }
      const toRemove = Math.min(item.entry.count, remainingHits);
      item.entry.count -= toRemove;
      remainingHits -= toRemove;
    }

    for (let i = regionUnits.length - 1; i >= 0; i--) {
      if (regionUnits[i].faction_id === factionId && regionUnits[i].count <= 0) {
        regionUnits.splice(i, 1);
      }
    }
  }
}
