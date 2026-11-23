import { useEffect, useState, type ReactNode } from "react";

/** Engine phases that open the right drawer. Purchase is the wide catalog. Mobilize is the slim tray. */
export function drawerMode(phase: string): "purchase" | "mobilize" | "closed" {
  if (phase === "purchase") {
    return "purchase";
  }
  if (phase === "mobilize") {
    return "mobilize";
  }
  return "closed";
}

export function PhaseDrawer({ phase, children }: { phase: string; children: ReactNode }) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const mode = entered ? drawerMode(phase) : "closed";
  return (
    <div className="hud-drawer-host" aria-hidden={mode === "closed"}>
      <div className={`hud-drawer hud-drawer-buy${mode === "purchase" ? " is-open" : ""}`}>
        {mode === "purchase" ? children : null}
      </div>
      <div className={`hud-drawer hud-drawer-place${mode === "mobilize" ? " is-open" : ""}`}>
        {mode === "mobilize" ? children : null}
      </div>
    </div>
  );
}
