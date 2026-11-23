import { handlePlannerMessage, type PlannerRequest } from "./planAITurn";

interface WorkerScope {
  onmessage: ((event: MessageEvent<PlannerRequest>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event: MessageEvent<PlannerRequest>) => {
  const plan = handlePlannerMessage(event.data);
  scope.postMessage({
    commands: plan.commands.map((command) => ({
      command_id: command.command_id,
      player_id: command.player_id,
      type: command.type,
      payload: command.payload,
    })),
    evaluatedPlans: plan.evaluatedPlans,
    expectedScoreDelta: plan.expectedScoreDelta,
    elapsedMs: plan.elapsedMs,
  });
};
