// `res://` paths resolve to the Godot project's own JSON so both engines read one copy of the data.
import eventSchema from "../../../../docs/event_schema.json";
import demoMap01 from "../../../../demomap01.json";
import dataFactions from "../../../../data/factions.json";
import dataRegions from "../../../../data/regions.json";
import dataScenario1940Minimal from "../../../../data/scenario_1940_minimal.json";
import dataStartingUnits from "../../../../data/starting_units.json";
import dataUnits from "../../../../data/units.json";
import minimalFactions from "../../../../data/scenarios/minimal/factions.json";
import minimalMap from "../../../../data/scenarios/minimal/map.json";
import minimalRules from "../../../../data/scenarios/minimal/rules.json";
import minimalSetup from "../../../../data/scenarios/minimal/setup.json";
import minimalUnits from "../../../../data/scenarios/minimal/units.json";
import { type Dict, deepCopy } from "../model/types";

const RES_FILES: Record<string, unknown> = {
  "res://docs/event_schema.json": eventSchema,
  "res://demomap01.json": demoMap01,
  "res://data/factions.json": dataFactions,
  "res://data/regions.json": dataRegions,
  "res://data/scenario_1940_minimal.json": dataScenario1940Minimal,
  "res://data/starting_units.json": dataStartingUnits,
  "res://data/units.json": dataUnits,
  "res://data/scenarios/minimal/factions.json": minimalFactions,
  "res://data/scenarios/minimal/map.json": minimalMap,
  "res://data/scenarios/minimal/rules.json": minimalRules,
  "res://data/scenarios/minimal/setup.json": minimalSetup,
  "res://data/scenarios/minimal/units.json": minimalUnits,
};

/**
 * Port of GameSessionFactory.load_json. Returns a fresh deep copy each call, as
 * FileAccess + JSON.parse_string does, so callers can mutate the result freely.
 */
export function loadJson(path: string): Dict {
  const data = RES_FILES[path];
  if (data === undefined || typeof data !== "object" || data === null || Array.isArray(data)) {
    return {};
  }
  return deepCopy(data) as Dict;
}

export type JsonLoader = (path: string) => Dict;
