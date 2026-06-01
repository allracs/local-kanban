import chokidar from "chokidar";
import type { WebSocketServer } from "ws";
import type { WSMessage } from "@kanban/shared";
import { readBoard } from "./fs/board.js";

// Paths of files that this server just wrote (to suppress self-echo)
const selfWritten = new Set<string>();

export function suppressSelfWrite(filePath: string, ttlMs = 300): void {
  selfWritten.add(filePath);
  setTimeout(() => selfWritten.delete(filePath), ttlMs);
}

export function startWatcher(workspace: string, wss: WebSocketServer): void {
  const kanbanRoot = `${workspace}/.kanban`;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const broadcast = async () => {
    try {
      const state = await readBoard(workspace);
      const msg: WSMessage = { type: "board:update", state };
      const payload = JSON.stringify(msg);
      for (const client of wss.clients) {
        if (client.readyState === 1) {
          client.send(payload);
        }
      }
    } catch (err) {
      const msg: WSMessage = { type: "error", message: String(err) };
      const payload = JSON.stringify(msg);
      for (const client of wss.clients) {
        if (client.readyState === 1) client.send(payload);
      }
    }
  };

  const scheduleBroadcast = (filePath: string) => {
    if (selfWritten.has(filePath)) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(broadcast, 120);
  };

  chokidar
    .watch(kanbanRoot, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 100 } })
    .on("add", scheduleBroadcast)
    .on("change", scheduleBroadcast)
    .on("unlink", scheduleBroadcast)
    .on("addDir", () => { scheduleBroadcast(""); })
    .on("unlinkDir", () => { scheduleBroadcast(""); });
}
