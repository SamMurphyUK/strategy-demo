import { readFileSync, writeFileSync } from "node:fs";
import { buildGlobal1940 } from "../src/ui/map/editor/global1940/buildBoard";

const svg = readFileSync(new URL("../../data/maps/global_vii_land.svg", import.meta.url), "utf8");
const built = buildGlobal1940(svg);
const json = JSON.stringify(built.map);
writeFileSync(new URL("../../data/maps/global_vii_auto.json", import.meta.url), json);
console.log(
  JSON.stringify({
    bytes: json.length,
    regions: (built.map.regions as unknown[]).length,
    placeholders: built.placeholders,
  }),
);
