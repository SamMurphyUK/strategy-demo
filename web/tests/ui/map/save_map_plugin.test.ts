import { describe, expect, it } from "vitest";
import demo from "../../../../demomap01.json";
import { validateMapJson } from "../../../dev/saveMapPlugin.mjs";

const region = (id: string, vertices = 3) => ({
  metadata: { region_id: id },
  polygon: Array.from({ length: vertices }, (_, i) => [i, i * i]),
});

describe("dev-server map save check", () => {
  it("accepts the shipped map", () => {
    expect(validateMapJson(demo)).toBe("");
  });

  it("rejects maps the app could not load", () => {
    expect(validateMapJson(null)).not.toBe("");
    expect(validateMapJson({ regions: [] })).not.toBe("");
    expect(validateMapJson({ regions: [{ polygon: [] }] })).toContain("region_id");
    expect(validateMapJson({ regions: [region("A"), region("A")] })).toContain("twice");
    expect(validateMapJson({ regions: [region("A", 2)] })).toContain("fewer than 3");
  });
});
