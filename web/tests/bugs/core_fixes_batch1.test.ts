import { describe, expect, it } from "vitest";
import {
  CombatEngine,
  GameSessionFactory,
  GameState,
  loadJson,
  MovementValidator,
  PCG,
  Region,
  Ruleset,
  SessionMode,
  Unit,
  type Dict,
} from "../../src/engine";
import { normalizeUnitTypeAndFaction } from "../../src/engine/presentation/region_unit_display";
import { UNIT_DEFINITIONS } from "../../src/ui/battle/combatTypes";
import { battleSpriteKey } from "../../src/ui/battle/default_unit_matrices";
import { factionName } from "../../src/ui/map/session/event_text";
import { canStageAnother, purchasePhaseAdvance, UNCONFIRMED_BASKET_MESSAGE } from "../../src/ui/map/purchaseBasket";
import type { UnitStackEntry } from "../../src/engine/model/types";

function catalogState(): GameState {
  const state = new GameState();
  for (const data of loadJson("res://data/units.json").units as Dict[]) {
    state.unit_types[String(data.id)] = Unit.fromDict(data);
  }
  return state;
}

function land(state: GameState, id: string, owner: string, units: UnitStackEntry[] = []): void {
  state.regions[id] = Region.fromDict({ id, name: id, type: "land", owner_faction_id: owner });
  state.region_units[id] = units;
  state.adjacency[id] = state.adjacency[id] ?? [];
}

function link(state: GameState, a: string, b: string): void {
  state.adjacency[a].push(b);
  state.adjacency[b].push(a);
}

const stack = (faction_id: string, unit_type_id: string, count: number): UnitStackEntry => ({
  faction_id,
  unit_type_id,
  count,
});

function scripted(rolls: number[]): PCG {
  const rng = new PCG(1, 1);
  let index = 0;
  rng.rollD6 = () => rolls[index++] ?? 6;
  return rng;
}

function aaDice(events: { type: string; payload: Dict }[]): Dict[] {
  const rolled = events.find((event) => event.type === "dice_rolled");
  const dice = (rolled?.payload.dice ?? []) as Dict[];
  return dice.filter((die) => die.aa === true);
}

