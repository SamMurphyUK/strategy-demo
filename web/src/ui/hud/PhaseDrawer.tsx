import { useEffect, useRef, useState, type ReactNode } from "react";

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

/** How long a drawer keeps its contents after it starts sliding out, so it leaves whole instead of emptying first. */
const EXIT_MS = 340;

/** True while `open`, and for EXIT_MS after it turns false. */
function useRetained(open: boolean): boolean {
  const [retained, setRetained] = useState(open);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (open) {
      setRetained(true);
    } else {
      timer.current = window.setTimeout(() => setRetained(false), EXIT_MS);
    }
    return () => window.clearTimeout(timer.current);
  }, [open]);
  return open || retained;
}

export function PhaseDrawer({ phase, children }: { phase: string; children: ReactNode }) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const mode = entered ? drawerMode(phase) : "closed";
  const buyMounted = useRetained(mode === "purchase");
  const placeMounted = useRetained(mode === "mobilize");
  return (
    <div className="hud-drawer-host" aria-hidden={mode === "closed"}>
      <div className={`hud-drawer hud-drawer-buy${mode === "purchase" ? " is-open" : ""}`}>
        {buyMounted ? children : null}
      </div>
      <div className={`hud-drawer hud-drawer-place${mode === "mobilize" ? " is-open" : ""}`}>
        {placeMounted ? children : null}
      </div>
    </div>
  );
}
