import type { Dict } from "../engine/model/types";
import type { SeatAssignment, ServerMessage, SyncBody } from "./protocol";

type SyncMessage = Extract<ServerMessage, { type: "sync" }>;
type RejectedMessage = Extract<ServerMessage, { type: "rejected" }>;

interface Waiter {
  resolve(message: ServerMessage): void;
  reject(error: Error): void;
}

interface GameSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "message", listener: (event: { data?: unknown }) => void): void;
  addEventListener(type: "open" | "error" | "close", listener: () => void, options?: { once?: boolean }): void;
}

interface WebSocketCtor {
  new (url: string): GameSocket;
  readonly CLOSED: number;
}

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

/**
 * A browser (or test) mirror. It does not simulate rules. It stores the host's
 * events and locks onto each authoritative snapshot.
 */
export class MultiplayerClient {
  seq = 0;
  snapshot: SyncBody["snapshot"] | null = null;
  seatAssignments: SeatAssignment[] = [];
  yourFactions: string[] = [];
  readonly frames: SyncMessage[] = [];

  private readonly inbox: ServerMessage[] = [];
  private readonly waiters: Waiter[] = [];
  private tail: Promise<void> = Promise.resolve();
  private closing = false;

  private constructor(
    private readonly ws: GameSocket,
    readonly playerToken: string,
  ) {
    ws.addEventListener("message", (event) => {
      this.tail = this.tail.then(() => this.onData(event.data)).catch((error: unknown) => {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      });
    });
    ws.addEventListener("close", () => {
      if (!this.closing) {
        this.fail(new Error("socket closed"));
      }
    });
  }

  static async connect(url: string, roomId: string, playerToken: string): Promise<MultiplayerClient> {
    const ws = new (webSocketCtor())(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error(`websocket failed for ${url}`)), { once: true });
    });
    const client = new MultiplayerClient(ws, playerToken);
    ws.send(JSON.stringify({ type: "join", roomId, playerToken }));
    const welcome = await client.next();
    if (welcome.type !== "welcome") {
      throw new Error(`expected welcome, got ${welcome.type}`);
    }
    return client;
  }

  async sendCommand(command: Dict): Promise<SyncMessage | RejectedMessage> {
    const commandId = String(command.command_id ?? "");
    this.ws.send(JSON.stringify({ type: "command", playerToken: this.playerToken, command }));
    for (;;) {
      const message = await this.next();
      if (message.type === "rejected") {
        return message;
      }
      if (message.type === "sync" && String(message.command.command_id ?? "") === commandId) {
        return message;
      }
    }
  }

  async waitForSeq(seq: number): Promise<void> {
    while (this.seq < seq) {
      await this.next();
    }
  }

  close(): Promise<void> {
    this.closing = true;
    if (this.ws.readyState === webSocketCtor().CLOSED) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.ws.addEventListener("close", () => resolve(), { once: true });
      this.ws.close();
    });
  }

  private async onData(data: unknown): Promise<void> {
    const text = await messageText(data);
    const message = JSON.parse(text) as ServerMessage;
    this.absorb(message);
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(message);
    } else {
      this.inbox.push(message);
    }
  }

  private absorb(message: ServerMessage): void {
    if (message.type === "welcome") {
      this.seq = message.seq;
      this.snapshot = message.snapshot;
      this.seatAssignments = message.seatAssignments;
      this.yourFactions = message.yourFactions;
      return;
    }
    if (message.type === "sync") {
      this.seq = message.seq;
      this.snapshot = message.snapshot;
      this.frames.push(message);
    }
  }

  private next(): Promise<ServerMessage> {
    const queued = this.inbox.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const timer = schedule(() => reject(new Error("timed out waiting for the host")), 8000);
      this.waiters.push({
        resolve: (message) => {
          cancelSchedule(timer);
          resolve(message);
        },
        reject: (error) => {
          cancelSchedule(timer);
          reject(error);
        },
      });
    });
  }

  private fail(error: Error): void {
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error);
    }
  }
}
