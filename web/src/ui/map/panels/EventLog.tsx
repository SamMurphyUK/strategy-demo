import { Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "../session/use_game_session";

export function EventLog({ log }: { log: LogEntry[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [log, collapsed]);

  return (
    <section className={collapsed ? "panel event-log is-collapsed" : "panel event-log"}>
      <h2>
        <span>Events</span>
        <button
          type="button"
          className="hud-fold"
          aria-label={collapsed ? "Expand events" : "Collapse events"}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <Copy size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </h2>
      <div className="event-fold" aria-hidden={collapsed}>
        <div className="event-fold-inner">
          {log.length === 0 ? (
            <p className="muted">Nothing yet.</p>
          ) : (
            <ol ref={listRef}>
              {log.map((entry) => (
                <li key={entry.id} className={entry.kind === "error" ? "log-error" : ""}>
                  {entry.text}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
