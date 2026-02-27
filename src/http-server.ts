#!/usr/bin/env node
/**
 * Soul Pack Reader — Standalone HTTP Server
 *
 * Optional companion to the MCP server. Provides HTTP API endpoints
 * for website integration (e.g. "一键安装" button on Ai_character_cards).
 *
 * Usage:
 *   npx tsx src/http-server.ts                    # default port 18790
 *   SOULPACK_HTTP_PORT=3456 npx tsx src/http-server.ts
 *
 * Env vars:
 *   SOULPACK_HTTP_PORT  — Port to listen on (default: 18790)
 *   SOULPACK_STATE_DIR  — Storage directory (default: ~/.soulpack)
 */

import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import { createRouteHandlers } from "./http-routes.js";
import { setStateDir, setCurrentPackRef, setEngineRef } from "./tools.js";
import { MemoryEngine } from "./memory-engine.js";
import { parsePack } from "./reader.js";
import { savePack } from "./pack-store.js";
import type { SoulPack } from "./types.js";

const DEFAULT_STATE_DIR = path.join(os.homedir(), ".soulpack");
const stateDir = process.env.SOULPACK_STATE_DIR || DEFAULT_STATE_DIR;
const port = Number(process.env.SOULPACK_HTTP_PORT) || 18790;

// ─── Local state ─────────────────────────────────────────────

let currentPack: SoulPack | null = null;
let engine: MemoryEngine | null = null;

function ensureStateDir(): void {
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
}

function activatePack(pack: SoulPack): void {
  currentPack = pack;
  engine = new MemoryEngine({
    stateDir,
    packId: pack.packId,
    maxMemories: 200,
    maxTranscripts: 50,
  });
}

// Wire up shared state for http-routes
setStateDir(stateDir);
setCurrentPackRef(
  () => currentPack,
  (p) => { currentPack = p; activatePack(p); },
);
setEngineRef(() => engine);

// ─── Auto-load ───────────────────────────────────────────────

const defaultPack = process.env.SOULPACK_DEFAULT_PACK;
if (defaultPack) {
  const resolved = path.resolve(defaultPack);
  if (fs.existsSync(resolved)) {
    try {
      const pack = parsePack(fs.readFileSync(resolved, "utf-8"));
      ensureStateDir();
      savePack(stateDir, pack);
      activatePack(pack);
      console.log(`[soulpack-http] Auto-loaded: "${pack.name}" (${pack.packId})`);
    } catch (err) {
      console.error(`[soulpack-http] Auto-load failed:`, err);
    }
  }
}

// ─── HTTP Server ─────────────────────────────────────────────

ensureStateDir();

const routes = createRouteHandlers(stateDir, () => engine);
const routeMap: Record<string, (req: any, res: any) => void> = {
  "/import": routes.import,
  "/list": routes.list,
  "/activate": routes.activate,
  "/ping": routes.ping,
  "/remove": routes.remove,
  "/record": routes.record,
  "/memory/status": routes.memoryStatus,
  "/memory/search": routes.memorySearch,
  "/version-check": routes.versionCheck,
};

const httpServer = createServer((req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
  const url = new URL(req.url || "/", `http://localhost:${port}`);

  // Handle OPTIONS preflight for all routes
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.writeHead(204);
    res.end();
    return;
  }

  const handler = routeMap[url.pathname];
  if (handler) {
    handler(req, res);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: "Not found",
      availableRoutes: Object.keys(routeMap),
    }));
  }
});

httpServer.listen(port, () => {
  console.log(`[soulpack-http] Soul Pack HTTP Server v0.3.0`);
  console.log(`[soulpack-http] Listening on http://localhost:${port}`);
  console.log(`[soulpack-http] State dir: ${stateDir}`);
  console.log(`[soulpack-http] Routes: ${Object.keys(routeMap).join(", ")}`);
});
