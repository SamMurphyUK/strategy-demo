import { describe, expect, it } from "vitest";
import { GameSessionStub, MovementValidator, type Ruleset } from "../../../src/engine";

function firstAlliesFactoryRegion(stub: GameSessionStub): string {
  for (const rid of Object.keys(stub.state.regions)) {
    const r = stub.state.regions[rid];
    if (r.owner_faction_id === "allies" && r.has_factory) {
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

function firstTransportInRegion(stub: GameSessionStub, regionId: string): string {
  for (const entry of stub.state.getUnitsInRegion(regionId)) {
    if ("instance_id" in entry) {
      return String(entry.instance_id);
    }
  }
  return "";
}

function reachableSeaTwoAway(stub: GameSessionStub, start: string): string {
  const validator = new MovementValidator();
  const legal = validator.getLegalDestinationsForInstance(
    firstTransportInRegion(stub, start),
    "allies",
    stub.state,
    stub.ruleset as Ruleset,
  );
  for (const dest of legal) {
    if (dest !== start && !stub.state.isAdjacent(start, String(dest))) {
      return String(dest);
    }
  }
  return "";
}

function landSeaWithTransport(
  stub: GameSessionStub,
  faction: string,
): { land: string; sea: string; transport_id: string } | null {
  for (const rid of Object.keys(stub.state.regions)) {
    const r = stub.state.regions[rid];
    if (!r.isLandRegion()) {
      continue;
    }
    for (const neighbor of stub.state.getAdjacentRegions(rid)) {
      const sea = stub.state.regions[String(neighbor)];
      if (sea == null || !sea.isSeaRegion()) {
        continue;
      }
      for (const entry of stub.state.getFactionUnitsInRegion(String(neighbor), faction)) {
        if ("instance_id" in entry && String(entry.unit_type_id ?? "") === "transport") {
          return { land: rid, sea: String(neighbor), transport_id: String(entry.instance_id) };
        }
      }
    }
  }
  return null;
}

describe("integration/test_session_stub_ship_move_load", () => {
  it("test_transport_instance_can_move_two_sea_zones", (ctx) => {
    const stub = new GameSessionStub();
    stub.initializeDemo(12345);
    stub.applyCommand({
      command_id: "buy_transport",
      player_id: "allies",
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "transport", count: 1 }] },
    });
    for (let i = 0; i < 4; i++) {
      stub.applyCommand({ command_id: `ep_${i}`, player_id: "allies", type: "end_phase", payload: {} });
    }
    const factory = firstAlliesFactoryRegion(stub);
    const sea = seaZoneAdjacentTo(stub, factory);
    if (sea === "") {
      ctx.skip("No adjacent sea zone");
      return;
    }
    stub.applyCommand({
      command_id: "place_transport",
      player_id: "allies",
      type: "place_units",
      payload: { placements: [{ region_id: sea, units: [{ unit_type_id: "transport", count: 1 }] }] },
    });
    const transportId = firstTransportInRegion(stub, sea);
    expect(transportId === "").toBe(false);
    const dest = reachableSeaTwoAway(stub, sea);
    if (dest === "") {
      ctx.skip("No two-hop sea destination in demo map");
      return;
    }
    const res = stub.applyCommand({
      command_id: "move_transport",
      player_id: "allies",
      type: "move_units",
      payload: { moves: [{
        from_region_id: sea,
        to_region_id: dest,
        units: [{ unit_type_id: "transport", count: 1, instance_id: transportId }],
      }] },
    });
    expect(String(res.result_type ?? "")).toBe("ok");
    expect(String(stub.state.transport_instances[transportId].region_id)).toBe(dest);
  });

  it("test_load_infantry_onto_adjacent_transport", (ctx) => {
    const stub = new GameSessionStub();
    stub.initializeDemo(12345);
    for (let i = 0; i < 1; i++) {
      stub.applyCommand({ command_id: `ep_${i}`, player_id: "allies", type: "end_phase", payload: {} });
    }
    const pair = landSeaWithTransport(stub, "allies");
    if (pair === null) {
      ctx.skip("No land/sea transport setup on demo map");
      return;
    }
    const res = stub.applyCommand({
      command_id: "load_inf",
      player_id: "allies",
      type: "load_transport",
      payload: {
        transport_instance_id: pair.transport_id,
        from_region_id: pair.land,
        units: [{ unit_type_id: "infantry", count: 1 }],
      },
    });
    expect(String(res.result_type ?? "")).toBe("ok");
    expect(stub.state.transport_instances[pair.transport_id].cargo.length).toBe(1);
  });
});
