import { describe, expect, it } from "vitest";
import type { Dict } from "../../../src/engine/model/types";
import { RegionUnitDisplay } from "../../../src/engine/presentation/region_unit_display";
import { GameSessionStub } from "../../../src/engine/session/game_session_stub";
import { describeEvent } from "../../../src/ui/map/session/event_text";

// Walks one full turn the way the playground UI does and checks every event renders as text.
describe("playground turn walk", () => {
  it("purchases, moves, fights, places and ends the turn with readable events", () => {
    const s = new GameSessionStub();
    s.initializeDemo(12345);
    const events: Dict[] = [];
    let n = 0;
    const send = (type: string, payload: Dict = {}) => {
      n += 1;
      const r = s.applyCommand({
        command_id: `t_${n}`,
        player_id: s.state.current_faction_id,
        type,
        payload,
      });
      events.push(...r.events);
      return r;
    };

    const faction = s.state.current_faction_id;
    expect(s.state.current_phase).toBe("purchase");
    expect(send("purchase_units", { purchases: [{ unit_type_id: "infantry", count: 1 }] }).result_type).toBe("ok");
    expect(send("end_phase").result_type).toBe("ok");
    expect(s.state.current_phase).toBe("combat_move");

    let moved = false;
    for (const regionId of Object.keys(s.state.region_units).sort()) {
      const entries = RegionUnitDisplay.buildDisplayEntries(s.state.getFactionUnitsInRegion(regionId, faction));
      for (const entry of entries) {
        if (entry.instance_id) {
          continue;
        }
        const dests = s.getLegalMoveDestinations(regionId, entry.unit_type_id, faction, "");
        const max = s.state.movableStackCount(faction, regionId, entry.unit_type_id);
        if (dests.length > 0 && max > 0) {
          const r = send("move_units", {
            moves: [
              {
                from_region_id: regionId,
                to_region_id: dests[0],
                units: [{ unit_type_id: entry.unit_type_id, count: max }],
              },
            ],
          });
          expect(r.result_type).toBe("ok");
          moved = true;
          break;
        }
      }
      if (moved) {
        break;
      }
    }
    expect(moved).toBe(true);

    while (s.state.current_phase !== "mobilize") {
      expect(send("end_phase").result_type).toBe("ok");
    }
    const targets = s.getLegalMobilizeRegions(faction, "infantry");
    expect(targets.length).toBeGreaterThan(0);
    expect(
      send("place_units", { placements: [{ region_id: targets[0], units: [{ unit_type_id: "infantry", count: 1 }] }] })
        .result_type,
    ).toBe("ok");
    expect(send("end_phase").result_type).toBe("ok");
    expect(s.getLegalCommands(faction)).toContain("end_turn");
    expect(send("end_turn").result_type).toBe("ok");
    expect(s.state.current_faction_id).not.toBe(faction);

    const types = new Set(events.map((e) => String(e.type)));
    for (const t of ["unitspurchased", "phasechanged", "unitsmoved", "unitsplaced", "incomecollected", "turnended"]) {
      expect(types).toContain(t);
    }
    for (const evt of events) {
      const text = describeEvent(evt, s.state.unit_types);
      expect(text, `event ${String(evt.type)}`).not.toMatch(/undefined|NaN|\{/);
    }
  });
});
