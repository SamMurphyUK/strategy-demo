/** Shop basket rules. The panel stages a purchase locally until Confirm. */

export const UNCONFIRMED_BASKET_MESSAGE =
  "You have unconfirmed units in your requisition basket. Confirm purchase or clear basket before ending phase";

/** True when one more of this unit still fits in the IPC that is left. */
export function canStageAnother(unitCost: number, availableIpc: number, stagedTotal: number): boolean {
  return unitCost > 0 && stagedTotal + unitCost <= availableIpc;
}

/** End phase throws the basket away. Block that while anything is still staged. */
export function purchasePhaseAdvance(stagedTotal: number): { advance: boolean; warning: string | null } {
  if (stagedTotal > 0) {
    return { advance: false, warning: UNCONFIRMED_BASKET_MESSAGE };
  }
  return { advance: true, warning: null };
}
