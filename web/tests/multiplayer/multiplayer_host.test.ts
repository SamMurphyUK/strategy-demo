import { afterEach, describe, expect, it } from "vitest";
import type { Dict } from "../../src/engine/model/types";
import { MultiplayerClient } from "../../src/multiplayer/client";
import { MultiplayerHost, type Room } from "../../src/multiplayer/host";
import type { SyncBody } from "../../src/multiplayer/protocol";

const HIDDEN_RNG_KEYS = new Set(["rng", "rng_state", "pcg", "prng"]);

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

/** Germany moves first. Poland is a UK land battle. The Baltic holds a German transport. */
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

function leaksRng(value: unknown, cursor: { state: string }): boolean {
  if (JSON.stringify(value).includes(cursor.state)) {
    return true;
  }
  return hasHiddenKey(value);
}

function hasHiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasHiddenKey(item));
  }
  if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value as Dict)) {
      if (HIDDEN_RNG_KEYS.has(key) || hasHiddenKey((value as Dict)[key])) {
        return true;
      }
    }
  }
  return false;
}

function board(client: MultiplayerClient): SyncBody["snapshot"] {
  if (client.snapshot == null) {
    throw new Error("client has no snapshot");
  }
  return client.snapshot;
}

function eventTypes(client: MultiplayerClient): string[] {
  return client.frames.flatMap((frame) => frame.events.map((event) => event.type));
}

