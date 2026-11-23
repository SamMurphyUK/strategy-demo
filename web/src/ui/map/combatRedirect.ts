/** A combat-move order that can be aimed somewhere else. */

export interface HeldMove {
  id: string;
  toRegionId: string;
  count: number;
  instanceId: string;
}

export function committedMoves(
  orders: readonly {
    id: string;
    faction: string;
    fromRegionId: string;
    unitType: string;
    kind?: string;
    count: number;
    toRegionId: string;
    shipInstanceIds?: string[];
  }[],
  factionId: string,
  regionId: string,
  unitTypeId: string,
  instanceId: string,
): HeldMove[] {
  const found: HeldMove[] = [];
  for (const order of orders) {
    if (order.faction !== factionId || order.fromRegionId !== regionId || order.unitType !== unitTypeId) {
      continue;
    }
    if (order.kind != null && order.kind !== "move") {
      continue;
    }
    const ship = order.shipInstanceIds?.[0] ?? "";
    if (instanceId !== "" && ship !== instanceId) {
      continue;
    }
    if (instanceId === "" && ship !== "") {
      continue;
    }
    found.push({
      id: order.id,
      toRegionId: order.toRegionId,
      count: Math.max(0, Math.trunc(order.count)),
      instanceId: ship,
    });
  }
  return found;
}

/** Orders to put back after `take` units leave those orders for a new destination. */
export function peelHeld(orders: readonly HeldMove[], take: number): HeldMove[] {
  let left = Math.max(0, Math.trunc(take));
  const keep: HeldMove[] = [];
  for (const order of orders) {
    if (left >= order.count) {
      left -= order.count;
      continue;
    }
    if (left > 0) {
      keep.push({ ...order, count: order.count - left });
      left = 0;
      continue;
    }
    keep.push(order);
  }
  return keep;
}
