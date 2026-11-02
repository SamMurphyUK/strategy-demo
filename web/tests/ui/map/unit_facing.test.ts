import { describe, expect, it } from "vitest";
import type { Rect } from "../../../src/ui/map/geometry";
import {
  campaignSameTeam,
  facingSign,
  nearestEnemyFacing,
  nextFacingHold,
  type FacingRegion,
  type FacingStacks,
} from "../../../src/ui/map/uprightSprites";

const bounds: Rect = { x: 0, y: 0, w: 800, h: 504 };
const home = { x: 100, y: 80 };

function teamOf(id: string): string {
  if (id === "ger" || id === "jap") return "axis";
  if (id === "ussr" || id === "uk" || id === "usa") return "allies";
  return id;
}

const sameTeam = (a: string, b: string) => a !== "" && b !== "" && teamOf(a) === teamOf(b);

describe("upright facing", () => {
  it("faces right toward a nearer enemy and left when the short way around the map is left", () => {
    const regions: FacingRegion[] = [
      { id: "home", anchor: home, owner: "uk", factions: ["uk"] },
      { id: "east", anchor: { x: 180, y: 80 }, owner: "ger", factions: ["ger"] },
      { id: "ally", anchor: { x: 40, y: 80 }, owner: "ussr", factions: ["ussr"] },
      { id: "far", anchor: { x: 760, y: 80 }, owner: "jap", factions: ["jap"] },
    ];
    expect(nearestEnemyFacing("home", home, "uk", regions, bounds, true, sameTeam)).toBe(1);
    expect(facingSign(home, { x: 180, y: 80 }, bounds, true)).toBe(1);

    const across: FacingRegion[] = [
      { id: "home", anchor: { x: 20, y: 80 }, owner: "usa", factions: ["usa"] },
      { id: "seam", anchor: { x: 780, y: 80 }, owner: "jap", factions: ["jap"] },
      { id: "long", anchor: { x: 220, y: 80 }, owner: "ger", factions: ["ger"] },
    ];
    expect(nearestEnemyFacing("home", across[0].anchor, "usa", across, bounds, true, sameTeam)).toBe(-1);
    expect(nearestEnemyFacing("home", across[0].anchor, "usa", across, bounds, false, sameTeam)).toBe(1);
  });

  it("ignores allies, empty land, and an enemy standing in the same region", () => {
    const quiet: FacingRegion[] = [
      { id: "home", anchor: home, owner: "ger", factions: ["ger", "uk"] },
      { id: "friend", anchor: { x: 40, y: 80 }, owner: "jap", factions: ["jap"] },
      { id: "empty", anchor: { x: 200, y: 80 }, owner: "", factions: [] },
    ];
    expect(nearestEnemyFacing("home", home, "ger", quiet, bounds, true, sameTeam)).toBe(1);

    const sea: FacingRegion[] = [
      { id: "home", anchor: home, owner: "uk", factions: ["uk"] },
      { id: "channel", anchor: { x: 40, y: 90 }, owner: "", factions: ["ger"] },
      { id: "far", anchor: { x: 300, y: 80 }, owner: "ger", factions: ["ger"] },
    ];
    expect(nearestEnemyFacing("home", home, "uk", sea, bounds, true, sameTeam)).toBe(-1);
    expect(nearestEnemyFacing("home", home, "uk", sea, bounds, true)).toBe(-1);
    expect(campaignSameTeam("uk", "ussr")).toBe(true);
    expect(campaignSameTeam("uk", "ger")).toBe(false);
    expect(facingSign(home, { x: 100, y: 10 }, bounds, true)).toBe(1);
  });

  it("faces the heavier enemy when a region sits between two forces", () => {
    const regions: FacingRegion[] = [
      { id: "home", anchor: home, owner: "ger", factions: ["ger"] },
      { id: "near", anchor: { x: 40, y: 80 }, owner: "uk", factions: ["uk"], stacks: [{ factionId: "uk", count: 2 }] },
      { id: "far", anchor: { x: 260, y: 80 }, owner: "ussr", factions: ["ussr"], stacks: [{ factionId: "ussr", count: 9 }] },
    ];
    expect(nearestEnemyFacing("home", home, "ger", regions, bounds, true, sameTeam)).toBe(1);
    const oneSide: FacingRegion[] = [
      { id: "home", anchor: home, owner: "ger", factions: ["ger"] },
      { id: "empty", anchor: { x: 40, y: 80 }, owner: "uk", factions: [], stacks: [] },
      { id: "army", anchor: { x: 260, y: 80 }, owner: "ussr", factions: ["ussr"], stacks: [{ factionId: "ussr", count: 9 }] },
    ];
    expect(nearestEnemyFacing("home", home, "ger", oneSide, bounds, true, sameTeam)).toBe(-1);
    const tied: FacingRegion[] = [
      { id: "home", anchor: home, owner: "ger", factions: ["ger"] },
      { id: "near", anchor: { x: 40, y: 80 }, owner: "uk", factions: ["uk"], stacks: [{ factionId: "uk", count: 5 }] },
      { id: "far", anchor: { x: 260, y: 80 }, owner: "ussr", factions: ["ussr"], stacks: [{ factionId: "ussr", count: 5 }] },
    ];
    expect(nearestEnemyFacing("home", home, "ger", tied, bounds, true, sameTeam)).toBe(-1);
    const axisTeam = (a: string, b: string) => {
      const side = (id: string) => (id === "axis" || id === "ger" || id === "jap" ? "axis" : "allies");
      return a !== "" && b !== "" && side(a) === side(b);
    };
    const german: FacingRegion[] = [
      { id: "home", anchor: home, owner: "ger", factions: ["axis"] },
      { id: "own", anchor: { x: 40, y: 80 }, owner: "ger", factions: ["ger"], stacks: [{ factionId: "ger", count: 12 }] },
      { id: "threat", anchor: { x: 180, y: 80 }, owner: "uk", factions: ["uk"], stacks: [{ factionId: "uk", count: 3 }] },
    ];
    expect(nearestEnemyFacing("home", home, "axis", german, bounds, true, axisTeam)).toBe(1);
  });

  it("keeps the combat-move snapshot until the next faction starts its combat move", () => {
    const opening: FacingStacks = { west: [{ factionId: "uk", count: 4 }] };
    const moved: FacingStacks = { west: [{ factionId: "uk", count: 1 }], east: [{ factionId: "ussr", count: 8 }] };
    const first = nextFacingHold(null, false, "purchase", "1|ussr", opening);
    expect(first.locked).toBe(false);
    expect(first.stacks).toBe(opening);
    const held = nextFacingHold(first, true, "combat_move", "1|ussr", opening);
    expect(held.locked).toBe(true);
    const during = nextFacingHold(held, true, "combat_move", "1|ussr", moved);
    expect(during.stacks).toBe(opening);
    const later = nextFacingHold(during, true, "combat", "1|ussr", moved);
    expect(later.stacks).toBe(opening);
    const germany = nextFacingHold(later, true, "combat_move", "1|ger", moved);
    expect(germany.stacks).toBe(moved);
    const restarted = nextFacingHold(germany, false, "purchase", "1|ussr", opening);
    expect(restarted.stacks).toBe(opening);
    expect(restarted.locked).toBe(false);
  });
});
