import { useState } from "react";
import { factionName } from "../session/event_text";
import type { RoomControls } from "../session/use_campaign_session";

const FACTION_ORDER = ["ussr", "ger", "uk", "jap", "usa"];

function statusLabel(status: RoomControls["status"]): string {
  switch (status) {
    case "connecting":
      return "Connecting";
    case "open":
      return "Open";
    case "reconnecting":
      return "Reconnecting";
    case "closed":
      return "Closed";
    default:
      return "Local";
  }
}

function holder(faction: string, room: RoomControls): string {
  if (room.yourFactions.includes(faction)) {
    return "You";
  }
  if (room.takenFactions.includes(faction)) {
    return "Opponent";
  }
  return "Open";
}

export function RoomPill({ room }: { room: RoomControls }) {
  const [open, setOpen] = useState(false);
  const [roomId, setRoomId] = useState(room.roomId || "table");
  const inRoom = room.status === "open" || room.status === "reconnecting";
  const label = inRoom ? `[ ROOM: ${room.roomId} ]` : "[ LOCAL ]";

  return (
    <div className="room-pill-wrap">
      <button
        type="button"
        className="room-pill"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open && (
        <div className="room-popover" role="dialog" aria-label="Multiplayer room">
          <p className="room-status">Status: {statusLabel(room.status)}</p>
          <label className="room-id">
            Room ID
            <input
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
              spellCheck={false}
              autoCapitalize="off"
            />
          </label>
          <div className="room-actions">
            <button type="button" onClick={() => room.connect(roomId)}>
              Connect
            </button>
            {inRoom && (
              <button type="button" onClick={() => room.disconnect()}>
                Leave
              </button>
            )}
          </div>
          <ul className="room-seats">
            {FACTION_ORDER.map((faction) => (
              <li key={faction}>
                <span>{factionName(faction)}</span>
                <b>{holder(faction, room)}</b>
              </li>
            ))}
          </ul>
          <div className="room-actions">
            <button type="button" disabled={!inRoom} onClick={() => room.claim("axis")}>
              [ Claim Axis ]
            </button>
            <button type="button" disabled={!inRoom} onClick={() => room.claim("allies")}>
              [ Claim Allies ]
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
