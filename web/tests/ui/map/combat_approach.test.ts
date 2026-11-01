import { describe, expect, it } from "vitest";
import { flagMotifForFaction, ipcLostCaption } from "../../../src/ui/battle/flagMotif";
import {
  attackBriefingLines,
  combatGoal,
  lerpView,
  viewCenter,
  viewFor,
} from "../../../src/ui/map/combatCamera";

describe("combat approach", () => {
  it("reads the attack as faction, faction, and region", () => {
    const lines = attackBriefingLines("Germany", "Soviet Union", "Eastern Europe");
    expect(lines).toEqual(["GERMANY IS ATTACKING", "SOVIET UNION", "AT EASTERN EUROPE"]);
    expect(lines.join(" ")).toBe("GERMANY IS ATTACKING SOVIET UNION AT EASTERN EUROPE");
  });

  it("zooms in on the territory, and a later fight keeps that zoom", () => {
    const bounds = { x: 10, y: 20, w: 100, h: 50 };
    const zoomed = combatGoal({ x: 0, y: 0, k: 1 }, bounds, 800, 600, 1, "zoom");
    expect(zoomed.center).toEqual({ x: 60, y: 45 });
    expect(zoomed.k).toBeCloseTo(6.56);

    const panned = combatGoal({ x: 0, y: 0, k: zoomed.k }, { x: 400, y: 80, w: 30, h: 30 }, 800, 600, 1, "pan");
    expect(panned.k).toBe(zoomed.k);
    expect(panned.center).toEqual({ x: 415, y: 95 });
  });

  it("still closes in when the territory is most of the map", () => {
    const goal = combatGoal({ x: 0, y: 0, k: 0.05 }, { x: 0, y: 0, w: 10000, h: 5000 }, 800, 600, 0.05, "zoom");
    expect(goal.k).toBeCloseTo(0.05 * 2.6);
  });

  it("lands the camera on the target at the end of the move", () => {
    const from = viewFor({ x: 0, y: 0 }, 1, 200, 100);
    const to = viewFor({ x: 80, y: 40 }, 4, 200, 100);
    expect(viewCenter(lerpView(from, to, 0, 200, 100), 200, 100)).toEqual({ x: 0, y: 0 });
    const end = lerpView(from, to, 1, 200, 100);
    expect(viewCenter(end, 200, 100)).toEqual({ x: 80, y: 40 });
    expect(end.k).toBeCloseTo(4);
  });

  it("flies the attacker's flag and names the IPC as lost", () => {
    expect(flagMotifForFaction("ger").emblem).toBe("cross");
    expect(flagMotifForFaction("axis").canton).toBe(flagMotifForFaction("germany").canton);
    expect(flagMotifForFaction("ussr").emblem).toBe("star");
    expect(flagMotifForFaction("jap").emblem).toBe("disc");
    expect(flagMotifForFaction("usa").emblem).toBe("stars");
    expect(flagMotifForFaction("uk").emblem).toBe("cross");
    expect(flagMotifForFaction("uk").canton).not.toBe(flagMotifForFaction("ger").canton);
    expect(ipcLostCaption(12)).toBe("12 IPC LOST");
    expect(ipcLostCaption(0)).toBe("0 IPC LOST");
  });
});
