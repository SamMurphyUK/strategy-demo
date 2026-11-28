import { describe, expect, it } from "vitest";
import { GameSession, GameState, Region, Unit } from "../../../src/engine";
import { nextPatrolCount, opsFor, reportFromEvents } from "../../../src/ui/map/ops/specialOps";

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

function game(phase: string): { session: GameSession; state: GameState } {
  const built = new GameState();
  built.rulesetConfig.facilitiesAndPatrols = true;
  built.turn_order = ["red", "blue"];
  for (const [id, category] of [["strategic_bomber", "air"], ["tactical_bomber", "air"], ["fighter", "air"], ["destroyer", "sea"], ["infantry", "land"]] as const) {
    built.unit_types[id] = Unit.fromDict({ id, name: id, category, attack: 2, defense: 2, movement: 3, cost: 6, special: {} });
  }
  const session = new GameSession();
  session.bindArena(built, 3);
  session.state.current_faction_id = "red";
  session.state.current_phase = phase;
  return { session, state: session.state };
}

describe("what a selected unit is offered", () => {
  it("offers nothing at all without Facilities and patrols", () => {
    const { session, state } = game("combat");
    const city = region(state, "city", true, "blue");
    city.major_factory = true;
    state.region_units.city = [{ faction_id: "red", unit_type_id: "strategic_bomber", count: 1 }];
    state.rulesetConfig.facilitiesAndPatrols = false;
    expect(opsFor(session, state, "red", "city", "strategic_bomber")).toEqual([]);
  });

  it("offers heavy bombers the factory raid, with the escorts, in combat", () => {
    const { session, state } = game("combat");
    const city = region(state, "city", true, "blue");
    city.major_factory = true;
    city.airbase = true;
    state.region_units.city = [
      { faction_id: "red", unit_type_id: "strategic_bomber", count: 1 },
      { faction_id: "red", unit_type_id: "fighter", count: 2 },
    ];
    const options = opsFor(session, state, "red", "city", "strategic_bomber");
    expect(options.map((option) => option.id)).toEqual(["bomb:factory"]);
    expect(options[0]).toMatchObject({ icon: "factory", maxEscorts: 2 });
    // Fighters and infantry are offered no bombing.
    expect(opsFor(session, state, "red", "city", "fighter")).toEqual([]);
    expect(opsFor(session, state, "red", "city", "infantry")).toEqual([]);
  });

  it("offers tactical bombers the airbase, and not the factory", () => {
    const { session, state } = game("combat");
    const city = region(state, "city", true, "blue");
    city.major_factory = true;
    city.airbase = true;
    state.region_units.city = [{ faction_id: "red", unit_type_id: "tactical_bomber", count: 1 }];
    expect(opsFor(session, state, "red", "city", "tactical_bomber").map((option) => option.id)).toEqual(["bomb:airbase"]);
  });

  it("offers a surface raider the raid, with the zones it could strike, in combat move", () => {
    const { session, state } = game("combat_move");
    region(state, "far", false);
    region(state, "near", false);
    region(state, "port", true, "blue").harbor = true;
    link(state, "far", "near");
    link(state, "near", "port");
    state.region_units.near = [{ faction_id: "red", unit_type_id: "destroyer", count: 1 }];
    const [raid] = opsFor(session, state, "red", "near", "destroyer");
    expect(raid).toMatchObject({ id: "raid", icon: "raid", targets: ["port"] });
    state.current_phase = "combat";
    expect(opsFor(session, state, "red", "near", "destroyer")).toEqual([]);
  });

  it("offers fighters on an operational airbase a patrol in non-combat move, and no other unit", () => {
    const { session, state } = game("noncombat_move");
    const base = region(state, "base", true, "red");
    base.airbase = true;
    state.region_units.base = [
      { faction_id: "red", unit_type_id: "fighter", count: 2 },
      { faction_id: "red", unit_type_id: "infantry", count: 1 },
    ];
    const [patrol] = opsFor(session, state, "red", "base", "fighter");
    expect(patrol).toMatchObject({ id: "patrol", icon: "patrol", max: 2, current: 0 });
    expect(opsFor(session, state, "red", "base", "infantry")).toEqual([]);
    // Only the faction whose turn it is.
    expect(opsFor(session, state, "blue", "base", "fighter")).toEqual([]);
  });

  it("steps the patrol one fighter at a time and back to none", () => {
    expect([0, 1, 2, 3].map((now) => nextPatrolCount(now, 3))).toEqual([1, 2, 3, 0]);
    expect(nextPatrolCount(0, 0)).toBe(0);
  });
});

describe("what a raid reports", () => {
  const name = (id: string) => `Place ${id}`;

  it("reads an industrial raid off its event: success when it did damage", () => {
    const report = reportFromEvents([{ payload: { reason: "strategic_bomb", facility: "factory", region_id: "x", bomber_losses: 1, escort_losses: 0, interceptor_losses: 2, damage: 7, tokens: 9 } }], name);
    expect(report).toMatchObject({ kind: "bomb", outcome: "success", title: "Strategic bombing: Place x" });
    expect(report?.headline).toBe("Success: 7 damage to the factory");
    expect(report?.lines).toEqual([
      "Anti-aircraft: 1 bomber lost",
      "Escorts against interceptors: 0 escorts and 2 interceptors lost",
      "Factory damage: 7 (repair tokens now 9)",
    ]);
  });

  it("is a failure when the bombers did nothing", () => {
    const report = reportFromEvents([{ payload: { reason: "strategic_bomb", facility: "factory", region_id: "x", bomber_losses: 2, escort_losses: 0, interceptor_losses: 0, damage: 0, tokens: 0 } }], name);
    expect(report?.outcome).toBe("failure");
    expect(report?.headline).toBe("Failure: no damage done");
  });

  it("reads an interdiction and a naval raid", () => {
    const hit = reportFromEvents([{ payload: { reason: "tactical_interdiction", facility: "airbase", region_id: "x", hits: 1, disabled_until: 4 } }], name);
    expect(hit?.headline).toBe("Success: the airbase is closed through round 4");
    const raid = reportFromEvents([{ payload: { reason: "naval_raid", region_id: "p", from_region_id: "s", pinned: false, harbor_disabled: true, raider_losses: 0, defender_losses: 1 } }], name);
    expect(raid).toMatchObject({ kind: "raid", outcome: "success", fromRegionId: "s" });
    const pinned = reportFromEvents([{ payload: { reason: "naval_raid", region_id: "p", from_region_id: "s", pinned: true } }], name);
    expect(pinned).toMatchObject({ outcome: "failure", headline: "Failure: the raiders were pinned" });
  });

  it("reports nothing for an event that is not a raid", () => {
    expect(reportFromEvents([{ payload: { reason: "preparatory_bombardment" } }, {}], name)).toBeNull();
  });
});
