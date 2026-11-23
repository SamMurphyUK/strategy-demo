import { monteCarloMessage, type MonteCarloRequest } from "../rules/optional/montecarlo";

const scope = globalThis as {
  onmessage: ((event: { data: MonteCarloRequest }) => void) | null;
  postMessage: (data: unknown) => void;
};

scope.onmessage = (event) => {
  scope.postMessage(monteCarloMessage(event.data));
};
