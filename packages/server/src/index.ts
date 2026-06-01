import express, { type Express } from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { createRouter } from "./routes.js";
import { startWatcher } from "./watcher.js";
import { readBoard } from "./fs/board.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findWebDist(): string | null {
  // Walk up from this file looking for packages/web/dist/index.html
  const candidates = [
    path.resolve(__dirname, "../../web/dist"),       // installed layout
    path.resolve(__dirname, "../../../web/dist"),    // running from src/
    path.resolve(__dirname, "../../../../packages/web/dist"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "index.html"))) return c;
  }
  return null;
}

export function createApp(workspace: string): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", createRouter(workspace));

  const webDist = findWebDist();
  if (webDist) {
    app.use(express.static(webDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(webDist, "index.html"));
    });
  } else {
    app.get("/", (_req, res) => {
      res
        .status(500)
        .send("Web UI not built. Run `pnpm --filter @kanban/web build` in the kanban repo.");
    });
  }

  return app;
}

export function startServer(workspace: string, port: number): void {
  const app = createApp(workspace);
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", async (ws) => {
    try {
      const state = await readBoard(workspace);
      ws.send(JSON.stringify({ type: "board:update", state }));
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", message: String(err) }));
    }
  });

  startWatcher(workspace, wss);
  httpServer.listen(port, () => {
    console.log(`Kanban server running at http://localhost:${port}`);
  });
}
