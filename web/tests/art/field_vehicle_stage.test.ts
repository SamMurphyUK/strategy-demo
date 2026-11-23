// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createVehicleStage, type VehicleSvgUnit } from "../../src/art/fieldVehicleStage";

const camera = { cssWidth: 120, cssHeight: 80, camX: 0, camY: 0, viewScale: 1 };

function tank(href: string): VehicleSvgUnit {
  return {
    id: "ger-tank",
    x: 40,
    y: 50,
    unitScale: 1,
    rootX: -10,
    rootY: -20,
    parts: [{ role: "torso", href, x: 0, y: 0, width: 192, height: 96, resolution: 4 }],
  };
}

describe("vehicle stage frames", () => {
  it("keeps the current tank picture until the next frame has loaded", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const stage = createVehicleStage(svg);
    stage.sync(camera, [tank("/idle_0.svg")], null);
    const scale = svg.querySelector("[data-scale]");
    expect(scale).toBeTruthy();
    const first = scale?.querySelector("image");
    expect(first?.getAttribute("href")).toBe("/idle_0.svg");
    first?.dispatchEvent(new Event("load"));

    stage.sync(camera, [tank("/idle_3.svg")], null);
    const images = [...(scale?.querySelectorAll("image") ?? [])];
    expect(images.map((image) => image.getAttribute("href"))).toEqual(["/idle_0.svg", "/idle_3.svg"]);
    expect(images[0]?.hasAttribute("visibility")).toBe(false);
    expect(images[1]?.getAttribute("visibility")).toBe("hidden");

    images[1]?.dispatchEvent(new Event("load"));
    expect(images[0]?.getAttribute("visibility")).toBe("hidden");
    expect(images[1]?.hasAttribute("visibility")).toBe(false);

    stage.sync(camera, [tank("/idle_0.svg")], null);
    expect(scale?.querySelectorAll("image")).toHaveLength(2);
    expect(images[0]?.hasAttribute("visibility")).toBe(false);
    expect(images[1]?.getAttribute("visibility")).toBe("hidden");
  });
});
