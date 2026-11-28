import { useEffect } from "react";
import type { OpReport } from "./specialOps";

/**
 * The window a raid's result opens in: a centred, framed black viewport, the place a cinematic will go, with the headless result
 * written inside it. The game waits for Continue. It is a presentation layer only: the raid was resolved by the engine before this is
 * shown, and nothing here reaches back into the simulation, so headless play and AI turns never meet it.
 */
export function OpsCinematic({ report, onContinue }: { report: OpReport; onContinue(): void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        onContinue();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onContinue]);

  return (
    <div className="ops-cinema" role="dialog" aria-modal="true" aria-label={report.title}>
      <div className="ops-cinema-frame">
        <header className="ops-cinema-title">{report.title}</header>
        <div className="ops-cinema-screen">
          <p className={`ops-cinema-headline is-${report.outcome}`}>{report.headline}</p>
          <ul className="ops-cinema-lines">
            {report.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <footer className="ops-cinema-foot">
          <button type="button" className="primary" onClick={onContinue} autoFocus>
            Continue
          </button>
        </footer>
      </div>
    </div>
  );
}
