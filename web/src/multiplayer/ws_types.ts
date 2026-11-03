// The engine tsconfig has no DOM or Node types. This is the slice of `ws` the host uses.
declare module "ws" {
  interface AddressInfo {
    port: number;
  }

  interface RawData {
    toString(): string;
  }

  class WebSocket {
    static readonly OPEN: number;
    readyState: number;
    send(data: string): void;
    close(): void;
    on(event: "message", listener: (data: RawData) => void): void;
    on(event: "close", listener: () => void): void;
  }

  class WebSocketServer {
    constructor(options: { host: string; port: number });
    on(event: "connection", listener: (socket: WebSocket) => void): void;
    once(event: "listening", listener: () => void): void;
    once(event: "error", listener: (err: Error) => void): void;
    address(): AddressInfo | string | null;
    close(callback: (err?: Error) => void): void;
  }
}
