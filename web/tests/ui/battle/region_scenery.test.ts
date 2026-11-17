import { describe, expect, it } from "vitest";
import { MILITARY } from "../../../src/ui/theme/militaryPalette";
import { sceneForRegion, sceneRegionList } from "../../../src/ui/battle/scenery/sceneRegions";
import { sceneRandom, sceneSeed, type LandScene, type SeaScene } from "../../../src/ui/battle/scenery/regionScene";
import {
  paintGround,
  paintHorizon,
  paintInlandEdge,
  paintSeaHorizon,
  seaLook,
  type Paint,
} from "../../../src/ui/battle/scenery/sceneryPaint";

const PALETTE = new Set<string>(Object.values(MILITARY));

function recorder(): Paint & { log: string[]; colours: Set<string> } {
  const log: string[] = [];
  const colours = new Set<string>();
  const call = (name: string) => (...args: unknown[]) => {
    log.push(`${name}(${args.map((a) => (typeof a === "number" ? a.toFixed(2) : String(a))).join(",")})`);
  };
  let fill = "";
  let stroke = "";
  return {
    log,
    colours,
    get fillStyle() {
      return fill;
    },
    set fillStyle(v: string) {
      fill = v;
      colours.add(v);
      log.push(`fill=${v}`);
    },
    get strokeStyle() {
      return stroke;
    },
    set strokeStyle(v: string) {
      stroke = v;
      colours.add(v);
      log.push(`stroke=${v}`);
    },
    lineWidth: 1,
    globalAlpha: 1,
    fillRect: call("fillRect"),
    beginPath: call("beginPath"),
    moveTo: call("moveTo"),
    lineTo: call("lineTo"),
    closePath: call("closePath"),
    fill: call("fill"),
    stroke: call("stroke"),
    arc: call("arc"),
    ellipse: call("ellipse"),
    save: call("save"),
    restore: call("restore"),
  } as Paint & { log: string[]; colours: Set<string> };
}

function land(id: string): LandScene {
  const scene = sceneForRegion(id);
  if (scene?.kind !== "land") throw new Error(`${id} is not a land region`);
  return scene;
}

function sea(id: string): SeaScene {
  const scene = sceneForRegion(id);
  if (scene?.kind !== "sea") throw new Error(`${id} is not a sea zone`);
  return scene;
}

function paintLand(scene: LandScene) {
  const ctx = recorder();
  paintHorizon(ctx, scene, 1280);
  paintGround(ctx, scene, 1280);
  if (!scene.coastal) paintInlandEdge(ctx, scene, 1280, 720);
  return ctx;
}

describe("region scenes", () => {
  it("gives Germany's capital its Berlin landmarks over a German street grid", () => {
    const germany = land("Germany");
    expect(germany.settlement).toBe("capital");
    expect(germany.culture).toBe("german");
    expect(germany.biome).toBe("temperate");
    expect(germany.landmarks).toEqual(["brandenburg_gate", "reichstag", "flak_tower"]);
  });

  it("themes North Africa as desert settlements", () => {
    for (const id of ["Libya", "Egypt", "Algiers", "Morocco"]) {
      const scene = land(id);
      expect(scene.biome).toBe("desert");
      expect(scene.culture).toBe("arab");
    }
    expect(land("Egypt").landmarks).toContain("pyramids");
  });

  it("runs the sea along the bottom of coastal regions and land below inland ones", () => {
    expect(land("Libya").coastal).toBe(true);
    expect(land("Moscow").coastal).toBe(false);
    expect(land("Moscow").landmarks).toEqual(["kremlin", "st_basils"]);
  });

  it("splits islands into Atlantic and Pacific looks by the ocean around them", () => {
    expect(land("Midway").island).toBe("pacific");
    expect(land("Hawaii").island).toBe("pacific");
    expect(land("Iceland").island).toBe("atlantic");
    expect(land("Malta").island).toBe("atlantic");
    expect(land("Germany").island).toBeNull();
  });

  it("places each sea zone in its ocean", () => {
    expect(sea("Sea Zone 14").ocean).toBe("arctic");
    expect(sea("Sea Zone 33").ocean).toBe("mediterranean");
    expect(sea("Sea Zone 08").ocean).toBe("atlantic");
    expect(sea("Sea Zone 28").ocean).toBe("indian");
    expect(sea("Sea Zone 60").ocean).toBe("pacific");
  });

  it("gives every board region a scene", () => {
    const regions = sceneRegionList();
    expect(regions.length).toBeGreaterThan(150);
    for (const region of regions) expect(sceneForRegion(region.id)?.kind).toBe(region.type);
  });

  it("seeds each region from its id alone", () => {
    expect(sceneSeed("Germany")).toBe(sceneSeed("Germany"));
    expect(sceneSeed("Germany")).not.toBe(sceneSeed("Poland"));
    const a = sceneRandom(sceneSeed("Germany"));
    const b = sceneRandom(sceneSeed("Germany"));
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("baked scenery", () => {
  it("paints the same region identically every time", () => {
    expect(paintLand(land("Germany")).log).toEqual(paintLand(land("Germany")).log);
    const one = recorder();
    const two = recorder();
    paintSeaHorizon(one, sea("Sea Zone 14"), 1280);
    paintSeaHorizon(two, sea("Sea Zone 14"), 1280);
    expect(one.log).toEqual(two.log);
  });

  it("paints different regions differently", () => {
    const logs = ["Germany", "Libya", "Moscow", "Japan", "Midway", "Ukraine"].map((id) => paintLand(land(id)).log.join("|"));
    expect(new Set(logs).size).toBe(logs.length);
    const seas = ["Sea Zone 14", "Sea Zone 15", "Sea Zone 33", "Sea Zone 60"].map((id) => {
      const ctx = recorder();
      paintSeaHorizon(ctx, sea(id), 1280);
      return ctx.log.join("|");
    });
    expect(new Set(seas).size).toBe(seas.length);
  });

  it("varies the swell between neighbouring sea zones", () => {
    expect(seaLook(sea("Sea Zone 14")).phase).not.toBe(seaLook(sea("Sea Zone 15")).phase);
    expect(seaLook(sea("Sea Zone 14")).ice).toBe(true);
    expect(seaLook(sea("Sea Zone 60")).ice).toBe(false);
  });

  it("keeps every region to the 16-colour palette", () => {
    for (const region of sceneRegionList()) {
      const scene = sceneForRegion(region.id)!;
      const ctx = recorder();
      if (scene.kind === "land") {
        paintHorizon(ctx, scene, 1280);
        paintGround(ctx, scene, 1280);
        paintInlandEdge(ctx, scene, 1280, 720);
      } else {
        paintSeaHorizon(ctx, scene, 1280);
      }
      for (const colour of ctx.colours) expect(PALETTE, `${region.id} used ${colour}`).toContain(colour);
    }
  });
});
