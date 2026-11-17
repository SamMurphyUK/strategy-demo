import { describe, expect, it } from "vitest";
import {
  ROSTER_CUES,
  ROSTER_NAMES,
  type RosterKey,
  type RosterUnit,
  rosterKey,
  rosterName,
  rosterUnit,
} from "../../../src/ui/theme/factionRoster";
import { factionSilhouette } from "../../../src/ui/theme/tokens/factionSilhouettes";
import { unitSilhouette } from "../../../src/ui/map/tokenStyle";

const KEYS: RosterKey[] = ["GER", "USSR", "UK", "US", "JAP", "MINOR"];
const FACTION_ID: Record<RosterKey, string> = { GER: "ger", USSR: "ussr", UK: "uk", US: "usa", JAP: "jap", MINOR: "" };
const DRAWN: RosterUnit[] = ["infantry", "artillery", "tank", "fighter", "bomber", "submarine", "destroyer", "cruiser", "carrier", "battleship"];

describe("faction roster", () => {
  it("names each power's machines as briefed", () => {
    expect(Object.values(ROSTER_NAMES.GER).slice(0, 10)).toEqual([
      "Stahlhelm infantry", "10.5cm leFH 18", "Panzer IV / Tiger I", "Bf 109", "He 111",
      "Type VII U-Boat", "Narvik destroyer", "Hipper cruiser", "Graf Zeppelin carrier", "Bismarck battleship",
    ]);
    expect(Object.values(ROSTER_NAMES.USSR).slice(0, 10)).toEqual([
      "Ssh-40 infantry", "ZiS-3 gun", "T-34/85", "Yak-3", "Pe-2/Il-4",
      "Shchuka sub", "Gnevny destroyer", "Kirov cruiser", "Project 72 carrier", "Sovetsky Soyuz battleship",
    ]);
    expect(Object.values(ROSTER_NAMES.UK).slice(0, 10)).toEqual([
      "Brodie-helmet infantry", "QF 25-pounder", "Churchill/Cromwell", "Spitfire", "Lancaster",
      "T-class sub", "Tribal destroyer", "County cruiser", "Illustrious carrier", "King George V battleship",
    ]);
    expect(Object.values(ROSTER_NAMES.US).slice(0, 10)).toEqual([
      "M1-helmet infantry", "M2A1 105mm", "M4 Sherman", "P-51 Mustang", "B-17",
      "Gato sub", "Fletcher destroyer", "Baltimore cruiser", "Essex carrier", "Iowa battleship",
    ]);
    expect(Object.values(ROSTER_NAMES.JAP).slice(0, 10)).toEqual([
      "Type 90 havelock infantry", "Type 91 105mm", "Type 97 Chi-Ha", "A6M Zero", "G4M Betty",
      "I-400 sub", "Kagero destroyer", "Takao cruiser", "Shokaku carrier", "Yamato battleship",
    ]);
  });

  it("maps engine faction ids to the five powers and everyone else to the minor set", () => {
    expect(rosterKey("ger")).toBe("GER");
    expect(rosterKey("ussr")).toBe("USSR");
    expect(rosterKey("uk")).toBe("UK");
    expect(rosterKey("usa")).toBe("US");
    expect(rosterKey("jap")).toBe("JAP");
    expect(rosterKey("")).toBe("MINOR");
    expect(rosterKey("neutral")).toBe("MINOR");
    expect(rosterKey("italy")).toBe("MINOR");
  });

  it("keeps rules ids: aliases share a slot, and pieces with no counterpart have none", () => {
    expect(rosterUnit("armor")).toBe("tank");
    expect(rosterUnit("sub")).toBe("submarine");
    expect(rosterUnit("strategic_bomber")).toBe("bomber");
    expect(rosterUnit("tactical_bomber")).toBe("bomber");
    expect(rosterUnit("aaa")).toBeNull();
    expect(rosterUnit("mech_infantry")).toBeNull();
    expect(rosterName("tank", "usa")).toBe("M4 Sherman");
    expect(rosterName("battleship", "jap")).toBe("Yamato battleship");
    expect(rosterName("aaa", "ger")).toBeNull();
  });

  it("gives every faction its own cues, the minor set included", () => {
    const prints = KEYS.map((k) => JSON.stringify(ROSTER_CUES[k]));
    expect(new Set(prints).size).toBe(KEYS.length);
    expect(new Set(KEYS.map((k) => ROSTER_CUES[k].helmet)).size).toBe(KEYS.length);
  });
});

describe("faction silhouettes", () => {
  it("draws a different outline for each faction's piece of every drawn type", () => {
    for (const unit of DRAWN) {
      const id = unit === "bomber" ? "strategic_bomber" : unit;
      const prints = KEYS.map((k) => JSON.stringify(factionSilhouette(id, FACTION_ID[k])));
      expect(new Set(prints).size, unit).toBe(KEYS.length);
    }
  });

  it("stays inside the token", () => {
    for (const k of KEYS) {
      for (const unit of [...DRAWN, "tactical_bomber"]) {
        for (const part of factionSilhouette(unit, FACTION_ID[k]) ?? []) {
          for (const p of part) {
            expect(Math.hypot(p.x, p.y), `${k} ${unit}`).toBeLessThanOrEqual(0.5);
          }
        }
      }
    }
  });

  it("keeps the tactical and strategic bomber apart within a faction", () => {
    for (const k of KEYS) {
      expect(JSON.stringify(factionSilhouette("tactical_bomber", FACTION_ID[k]))).not.toBe(
        JSON.stringify(factionSilhouette("strategic_bomber", FACTION_ID[k])),
      );
    }
  });

  it("uses the faction outline on the map when the owner is known, the shared one otherwise", () => {
    expect(unitSilhouette("tank", "ger")).toEqual(factionSilhouette("tank", "ger"));
    expect(JSON.stringify(unitSilhouette("tank"))).not.toBe(JSON.stringify(unitSilhouette("tank", "ger")));
    expect(unitSilhouette("aaa", "ger")).toEqual(unitSilhouette("aaa"));
  });
});
