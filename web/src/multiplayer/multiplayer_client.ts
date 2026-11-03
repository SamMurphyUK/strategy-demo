import type { GameState } from "../engine/model/game_state";
import type { MoveOrder } from "../engine/movement/phase_orders";
import type { CanonicalEvent, GameSessionStub, StubStateSnapshot } from "../engine/session/game_session_stub";
import type { Dict } from "../engine/model/types";
import { ALLIES_FACTIONS, AXIS_FACTIONS, type SeatAssignment, type ServerMessage, type SyncBody } from "./protocol";

export const DEFAULT_MULTIPLAYER_URL = "ws://localhost:8787";
const TOKEN_KEY = "strategy-demo.player-token";

const BATTLE_COMMANDS = new Set(["start_battle", "battle_roll", "battle_casualties", "battle_retreat"]);

export interface TokenStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SessionOptions {
  url?: string;
  playerToken?: string;
  storage?: TokenStore | null;
}

type SyncMessage = Extract<ServerMessage, { type: "sync" }>;
type RejectedMessage = Extract<ServerMessage, { type: "rejected" }>;

interface GameSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "message", listener: (event: { data?: unknown }) => void): void;
  addEventListener(type: "open" | "error" | "close", listener: () => void, options?: { once?: boolean }): void;
}

interface WebSocketCtor {
  new (url: string): GameSocket;
  readonly OPEN: number;
}

interface Waiter {
  match(message: ServerMessage): boolean;
  resolve(message: ServerMessage): void;
  reject(error: Error): void;
  timer: unknown;
}

export type ClientStatus = "local" | "connecting" | "open" | "reconnecting" | "closed";
export type ClientNotice = "welcome" | "seats" | "sync" | "rejected" | "status";

function webSocketCtor(): WebSocketCtor {
  const ctor = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
  if (ctor == null) {
    throw new Error("WebSocket is not available");
  }
  return ctor;
}

function messageText(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return Promise.resolve(data);
  }
  if (data != null && typeof (data as { text?: unknown }).text === "function") {
    return (data as { text: () => Promise<string> }).text();
  }
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    const Decoder = (globalThis as { TextDecoder?: new () => { decode(input: ArrayBuffer | ArrayBufferView): string } })
      .TextDecoder;
    if (Decoder == null) {
      return Promise.reject(new Error("Binary websocket frame without TextDecoder"));
    }
    return Promise.resolve(new Decoder().decode(data));
  }
  return Promise.resolve(String(data));
}

function schedule(fn: () => void, ms: number): unknown {
  return (globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }).setTimeout(fn, ms);
}

function cancelSchedule(id: unknown): void {
  (globalThis as unknown as { clearTimeout(id: unknown): void }).clearTimeout(id);
}

