import { WebSocketServer, WebSocket as HostSocket } from "ws";
import { GameSessionStub } from "../engine/session/game_session_stub";
import { type Dict, isDict } from "../engine/model/types";
import {
  ALLIES_FACTIONS,
  AXIS_FACTIONS,
  MULTIPLAYER_PORT,
  type ResumeBody,
  type SeatAssignment,
  type SeatSpec,
  type ServerMessage,
  type SyncBody,
} from "./protocol";

const CAMPAIGN_DEV_PORT = 5173;
const LOBBY_FACTIONS = ["ussr", "ger", "uk", "jap", "usa"];

export interface RoomOptions {
  roomId?: string;
  seed?: number;
  map?: Dict;
  seats: SeatSpec[];
}

interface Seat {
  seatId: string;
  playerToken: string;
  factions: string[];
}

interface Joined {
  room: Room;
  playerToken: string;
  spectator: boolean;
}

type SubmitOutcome =
  | { kind: "broadcast"; body: SyncBody }
  | { kind: "replay"; body: SyncBody }
  | { kind: "reject"; code: string; message: string };

/**
 * One room, one authoritative `GameSessionStub`.
 * Seat tokens are checked before a command is allowed to touch the session.
 */
export class Room {
  readonly session: GameSessionStub;
  seq = 0;
  private readonly seats: Seat[];
  private readonly accepted = new Map<string, SyncBody>();

  constructor(
    readonly id: string,
    session: GameSessionStub,
    seats: Seat[],
  ) {
    this.session = session;
    this.seats = seats;
  }

  seatAssignments(): SeatAssignment[] {
    return this.seats.map((seat) => ({ seatId: seat.seatId, factions: [...seat.factions] }));
  }

  factionsFor(playerToken: string): string[] | null {
    if (playerToken === "") {
      return null;
    }
    const owned = this.seats.filter((item) => item.playerToken === playerToken);
    if (owned.length === 0) {
      return null;
    }
    return owned.flatMap((item) => item.factions);
  }

  /** A lobby seat still has an empty token, so a connecting tab may claim it. */
  allowsClaim(): boolean {
    return this.seats.some((seat) => seat.playerToken === "");
  }

  takenFactions(): string[] {
    return this.seats.filter((seat) => seat.playerToken !== "").flatMap((seat) => [...seat.factions]);
  }

  /**
   * Bind this token to Axis, Allies, or one faction.
   * Fails without changing seats when any requested faction belongs to someone else.
   */
  claim(
    playerToken: string,
    seatKey: string,
  ): { ok: true; factions: string[] } | { ok: false; code: string; message: string } {
    if (playerToken === "") {
      return { ok: false, code: "UNAUTHORIZED", message: "Unknown seat" };
    }
    const key = seatKey.trim().toLowerCase();
    const bundles: Record<string, readonly string[]> = {
      axis: AXIS_FACTIONS,
      allies: ALLIES_FACTIONS,
    };
    const wanted = bundles[key] ?? [key];
    if (wanted.length === 0 || wanted.some((faction) => faction === "")) {
      return { ok: false, code: "UNKNOWN_SEAT", message: "Unknown seat" };
    }
    const chosen: Seat[] = [];
    for (const faction of wanted) {
      const seat = this.seats.find(
        (item) => item.seatId === faction || (item.factions.length === 1 && item.factions[0] === faction),
      );
      if (!seat || !seat.factions.includes(faction)) {
        return { ok: false, code: "UNKNOWN_SEAT", message: `No seat for ${faction}` };
      }
      if (seat.playerToken !== "" && seat.playerToken !== playerToken) {
        return { ok: false, code: "SEAT_TAKEN", message: `${faction} is already claimed` };
      }
      chosen.push(seat);
    }
    for (const seat of chosen) {
      seat.playerToken = playerToken;
    }
    return { ok: true, factions: this.factionsFor(playerToken) ?? [...wanted] };
  }

  /** Host-only dice cursor. Client snapshots never include this. */
  rngCursor(): { state: string; sequence: string } {
    const cursor = this.session.rng.getState();
    return { state: cursor.state.toString(), sequence: cursor.sequence.toString() };
  }

  resume(): ResumeBody {
    return {
      seq: this.seq,
      seatAssignments: this.seatAssignments(),
      snapshot: this.session.clientSnapshot(),
    };
  }

