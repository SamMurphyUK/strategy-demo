import { describe, expect, it } from "vitest";
import { holdsReturnGlide, planeWasShotDown } from "../../../src/ui/battle/sortieReturn";

describe("sortie return", () => {
  it("keeps a living plane on the glide home", () => {
    expect(planeWasShotDown({ type: "fighter", status: "alive", currentHp: 1 })).toBe(false);
    expect(holdsReturnGlide(0.9, false)).toBe(false);
  });

  it("drops the glide home once a shot-down plane would turn back", () => {
    const wreck = { type: "fighter", isDestroyed: true, status: "downed", currentHp: 0 };
    expect(planeWasShotDown(wreck)).toBe(true);
    expect(holdsReturnGlide(0.7, true)).toBe(false);
    expect(holdsReturnGlide(0.82, true)).toBe(true);
  });

  it("still brings a carrier's own sortie back", () => {
    expect(planeWasShotDown({ type: "carrier", isDestroyed: true, currentHp: 0 })).toBe(false);
  });
});
