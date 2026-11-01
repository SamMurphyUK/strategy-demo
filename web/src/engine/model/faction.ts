import type { Dict } from "./types";
import { toInt } from "./unit";

export class Faction {
  id = "";
  name = "";
  color = "#FFFFFF";
  starting_ipc = 0;
  turn_order = 0;
  /** Allied powers share a team. Empty means this faction is hostile to every other faction. */
  team = "";

  static fromDict(data: Dict): Faction {
    const faction = new Faction();
    faction.id = data.id ?? "";
    faction.name = data.name ?? "";
    faction.color = data.color ?? "#FFFFFF";
    faction.starting_ipc = toInt(data.starting_ipc ?? 0);
    faction.turn_order = toInt(data.turn_order ?? 0);
    faction.team = String(data.team ?? "");
    return faction;
  }
}
