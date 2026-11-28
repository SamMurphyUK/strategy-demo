import { describe, expect, it } from "vitest";
import { GameSession, GameState, PHASE_COMMANDS, Region, Unit } from "../../../src/engine";
import { navalRaidTargets } from "../../../src/engine/rules/optional/airAndNavalRaiding";

function region(state: GameState, id: string, land: boolean, owner = ""): Region {
  const next = new Region();
  next.id = id;
  next.name = id;
  next.type = land ? "land" : "sea";
  next.owner_faction_id = owner;
  state.regions[id] = next;
  state.region_units[id] = [];
  state.adjacency[id] = [];
  return next;
}

function link(state: GameState, a: string, b: string): void {
  state.adjacency[a].push(b);
  state.adjacency[b].push(a);
}

/** Red's destroyer in `from`, a sea next to it, and blue's port beyond that, in red's combat move. */
function board(): { session: GameSession; state: GameState } {
  const built = new GameState();
  built.rulesetConfig.facilitiesAndPatrols = true;
  built.turn_order = ["red", "blue"];
  built.unit_types.destroyer = Unit.fromDict({ id: "destroyer", name: "destroyer", category: "sea", attack: 2, defense: 2, movement: 2, cost: 8, special: {} });
  region(built, "from", false);
  region(built, "sea", false);
  const port = region(built, "port", true, "blue");
  port.harbor = true;
  link(built, "from", "sea");
  link(built, "sea", "port");
  built.region_units.from = [{ faction_id: "red", unit_type_id: "destroyer", count: 1 }];
  const session = new GameSession();
  session.bindArena(built, 7);
  session.state.current_faction_id = "red";
  session.state.current_phase = "combat_move";
  return { session, state: session.state };
}

describe("the naval raid command", () => {
  it("is accepted in combat move and nowhere else", () => {
    expect(PHASE_COMMANDS.combat_move).toContain("naval_raid");
    expect(PHASE_COMMANDS.combat).not.toContain("naval_raid");
    expect(PHASE_COMMANDS.noncombat_move).not.toContain("naval_raid");
    expect(PHASE_COMMANDS.purchase).not.toContain("naval_raid");
  });

  it("lists the adjacent enemy zones a surface raider could strike", () => {
    const { state } = board();
    // From `from`, the sea beside blue's coast is a target; from that sea, the port itself is.
    expect(navalRaidTargets(state, "red", "from")).toEqual(["sea"]);
    state.region_units.sea = [{ faction_id: "red", unit_type_id: "destroyer", count: 1 }];
    expect(navalRaidTargets(state, "red", "sea")).toEqual(["port"]);
  });

  it("lists nothing without raiders, off the combat move, or with the optional rule off", () => {
    const { state } = board();
    state.region_units.sea = [{ faction_id: "red", unit_type_id: "destroyer", count: 1 }];
    expect(navalRaidTargets(state, "red", "sea")).toEqual(["port"]);
    state.region_units.sea = [];
    expect(navalRaidTargets(state, "red", "sea")).toEqual([]);
    state.region_units.sea = [{ faction_id: "red", unit_type_id: "destroyer", count: 1 }];
    state.current_phase = "combat";
    expect(navalRaidTargets(state, "red", "sea")).toEqual([]);
    state.current_phase = "combat_move";
    state.rulesetConfig.facilitiesAndPatrols = false;
    expect(navalRaidTargets(state, "red", "sea")).toEqual([]);
  });

  it("runs resolveNavalRaid and reports what it did on an event", () => {
    const { session, state } = board();
    state.region_units.sea = [{ faction_id: "red", unit_type_id: "destroyer", count: 1 }];
    const result = session.applyCommand({
      command_id: "raid_1",
      player_id: "red",
      type: "naval_raid",
      payload: { from_region_id: "sea", to_region_id: "port" },
    });
    expect(String(result.result_type)).toBe("ok");
    const events = result.events as { payload?: Record<string, unknown> }[];
    const report = events.find((item) => item.payload?.reason === "naval_raid")?.payload;
    expect(report).toMatchObject({ region_id: "port", from_region_id: "sea", pinned: false });
    expect(typeof report?.harbor_disabled).toBe("boolean");
    expect(typeof report?.raider_losses).toBe("number");
  });

  it("refuses a bad raid with the engine's own words", () => {
    const { session } = board();
    const result = session.applyCommand({
      command_id: "raid_bad",
      player_id: "red",
      type: "naval_raid",
      payload: { from_region_id: "from", to_region_id: "port" },
    });
    expect(String(result.result_type)).toBe("error");
    expect((result.error as { code?: string }).code).toBe("RAID_INVALID");
    expect(String((result.error as { message?: string }).message)).toMatch(/adjacent/i);
  });
});
