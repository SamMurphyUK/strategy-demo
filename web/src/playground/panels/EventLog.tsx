import { useEffect, useRef } from "react";
import type { LogEntry } from "../session/use_game_session";

export function EventLog({ log }: { log: LogEntry[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [log]);

  return (
    <section className="panel event-log">
      <h2>Events</h2>
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
    </section>
  );
}