function randomToken(): string {
  const cryptoHost = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (cryptoHost.crypto?.randomUUID) {
    return cryptoHost.crypto.randomUUID();
  }
  return `player-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function browserStore(): TokenStore | null {
  try {
    const host = globalThis as unknown as { sessionStorage?: TokenStore };
    return host.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** One token per tab. `sessionStorage` keeps two tabs on one machine distinct. */
export function readPlayerToken(store: TokenStore | null): string {
  const existing = store?.getItem(TOKEN_KEY) ?? "";
  if (existing !== "") {
    return existing;
  }
  const token = randomToken();
  store?.setItem(TOKEN_KEY, token);
  return token;
}

/** `?room=ROOM_ID` from a campaign URL. */
export function roomIdFromSearch(search: string): string {
  const query = search.startsWith("?") ? search.slice(1) : search;
  for (const part of query.split("&")) {
    if (part === "") {
      continue;
    }
    const splitAt = part.indexOf("=");
    const key = splitAt === -1 ? part : part.slice(0, splitAt);
    const value = splitAt === -1 ? "" : part.slice(splitAt + 1);
    if (decodeURIComponent(key) === "room") {
      return decodeURIComponent(value);
    }
  }
  return "";
}

export function factionsForSeat(seat: string): readonly string[] {
  const key = seat.trim().toLowerCase();
  if (key === "axis") {
    return AXIS_FACTIONS;
  }
  if (key === "allies") {
    return ALLIES_FACTIONS;
  }
  return [key];
}

/**
 * Local play is always this tab's turn.
 * In a room, the turn belongs to the tab whose token owns the active faction.
 */
export function isPlayerTurn(online: boolean, yourFactions: readonly string[], activeFaction: string): boolean {
  if (!online) {
    return true;
  }
  return yourFactions.includes(activeFaction);
}

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Copy the host board onto a live session. The client's dice cursor is left untouched. */
export function applyAuthoritativeSnapshot(session: GameSessionStub, snapshot: StubStateSnapshot): void {
  const state = session.state;
  state.game_round = snapshot.game_round;
  state.current_faction_id = snapshot.turn_info.current_faction_id;
  state.current_phase = snapshot.turn_info.current_phase;
  state.turn_number = snapshot.turn_info.turn_number;
  state.ipc = { ...snapshot.ipc };
  state.pending_purchases = cloneData(snapshot.pending_purchases ?? {});
  state.pending_amphibious_assaults = cloneData(snapshot.pending_amphibious_assaults ?? []);
  state.transport_instances = cloneData(snapshot.transport_instances ?? {});
  state.phase_orders = cloneData(snapshot.phase_orders ?? []);
  state.game_over = snapshot.game_over;
  state.winner_faction_id = snapshot.winner_faction_id;
  state.active_battle = snapshot.active_battle ? cloneData(snapshot.active_battle) : null;
  for (const region of snapshot.regions ?? []) {
    const live = state.regions[region.region_id];
    if (!live) {
      continue;
    }
    live.owner_faction_id = region.owner_faction_id;
    state.region_units[region.region_id] = cloneData(region.units ?? []);
  }
  restoreMovementHolds(state, state.phase_orders);
}

function restoreMovementHolds(state: GameState, orders: readonly MoveOrder[]): void {
  state.clearMovementPhaseTracking();
  for (const order of orders) {
    if (order.kind === "load_transport") {
      state.recordStackEmbark(order.faction, order.fromRegionId, order.unitType, order.count);
      continue;
    }
    if (order.kind === "unload_transport") {
      continue;
    }
    const ships = order.shipInstanceIds ?? [];
    if (ships.length > 0) {
      for (const id of ships) {
        state.recordInstanceMoved(id);
      }
      continue;
    }
    state.recordAttackHold(order.faction, order.fromRegionId, order.unitType, order.count);
  }
}

/**
 * Browser session for one tab. It does not roll dice. The host's snapshot replaces
 * the board, and battle events are forwarded for the spectator animation.
 */
export class MultiplayerSession {
  readonly url: string;
  readonly playerToken: string;
  status: ClientStatus = "local";
  roomId = "";
  seq = 0;
  revision = 0;
  lastNotice: ClientNotice = "status";
  snapshot: StubStateSnapshot | null = null;
  seatAssignments: SeatAssignment[] = [];
  yourFactions: string[] = [];
  takenFactions: string[] = [];
  rejection: { code: string; message: string } | null = null;
  readonly frames: SyncMessage[] = [];

  private socket: GameSocket | null = null;
  private generation = 0;
  private intentional = false;
  private reconnectTimer: unknown = null;
  private commandSerial = 0;
  private eventCursor = 0;
  private readonly waiters: Waiter[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(options: SessionOptions = {}) {
    this.url = options.url ?? DEFAULT_MULTIPLAYER_URL;
    const store = options.storage === undefined ? browserStore() : options.storage;
    this.playerToken = options.playerToken && options.playerToken !== "" ? options.playerToken : readPlayerToken(store);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Events from sync frames that have not been handed to the UI yet. */
  takeNewEvents(): CanonicalEvent[] {
    const all = this.frames.flatMap((frame) => frame.events);
    const next = all.slice(this.eventCursor);
    this.eventCursor = all.length;
    return next;
  }

  isMyTurn(): boolean {
    if (this.status === "local" || this.status === "closed") {
      return true;
    }
    const faction = this.snapshot?.turn_info.current_faction_id ?? "";
    return isPlayerTurn(true, this.yourFactions, faction);
  }

  /** True while this tab must not roll, pick casualties, or retreat. */
  blocksBattleInput(): boolean {
    return this.status !== "local" && this.status !== "closed" && !this.isMyTurn();
  }

  /**
   * The battle-screen gate. A blocked roll is not written to the socket.
   * An allowed result still has to be sent with `sendCommand`.
   */
  localBattleRoll(): { accepted: boolean; reason: string } {
    if (this.blocksBattleInput()) {
      return { accepted: false, reason: "OPPONENT_TURN" };
    }
    return { accepted: true, reason: "" };
  }

  /** Latest host frame whose command is one of the live battle steps. */
  latestBattleFrame(): SyncMessage | null {
    for (let i = this.frames.length - 1; i >= 0; i -= 1) {
      const frame = this.frames[i];
      if (BATTLE_COMMANDS.has(String(frame.command.type ?? ""))) {
        return frame;
      }
    }
    return null;
  }

  async connect(roomId: string): Promise<void> {
    const generation = ++this.generation;
    this.clearReconnect();
    const previous = this.socket;
    this.socket = null;
    previous?.close();
    this.intentional = false;
    this.roomId = roomId;
    this.status = "connecting";
    this.touch("status");
    await this.openAndJoin(generation);
  }

  async claim(seat: string): Promise<void> {
    const wanted = factionsForSeat(seat);
    const pending = this.waitFor((message) => {
      if (message.type === "rejected") {
        return true;
      }
      return message.type === "seats" && wanted.every((faction) => message.yourFactions.includes(faction));
    });
    this.socketSend({ type: "claim", playerToken: this.playerToken, seat });
    const message = await pending;
    if (message.type === "rejected") {
      throw new Error(`${message.code}: ${message.message}`);
    }
  }

  async sendCommand(command: Dict): Promise<SyncMessage | RejectedMessage> {
    const commandId = String(command.command_id ?? "");
    const pending = this.waitFor((message) => {
      if (message.type === "rejected") {
        return true;
      }
      return message.type === "sync" && String(message.command.command_id ?? "") === commandId;
    });
    this.socketSend({ type: "command", playerToken: this.playerToken, command });
    const message = await pending;
    if (message.type !== "sync" && message.type !== "rejected") {
      throw new Error(`expected sync, got ${message.type}`);
    }
    return message;
  }

  /** Build a command id unique to this tab and send it. */
  dispatch(type: string, playerId: string, payload: Dict = {}): Promise<SyncMessage | RejectedMessage> {
    this.commandSerial += 1;
    return this.sendCommand({
      command_id: `tab_${this.playerToken.slice(0, 8)}_${this.commandSerial}`,
      player_id: playerId,
      type,
      payload,
    });
  }

  async waitForSeq(seq: number): Promise<void> {
    if (this.seq >= seq) {
      return;
    }
    await this.waitFor((message) => {
      if (message.type === "sync" || message.type === "welcome" || message.type === "seats") {
        return message.seq >= seq;
      }
      return false;
    });
  }

  close(): Promise<void> {
    this.intentional = true;
    this.generation += 1;
    this.clearReconnect();
    this.fail(new Error("socket closed"));
    const socket = this.socket;
    this.socket = null;
    this.status = "local";
    this.touch("status");
    if (!socket) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      socket.addEventListener("close", () => resolve(), { once: true });
      socket.close();
    });
  }

  private async openAndJoin(generation: number): Promise<void> {
    const ws = new (webSocketCtor())(this.url);
    this.socket = ws;
    const opened = new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error(`websocket failed for ${this.url}`)), { once: true });
    });
    ws.addEventListener("message", (event) => {
      void messageText(event.data)
        .then((text) => {
          if (this.generation !== generation) {
            return;
          }
          this.deliver(JSON.parse(text) as ServerMessage);
        })
        .catch((error: unknown) => {
          this.fail(error instanceof Error ? error : new Error(String(error)));
        });
    });
    ws.addEventListener("close", () => {
      if (this.socket !== ws || this.intentional || this.generation !== generation) {
        return;
      }
      this.status = "reconnecting";
      this.touch("status");
      this.reconnectTimer = schedule(() => {
        void this.openAndJoin(generation).catch(() => {
          if (this.generation !== generation || this.intentional) {
            return;
          }
          this.status = "reconnecting";
          this.touch("status");
          this.reconnectTimer = schedule(() => {
            void this.openAndJoin(generation);
          }, 400);
        });
      }, 400);
    });
    try {
      await opened;
    } catch (error) {
      if (this.generation === generation) {
        this.status = "closed";
        this.touch("status");
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
    if (this.generation !== generation) {
      return;
    }
    const welcome = this.waitFor((message) => message.type === "welcome" || message.type === "rejected");
    this.socketSend({ type: "join", roomId: this.roomId, playerToken: this.playerToken, create: true });
    const message = await welcome;
    if (message.type === "rejected") {
      this.status = "closed";
      this.touch("status");
      throw new Error(`${message.code}: ${message.message}`);
    }
  }

  private socketSend(message: unknown): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== webSocketCtor().OPEN) {
      throw new Error("multiplayer socket is not open");
    }
    socket.send(JSON.stringify(message));
  }

  private waitFor(match: (message: ServerMessage) => boolean): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        match,
        resolve: (message) => {
          cancelSchedule(waiter.timer);
          resolve(message);
        },
        reject: (error) => {
          cancelSchedule(waiter.timer);
          reject(error);
        },
        timer: null,
      };
      waiter.timer = schedule(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(new Error("timed out waiting for the host"));
      }, 8000);
      this.waiters.push(waiter);
    });
  }

  private deliver(message: ServerMessage): void {
    this.absorb(message);
    const index = this.waiters.findIndex((waiter) => waiter.match(message));
    if (index >= 0) {
      const [waiter] = this.waiters.splice(index, 1);
      waiter.resolve(message);
    }
    this.emit();
  }

  private absorb(message: ServerMessage): void {
    if (message.type === "welcome" || message.type === "seats") {
      this.seq = message.seq;
      this.snapshot = message.snapshot;
      this.seatAssignments = message.seatAssignments;
      this.yourFactions = [...message.yourFactions];
      this.takenFactions = [...message.takenFactions];
      this.status = "open";
      this.rejection = null;
      this.lastNotice = message.type;
      this.revision += 1;
      return;
    }
    if (message.type === "sync") {
      this.seq = message.seq;
      this.snapshot = message.snapshot;
      this.frames.push(message);
      this.status = "open";
      this.rejection = null;
      this.lastNotice = "sync";
      this.revision += 1;
      return;
    }
    if (message.type === "rejected") {
      this.rejection = { code: message.code, message: message.message };
      this.lastNotice = "rejected";
      this.revision += 1;
    }
  }

  private touch(notice: ClientNotice): void {
    this.lastNotice = notice;
    this.revision += 1;
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  private fail(error: Error): void {
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error);
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer != null) {
      cancelSchedule(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export type { SyncBody };
