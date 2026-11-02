import { describe, expect, it } from "vitest";
import {
  AmphibiousEngine,
  applyCargoCommand,
  beginMovementPhase,
  cancel_phase_order,
  CombatEngine,
  Command,
  CommandType,
  GameEventType,
  GameState,
  MovementEngine,
  PCG,
  Region,
  TransportLoadValidator,
  combatCargoCommit,
  type CargoLine,
} from "../../src/engine";
import type { UnitStackEntry } from "../../src/engine/model/types";

function region(state: GameState, id: string, land: boolean, owner: string): void {
  const next = new Region();
  next.id = id;
  next.name = id;
  next.type = land ? "land" : "sea";
  next.owner_faction_id = owner;
  state.regions[id] = next;
  state.region_units[id] = state.region_units[id] ?? [];
  state.adjacency[id] = state.adjacency[id] ?? [];
}

function link(state: GameState, a: string, b: string): void {
  state.adjacency[a].push(b);
  state.adjacency[b].push(a);
}

function stack(faction_id: string, unit_type_id: string, count: number, instance_id?: string): UnitStackEntry {
  return instance_id ? { faction_id, unit_type_id, count, instance_id } : { faction_id, unit_type_id, count };
}

function countOf(state: GameState, regionId: string, faction: string, unitType: string): number {
  return (state.region_units[regionId] ?? [])
    .filter((entry) => entry.faction_id === faction && entry.unit_type_id === unitType && entry.instance_id == null)
    .reduce((sum, entry) => sum + entry.count, 0);
}

function transportBoard(): GameState {
  const state = new GameState();
  state.current_faction_id = "red";
  state.current_phase = "combat_move";
  for (const [id, category, attack, defense] of [
    ["infantry", "land", 1, 2],
    ["tank", "land", 3, 3],
    ["aa", "land", 0, 0],
    ["transport", "sea", 0, 0],
    ["battleship", "sea", 4, 4],
    ["cruiser", "sea", 3, 3],
    ["destroyer", "sea", 2, 2],
  ] as const) {
    state.unit_types[id] = {
      id,
      name: id === "aa" ? "AA Gun" : id.charAt(0).toUpperCase() + id.slice(1),
      category,
      attack,
      defense,
      movement: id === "transport" || id === "battleship" || id === "cruiser" ? 2 : 1,
      cost: 3,
      container:
        id === "transport"
          ? { allowed_cargo_categories: ["land"], capacity: 2, max_per_type: { infantry: 2, tank: 1, aa: 1 } }
          : {},
      special: id === "aa" ? { is_aa: true, noncombat_move_only: true } : {},
    } as GameState["unit_types"][string];
  }
  region(state, "coast", true, "red");
  region(state, "sea", false, "");
  region(state, "beach", true, "blue");
  link(state, "coast", "sea");
  link(state, "sea", "beach");
  state.region_units.sea = [stack("red", "transport", 1, "transport_red_001")];
  state.transport_instances.transport_red_001 = {
    instance_id: "transport_red_001",
    unit_type_id: "transport",
    region_id: "sea",
    cargo: [],
  };
  return state;
}

function load(state: GameState, units: CargoLine[]): void {
  applyCargoCommand(
    state,
    Command.fromDict({
      player_id: "red",
      type: CommandType.LOAD_TRANSPORT,
      payload: { transport_instance_id: "transport_red_001", from_region_id: "coast", units },
    }),
    new MovementEngine(state),
  );
}

