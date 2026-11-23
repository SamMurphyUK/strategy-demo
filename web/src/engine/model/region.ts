import type { Dict } from "./types";
import { toInt } from "./unit";

export type RegionType = "land" | "sea";

export class Region {
  id = "";
  name = "";
  type: string = "";
  ipc_value = 0;
  owner_faction_id = "";
  is_capital = false;
  has_factory = false;
  adjacent: string[] = [];
  /** Optional land cover for the 1940 terrain rules. Empty stays open and is not saved. */
  land_cover = "";
  airbase = false;
  harbor = false;
  /** Game round through which the airbase stays closed. Zero means it is open. */
  airbase_disabled_until = 0;
  /** Game round through which the harbor stays closed. Zero means it is open. */
  harbor_disabled_until = 0;
  /** A major industrial complex. Omitted from saves while false. */
  major_factory = false;
  /** A forward depot. Omitted from saves while false. */
  forward_depot = false;
  /** Printed build output. Zero uses the territory value. */
  base_output = 0;
  /** A convoy sea zone. Omitted from saves while false. */
  is_convoy_zone = false;

  static fromDict(data: Dict): Region {
    const region = new Region();
    region.id = String(data.id ?? "");
    region.name = String(data.name ?? "");
    region.type = String(data.type ?? "land");
    region.ipc_value = toInt(data.ipc_value ?? 0);
    region.owner_faction_id = String(data.owner_faction_id ?? "");
    region.is_capital = Boolean(data.is_capital ?? false);
    region.has_factory = Boolean(data.has_factory ?? false);
    const adj: unknown[] = Array.isArray(data.adjacent) ? data.adjacent : [];
    region.adjacent = adj.map((a) => String(a));
    region.land_cover = String(data.land_cover ?? "");
    region.airbase = data.airbase === true;
    region.harbor = data.harbor === true;
    region.airbase_disabled_until = toInt(data.airbase_disabled_until ?? 0);
    region.harbor_disabled_until = toInt(data.harbor_disabled_until ?? 0);
    region.major_factory = data.major_factory === true;
    region.forward_depot = data.forward_depot === true;
    region.base_output = toInt(data.base_output ?? 0);
    region.is_convoy_zone = data.is_convoy_zone === true;
    return region;
  }

  isLandRegion(): boolean {
    return this.type === "land";
  }

  isSeaRegion(): boolean {
    return this.type === "sea";
  }

  toDict(): Dict {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      ipc_value: this.ipc_value,
      owner_faction_id: this.owner_faction_id,
      is_capital: this.is_capital,
      has_factory: this.has_factory,
      adjacent: this.adjacent,
      ...(this.land_cover !== "" ? { land_cover: this.land_cover } : {}),
      ...(this.airbase ? { airbase: true } : {}),
      ...(this.harbor ? { harbor: true } : {}),
      ...(this.airbase_disabled_until > 0 ? { airbase_disabled_until: this.airbase_disabled_until } : {}),
      ...(this.harbor_disabled_until > 0 ? { harbor_disabled_until: this.harbor_disabled_until } : {}),
      ...(this.major_factory ? { major_factory: true } : {}),
      ...(this.forward_depot ? { forward_depot: true } : {}),
      ...(this.base_output > 0 ? { base_output: this.base_output } : {}),
      ...(this.is_convoy_zone ? { is_convoy_zone: true } : {}),
    };
  }
}
