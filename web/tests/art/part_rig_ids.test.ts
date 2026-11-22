import { describe, expect, it } from "vitest";
import { readPartFile } from "../../src/art/partRig";

const wing = {
  kind: "rig-part",
  version: 1,
  name: "Far wing",
  layer: "legs",
  width: 1,
  height: 1,
  drawings: [[0]],
};

describe("part rig ids", () => {
  it("accepts a capital letter in a part id", () => {
    expect(readPartFile({ ...wing, id: "legs_farWing" }).id).toBe("legs_farWing");
  });

  it("rejects a part id with a space", () => {
    expect(() => readPartFile({ ...wing, id: "legs far" })).toThrow(/missing its name/);
  });
});
