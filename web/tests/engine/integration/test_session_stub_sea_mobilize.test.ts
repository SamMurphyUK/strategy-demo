import { describe, expect, it } from "vitest";
import { GameSessionStub } from "../../../src/engine";

function firstAlliesFactoryRegion(stub: GameSessionStub): string {
  for (const rid of Object.keys(stub.state.regions)) {
    const r = stub.state.regions[rid];
    if (r.owner_faction_id === stub.state.current_faction_id && r.has_factory) {
      return rid;
    }
  }
  return "";
}

function seaZoneAdjacentTo(stub: GameSessionStub, regionId: string): string {
  for (const neighbor of stub.state.getAdjacentRegions(regionId)) {
    const r = stub.state.regions[String(neighbor)];
    if (r != null && r.isSeaRegion()) {
      return String(neighbor);
    }
  }
  return "";
}

function buyTransportAndAdvance(): GameSessionStub {
  const stub = new GameSessionStub();
  stub.initializeDemo(12345);
  stub.applyCommand({
    command_id: "buy_transport",
    player_id: stub.state.current_faction_id,
    type: "purchase_units",
    payload: { purchases: [{ unit_type_id: "transport", count: 1 }] },
  });
  for (let i = 0; i < 4; i++) {
    stub.applyCommand({ command_id: `ep_${i}`, player_id: stub.state.current_faction_id, type: "end_phase", payload: {} });
  }
  return stub;
}

describe("integration/test_session_stub_sea_mobilize", () => {
  it("test_sea_unit_rejected_at_factory_land", () => {
    const stub = buyTransportAndAdvance();
    const factory = firstAlliesFactoryRegion(stub);
    const res = stub.applyCommand({
      command_id: "place_ship_on_land",
      player_id: stub.state.current_faction_id,
      type: "place_units",
      payload: { placements: [{ region_id: factory, units: [{ unit_type_id: "transport", count: 1 }] }] },
    });
    expect(String(res.result_type ?? "")).toBe("error");
  });

  it("test_sea_unit_placed_in_adjacent_sea_zone", (ctx) => {
    const stub = buyTransportAndAdvance();
    const factory = firstAlliesFactoryRegion(stub);
    const sea = seaZoneAdjacentTo(stub, factory);
    if (sea === "") {
      ctx.skip("No sea zone adjacent to allies factory in demo map");
      return;
    }
    const res = stub.applyCommand({
      command_id: "place_ship_at_sea",
      player_id: stub.state.current_faction_id,
      type: "place_units",
      payload: { placements: [{ region_id: sea, units: [{ unit_type_id: "transport", count: 1 }] }] },
    });
    expect(String(res.result_type ?? "")).toBe("ok");
  });
});
