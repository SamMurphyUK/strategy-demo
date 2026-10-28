import { useEffect, useState } from "react";
import { loadMasterLand, type MasterLand } from "./svgLandLoader";

let pending: Promise<MasterLand> | null = null;

/** Loads the master land stencil once for the page. `land` is null until it arrives, `error` is "" unless it failed. */
export function useMasterLand(): { land: MasterLand | null; error: string } {
  const [state, setState] = useState<{ land: MasterLand | null; error: string }>({ land: null, error: "" });
  useEffect(() => {
    let cancelled = false;
    pending ??= loadMasterLand();
    pending.then(
      (land) => !cancelled && setState({ land, error: "" }),
      (err: unknown) => {
        pending = null;
        if (!cancelled) {
          setState({ land: null, error: err instanceof Error ? err.message : String(err) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
