import { type Dict, isDict } from "./types";

export class Unit {
  id = "";
  name = "";
  category = "";
  attack = 0;
  defense = 0;
  movement = 0;
  cost = 0;
  container: Dict = {};
  special: Dict = {};

  static fromDict(data: Dict): Unit {
    const unit = new Unit();
    unit.id = String(data.id ?? "");
    unit.name = data.name ?? "";
    unit.category = data.category ?? "";
    unit.attack = toInt(data.attack ?? 0);
    unit.defense = toInt(data.defense ?? 0);
    unit.movement = toInt(data.movement ?? data.move ?? 0);
    unit.cost = toInt(data.cost ?? 0);
    unit.container = isDict(data.container) ? data.container : {};
    unit.special = isDict(data.special) ? data.special : {};
    return unit;
  }

  static isContainerUnit(unit: Unit | null | undefined): boolean {
    return unit != null && isDict(unit.container) && Object.keys(unit.container).length > 0;
  }
}

export type UnitType = Unit;

export function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
