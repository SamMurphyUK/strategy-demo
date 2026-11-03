import { afterEach, describe, expect, it } from "vitest";
import type { Dict } from "../../src/engine/model/types";
import { MultiplayerHost } from "../../src/multiplayer/host";
import { MultiplayerSession } from "../../src/multiplayer/multiplayer_client";

function territory(id: string, type: "land" | "sea", neighbors: string[], faction: string, ipc = 0): Dict {
  return {
    polygon: [
      [0, 0],
      [1, 0],
      [0, 1],
    ],
    neighbors,
    metadata: {
      region_id: id,
      name: id,
      faction,
      ipc,
      type,
      victory: false,
      factory: type === "land",
    },
  };
}

/** Five powers, no shared borders, so a turn can be passed without a battle. */
function powersMap(): Dict {
  return {
    version: 2,
    coord_space: "svg",
    turn_order: ["ussr", "ger", "uk", "jap", "usa"],
    regions: [
      territory("moscow", "land", [], "USSR", 1),
      territory("berlin", "land", [], "GER", 1),
      territory("london", "land", [], "UK", 1),
      territory("tokyo", "land", [], "JAP", 1),
      territory("washington", "land", [], "USA", 1),
    ],
    starting_units: [
      { region_id: "moscow", faction_id: "ussr", unit_type_id: "infantry", count: 1 },
      { region_id: "berlin", faction_id: "ger", unit_type_id: "infantry", count: 1 },
      { region_id: "london", faction_id: "uk", unit_type_id: "infantry", count: 1 },
      { region_id: "tokyo", faction_id: "jap", unit_type_id: "infantry", count: 1 },
      { region_id: "washington", faction_id: "usa", unit_type_id: "infantry", count: 1 },
    ],
  };
}

/** Germany moves first. Poland is a UK land battle. */
function battleMap(): Dict {
  return {
    version: 2,
    coord_space: "svg",
    turn_order: ["ger", "uk", "ussr", "jap", "usa"],
    regions: [
      territory("berlin", "land", ["poland", "baltic"], "GER", 5),
      territory("poland", "land", ["berlin"], "UK", 2),
      territory("baltic", "sea", ["berlin"], "Neutral", 0),
    ],
    starting_units: [
      { region_id: "berlin", faction_id: "ger", unit_type_id: "infantry", count: 4 },
      { region_id: "berlin", faction_id: "ger", unit_type_id: "tank", count: 1 },
      { region_id: "baltic", faction_id: "ger", unit_type_id: "transport", count: 1 },
      { region_id: "poland", faction_id: "uk", unit_type_id: "infantry", count: 6 },
    ],
  };
}

function board(client: MultiplayerSession) {
  if (client.snapshot == null) {
    throw new Error("client has no snapshot");
  }
  return client.snapshot;
}

function eventTypes(client: MultiplayerSession): string[] {
  return client.frames.flatMap((frame) => frame.events.map((event) => event.type));
}