  /**
   * Rejects a command that is out of turn or from a seat that does not own
   * `command.player_id` before `GameSessionStub.applyCommand`.
   */
  submit(playerToken: string, command: unknown): SubmitOutcome {
    if (!isDict(command) || String(command.type ?? "").trim() === "") {
      return { kind: "reject", code: "BAD_COMMAND", message: "Command type is required" };
    }
    const playerId = String(command.player_id ?? "");
    if (playerId === "") {
      return { kind: "reject", code: "BAD_COMMAND", message: "command.player_id is required" };
    }
    if (playerId !== this.session.state.current_faction_id) {
      return { kind: "reject", code: "OUT_OF_TURN", message: "Not your turn" };
    }
    const factions = this.factionsFor(playerToken);
    if (factions == null || !factions.includes(playerId)) {
      return { kind: "reject", code: "UNAUTHORIZED", message: "Seat does not control this faction" };
    }

    const commandId = String(command.command_id ?? "");
    const prior = commandId === "" ? undefined : this.accepted.get(commandId);
    if (prior) {
      return { kind: "replay", body: prior };
    }

    const result = this.session.applyCommand(command);
    if (result.result_type !== "ok") {
      return {
        kind: "reject",
        code: result.error?.code ?? "REJECTED",
        message: result.error?.message ?? "Command rejected",
      };
    }

    this.seq += 1;
    const body: SyncBody = {
      seq: this.seq,
      command,
      events: result.events,
      snapshot: this.session.clientSnapshot(),
    };
    if (commandId !== "") {
      this.accepted.set(commandId, body);
    }
    return { kind: "broadcast", body };
  }
}

export class MultiplayerHost {
  private readonly rooms = new Map<string, Room>();
  private readonly joined = new Map<HostSocket, Joined>();
  private wss: WebSocketServer | null = null;
  private roomSerial = 0;

  createRoom(options: RoomOptions): Room {
    const id = options.roomId ?? `room-${++this.roomSerial}`;
    if (this.rooms.has(id)) {
      throw new Error(`Room ${id} already exists`);
    }
    const session = new GameSessionStub();
    if (options.map) {
      session.initializeFromMap(options.map, options.seed ?? 12345);
    } else {
      session.initializeDemo(options.seed ?? 12345);
    }

    const claimed = new Set<string>();
    const tokens = new Set<string>();
    const seats: Seat[] = [];
    options.seats.forEach((spec, index) => {
      const playerToken = String(spec.playerToken ?? "");
      if (playerToken === "" || tokens.has(playerToken)) {
        throw new Error("Each seat needs its own player token");
      }
      tokens.add(playerToken);
      const factions = spec.factions.map((faction) => String(faction));
      for (const faction of factions) {
        if (session.state.factions[faction] == null) {
          throw new Error(`Unknown faction ${faction}`);
        }
        if (claimed.has(faction)) {
          throw new Error(`Faction ${faction} is already seated`);
        }
        claimed.add(faction);
      }
      const seatId = spec.seatId ?? `seat-${index + 1}`;
      if (seats.some((seat) => seat.seatId === seatId)) {
        throw new Error(`Duplicate seat id ${seatId}`);
      }
      seats.push({ seatId, playerToken, factions });
    });

    const room = new Room(id, session, seats);
    this.rooms.set(id, room);
    return room;
  }

  /**
   * Create the room when it is missing, with one unclaimed seat per playable faction.
   * An existing room is returned unchanged, including rooms whose seats were assigned up front.
   */
  openLobby(roomId: string, options?: { seed?: number; map?: Dict }): Room {
    const existing = this.rooms.get(roomId);
    if (existing) {
      return existing;
    }
    const session = new GameSessionStub();
    if (options?.map) {
      session.initializeFromMap(options.map, options.seed ?? 12345);
    } else {
      session.initializeDemo(options?.seed ?? 12345);
    }
    const seats: Seat[] = LOBBY_FACTIONS.filter((faction) => session.state.factions[faction] != null).map((faction) => ({
      seatId: faction,
      playerToken: "",
      factions: [faction],
    }));
    const room = new Room(roomId, session, seats);
    this.rooms.set(roomId, room);
    return room;
  }

  /**
   * Binds the game socket. Port 0 asks the OS for a free port (tests).
   * Port 5173 is the campaign dev server and is refused.
   */
  listen(port: number = MULTIPLAYER_PORT): Promise<number> {
    if (port === CAMPAIGN_DEV_PORT) {
      return Promise.reject(new Error("The multiplayer host must not bind port 5173"));
    }
    if (this.wss) {
      return Promise.reject(new Error("Host is already listening"));
    }
    const wss = new WebSocketServer({ host: "127.0.0.1", port });
    this.wss = wss;
    wss.on("connection", (socket) => this.attach(socket));
    return new Promise((resolve, reject) => {
      wss.once("listening", () => {
        const address = wss.address();
        resolve(typeof address === "object" && address ? address.port : port);
      });
      wss.once("error", reject);
    });
  }

