/** Shop basket rules. The panel stages a purchase locally until Confirm. */

export const UNCONFIRMED_BASKET_MESSAGE =
  "Unconfirmed requisition basket! Confirm purchase or clear basket before ending phase";

/** True when one more of this unit still fits in the IPC that is left. */
export function canStageAnother(unitCost: number, availableIpc: number, stagedTotal: number): boolean {
  return unitCost > 0 && stagedTotal + unitCost <= availableIpc;
}

export function stagedSpend(staged: Record<string, number>, costs: Record<string, number>): number {
  return Object.entries(staged).reduce((sum, [id, count]) => sum + (costs[id] ?? 0) * Math.max(0, count), 0);
}

/** One stepper click. A burst applies each click to the basket left by the click before it. */
export function stageStep(
  staged: Record<string, number>,
  id: string,
  delta: number,
  costs: Record<string, number>,
  availableIpc: number,
): Record<string, number> {
  const cost = costs[id] ?? 0;
  const count = Math.max(0, (staged[id] ?? 0) + delta);
  if (delta > 0 && !canStageAnother(cost, availableIpc, stagedSpend(staged, costs))) {
    return staged;
  }
  if (count === (staged[id] ?? 0)) {
    return staged;
  }
  return { ...staged, [id]: count };
}

/** End phase throws the basket away. Block that while anything is still staged. */
export function purchasePhaseAdvance(stagedTotal: number): { advance: boolean; warning: string | null } {
  if (stagedTotal > 0) {
    return { advance: false, warning: UNCONFIRMED_BASKET_MESSAGE };
  }
  return { advance: true, warning: null };
}
