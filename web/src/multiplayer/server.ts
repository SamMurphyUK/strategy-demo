import { MultiplayerHost } from "./host";
import { MULTIPLAYER_PORT } from "./protocol";

const log = (globalThis as unknown as { console: { log(message: string): void } }).console;

const host = new MultiplayerHost();
host.listen(MULTIPLAYER_PORT).then((port) => {
  log.log(`multiplayer host listening on ws://127.0.0.1:${port}`);
});