describe("transport cargo and amphibious assault", () => {
  it("accepts two infantry or one infantry and a tank, and rejects two tanks or three infantry", () => {
    const state = transportBoard();
    state.region_units.coast = [stack("red", "infantry", 3), stack("red", "tank", 2), stack("red", "aa", 1)];
    const validator = new TransportLoadValidator();
    const can = (units: CargoLine[]) =>
      validator.canLoadUnits("transport_red_001", "coast", units, "red", state);
    expect(can([{ unit_type_id: "infantry", count: 2 }])).toBe(true);
    expect(can([{ unit_type_id: "infantry", count: 1 }, { unit_type_id: "tank", count: 1 }])).toBe(true);
    expect(can([{ unit_type_id: "tank", count: 2 }])).toBe(false);
    expect(can([{ unit_type_id: "infantry", count: 3 }])).toBe(false);
    expect(can([{ unit_type_id: "aa", count: 1 }])).toBe(false);
  });

  it("blocks the end of combat move while embarked units are still aboard and points the camera at that sea", () => {
    const state = transportBoard();
    state.region_units.coast = [stack("red", "infantry", 2)];
    beginMovementPhase(state);
    load(state, [{ unit_type_id: "infantry", count: 2 }]);
    const focused: string[] = [];
    const gate = combatCargoCommit(state, (seaZoneId) => focused.push(seaZoneId));
    expect(gate.advance).toBe(false);
    expect(gate.seaZoneId).toBe("sea");
    expect(gate.warning).toMatch(/disembark/i);
    expect(focused).toEqual(["sea"]);
    expect(state.transport_instances.transport_red_001.cargo).toEqual([{ unit_type_id: "infantry", count: 2 }]);
  });

  it("restores the embarked unit to its coast when that order is cancelled", () => {
    const state = transportBoard();
    state.region_units.coast = [stack("red", "infantry", 2)];
    beginMovementPhase(state);
    load(state, [{ unit_type_id: "infantry", count: 2 }]);
    expect(countOf(state, "coast", "red", "infantry")).toBe(0);
    const orderId = state.phase_orders[0]?.id ?? "";
    expect(orderId).not.toBe("");
    cancel_phase_order(state, orderId);
    expect(countOf(state, "coast", "red", "infantry")).toBe(2);
    expect(state.transport_instances.transport_red_001.cargo).toEqual([]);
    expect(combatCargoCommit(state).advance).toBe(true);
  });

  it("lands amphibious infantry in the coastal battle instead of dropping the assault", () => {
    const state = transportBoard();
    state.region_units.coast = [stack("red", "infantry", 1)];
    state.region_units.beach = [stack("blue", "infantry", 1)];
    state.region_units.sea.push(stack("red", "battleship", 1), stack("red", "cruiser", 1));
    beginMovementPhase(state);
    load(state, [{ unit_type_id: "infantry", count: 1 }]);
    applyCargoCommand(
      state,
      Command.fromDict({
        player_id: "red",
        type: CommandType.DESIGNATE_AMPHIBIOUS,
        payload: {
          transport_instance_id: "transport_red_001",
          origin_sea_zone_id: "sea",
          target_region_id: "beach",
        },
      }),
      new MovementEngine(state),
      new AmphibiousEngine(state),
    );
    expect(state.pending_amphibious_assaults).toHaveLength(1);
    const combat = new CombatEngine(state, new PCG(1, 1));
    let roll = 0;
    combat.rng.rollD6 = () => [6, 6, 6, 6, 6][roll++] ?? 6;
    new AmphibiousEngine(state).resolveAssaults("red", combat);
    expect(state.pending_amphibious_assaults).toHaveLength(0);
    expect(countOf(state, "beach", "red", "infantry")).toBe(1);
    const opened = combat.startBattle("beach", "red");
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const started = opened.events.find((event) => event.type === GameEventType.BATTLE_STARTED);
    expect(started?.payload.region_id).toBe("beach");
    const attackers = started?.payload.attackers as { unit_type_id: string; amphibious?: boolean }[];
    expect(attackers.some((unit) => unit.unit_type_id === "infantry" && unit.amphibious)).toBe(true);
    const fought = combat.rollRound("red");
    expect(fought.ok).toBe(true);
    if (!fought.ok) return;
    const rolled = fought.events.find((event) => event.type === GameEventType.DICE_ROLLED);
    const dice = (rolled?.payload.dice ?? []) as { bombard?: boolean; rank?: number }[];
    const bombardment = dice.filter((die) => die.bombard);
    expect(bombardment).toHaveLength(1);
    expect(bombardment[0].rank).toBe(4);
    expect(combat.legalRetreats()).toEqual([]);
  });
});
