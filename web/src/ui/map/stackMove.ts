import type { Dict } from "../../engine/model/types";

/** The `move_units` payload for one stack, including a ship instance when the piece has one. */
export function moveUnitsPayload(
  fromRegionId: string,
  entry: { unit_type_id: string; instance_id?: string },
  target: string,
  count: number,
): Dict {
  const unit: Dict = { unit_type_id: entry.unit_type_id, count };
  if (entry.instance_id) {
    unit.instance_id = entry.instance_id;
  }
  return {
    moves: [{ from_region_id: fromRegionId, to_region_id: target, units: [unit] }],
  };
}
