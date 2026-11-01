// Command and event payloads are untyped GDScript Dictionaries in the source engine.
export type Dict = Record<string, any>;

export interface UnitStackEntry {
  faction_id: string;
  unit_type_id: string;
  count: number;
  instance_id?: string;
  /** Legacy per-unit id used by MovementValidator.get_legal_moves_for_unit and the carrier checker. */
  id?: number;
  /** Legacy per-unit region used alongside `id`. */
  region?: string;
}

export interface CargoLine {
  unit_type_id: string;
  count: number;
}

export interface TransportInstance {
  instance_id?: string;
  unit_type_id?: string;
  cargo: CargoLine[];
  region_id: string;
}

export interface PurchaseLine {
  unit_type_id: string;
  count: number;
}

export function isDict(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Godot `duplicate(true)`: copies nested arrays and dictionaries, but Objects
 * (class instances here) stay shared references.
 */
export function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => deepCopy(v)) as T;
  }
  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Dict = {};
    for (const key of Object.keys(value)) {
      out[key] = deepCopy((value as Dict)[key]);
    }
    return out as T;
  }
  return value;
}
