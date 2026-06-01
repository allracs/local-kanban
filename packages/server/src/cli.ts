#!/usr/bin/env node
import path from "node:path";
import { bootstrapIfNeeded } from "./fs/board.js";
import { startServer } from "./index.js";

const args = process.argv.slice(2);
const portArg = args.find((a) => a.startsWith("--port="));
const port = portArg ? parseInt(portArg.split("=")[1], 10) : 3131;
const workspace = path.resolve(process.cwd());

(async () => {
  await bootstrapIfNeeded(workspace);

  // In dev (no static build), just start the API
  startServer(workspace, port);

  // Open browser (best-effort)
  try {
    const { default: open } = await import("open");
    await open(`http://localhost:${port}`);
  } catch {
    // non-fatal
  }
})();
