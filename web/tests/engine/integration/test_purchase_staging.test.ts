import { describe, expect, it } from "vitest";
import { type Dict, GameSessionStub } from "../../../src/engine";

function hasEvent(events: Dict[], typeName: string): boolean {
  return events.some((e) => String(e.type ?? "") === typeName);
}

function totalUnits(snapshot: Dict): number {
  let total = 0;
  for (const regionEntry of snapshot.regions ?? []) {
    for (const u of regionEntry.units ?? []) {
      total += Math.trunc(Number(u.count ?? 0));
    }
  }
  return total;
}

describe("integration/test_purchase_staging", () => {
  it("test_purchase_updates_pending_without_placing_units", () => {
    const demoStub = new GameSessionStub();
    demoStub.initializeDemo(12345);
    const before = demoStub.getState();
    const unitsBefore = totalUnits(before);
    const res = demoStub.applyCommand({
      command_id: "staging_1",
      player_id: "allies",
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    expect(String(res.result_type ?? "")).toBe("ok");
    expect(hasEvent(res.events ?? [], "unitspurchased")).toBe(true);
    const after = demoStub.getState();
    expect("allies" in (after.pending_purchases ?? {})).toBe(true);
    expect(Math.trunc(Number((after.pending_purchases ?? {}).allies?.[0]?.count ?? 0))).toBe(1);
    expect(unitsBefore).toBe(totalUnits(after));
  });
});