describe("multiplayer client", () => {
  let host: MultiplayerHost;
  const sessions: MultiplayerSession[] = [];

  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((session) => session.close()));
    if (host) {
      await host.close();
    }
  });

  async function listen(): Promise<string> {
    host = new MultiplayerHost();
    const port = await host.listen(0);
    expect(port).not.toBe(5173);
    return `ws://127.0.0.1:${port}`;
  }

  function open(url: string, playerToken: string): MultiplayerSession {
    const session = new MultiplayerSession({ url, playerToken, storage: null });
    sessions.push(session);
    return session;
  }

  async function play(actor: MultiplayerSession, peer: MultiplayerSession, command: Dict) {
    const result = await actor.sendCommand(command);
    if (result.type !== "sync") {
      throw new Error(`${String(command.type)} rejected: ${result.code} ${result.message}`);
    }
    await peer.waitForSeq(result.seq);
    return result;
  }

  async function passFaction(actor: MultiplayerSession, peer: MultiplayerSession, serial: { n: number }) {
    const start = board(actor).turn_info.current_faction_id;
    let guard = 0;
    while (board(actor).turn_info.current_faction_id === start) {
      if (++guard > 8) {
        throw new Error(`turn did not end from ${board(actor).turn_info.current_phase}`);
      }
      const phase = board(actor).turn_info.current_phase;
      await play(actor, peer, {
        command_id: `pass-${start}-${++serial.n}`,
        player_id: start,
        type: phase === "collect_income" ? "end_turn" : "end_phase",
        payload: {},
      });
    }
  }

  it("lets two tabs claim Axis and Allies and swaps isMyTurn as the turn advances", async () => {
    const url = await listen();
    host.openLobby("table", { map: powersMap() });
    const axis = open(url, "axis-tab");
    const allies = open(url, "allies-tab");
    expect(axis.playerToken).not.toBe(allies.playerToken);

    await Promise.all([axis.connect("table"), allies.connect("table")]);
    await axis.claim("axis");
    await allies.claim("allies");

    expect(axis.yourFactions).toEqual(["ger", "jap"]);
    expect(allies.yourFactions).toEqual(["ussr", "uk", "usa"]);
    expect(board(allies).turn_info.current_faction_id).toBe("ussr");
    expect(allies.isMyTurn()).toBe(true);
    expect(axis.isMyTurn()).toBe(false);

    const serial = { n: 0 };
    await passFaction(allies, axis, serial);
    expect(board(axis).turn_info.current_faction_id).toBe("ger");
    expect(axis.isMyTurn()).toBe(true);
    expect(allies.isMyTurn()).toBe(false);
    expect(axis.blocksBattleInput()).toBe(false);
    expect(allies.blocksBattleInput()).toBe(true);

    await passFaction(axis, allies, serial);
    expect(board(allies).turn_info.current_faction_id).toBe("uk");
    expect(allies.isMyTurn()).toBe(true);
    expect(axis.isMyTurn()).toBe(false);
    expect(board(axis)).toEqual(board(allies));
  });

  it("feeds the spectator the host battle and blocks a local battle roll", async () => {
    const url = await listen();
    host.createRoom({
      roomId: "battle",
      map: battleMap(),
      seats: [
        { playerToken: "ger-tab", factions: ["ger"], seatId: "germany" },
        { playerToken: "uk-tab", factions: ["uk"], seatId: "britain" },
      ],
    });
    const ger = open(url, "ger-tab");
    const uk = open(url, "uk-tab");
    await Promise.all([ger.connect("battle"), uk.connect("battle")]);
    expect(ger.isMyTurn()).toBe(true);
    expect(uk.isMyTurn()).toBe(false);
    expect(uk.blocksBattleInput()).toBe(true);

    let n = 0;
    const command = (type: string, payload: Dict = {}): Dict => ({
      command_id: `battle-${++n}`,
      player_id: "ger",
      type,
      payload,
    });

    await play(ger, uk, command("purchase_units", { purchases: [{ unit_type_id: "infantry", count: 1 }] }));
    await play(ger, uk, command("end_phase"));
    await play(
      ger,
      uk,
      command("move_units", {
        moves: [
          {
            from_region_id: "berlin",
            to_region_id: "poland",
            units: [{ unit_type_id: "infantry", count: 2 }],
          },
        ],
      }),
    );
    await play(ger, uk, command("end_phase"));
    await play(ger, uk, command("start_battle", { region_id: "poland" }));
    await play(ger, uk, command("battle_roll"));

    expect(eventTypes(uk)).toContain("battlestarted");
    expect(eventTypes(uk)).toContain("dicerolled");
    expect(uk.frames).toEqual(ger.frames);
    expect(board(uk)).toEqual(board(ger));
    expect(board(uk).active_battle).not.toBeNull();

    const frames = uk.frames.length;
    const seq = uk.seq;
    const blocked = uk.localBattleRoll();
    expect(blocked.accepted).toBe(false);
    expect(blocked.reason).toBe("OPPONENT_TURN");
    expect(uk.blocksBattleInput()).toBe(true);
    expect(uk.frames.length).toBe(frames);
    expect(uk.seq).toBe(seq);
    expect(ger.localBattleRoll().accepted).toBe(true);
  });
});
