// Whether the unit transform inspector is open. It is opened by the T key and by the button in the
// Board Look drawer, so the state lives here and not in either of them.

let open = false;
const listeners = new Set<() => void>();

export function getInspectorOpen(): boolean {
  return open;
}

export function setInspectorOpen(next: boolean): void {
  if (next === open) {
    return;
  }
  open = next;
  for (const listener of listeners) {
    listener();
  }
}

export function toggleInspector(): void {
  setInspectorOpen(!open);
}

export function subscribeInspector(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
