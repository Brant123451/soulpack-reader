#!/usr/bin/env node
/**
 * Soul Pack Reader — MCP Server (stdio)
 *
 * A standalone Model Context Protocol server that provides character persona
 * materials (personality, voice, appearance, memory) to any AI agent.
 *
 * Works with: Windsurf, Cursor, Claude Desktop, or any MCP-compatible host.
 *
 * Core philosophy:
 *   Soul Pack only provides materials and suggestions.
 *   The AI agent uses its own coding ability to implement features as needed.
 *
 * Tools:
 *   soulpack_select         — Load a pack from file path
 *   soulpack_list           — List installed packs
 *   soulpack_install        — Install from URL or registry
 *   soulpack_export_state   — Export memory state
 *   soulpack_import_state   — Import memory state
 *   soulpack_status         — Current pack info + full prompt injection
 *   soulpack_record         — Record a conversation exchange into memory
 *   soulpack_search_memory  — Search through memories
 *
 * Resources:
 *   soulpack://current/prompt — Current persona prompt injection text
 *   soulpack://current/status — Engine status JSON
 *
 * Env vars:
 *   SOULPACK_STATE_DIR    — Storage directory (default: ~/.soulpack)
 *   SOULPACK_DEFAULT_PACK — Auto-load this pack on startup
 *   SOULPACK_HTTP_PORT    — HTTP server port (default: 18790, set 0 to disable)
 *   SOULPACK_HTTP_DISABLE — Set to "1" to disable HTTP server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { parsePack, normalize, buildPromptInjection } from "./reader.js";
import {
  listPacks,
  loadPack,
  savePack,
  installPackFromUrl,
  searchRegistry,
  installFromRegistry,
} from "./pack-store.js";
import { loadState, saveState, exportState, importState } from "./state.js";
import { MemoryEngine } from "./memory-engine.js";
import type { SoulPack } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Global State ────────────────────────────────────────────

const CURRENT_VERSION = "0.3.0";
const DEFAULT_STATE_DIR = path.join(os.homedir(), ".soulpack");
const stateDir = process.env.SOULPACK_STATE_DIR || DEFAULT_STATE_DIR;

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

function getPromptInjection(): string | null {
  if (!currentPack) return null;
  const state = engine ? engine.loadState() : { stateVersion: "0.1.0", packId: currentPack.packId, memories: [], lastUpdated: new Date().toISOString() };
  const normalized = normalize(currentPack, state);
  return buildPromptInjection(normalized);
}

function packFeatures(pack: SoulPack): string[] {
  const f: string[] = [];
  if (pack.voice) f.push(`voice(${pack.voice.provider || "?"}/${pack.voice.voiceId || "?"})`);
  if (pack.appearance?.avatarUrl) f.push("avatar");
  if (pack.appearance?.expressions) f.push(`${Object.keys(pack.appearance.expressions).length} expressions`);
  return f;
}

// ─── Auto-load from env ──────────────────────────────────────

function tryAutoLoad(): void {
  const packPath = process.env.SOULPACK_DEFAULT_PACK;
  if (!packPath) return;
  const resolved = path.resolve(packPath);
  if (!fs.existsSync(resolved)) return;
  try {
    const pack = parsePack(fs.readFileSync(resolved, "utf-8"));
    ensureStateDir();
    savePack(stateDir, pack);
    activatePack(pack);
    process.stderr.write(`[soulpack] Auto-loaded: "${pack.name}" (${pack.packId})\n`);
  } catch (err) {
    process.stderr.write(`[soulpack] Auto-load failed: ${err}\n`);
  }
}

// ─── MCP Server ──────────────────────────────────────────────

const server = new McpServer({
  name: "soulpack-reader",
  version: CURRENT_VERSION,
});

// ─── Tool: soulpack_select ───────────────────────────────────

server.tool(
  "soulpack_select",
  "Load and activate a Soul Pack from a local .soulpack.json file. " +
  "Returns the full persona prompt injection including voice/appearance materials and memories.",
  { path: z.string().describe("Absolute path to a .soulpack.json file") },
  async (args) => {
    try {
      const resolved = path.resolve(args.path);
      if (!fs.existsSync(resolved)) {
        return { content: [{ type: "text" as const, text: `File not found: ${resolved}` }] };
      }
      const raw = fs.readFileSync(resolved, "utf-8");
      const pack = parsePack(raw);
      ensureStateDir();
      savePack(stateDir, pack);
      activatePack(pack);

      const state = engine!.loadState();
      const normalized = normalize(pack, state);
      const injection = buildPromptInjection(normalized);
      const features = packFeatures(pack);

      return {
        content: [{
          type: "text" as const,
          text:
            `Soul Pack "${pack.name}" (${pack.packId}) loaded.\n` +
            `Features: ${features.length > 0 ? features.join(", ") : "text persona only"}\n` +
            `Memories: ${state.memories.length}\n\n` +
            injection,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Failed: ${String(err)}` }] };
    }
  },
);

// ─── Tool: soulpack_list ─────────────────────────────────────

server.tool(
  "soulpack_list",
  "List all locally installed Soul Packs and show which one is currently active.",
  {},
  async () => {
    try {
      ensureStateDir();
      const packs = listPacks(stateDir);
      if (packs.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No Soul Packs installed. Use soulpack_install or soulpack_select to add one." }],
        };
      }
      const listing = packs.map((p) => {
        const active = currentPack?.packId === p.packId ? " ⚡ ACTIVE" : "";
        const features: string[] = [];
        if (p.hasVoice) features.push("voice");
        if (p.hasAppearance) features.push("avatar");
        return `- ${p.name} (${p.packId})${active}${features.length > 0 ? " [" + features.join(", ") + "]" : ""}\n  ${p.description || "No description"}`;
      }).join("\n");

      return { content: [{ type: "text" as const, text: `Installed Soul Packs (${packs.length}):\n\n${listing}` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${String(err)}` }] };
    }
  },
);

// ─── Tool: soulpack_install ──────────────────────────────────

server.tool(
  "soulpack_install",
  "Install a Soul Pack from a URL or registry. Downloads and saves locally, optionally activates.",
  {
    url: z.string().optional().describe("Direct URL to a .soulpack.json file"),
    registryUrl: z.string().optional().describe("Base URL of a Soul Pack registry (e.g. https://your-site.com)"),
    packId: z.string().optional().describe("Pack ID to install from registry (requires registryUrl)"),
    query: z.string().optional().describe("Search query for registry (requires registryUrl)"),
    activate: z.boolean().optional().describe("Activate after install (default: true)"),
  },
  async (args) => {
    try {
      ensureStateDir();
      const shouldActivate = args.activate !== false;

      // Mode 1: Direct URL
      if (args.url) {
        const { pack, filePath } = await installPackFromUrl(stateDir, args.url);
        if (shouldActivate) activatePack(pack);
        return {
          content: [{
            type: "text" as const,
            text:
              `Installed "${pack.name}" (${pack.packId}) from URL.\n` +
              `Saved: ${filePath}\n` +
              (shouldActivate ? "Activated." : "Not activated."),
          }],
        };
      }

      // Mode 2: Registry by packId
      if (args.registryUrl && args.packId) {
        const { pack, filePath } = await installFromRegistry(stateDir, args.registryUrl, args.packId);
        if (shouldActivate) activatePack(pack);
        return {
          content: [{
            type: "text" as const,
            text:
              `Installed "${pack.name}" from registry.\n` +
              `Saved: ${filePath}\n` +
              (shouldActivate ? "Activated." : "Not activated."),
          }],
        };
      }

      // Mode 3: Registry search
      if (args.registryUrl && args.query) {
        const results = await searchRegistry(args.registryUrl, args.query);
        if (results.length === 0) {
          return { content: [{ type: "text" as const, text: `No packs found for "${args.query}".` }] };
        }
        const listing = results
          .map((r, i) => `${i + 1}. ${r.name} (${r.packId})${r.author ? " by " + r.author : ""}\n   ${r.description || "No description"}`)
          .join("\n");
        return {
          content: [{
            type: "text" as const,
            text: `Found ${results.length} pack(s):\n\n${listing}\n\nUse soulpack_install with registryUrl + packId to install.`,
          }],
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: "Provide: url (direct download), or registryUrl + packId (registry install), or registryUrl + query (search).",
        }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Install failed: ${String(err)}` }] };
    }
  },
);

// ─── Tool: soulpack_export_state ─────────────────────────────

server.tool(
  "soulpack_export_state",
  "Export the current Soul Pack's memory state as JSON for backup or migration.",
  {
    packId: z.string().optional().describe("Pack ID to export (default: current active pack)"),
    outputPath: z.string().optional().describe("File path to save the export (omit to return inline)"),
  },
  async (args) => {
    try {
      ensureStateDir();
      const pid = args.packId || currentPack?.packId;
      if (!pid) {
        return { content: [{ type: "text" as const, text: "No pack active. Load one first or specify packId." }] };
      }
      const state = loadState(stateDir, pid);
      const json = exportState(state);

      if (args.outputPath) {
        fs.writeFileSync(path.resolve(args.outputPath), json, "utf-8");
        return { content: [{ type: "text" as const, text: `Exported ${state.memories.length} memories to ${args.outputPath}` }] };
      }
      return { content: [{ type: "text" as const, text: `State for "${pid}" (${state.memories.length} memories):\n\n${json}` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Export failed: ${String(err)}` }] };
    }
  },
);

// ─── Tool: soulpack_import_state ─────────────────────────────

server.tool(
  "soulpack_import_state",
  "Import a Soul Pack memory state from a JSON file or string.",
  {
    source: z.string().describe("File path to .state.json or raw JSON string"),
    packId: z.string().optional().describe("Expected pack ID for validation"),
  },
  async (args) => {
    try {
      ensureStateDir();
      let raw: string;
      const resolved = path.resolve(args.source);
      if (fs.existsSync(resolved)) {
        raw = fs.readFileSync(resolved, "utf-8");
      } else {
        raw = args.source;
      }
      const state = importState(raw, args.packId);
      saveState(stateDir, state);
      return {
        content: [{
          type: "text" as const,
          text: `Imported ${state.memories.length} memories for pack "${state.packId}". Last updated: ${state.lastUpdated}`,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Import failed: ${String(err)}` }] };
    }
  },
);

// ─── Tool: soulpack_status ───────────────────────────────────

server.tool(
  "soulpack_status",
  "Show current Soul Pack status: active pack info, memory count, available materials, and the full prompt injection text.",
  {},
  async () => {
    if (!currentPack) {
      return { content: [{ type: "text" as const, text: "No Soul Pack is active. Use soulpack_select or soulpack_list." }] };
    }
    const status = engine?.getStatus();
    const injection = getPromptInjection();
    const features = packFeatures(currentPack);

    return {
      content: [{
        type: "text" as const,
        text:
          `Active Pack: ${currentPack.name} (${currentPack.packId})\n` +
          `Features: ${features.length > 0 ? features.join(", ") : "text persona only"}\n` +
          `Memories: ${status?.totalMemories ?? 0}/${status?.maxMemories ?? 200}\n` +
          `Transcripts: ${status?.transcriptCount ?? 0}\n` +
          `Session: ${status?.activeSession || "none"}\n\n` +
          (injection ? `--- Full Prompt Injection ---\n${injection}` : ""),
      }],
    };
  },
);

// ─── Tool: soulpack_record ───────────────────────────────────

server.tool(
  "soulpack_record",
  "Record a conversation exchange into Soul Pack memory. Use this to log important interactions that should be remembered across sessions.",
  {
    userInput: z.string().describe("What the user said"),
    aiOutput: z.string().describe("What the AI responded"),
    sessionId: z.string().optional().describe("Session identifier"),
  },
  async (args) => {
    if (!engine) {
      return { content: [{ type: "text" as const, text: "No pack active. Load one first." }] };
    }
    const result = engine.record(args.userInput, args.aiOutput, args.sessionId);
    return {
      content: [{
        type: "text" as const,
        text: `Recorded. Memories added: ${result.memoriesAdded}, total: ${result.totalMemories}`,
      }],
    };
  },
);

// ─── Tool: soulpack_search_memory ────────────────────────────

server.tool(
  "soulpack_search_memory",
  "Search through Soul Pack memories by keyword.",
  {
    query: z.string().describe("Search keyword"),
    limit: z.number().optional().describe("Max results (default: 10)"),
  },
  async (args) => {
    if (!engine) {
      return { content: [{ type: "text" as const, text: "No pack active." }] };
    }
    const results = engine.searchMemories(args.query, args.limit ?? 10);
    if (results.length === 0) {
      return { content: [{ type: "text" as const, text: `No memories matching "${args.query}".` }] };
    }
    const listing = results.map((m) => `- [${m.timestamp}] ${m.content}`).join("\n");
    return { content: [{ type: "text" as const, text: `Found ${results.length} memories:\n${listing}` }] };
  },
);

// ─── Resource: current prompt injection ──────────────────────

server.resource(
  "current-prompt",
  "soulpack://current/prompt",
  async (uri) => {
    const injection = getPromptInjection();
    return {
      contents: [{
        uri: uri.href,
        text: injection || "No Soul Pack is active. Use soulpack_select to load one.",
        mimeType: "text/plain",
      }],
    };
  },
);

// ─── Resource: current status JSON ───────────────────────────

server.resource(
  "current-status",
  "soulpack://current/status",
  async (uri) => {
    const status = engine?.getStatus();
    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify({
          active: !!currentPack,
          packId: currentPack?.packId ?? null,
          name: currentPack?.name ?? null,
          features: currentPack ? packFeatures(currentPack) : [],
          ...status,
        }, null, 2),
        mimeType: "application/json",
      }],
    };
  },
);

// ─── Prompt: usage guide ─────────────────────────────────────

server.prompt(
  "soulpack-guide",
  "Usage guide for Soul Pack — how to load, use, and create character persona packs",
  {},
  async () => {
    const skillPath = path.join(__dirname, "..", "skills", "soulpack-usage", "SKILL.md");
    let guideText = "Soul Pack Reader provides character persona materials. Use soulpack_list to see installed packs, soulpack_select to load one.";
    if (fs.existsSync(skillPath)) {
      guideText = fs.readFileSync(skillPath, "utf-8");
    }
    return {
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: guideText },
      }],
    };
  },
);

// ─── HTTP Server (default on, port 18790) ────────────────────

const DEFAULT_HTTP_PORT = 18790;

async function maybeStartHttpServer(): Promise<void> {
  if (process.env.SOULPACK_HTTP_DISABLE === "1") return;
  const port = process.env.SOULPACK_HTTP_PORT || String(DEFAULT_HTTP_PORT);
  if (port === "0") return;

  const { createServer } = await import("node:http");
  const { createRouteHandlers } = await import("./http-routes.js");

  // Patch tools.ts state for HTTP routes
  const { setStateDir, setCurrentPackRef, setEngineRef } = await import("./tools.js");
  setStateDir(stateDir);
  setCurrentPackRef(() => currentPack, (p) => { currentPack = p; });
  setEngineRef(() => engine);

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

  const httpServer = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    const handler = routeMap[url.pathname];
    if (handler) {
      handler(req, res);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  });

  httpServer.listen(Number(port), "127.0.0.1", () => {
    process.stderr.write(`[soulpack] HTTP server on http://127.0.0.1:${port}\n`);
  });
}

// ─── Start ───────────────────────────────────────────────────

ensureStateDir();
tryAutoLoad();
maybeStartHttpServer().catch((err) => {
  process.stderr.write(`[soulpack] HTTP server failed: ${err}\n`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`[soulpack] MCP Server v${CURRENT_VERSION} started (stdio) | stateDir: ${stateDir}\n`);
