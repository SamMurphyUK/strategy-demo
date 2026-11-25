import { describe, expect, it } from "vitest";
import { stackLabel } from "../../../src/ui/map/stackLabel";

describe("the stack tooltip", () => {
  it("shows the count only when there is more than one unit", () => {
    expect(stackLabel("Stahlhelm infantry", "Infantry", 1)).toBe("Stahlhelm infantry (Infantry)");
    expect(stackLabel("Stahlhelm infantry", "Infantry", 3)).toBe("Stahlhelm infantry (Infantry × 3)");
    expect(stackLabel("Stahlhelm infantry", "Infantry", 2)).toBe("Stahlhelm infantry (Infantry × 2)");
  });

  it("falls back to the type alone when the faction has no name for it", () => {
    expect(stackLabel(null, "Tank", 1)).toBe("Tank");
    expect(stackLabel("", "Tank", 4)).toBe("Tank × 4");
  });

  it("ignores a count that is not a number", () => {
    expect(stackLabel(undefined, "Tank", Number.NaN)).toBe("Tank");
    expect(stackLabel(undefined, "Tank", 0)).toBe("Tank");
  });
});