  async close(): Promise<void> {
    for (const socket of this.joined.keys()) {
      socket.close();
    }
    this.joined.clear();
    const wss = this.wss;
    this.wss = null;
    if (!wss) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      wss.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private attach(socket: HostSocket): void {
    socket.on("message", (data) => {
      this.onMessage(socket, data.toString());
    });
    socket.on("close", () => {
      this.joined.delete(socket);
    });
  }

  private onMessage(socket: HostSocket, raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.send(socket, { type: "rejected", code: "BAD_MESSAGE", message: "Malformed JSON" });
      return;
    }
    if (!isDict(parsed) || typeof parsed.type !== "string") {
      this.send(socket, { type: "rejected", code: "BAD_MESSAGE", message: "Message type is required" });
      return;
    }
    if (parsed.type === "join") {
      this.join(socket, parsed);
      return;
    }
    if (parsed.type === "claim") {
      this.claimSeat(socket, parsed);
      return;
    }
    if (parsed.type === "command") {
      this.command(socket, parsed);
      return;
    }
    this.send(socket, { type: "rejected", code: "BAD_MESSAGE", message: `Unknown message ${parsed.type}` });
  }

  private join(socket: HostSocket, message: Dict): void {
    if (this.joined.has(socket)) {
      this.send(socket, { type: "rejected", code: "ALREADY_JOINED", message: "Socket is already in a room" });
      return;
    }
    const roomId = String(message.roomId ?? "");
    let room = this.rooms.get(roomId);
    if (!room && message.create === true && roomId !== "") {
      room = this.openLobby(roomId);
    }
    if (!room) {
      this.send(socket, { type: "rejected", code: "ROOM_NOT_FOUND", message: "No such room" });
      return;
    }
    if (message.spectate === true) {
      this.joined.set(socket, { room, playerToken: "", spectator: true });
      this.welcome(socket, room, []);
      return;
    }
    const playerToken = String(message.playerToken ?? "");
    if (playerToken === "") {
      this.send(socket, { type: "rejected", code: "UNAUTHORIZED", message: "Unknown seat" });
      return;
    }
    const factions = room.factionsFor(playerToken);
    if (factions == null) {
      if (!room.allowsClaim()) {
        this.send(socket, { type: "rejected", code: "UNAUTHORIZED", message: "Unknown seat" });
        return;
      }
      this.joined.set(socket, { room, playerToken, spectator: false });
      this.welcome(socket, room, []);
      return;
    }
    this.joined.set(socket, { room, playerToken, spectator: false });
    this.welcome(socket, room, factions);
  }

  private claimSeat(socket: HostSocket, message: Dict): void {
    const joined = this.joined.get(socket);
    if (!joined || joined.spectator) {
      this.send(socket, { type: "rejected", code: "NOT_JOINED", message: "Join a room first" });
      return;
    }
    const playerToken = String(message.playerToken ?? "");
    if (playerToken === "" || playerToken !== joined.playerToken) {
      this.send(socket, { type: "rejected", code: "UNAUTHORIZED", message: "Socket is not joined as this seat" });
      return;
    }
    const outcome = joined.room.claim(playerToken, String(message.seat ?? ""));
    if (!outcome.ok) {
      this.send(socket, { type: "rejected", code: outcome.code, message: outcome.message });
      return;
    }
    this.announceSeats(joined.room);
  }

  private welcome(socket: HostSocket, room: Room, yourFactions: string[]): void {
    this.send(socket, {
      type: "welcome",
      ...room.resume(),
      yourFactions,
      takenFactions: room.takenFactions(),
    });
  }

  private announceSeats(room: Room): void {
    for (const [socket, joined] of this.joined) {
      if (joined.room !== room || socket.readyState !== HostSocket.OPEN) {
        continue;
      }
      const yourFactions = joined.spectator ? [] : (room.factionsFor(joined.playerToken) ?? []);
      this.send(socket, {
        type: "seats",
        ...room.resume(),
        yourFactions,
        takenFactions: room.takenFactions(),
      });
    }
  }

  private command(socket: HostSocket, message: Dict): void {
    const joined = this.joined.get(socket);
    if (!joined) {
      this.send(socket, { type: "rejected", code: "NOT_JOINED", message: "Join a room first" });
      return;
    }
    const playerToken = String(message.playerToken ?? "");
    if (joined.spectator || playerToken === "" || playerToken !== joined.playerToken) {
      this.send(socket, { type: "rejected", code: "UNAUTHORIZED", message: "Socket is not joined as this seat" });
      return;
    }
    const outcome = joined.room.submit(playerToken, message.command);
    if (outcome.kind === "reject") {
      this.send(socket, { type: "rejected", code: outcome.code, message: outcome.message });
      return;
    }
    if (outcome.kind === "replay") {
      this.send(socket, { type: "sync", ...outcome.body });
      return;
    }
    this.broadcast(joined.room, outcome.body);
  }

  private broadcast(room: Room, body: SyncBody): void {
    const packet = JSON.stringify({ type: "sync", ...body } satisfies ServerMessage);
    for (const [socket, joined] of this.joined) {
      if (joined.room !== room || socket.readyState !== HostSocket.OPEN) {
        continue;
      }
      socket.send(packet);
    }
  }

  private send(socket: HostSocket, message: ServerMessage): void {
    if (socket.readyState === HostSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }
}
