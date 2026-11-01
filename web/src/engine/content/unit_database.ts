import type { Dict } from "../model/types";
import { type JsonLoader, loadJson } from "./res";

export class UnitDatabase {
  /** id -> raw unit dictionary (not a Unit instance). */
  units: Record<string, Dict> = {};

  constructor(private readonly load: JsonLoader = loadJson) {}

  loadFromJson(path: string): void {
    const data = this.load(path);
    if (!Array.isArray(data.units)) {
      return;
    }
    this.units = {};
    for (const unitDef of data.units as Dict[]) {
      if (!("id" in unitDef)) {
        continue;
      }
      this.units[String(unitDef.id)] = unitDef;
    }
  }
}
