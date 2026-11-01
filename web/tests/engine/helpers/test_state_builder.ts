// Port of tests/validator/helpers/test_state_builder.gd.
import { GameState, Region, Ruleset, Unit } from "../../../src/engine";

export class TestStateBuilder {
  state: GameState;
  ruleset: Ruleset;

  constructor() {
    this.state = new GameState();
    this.ruleset = new Ruleset();
  }

  withRegion(name: string, isLand = true, owner: string = "red"): this {
    const r = new Region();
    r.id = name;
    r.name = name;
    r.type = isLand ? "land" : "sea";
    r.owner_faction_id = String(owner);
    r.ipc_value = 0;
    r.is_capital = false;
    r.has_factory = false;

    this.state.regions[name] = r;
    this.state.region_units[name] = [];
    this.state.adjacency[name] = [];
    return this;
  }

  withAdjacent(a: string, b: string): this {
    this.state.adjacency[a].push(b);
    this.state.adjacency[b].push(a);
    return this;
  }

  withUnitType(unitTypeId: string, category = "land", movement = 1): this {
    this.state.unit_types[unitTypeId] = Unit.fromDict({
      id: unitTypeId,
      name: unitTypeId,
      category,
      attack: 1,
      defense: 1,
      movement,
      cost: 3,
    });
    return this;
  }

  withStackUnit(unitTypeId: string, region: string, faction: string = "red", count = 1): this {
    if (!(region in this.state.region_units)) {
      this.state.region_units[region] = [];
    }
    this.state.region_units[region].push({
      faction_id: String(faction),
      unit_type_id: unitTypeId,
      count,
    });
    return this;
  }

  withUnit(id: number, unitTypeId: string, region: string, faction: string = "red"): this {
    const entry = {
      id,
      unit_type_id: unitTypeId,
      faction_id: String(faction),
      region,
      count: 1,
    };
    if (!(region in this.state.region_units)) {
      this.state.region_units[region] = [];
    }
    this.state.region_units[region].push(entry);
    return this;
  }

  buildState(): GameState {
    return this.state;
  }

  buildRuleset(): Ruleset {
    return this.ruleset;
  }
}