describe("core fixes batch 1", () => {
  it("prints Germany for ger, including the art id the territory panel receives", () => {
    expect(factionName("ger")).toBe("Germany");
    expect(factionName("GER")).toBe("Germany");
    const shown = normalizeUnitTypeAndFaction("tank", "ger");
    expect(shown.faction_id).toBe("axis");
    expect(factionName(shown.faction_id)).toBe("Germany");
    expect(factionName("jap")).toBe("Japan");
  });

  it("sells an AA gun that cannot move in combat and fires an opening volley at aircraft", () => {
    const catalog = loadJson("res://data/units.json").units as Dict[];
    const aa = catalog.find((unit) => unit.id === "aa");
    expect(aa).toMatchObject({ cost: 5, attack: 0, defense: 0, move: 1, category: "land" });
    const shop = GameSessionFactory.create(SessionMode.STUB).getCostTable();
    expect(shop.aa).toBe(5);

    const moving = catalogState();
    moving.current_faction_id = "uk";
    land(moving, "Britain", "uk", [stack("uk", "aa", 1)]);
    land(moving, "France", "uk");
    link(moving, "Britain", "France");
    const ruleset = new Ruleset();
    ruleset.syncFromState(moving);
    const validator = new MovementValidator();
    moving.current_phase = "combat_move";
    expect(validator.getLegalDestinationsForStack("Britain", "aa", "uk", moving, ruleset)).toEqual([]);
    expect(validator.validateStackMove("Britain", "France", "aa", "uk", 1, moving, ruleset).ok).toBe(false);
    moving.current_phase = "noncombat_move";
    expect(validator.getLegalDestinationsForStack("Britain", "aa", "uk", moving, ruleset)).toContain("France");

    const wiped = catalogState();
    land(wiped, "Britain", "uk", [stack("ger", "fighter", 1), stack("uk", "aa", 1)]);
    const wipedCombat = new CombatEngine(wiped, scripted([1]));
    expect(wipedCombat.startBattle("Britain", "ger").ok).toBe(true);
    const wipedRoll = wipedCombat.rollRound("ger");
    expect(wipedRoll.ok).toBe(true);
    if (!wipedRoll.ok) return;
    const opening = aaDice(wipedRoll.events);
    expect(opening).toHaveLength(1);
    expect(opening[0].roll).toBe(1);
    expect(opening[0].hit).toBe(true);
    expect(wiped.region_units.Britain?.some((unit) => unit.unit_type_id === "fighter")).toBe(false);
    expect(wiped.region_units.Britain?.some((unit) => unit.unit_type_id === "aa")).toBe(true);

    const capped = catalogState();
    land(capped, "Britain", "uk", [stack("ger", "fighter", 4), stack("uk", "aa", 1), stack("uk", "infantry", 1)]);
    const cappedCombat = new CombatEngine(capped, scripted([6, 6, 6, 6, 6, 6, 6, 6]));
    expect(cappedCombat.startBattle("Britain", "ger").ok).toBe(true);
    const cappedRoll = cappedCombat.rollRound("ger");
    expect(cappedRoll.ok).toBe(true);
    if (!cappedRoll.ok) return;
    const shots = aaDice(cappedRoll.events);
    expect(shots).toHaveLength(3);
    expect(shots.every((die) => die.hit === Number(die.roll) <= 1)).toBe(true);
    expect(capped.active_battle?.attackers.filter((unit) => unit.hp > 0)).toHaveLength(4);

    const again = catalogState();
    land(again, "Britain", "uk", [stack("ger", "fighter", 1), stack("uk", "aa", 1), stack("uk", "infantry", 1)]);
    const againCombat = new CombatEngine(again, scripted([2, 6, 6, 6, 6]));
    expect(againCombat.startBattle("Britain", "ger").ok).toBe(true);
    const first = againCombat.rollRound("ger");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(aaDice(first.events)).toHaveLength(1);
    const second = againCombat.rollRound("ger");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(aaDice(second.events)).toHaveLength(0);
  });

  it("gives transport and aa their own battle sprites", () => {
    expect(battleSpriteKey("transport")).toBe("transport");
    expect(battleSpriteKey("aa")).toBe("aa");
    expect(battleSpriteKey("transport")).not.toBe("infantry");
    expect(battleSpriteKey("aa")).not.toBe("infantry");
    expect(battleSpriteKey("mech_infantry")).toBe("mech_infantry");
    expect(battleSpriteKey("armor")).toBe("armor");
    for (const id of ["transport", "aa", "submarine", "destroyer", "cruiser", "carrier", "battleship", "fighter", "tactical_bomber", "strategic_bomber", "artillery", "mech_infantry", "armor"]) {
      const key = battleSpriteKey(id);
      expect(key).not.toBe("infantry");
      expect(Object.prototype.hasOwnProperty.call(UNIT_DEFINITIONS, key)).toBe(true);
    }
    expect(battleSpriteKey("infantry")).toBe("infantry");
  });

  it("stops the shop at the IPC that is left and refuses to drop an unconfirmed basket", () => {
    let staged = 0;
    let count = 0;
    while (canStageAnother(3, 17, staged)) {
      count += 1;
      staged += 3;
    }
    expect(count).toBe(5);
    expect(staged).toBe(15);
    expect(canStageAnother(3, 17, staged)).toBe(false);
    expect(canStageAnother(20, 17, 0)).toBe(false);
    expect(purchasePhaseAdvance(staged)).toEqual({ advance: false, warning: UNCONFIRMED_BASKET_MESSAGE });
    expect(purchasePhaseAdvance(0)).toEqual({ advance: true, warning: null });
  });
});
