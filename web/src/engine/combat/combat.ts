import type { ActiveBattle, BattleCasualty, BattleDie, BattleSide, BattleUnitState } from "../model/battle";
import { CommandType } from "../model/command";
import { GameEvent, GameEventType } from "../model/event";
import type { GameState } from "../model/game_state";
import { type Dict, deepCopy, type UnitStackEntry } from "../model/types";
import type { PCG } from "../rng/pcg";
import {
  battleOutcome,
  cheapestCasualties,
  firingRanks,
  hitsOn,
  isAlive,
  isCombatUnit,
  maxHpOf,
  resolveHit,
} from "./battle_rules";

export interface Battle {
  region_id: string;
  attacker_faction_id: string;
  defender_faction_id: string;
  battle_type: "naval" | "land";
}

/** Auto-resolve stops here and leaves both sides in place. */
export const MAX_BATTLE_ROUNDS = 100;

export interface BattleCommandError {
  code: string;
  message: string;
}

export type BattleCommandResult = { ok: true; events: GameEvent[] } | { ok: false; error: BattleCommandError };

function fail(code: string, message: string): BattleCommandResult {
  return { ok: false, error: { code, message } };
}

/**
 * Owns every battle. A battle is fought round by round through `startBattle`, `rollRound`,
 * `assignAttackerCasualties` and `retreat`, or all at once by `resolveAllBattles`.
 * Both paths use the same rules and the session's dice.
 */
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

  // ---------------------------------------------------------
  // QUERIES
  // ---------------------------------------------------------

  identifyBattles(attackerFactionId: string): Battle[] {
    const battles: Battle[] = [];
    const state = this.state;

    for (const regionId of Object.keys(state.region_units)) {
      const region = state.regions[regionId];
      if (region == null) {
        continue;
      }
      if (this.getCombatUnits(regionId, attackerFactionId).length === 0) {
        continue;
      }
      const defenderFactionId = this.defenderIn(regionId, attackerFactionId);
      if (defenderFactionId === "") {
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

  getCombatUnits(regionId: string, factionId: string): UnitStackEntry[] {
    return (this.state.region_units[regionId] ?? []).filter(
      (entry) => entry.faction_id === factionId && isCombatUnit(this.state.unit_types[entry.unit_type_id]),
    );
  }

  /** Adjacent regions the attacker may fall back to: no enemy units, and friendly land for a land battle. */
  legalRetreats(): string[] {
    const battle = this.state.active_battle;
    if (battle == null) {
      return [];
    }
    const attacker = battle.attacker_faction_id;
    return this.state.getAdjacentRegions(battle.region_id).filter((id) => {
      const region = this.state.regions[id];
      if (region == null || this.state.getEnemyUnitsInRegion(id, attacker).length > 0) {
        return false;
      }
      if (battle.battle_type === "land") {
        return region.isLandRegion() && region.owner_faction_id === attacker;
      }
      return region.isSeaRegion();
    });
  }

  // ---------------------------------------------------------
  // INTERACTIVE BATTLE
  // ---------------------------------------------------------

  /** Routes a battle command. Returns null for any other command type. */
  applyBattleCommand(type: string, factionId: string, payload: Dict): BattleCommandResult | null {
    switch (type) {
      case CommandType.START_BATTLE:
        return this.startBattle(String(payload.region_id ?? ""), factionId);
      case CommandType.BATTLE_ROLL:
        return this.rollRound(factionId);
      case CommandType.BATTLE_CASUALTIES: {
        const ids: unknown = payload.unit_ids;
        return this.assignAttackerCasualties(factionId, Array.isArray(ids) ? ids.map(String) : undefined);
      }
      case CommandType.BATTLE_RETREAT:
        return this.retreat(factionId, String(payload.to_region_id ?? ""));
    }
    return null;
  }

  startBattle(regionId: string, attackerFactionId: string): BattleCommandResult {
    if (this.state.active_battle != null) {
      return fail("BATTLE_IN_PROGRESS", `A battle in ${this.state.active_battle.region_id} is not finished`);
    }
    const battle = this.identifyBattles(attackerFactionId).find((b) => b.region_id === regionId);
    if (battle == null) {
      return fail("NO_BATTLE", `No battle to fight in ${regionId}`);
    }
    return { ok: true, events: this.openBattle(battle) };
  }

  /** Rolls round 1, or presses on into the next round from the decision. */
  rollRound(factionId: string): BattleCommandResult {
    const battle = this.state.active_battle;
    const error = this.checkTurn(battle, factionId, ["awaiting_roll", "awaiting_decision"]);
    if (error) {
      return error;
    }
    return { ok: true, events: this.roll(battle!) };
  }

  /**
   * The attacker spends `attacker_hits_to_take` hits. Each id takes one hit, in order, so a
   * two-hit unit may appear twice. With no ids the cheapest units are taken.
   */
  assignAttackerCasualties(factionId: string, unitIds?: string[]): BattleCommandResult {
    const battle = this.state.active_battle;
    const error = this.checkTurn(battle, factionId, ["awaiting_casualties"]);
    if (error) {
      return error;
    }
    const b = battle!;
    let plan: BattleCasualty[];
    if (unitIds == null || unitIds.length === 0) {
      plan = cheapestCasualties(
        b.attackers,
        b.attacker_hits_to_take,
        "attacker",
        this.state.unit_types,
        firingRanks(b.attackers, "attacker", this.state.unit_types),
      );
    } else {
      const built = this.planChosenHits(b, unitIds);
      if ("error" in built) {
        return fail("INVALID_CASUALTIES", built.error);
      }
      plan = built.plan;
    }
    this.applyCasualties(b, plan);
    b.attacker_hits_to_take = 0;
    b.last_casualties = plan;
    const events = [
      GameEvent.create(
        GameEventType.UNITS_DESTROYED,
        { region_id: b.region_id, round: b.round, casualties: deepCopy(plan) },
        this.nextSeq(),
      ),
    ];
    events.push(...this.afterCasualties(b));
    return { ok: true, events };
  }

  retreat(factionId: string, toRegionId: string): BattleCommandResult {
    const battle = this.state.active_battle;
    const error = this.checkTurn(battle, factionId, ["awaiting_decision"]);
    if (error) {
      return error;
    }
    if (!this.legalRetreats().includes(toRegionId)) {
      return fail("INVALID_RETREAT", `Cannot retreat to ${toRegionId}`);
    }
    return { ok: true, events: this.finish(battle!, "attacker_retreated", toRegionId) };
  }

  // ---------------------------------------------------------
  // AUTO-RESOLVE
  // ---------------------------------------------------------

  /** Fights every battle for this attacker to the end: cheapest casualties, never retreat. */
  resolveAllBattles(attackerFactionId: string): GameEvent[] {
    const events: GameEvent[] = [];
    for (const battle of this.identifyBattles(attackerFactionId)) {
      events.push(...this.openBattle(battle));
      events.push(...this.autoResolveActive());
    }
    return events;
  }

  /** Finishes the open battle with cheapest casualties and no retreat. */
  autoResolveActive(): GameEvent[] {
    const events: GameEvent[] = [];
    let b = this.state.active_battle;
    while (b != null) {
      if (b.stage === "awaiting_casualties") {
        const result = this.assignAttackerCasualties(b.attacker_faction_id);
        if (result.ok) {
          events.push(...result.events);
        }
      } else if (b.round >= MAX_BATTLE_ROUNDS && b.stage === "awaiting_decision") {
        events.push(...this.finish(b, "draw"));
      } else {
        events.push(...this.roll(b));
      }
      b = this.state.active_battle;
    }
    return events;
  }

  // ---------------------------------------------------------
  // INTERNALS
  // ---------------------------------------------------------

  private checkTurn(
    battle: ActiveBattle | null,
    factionId: string,
    stages: ActiveBattle["stage"][],
  ): BattleCommandResult | null {
    if (battle == null) {
      return fail("NO_ACTIVE_BATTLE", "No battle is being fought");
    }
    if (battle.attacker_faction_id !== factionId) {
      return fail("OUT_OF_TURN", "Only the attacker commands the battle");
    }
    if (!stages.includes(battle.stage)) {
      return fail("WRONG_BATTLE_STAGE", `Battle is ${battle.stage}`);
    }
    return null;
  }

  private defenderIn(regionId: string, attackerFactionId: string): string {
    for (const entry of this.state.region_units[regionId] ?? []) {
      if (entry.faction_id !== attackerFactionId && isCombatUnit(this.state.unit_types[entry.unit_type_id])) {
        return entry.faction_id;
      }
    }
    return "";
  }

  private expand(regionId: string, factionId: string): BattleUnitState[] {
    const units: BattleUnitState[] = [];
    const counters: Record<string, number> = {};
    for (const entry of this.getCombatUnits(regionId, factionId)) {
      const maxHp = maxHpOf(this.state.unit_types[entry.unit_type_id]);
      if (entry.instance_id) {
        units.push({
          id: entry.instance_id,
          faction_id: factionId,
          unit_type_id: entry.unit_type_id,
          instance_id: entry.instance_id,
          hp: maxHp,
          max_hp: maxHp,
        });
        continue;
      }
      const count = Math.max(0, Math.trunc(Number(entry.count ?? 0)));
      for (let i = 0; i < count; i++) {
        counters[entry.unit_type_id] = (counters[entry.unit_type_id] ?? 0) + 1;
        units.push({
          id: `${factionId}.${entry.unit_type_id}.${counters[entry.unit_type_id]}`,
          faction_id: factionId,
          unit_type_id: entry.unit_type_id,
          hp: maxHp,
          max_hp: maxHp,
        });
      }
    }
    return units;
  }

  private openBattle(battle: Battle): GameEvent[] {
    const active: ActiveBattle = {
      region_id: battle.region_id,
      attacker_faction_id: battle.attacker_faction_id,
      defender_faction_id: battle.defender_faction_id,
      battle_type: battle.battle_type,
      round: 1,
      stage: "awaiting_roll",
      attackers: this.expand(battle.region_id, battle.attacker_faction_id),
      defenders: this.expand(battle.region_id, battle.defender_faction_id),
      attacker_hits_to_take: 0,
      last_dice: [],
      last_casualties: [],
    };
    this.state.active_battle = active;
    return [
      GameEvent.create(
        GameEventType.BATTLE_STARTED,
        {
          region_id: active.region_id,
          attacker: active.attacker_faction_id,
          defender: active.defender_faction_id,
          battle_type: active.battle_type,
          attackers: deepCopy(active.attackers),
          defenders: deepCopy(active.defenders),
        },
        this.nextSeq(),
      ),
    ];
  }

  private rollDie(unit: BattleUnitState, side: BattleSide, rank: number, surprise: boolean): BattleDie {
    const roll = this.rng.rollD6();
    return { unit_id: unit.id, side, rank, roll, hit: hitsOn(roll, rank), surprise };
  }

  private hasFlag(unit: BattleUnitState, flag: string): boolean {
    return Boolean(this.state.unit_types[unit.unit_type_id]?.special?.[flag]);
  }

  /** Every living unit fires once. Surviving submarines without an enemy destroyer fire first. */
  private roll(b: ActiveBattle): GameEvent[] {
    if (b.stage === "awaiting_decision") {
      b.round += 1;
    }
    const types = this.state.unit_types;
    const dice: BattleDie[] = [];
    const casualties: BattleCasualty[] = [];
    const fired = new Set<string>();

    const surprise = (side: BattleSide) => {
      const own = side === "attacker" ? b.attackers : b.defenders;
      const enemy = side === "attacker" ? b.defenders : b.attackers;
      if (enemy.some((u) => isAlive(u) && this.hasFlag(u, "cancels_submarine_abilities"))) {
        return;
      }
      const subs = own.filter((u) => isAlive(u) && this.hasFlag(u, "has_surprise_strike"));
      if (subs.length === 0) {
        return;
      }
      const ranks = firingRanks(own, side, types);
      let hits = 0;
      for (const sub of subs) {
        const die = this.rollDie(sub, side, ranks.get(sub.id) ?? 0, true);
        dice.push(die);
        fired.add(sub.id);
        if (die.hit) hits += 1;
      }
      const enemySide: BattleSide = side === "attacker" ? "defender" : "attacker";
      const plan = cheapestCasualties(enemy, hits, enemySide, types, firingRanks(enemy, enemySide, types));
      this.applyCasualties(b, plan);
      casualties.push(...plan.map((c) => ({ ...c, surprise: true })));
    };
    surprise("attacker");
    surprise("defender");

    const fire = (side: BattleSide): number => {
      const own = side === "attacker" ? b.attackers : b.defenders;
      const ranks = firingRanks(own, side, types);
      let hits = 0;
      for (const unit of own) {
        if (!isAlive(unit) || fired.has(unit.id)) {
          continue;
        }
        const die = this.rollDie(unit, side, ranks.get(unit.id) ?? 0, false);
        dice.push(die);
        if (die.hit) hits += 1;
      }
      return hits;
    };
    const attackerHits = fire("attacker");
    const defenderHits = fire("defender");

    const defenderPlan = cheapestCasualties(
      b.defenders,
      attackerHits,
      "defender",
      types,
      firingRanks(b.defenders, "defender", types),
    );
    this.applyCasualties(b, defenderPlan);
    casualties.push(...defenderPlan);

    const attackerHp = b.attackers.reduce((sum, u) => sum + Math.max(0, u.hp), 0);
    b.attacker_hits_to_take = Math.min(defenderHits, attackerHp);
    b.last_dice = dice;
    b.last_casualties = casualties;

    const events = [
      GameEvent.create(
        GameEventType.DICE_ROLLED,
        {
          region_id: b.region_id,
          round: b.round,
          attacker_hits: dice.filter((d) => d.side === "attacker" && d.hit).length,
          defender_hits: dice.filter((d) => d.side === "defender" && d.hit).length,
          attacker_hits_to_take: b.attacker_hits_to_take,
          dice: deepCopy(dice),
          casualties: deepCopy(casualties),
        },
        this.nextSeq(),
      ),
    ];

    if (b.attacker_hits_to_take > 0) {
      b.stage = "awaiting_casualties";
      return events;
    }
    events.push(...this.afterCasualties(b));
    return events;
  }

  private planChosenHits(b: ActiveBattle, unitIds: string[]): { plan: BattleCasualty[] } | { error: string } {
    if (unitIds.length !== b.attacker_hits_to_take) {
      return { error: `Assign exactly ${b.attacker_hits_to_take} hits, got ${unitIds.length}` };
    }
    const hp = new Map(b.attackers.map((u) => [u.id, u.hp]));
    const plan: BattleCasualty[] = [];
    for (const id of unitIds) {
      const unit = b.attackers.find((u) => u.id === id);
      const before = hp.get(id) ?? 0;
      if (unit == null || before <= 0) {
        return { error: `${id} cannot take a hit` };
      }
      const result = resolveHit(before, unit.max_hp);
      hp.set(id, result === "damaged" ? before - 1 : 0);
      plan.push({ unit_id: id, side: "attacker", result });
    }
    return { plan };
  }

  private applyCasualties(b: ActiveBattle, plan: BattleCasualty[]): void {
    for (const step of plan) {
      const unit = [...b.attackers, ...b.defenders].find((u) => u.id === step.unit_id);
      if (unit == null) {
        continue;
      }
      unit.hp = step.result === "damaged" ? unit.hp - 1 : 0;
    }
  }

  private afterCasualties(b: ActiveBattle): GameEvent[] {
    const outcome = battleOutcome(b.attackers.filter(isAlive).length, b.defenders.filter(isAlive).length);
    if (outcome !== "undecided") {
      return this.finish(b, outcome);
    }
    b.stage = "awaiting_decision";
    return [];
  }

  /** Writes survivors back to the region, moves a retreat, captures land, and closes the battle. */
  private finish(b: ActiveBattle, result: string, retreatTo = ""): GameEvent[] {
    const state = this.state;
    const regionId = b.region_id;
    const kept = (state.region_units[regionId] ?? []).filter(
      (entry) =>
        (entry.faction_id !== b.attacker_faction_id && entry.faction_id !== b.defender_faction_id) ||
        !isCombatUnit(state.unit_types[entry.unit_type_id]),
    );
    const attackerStacks = this.toStacks(b.attackers);
    const defenderStacks = this.toStacks(b.defenders);
    state.region_units[regionId] = [...kept, ...defenderStacks];
    if (retreatTo !== "") {
      this.mergeInto(retreatTo, attackerStacks);
    } else {
      state.region_units[regionId].push(...attackerStacks);
    }

    const events: GameEvent[] = [];
    const landSurvivor = b.attackers.some(
      (u) => isAlive(u) && state.unit_types[u.unit_type_id]?.category === "land",
    );
    const region = state.regions[regionId];
    if (result === "attacker_won" && region?.isLandRegion() && landSurvivor) {
      const previous = region.owner_faction_id;
      region.owner_faction_id = b.attacker_faction_id;
      events.push(
        GameEvent.create(
          GameEventType.REGION_CAPTURED,
          { region_id: regionId, faction_id: b.attacker_faction_id, previous_owner_faction_id: previous },
          this.nextSeq(),
        ),
      );
    }

    const finished = GameEvent.create(
      GameEventType.BATTLE_FINISHED,
      { region_id: regionId, result, rounds: b.round, ...(retreatTo !== "" ? { retreat_to: retreatTo } : {}) },
      this.nextSeq(),
    );
    state.active_battle = null;
    return [...events, finished];
  }

  /** Damage is not carried out of a battle; the survivors return as plain stacks. */
  private toStacks(units: BattleUnitState[]): UnitStackEntry[] {
    const stacks: UnitStackEntry[] = [];
    for (const unit of units) {
      if (!isAlive(unit)) {
        continue;
      }
      if (unit.instance_id) {
        stacks.push({ faction_id: unit.faction_id, unit_type_id: unit.unit_type_id, count: 1, instance_id: unit.instance_id });
        continue;
      }
      const existing = stacks.find((s) => s.unit_type_id === unit.unit_type_id && s.instance_id == null);
      if (existing) {
        existing.count += 1;
      } else {
        stacks.push({ faction_id: unit.faction_id, unit_type_id: unit.unit_type_id, count: 1 });
      }
    }
    return stacks;
  }

  private mergeInto(regionId: string, stacks: UnitStackEntry[]): void {
    if (!(regionId in this.state.region_units)) {
      this.state.region_units[regionId] = [];
    }
    const units = this.state.region_units[regionId];
    for (const stack of stacks) {
      const existing =
        stack.instance_id == null
          ? units.find(
              (e) => e.faction_id === stack.faction_id && e.unit_type_id === stack.unit_type_id && e.instance_id == null,
            )
          : undefined;
      if (existing) {
        existing.count += stack.count;
      } else {
        units.push(stack);
      }
    }
  }
}