describe("multiplayer host", () => {
  let host: MultiplayerHost;
  const clients: MultiplayerClient[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    if (host) {
      await host.close();
    }
  });

  async function open(map: Dict, seats: { playerToken: string; factions: string[]; seatId: string }[], seed = 12345) {
    host = new MultiplayerHost();
    const room = host.createRoom({ map, seed, seats });
    const port = await host.listen(0);
    expect(port).not.toBe(5173);
    const url = `ws://127.0.0.1:${port}`;
    const connected: MultiplayerClient[] = [];
    for (const seat of seats) {
      const client = await MultiplayerClient.connect(url, room.id, seat.playerToken);
      clients.push(client);
      connected.push(client);
    }
    return { room, url, clients: connected };
  }

  async function play(actor: MultiplayerClient, peer: MultiplayerClient, command: Dict) {
    const result = await actor.sendCommand(command);
    if (result.type !== "sync") {
      throw new Error(`${String(command.type)} rejected: ${result.code} ${result.message}`);
    }
    await peer.waitForSeq(result.seq);
    return result;
  }

  async function passFaction(actor: MultiplayerClient, peer: MultiplayerClient, serial: { n: number }) {
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

  it("refuses a ger seat during uk's turn, including a spoofed uk player_id", async () => {
    const { clients: seats } = await open(powersMap(), [
      { playerToken: "axis-token", factions: ["ger", "jap"], seatId: "axis" },
      { playerToken: "allies-token", factions: ["ussr", "uk", "usa"], seatId: "allies" },
    ]);
    const axis = seats[0];
    const allies = seats[1];
    const serial = { n: 0 };
    await passFaction(allies, axis, serial);
    await passFaction(axis, allies, serial);
    expect(board(axis).turn_info.current_faction_id).toBe("uk");

    const seq = axis.seq;
    const ukIpc = board(axis).ipc.uk;
    const gerIpc = board(axis).ipc.ger;
    const early = await axis.sendCommand({
      command_id: "ger-early",
      player_id: "ger",
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    const spoof = await axis.sendCommand({
      command_id: "spoof-uk",
      player_id: "uk",
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });

    expect(early).toMatchObject({ type: "rejected", code: "OUT_OF_TURN" });
    expect(spoof).toMatchObject({ type: "rejected", code: "UNAUTHORIZED" });
    expect(axis.seq).toBe(seq);
    expect(board(allies).ipc.uk).toBe(ukIpc);
    expect(board(allies).ipc.ger).toBe(gerIpc);

    await play(allies, axis, {
      command_id: "spoof-uk",
      player_id: "uk",
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    expect(board(allies).ipc.uk).toBe(ukIpc - 3);

    await passFaction(allies, axis, serial);
    await passFaction(axis, allies, serial);
    await passFaction(allies, axis, serial);
    await passFaction(allies, axis, serial);
    expect(board(axis).turn_info.current_faction_id).toBe("ger");
    const before = board(axis).ipc.ger;
    await play(axis, allies, {
      command_id: "ger-early",
      player_id: "ger",
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    expect(board(axis).ipc.ger).toBe(before - 3);
    expect(allies.frames).toEqual(axis.frames);
  });

  it("lets one axis token play both ger and jap when each turn arrives", async () => {
    const { clients: seats } = await open(powersMap(), [
      { playerToken: "axis-token", factions: ["ger", "jap"], seatId: "axis" },
      { playerToken: "allies-token", factions: ["ussr", "uk", "usa"], seatId: "allies" },
    ]);
    const axis = seats[0];
    const allies = seats[1];
    const serial = { n: 0 };
    await passFaction(allies, axis, serial);

    const gerBefore = board(axis).ipc.ger;
    await play(axis, allies, {
      command_id: "buy-ger",
      player_id: "ger",
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    expect(board(axis).ipc.ger).toBe(gerBefore - 3);

    await passFaction(axis, allies, serial);
    await passFaction(allies, axis, serial);
    expect(board(axis).turn_info.current_faction_id).toBe("jap");

    const japBefore = board(axis).ipc.jap;
    await play(axis, allies, {
      command_id: "buy-jap",
      player_id: "jap",
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    expect(board(axis).ipc.jap).toBe(japBefore - 3);
    expect(board(axis).pending_purchases.jap).toEqual([{ unit_type_id: "infantry", count: 1 }]);
    expect(axis.frames.map((frame) => frame.command.command_id)).toEqual(expect.arrayContaining(["buy-ger", "buy-jap"]));
    expect(allies.frames).toEqual(axis.frames);
    expect(board(allies)).toEqual(board(axis));
  });

  it("keeps two clients on the same snapshots and battle events", async () => {
    const { clients: seats } = await open(battleMap(), [
      { playerToken: "ger-token", factions: ["ger"], seatId: "germany" },
      { playerToken: "uk-token", factions: ["uk"], seatId: "britain" },
    ]);
    const ger = seats[0];
    const uk = seats[1];
    expect(board(ger)).toEqual(board(uk));

    let n = 0;
    const command = (type: string, payload: Dict = {}, playerId = "ger"): Dict => ({
      command_id: `battle-${++n}`,
      player_id: playerId,
      type,
      payload,
    });

    await play(ger, uk, command("purchase_units", { purchases: [{ unit_type_id: "infantry", count: 1 }] }));
    await play(ger, uk, command("end_phase"));
    expect(board(ger).turn_info.current_phase).toBe("combat_move");
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
    expect(board(ger).turn_info.current_phase).toBe("combat");
    await play(ger, uk, command("start_battle", { region_id: "poland" }));

    let guard = 0;
    while (board(ger).active_battle != null && board(ger).active_battle?.stage !== "awaiting_casualties") {
      if (++guard > 12) {
        throw new Error(`battle never asked for casualties: ${JSON.stringify(board(ger).active_battle)}`);
      }
      await play(ger, uk, command("battle_roll"));
    }
    expect(board(ger).active_battle?.stage).toBe("awaiting_casualties");
    await play(ger, uk, command("battle_casualties"));

    guard = 0;
    while (board(ger).active_battle != null) {
      if (++guard > 40) {
        throw new Error("battle did not finish");
      }
      const stage = board(ger).active_battle?.stage;
      await play(ger, uk, command(stage === "awaiting_casualties" ? "battle_casualties" : "battle_roll"));
    }
    await play(ger, uk, command("end_phase"));

    const types = eventTypes(ger);
    expect(types).toContain("unitspurchased");
    expect(types).toContain("unitsmoved");
    expect(types).toContain("battlestarted");
    expect(types).toContain("dicerolled");
    expect(types).toContain("unitsdestroyed");
    expect(types).toContain("phasechanged");
    expect(uk.frames).toEqual(ger.frames);
    expect(board(uk)).toEqual(board(ger));
    expect(board(ger).turn_info.current_phase).toBe("noncombat_move");

    const infantry = board(ger)
      .regions.flatMap((region) => region.units)
      .filter((unit) => unit.unit_type_id === "infantry");
    expect(infantry.length).toBeGreaterThan(0);
    expect(infantry.every((unit) => unit.instance_id == null)).toBe(true);
  });

  it("syncs cancel_phase_order without touching cargo or the host dice cursor", async () => {
    const { room, clients: seats } = await open(battleMap(), [
      { playerToken: "ger-token", factions: ["ger"], seatId: "germany" },
      { playerToken: "uk-token", factions: ["uk"], seatId: "britain" },
    ]);
    const ger = seats[0];
    const uk = seats[1];
    const transportId = Object.keys(board(ger).transport_instances)[0];
    let n = 0;
    const command = (type: string, payload: Dict): Dict => ({
      command_id: `cargo-${++n}`,
      player_id: "ger",
      type,
      payload,
    });

    await play(ger, uk, command("end_phase", {}));
    await play(
      ger,
      uk,
      command("load_transport", {
        transport_instance_id: transportId,
        from_region_id: "berlin",
        units: [{ unit_type_id: "infantry", count: 1 }],
      }),
    );
    await play(
      ger,
      uk,
      command("move_units", {
        moves: [
          {
            from_region_id: "berlin",
            to_region_id: "poland",
            units: [{ unit_type_id: "infantry", count: 1 }],
          },
        ],
      }),
    );
    await play(
      ger,
      uk,
      command("move_units", {
        moves: [
          {
            from_region_id: "berlin",
            to_region_id: "poland",
            units: [{ unit_type_id: "tank", count: 1 }],
          },
        ],
      }),
    );
    expect(board(ger).phase_orders).toHaveLength(3);
    expect(board(ger).transport_instances[transportId].cargo).toEqual([{ unit_type_id: "infantry", count: 1 }]);

    const cursor = room.rngCursor();
    await play(ger, uk, command("cancel_phase_order", { index: 2 }));
    const infantryOrder = board(ger).phase_orders.find((order) => order.unitType === "infantry" && order.kind == null);
    expect(infantryOrder).toBeTruthy();
    await play(ger, uk, command("cancel_phase_order", { order_id: infantryOrder?.id }));

    expect(room.rngCursor()).toEqual(cursor);
    expect(board(ger).transport_instances[transportId].cargo).toEqual([{ unit_type_id: "infantry", count: 1 }]);
    expect(board(ger).phase_orders.map((order) => order.kind)).toEqual(["load_transport"]);
    expect(eventTypes(ger)).toContain("phaseordercancelled");
    expect(uk.frames).toEqual(ger.frames);
    expect(board(uk)).toEqual(board(ger));
    expect(leaksRng(board(ger), cursor)).toBe(false);
  });

  it("hydrates a reconnecting client with cargo and staged orders, and hides the dice cursor", async () => {
    const { room, url, clients: seats } = await open(battleMap(), [
      { playerToken: "ger-token", factions: ["ger"], seatId: "germany" },
      { playerToken: "uk-token", factions: ["uk"], seatId: "britain" },
    ]);
    const ger = seats[0];
    const uk = seats[1];
    const transportId = Object.keys(board(ger).transport_instances)[0];
    let n = 0;
    const command = (type: string, payload: Dict): Dict => ({
      command_id: `re-${++n}`,
      player_id: "ger",
      type,
      payload,
    });

    await play(ger, uk, command("end_phase", {}));
    await play(
      ger,
      uk,
      command("load_transport", {
        transport_instance_id: transportId,
        from_region_id: "berlin",
        units: [{ unit_type_id: "infantry", count: 1 }],
      }),
    );
    await play(
      ger,
      uk,
      command("move_units", {
        moves: [
          {
            from_region_id: "berlin",
            to_region_id: "poland",
            units: [{ unit_type_id: "tank", count: 1 }],
          },
        ],
      }),
    );

    const seq = ger.seq;
    await ger.close();
    const again = await MultiplayerClient.connect(url, room.id, "ger-token");
    clients.push(again);

    expect(again.seq).toBe(seq);
    expect(again.seatAssignments).toEqual([
      { seatId: "germany", factions: ["ger"] },
      { seatId: "britain", factions: ["uk"] },
    ]);
    expect(again.yourFactions).toEqual(["ger"]);
    expect(again.snapshot).toEqual(board(uk));
    expect(again.snapshot).toEqual(room.session.clientSnapshot());
    expect(again.snapshot?.transport_instances[transportId].cargo).toEqual([{ unit_type_id: "infantry", count: 1 }]);
    expect(again.snapshot?.phase_orders.map((order) => order.unitType)).toEqual(["infantry", "tank"]);
    expect(room.session.getState().transport_instances[transportId].cargo).toEqual([{ unit_type_id: "infantry", count: 1 }]);
    expect(room.session.getState().phase_orders.map((order) => order.id)).toEqual(
      again.snapshot?.phase_orders.map((order) => order.id),
    );
    expect(again.frames).toEqual([]);
    expect(leaksRng(again.snapshot, room.rngCursor())).toBe(false);

    const stacks = again.snapshot?.regions.flatMap((region) => region.units) ?? [];
    const infantry = stacks.filter((unit) => unit.unit_type_id === "infantry");
    expect(infantry.every((unit) => unit.instance_id == null)).toBe(true);
    expect(stacks.some((unit) => unit.unit_type_id === "transport" && unit.instance_id === transportId)).toBe(true);
  });
});
