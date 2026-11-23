/** Five Industrial Output buys one roll. A 6 unlocks. A miss carries one pip onto the next roll. */
export const RESEARCH_COST = 5;

export interface ResearchState {
  pity: number;
  unlocked: string[];
}

export function researchRoll(state: ResearchState, face: number, discovery: string): ResearchState {
  const roll = Math.min(6, Math.max(1, Math.trunc(face)));
  const effective = roll + state.pity;
  if (effective >= 6) {
    const unlocked = state.unlocked.includes(discovery) ? state.unlocked : [...state.unlocked, discovery];
    return { pity: 0, unlocked };
  }
  return { pity: state.pity + 1, unlocked: [...state.unlocked] };
}

export function canAffordResearch(treasury: number): boolean {
  return treasury >= RESEARCH_COST;
}
