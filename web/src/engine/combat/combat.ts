import type { ActiveBattle, BattleCasualty, BattleDie, BattleSide, BattleUnitState } from "../model/battle";
import { CommandType } from "../model/command";
import { GameEvent, GameEventType } from "../model/event";
import type { GameState } from "../model/game_state";
import { type Dict, deepCopy, type UnitStackEntry } from "../model/types";
import type { PCG } from "../rng/pcg";
import { navalBattleBlocksBombardment } from "../transport/cargo_rules";
import {
  assignAaHits,
  assignBombardHits,
  attackingAircraft,
  battleOutcome,
  casualtyFitsBudget,
  defendingAaGuns,
  escapingSubmarines,
  firingRanks,
  hasCombatantsAfterEscape,
  type HitBudget,
  hitsOn,
  isAlive,
  isCombatUnit,
  maxHpOf,
  openingAaShots,
  resolveHit,
  restrictedCasualties,
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
      const landed = state.amphibious_landings.some(
        (landing) => landing.region_id === regionId && landing.faction_id === attackerFactionId,
      );
      if (this.getCombatUnits(regionId, attackerFactionId).length === 0 && !landed) {
        continue;
      }
      const defenderFactionId = this.defenderIn(regionId, attackerFactionId);
      if (defenderFactionId === "") {
        continue;
      }
      const attackers = this.expand(regionId, attackerFactionId, "attacker");
      const defenders = this.expand(regionId, defenderFactionId, "defender");
      if (!hasCombatantsAfterEscape(attackers, defenders, state.unit_types) && !landed) {
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

  /** Transports do not roll, but they are navy and can be attacked. AA guns fire only their opening volley. */
  private isTargetable(entry: UnitStackEntry): boolean {
    const type = this.state.unit_types[entry.unit_type_id];
    return isCombatUnit(type) || type?.category === "sea" || Boolean(type?.special?.is_aa);
  }

  /** Adjacent regions the attacker may fall back to: no enemy units, and friendly land for a land battle. */
  legalRetreats(): string[] {
    const battle = this.state.active_battle;
    if (battle == null) {
      return [];
    }
    const living = battle.attackers.filter(isAlive);
    const canFlee = living.some(
      (unit) => !(unit.amphibious && this.state.unit_types[unit.unit_type_id]?.category === "land"),
    );
    if (!canFlee) {
      return [];
    }
    const attacker = battle.attacker_faction_id;
    return this.state.getAdjacentRegions(battle.region_id).filter((id) => {
      const region = this.state.regions[id];
      if (region == null || this.state.getEnemyUnitsInRegion(id, attacker).length > 0) {
        return false;
      }
      if (battle.battle_type === "land") {
        return region.isLandRegion() && this.state.sameTeam(region.owner_faction_id, attacker);
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
      plan = restrictedCasualties(
        b.attackers,
        {
          any: b.attacker_hits_to_take - (b.attacker_hits_skip_air ?? 0) - (b.attacker_hits_skip_sub ?? 0),
          skipAir: b.attacker_hits_skip_air ?? 0,
          skipSub: b.attacker_hits_skip_sub ?? 0,
        },
        "attacker",
        this.state.unit_types,
        firingRanks(b.attackers, "attacker", this.state.unit_types),
      ).plan;
    } else {
      const built = this.planChosenHits(b, unitIds);
      if ("error" in built) {
        return fail("INVALID_CASUALTIES", built.error);
      }
      plan = built.plan;
    }
    this.applyCasualties(b, plan);
    b.attacker_hits_to_take = 0;
    b.attacker_hits_skip_air = 0;
    b.attacker_hits_skip_sub = 0;
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
    const b = battle!;
    const staying = b.attackers.filter(
      (unit) => isAlive(unit) && unit.amphibious && this.state.unit_types[unit.unit_type_id]?.category === "land",
    );
    const leaving = b.attackers.filter((unit) => isAlive(unit) && !staying.includes(unit));
    if (leaving.length === 0) {
      return fail("INVALID_RETREAT", "Amphibious units cannot retreat");
    }
    if (staying.length === 0) {
      return { ok: true, events: this.finish(b, "attacker_retreated", toRegionId) };
    }
    this.mergeInto(toRegionId, this.toStacks(leaving));
    this.removeStacks(b.region_id, this.toStacks(leaving));
    const gone = new Set(leaving.map((unit) => unit.id));
    b.attackers = b.attackers.filter((unit) => !gone.has(unit.id));
    return {
      ok: true,
      events: [
        GameEvent.create(
          GameEventType.UNITS_MOVED,
          { region_id: b.region_id, retreat_to: toRegionId, units: this.toStacks(leaving) },
          this.nextSeq(),
        ),
      ],
    };
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
      if (!this.state.sameTeam(String(entry.faction_id ?? ""), attackerFactionId) && this.isTargetable(entry)) {
        return entry.faction_id;
      }
    }
    return "";
  }

  private expand(regionId: string, factionId: string, side: "attacker" | "defender"): BattleUnitState[] {
    const units: BattleUnitState[] = [];
    const counters: Record<string, number> = {};
    const entries = (this.state.region_units[regionId] ?? []).filter(
      (entry) => entry.faction_id === factionId && (side === "defender" ? this.isTargetable(entry) : isCombatUnit(this.state.unit_types[entry.unit_type_id])),
    );
    for (const entry of entries) {
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
      attackers: this.expand(battle.region_id, battle.attacker_faction_id, "attacker"),
      defenders: this.expand(battle.region_id, battle.defender_faction_id, "defender"),
      attacker_hits_to_take: 0,
      last_dice: [],
      last_casualties: [],
    };
    this.stampAmphibious(active);
    if (active.battle_type === "naval") {
      this.state.naval_battles_this_turn[active.region_id] = true;
    }
    const submerged = this.releaseSubmarines(active);
    this.state.active_battle = active;
    const started = GameEvent.create(
      GameEventType.BATTLE_STARTED,
      {
        region_id: active.region_id,
        attacker: active.attacker_faction_id,
        defender: active.defender_faction_id,
        battle_type: active.battle_type,
        attackers: deepCopy(active.attackers),
        defenders: deepCopy(active.defenders),
        ...(submerged.length > 0 ? { submerged } : {}),
      },
      this.nextSeq(),
    );
    const cleared = this.finishIfClear(active);
    return cleared ? [started, ...cleared] : [started];
  }

  private rollDie(unit: BattleUnitState, side: BattleSide, rank: number, surprise: boolean): BattleDie {
    const roll = this.rng.rollD6();
    return { unit_id: unit.id, side, rank, roll, hit: hitsOn(roll, rank), surprise };
  }

  private hasFlag(unit: BattleUnitState, flag: string): boolean {
    return Boolean(this.state.unit_types[unit.unit_type_id]?.special?.[flag]);
  }

  /** Marks cargo that landed from a transport, and adds pieces that do not roll a normal attack. */
  private stampAmphibious(b: ActiveBattle): void {
    const budget: Record<string, number> = {};
    for (const landing of this.state.amphibious_landings) {
      if (landing.region_id !== b.region_id || landing.faction_id !== b.attacker_faction_id) {
        continue;
      }
      for (const line of landing.cargo) {
        budget[line.unit_type_id] = (budget[line.unit_type_id] ?? 0) + Math.trunc(Number(line.count ?? 0));
      }
    }
    for (const unit of b.attackers) {
      if ((budget[unit.unit_type_id] ?? 0) <= 0) {
        continue;
      }
      unit.amphibious = true;
      budget[unit.unit_type_id] -= 1;
    }
    for (const unitType of Object.keys(budget)) {
      const maxHp = maxHpOf(this.state.unit_types[unitType]);
      for (let i = 0; i < budget[unitType]; i++) {
        b.attackers.push({
          id: `${b.attacker_faction_id}.${unitType}.amphib.${i + 1}`,
          faction_id: b.attacker_faction_id,
          unit_type_id: unitType,
          hp: maxHp,
          max_hp: maxHp,
          amphibious: true,
        });
      }
    }
  }

  /** Battleships hit on 4 and cruisers on 3, one ship per offloaded ground unit. */
  private shoreBombardment(b: ActiveBattle): { dice: BattleDie[]; casualties: BattleCasualty[] } {
    const dice: BattleDie[] = [];
    const casualties: BattleCasualty[] = [];
    const landing = this.state.amphibious_landings.find(
      (item) => item.region_id === b.region_id && item.faction_id === b.attacker_faction_id,
    );
    if (landing == null || navalBattleBlocksBombardment(this.state, landing.sea_zone_id, b.attacker_faction_id)) {
      return { dice, casualties };
    }
    const ground = b.attackers.filter(
      (unit) => isAlive(unit) && unit.amphibious && this.state.unit_types[unit.unit_type_id]?.category === "land",
    ).length;
    const ships: string[] = [];
    for (const entry of this.state.region_units[landing.sea_zone_id] ?? []) {
      if (entry.faction_id !== b.attacker_faction_id) {
        continue;
      }
      const id = String(entry.unit_type_id ?? "");
      if (id !== "battleship" && id !== "cruiser") {
        continue;
      }
      const count = entry.instance_id ? 1 : Math.max(0, Math.trunc(Number(entry.count ?? 0)));
      for (let i = 0; i < count; i++) {
        ships.push(id);
      }
    }
    ships.sort((a, c) => (a === "battleship" ? 0 : 1) - (c === "battleship" ? 0 : 1));
    const shots = Math.min(ground, ships.length);
    let hits = 0;
    for (let i = 0; i < shots; i++) {
      const rank = ships[i] === "battleship" ? 4 : 3;
      const roll = this.rng.rollD6();
      const die: BattleDie = {
        unit_id: `bombard.${ships[i]}.${i + 1}`,
        side: "attacker",
        rank,
        roll,
        hit: hitsOn(roll, rank),
        surprise: false,
        bombard: true,
      };
      dice.push(die);
      if (die.hit) {
        hits += 1;
      }
    }
    if (hits > 0) {
      const plan = assignBombardHits(b.defenders, hits, this.state.unit_types);
      this.applyCasualties(b, plan);
      casualties.push(...plan);
    }
    return { dice, casualties };
  }

  /**
   * Submarines the other side cannot hit leave before anyone fires.
   * They stay in the sea zone. The ids are the boats that just slipped away.
   */
  private releaseSubmarines(b: ActiveBattle): string[] {
    const types = this.state.unit_types;
    const attackingLeave = new Set(escapingSubmarines(b.attackers, b.defenders, "defender", types).map((unit) => unit.id));
    const defendingLeave = new Set(escapingSubmarines(b.defenders, b.attackers, "attacker", types).map((unit) => unit.id));
    const drop = (units: BattleUnitState[], leaving: Set<string>): string[] => {
      const ids = units.filter((unit) => leaving.has(unit.id)).map((unit) => unit.id);
      if (ids.length === 0) {
        return [];
      }
      const staying = units.filter((unit) => !leaving.has(unit.id));
      units.splice(0, units.length, ...staying);
      return ids;
    };
    return [...drop(b.attackers, attackingLeave), ...drop(b.defenders, defendingLeave)];
  }

  /** Ends the battle when a side has nobody left in it. */
  private finishIfClear(b: ActiveBattle): GameEvent[] | null {
    const outcome = battleOutcome(b.attackers.filter(isAlive).length, b.defenders.filter(isAlive).length);
    if (outcome === "undecided") {
      return null;
    }
    return this.finish(b, outcome);
  }

  /** Every living unit fires once. AA guns fire at aircraft before round 1, then sit out. */
  private roll(b: ActiveBattle): GameEvent[] {
    this.releaseSubmarines(b);
    const cleared = this.finishIfClear(b);
    if (cleared) {
      return cleared;
    }
    const openingRound = b.stage === "awaiting_roll";
    if (b.stage === "awaiting_decision") {
      b.round += 1;
    }
    const types = this.state.unit_types;
    const dice: BattleDie[] = [];
    const casualties: BattleCasualty[] = [];
    const fired = new Set<string>();

    if (openingRound && b.battle_type === "land") {
      const guns = defendingAaGuns(b.defenders, types);
      const planes = attackingAircraft(b.attackers);
      const shots = openingAaShots(guns.length, planes.length);
      let aaHits = 0;
      for (let i = 0; i < shots; i++) {
        const die = { ...this.rollDie(guns[i % guns.length], "defender", 1, false), aa: true as const };
        dice.push(die);
        if (die.hit) aaHits += 1;
      }
      if (aaHits > 0) {
        const plan = assignAaHits(planes, aaHits, types);
        this.applyCasualties(b, plan);
        casualties.push(...plan);
      }
      const ended = this.finishIfClear(b);
      if (ended) {
        return [...this.diceRolled(b, dice, casualties), ...ended];
      }
      const bombarded = this.shoreBombardment(b);
      dice.push(...bombarded.dice);
      casualties.push(...bombarded.casualties);
      const afterBombardment = this.finishIfClear(b);
      if (afterBombardment) {
        return [...this.diceRolled(b, dice, casualties), ...afterBombardment];
      }
    }

    const attackerDestroyer = b.attackers.some((u) => isAlive(u) && this.hasFlag(u, "cancels_submarine_abilities"));
    const defenderDestroyer = b.defenders.some((u) => isAlive(u) && this.hasFlag(u, "cancels_submarine_abilities"));

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
      const spent = restrictedCasualties(enemy, { any: 0, skipAir: hits, skipSub: 0 }, enemySide, types, firingRanks(enemy, enemySide, types));
      this.applyCasualties(b, spent.plan);
      casualties.push(...spent.plan.map((c) => ({ ...c, surprise: true })));
    };
    surprise("attacker");
    surprise("defender");

    const fire = (side: BattleSide, destroyer: boolean): HitBudget => {
      const own = side === "attacker" ? b.attackers : b.defenders;
      const ranks = firingRanks(own, side, types);
      const budget: HitBudget = { any: 0, skipAir: 0, skipSub: 0 };
      for (const unit of own) {
        if (!isAlive(unit) || fired.has(unit.id) || this.hasFlag(unit, "is_aa")) {
          continue;
        }
        const die = this.rollDie(unit, side, ranks.get(unit.id) ?? 0, false);
        dice.push(die);
        if (!die.hit) {
          continue;
        }
        const type = types[unit.unit_type_id];
        if (type?.special?.cannot_hit_air) {
          budget.skipAir += 1;
        } else if (type?.category === "air" && !destroyer) {
          budget.skipSub += 1;
        } else {
          budget.any += 1;
        }
      }
      return budget;
    };
    const attackerBudget = fire("attacker", attackerDestroyer);
    const defenderBudget = fire("defender", defenderDestroyer);

    const defenderPlan = restrictedCasualties(
      b.defenders,
      attackerBudget,
      "defender",
      types,
      firingRanks(b.defenders, "defender", types),
    );
    this.applyCasualties(b, defenderPlan.plan);
    casualties.push(...defenderPlan.plan);

    const taken = restrictedCasualties(
      b.attackers,
      defenderBudget,
      "attacker",
      types,
      firingRanks(b.attackers, "attacker", types),
    ).used;
    b.attacker_hits_to_take = taken.any + taken.skipAir + taken.skipSub;
    b.attacker_hits_skip_air = taken.skipAir;
    b.attacker_hits_skip_sub = taken.skipSub;
    b.last_dice = dice;
    b.last_casualties = casualties;

    const events = this.diceRolled(b, dice, casualties);

    if (b.attacker_hits_to_take > 0) {
      b.stage = "awaiting_casualties";
      return events;
    }
    events.push(...this.afterCasualties(b));
    return events;
  }

  private diceRolled(b: ActiveBattle, dice: BattleDie[], casualties: BattleCasualty[]): GameEvent[] {
    b.last_dice = dice;
    b.last_casualties = casualties;
    return [
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
  }

  private planChosenHits(b: ActiveBattle, unitIds: string[]): { plan: BattleCasualty[] } | { error: string } {
    if (unitIds.length !== b.attacker_hits_to_take) {
      return { error: `Assign exactly ${b.attacker_hits_to_take} hits, got ${unitIds.length}` };
    }
    const hp = new Map(b.attackers.map((u) => [u.id, u.hp]));
    const budget: HitBudget = {
      any: b.attacker_hits_to_take - (b.attacker_hits_skip_air ?? 0) - (b.attacker_hits_skip_sub ?? 0),
      skipAir: b.attacker_hits_skip_air ?? 0,
      skipSub: b.attacker_hits_skip_sub ?? 0,
    };
    const plan: BattleCasualty[] = [];
    for (const id of unitIds) {
      const unit = b.attackers.find((u) => u.id === id);
      const before = hp.get(id) ?? 0;
      if (unit == null || before <= 0) {
        return { error: `${id} cannot take a hit` };
      }
      const slot = casualtyFitsBudget(unit, budget, this.state.unit_types);
      if (slot == null) {
        const air = this.state.unit_types[unit.unit_type_id]?.category === "air";
        return {
          error: air
            ? `${id} cannot take a submarine hit`
            : `${id} cannot be hit by aircraft without a destroyer`,
        };
      }
      budget[slot] -= 1;
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
    this.releaseSubmarines(b);
    const cleared = this.finishIfClear(b);
    if (cleared) {
      return cleared;
    }
    b.stage = "awaiting_decision";
    return [];
  }

  /** Writes survivors back to the region, moves a retreat, captures land, and closes the battle. */
  private finish(b: ActiveBattle, result: string, retreatTo = ""): GameEvent[] {
    const state = this.state;
    const regionId = b.region_id;
    const fought = new Set<string>();
    for (const unit of [...b.attackers, ...b.defenders]) {
      fought.add(unit.instance_id ? `i:${unit.instance_id}` : `s:${unit.faction_id}|${unit.unit_type_id}`);
    }
    const kept = (state.region_units[regionId] ?? []).filter((entry) => {
      const key = entry.instance_id ? `i:${entry.instance_id}` : `s:${entry.faction_id}|${entry.unit_type_id}`;
      return !fought.has(key);
    });
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
      if (!state.sameTeam(previous, b.attacker_faction_id)) {
        state.territories_captured_this_turn[regionId] = true;
      }
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
    state.noteTerritoryFought(regionId);
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

  private removeStacks(regionId: string, stacks: UnitStackEntry[]): void {
    const units = this.state.region_units[regionId] ?? [];
    for (const stack of stacks) {
      let count = Math.trunc(Number(stack.count ?? 0));
      for (let i = units.length - 1; i >= 0 && count > 0; i--) {
        const entry = units[i];
        if (entry.faction_id !== stack.faction_id || entry.unit_type_id !== stack.unit_type_id || entry.instance_id) {
          continue;
        }
        if (entry.count > count) {
          entry.count -= count;
          count = 0;
        } else {
          count -= entry.count;
          units.splice(i, 1);
        }
      }
    }
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
