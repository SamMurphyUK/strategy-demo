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
    };
  }
}
