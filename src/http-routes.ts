/**
 * Soul Pack HTTP Routes — 供网站一键安装等外部客户端调用
 *
 * 路由（挂载在 /plugins/soulpack-reader/ 下）：
 *   POST /import    — 接收 pack JSON，保存到本地并可选激活
 *   GET  /list      — 返回已安装的 pack 列表
 *   POST /activate  — 切换当前激活的 pack
 *   GET  /ping      — 健康检查（供网站检测 OpenClaw 是否在线）
 *   POST /remove    — 删除已安装的 pack
 *   POST /record    — 外部系统推送对话记录（核心：独立于AI宿主的记忆采集）
 *   GET  /memory/status  — 记忆状态概览
 *   GET  /memory/search  — 搜索记忆
 *   GET  /version-check  — 检查 GitHub 版本更新
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { listPacks, importPackFromJson, loadPack, deletePack } from "./pack-store.js";
import { setCurrentPack, getCurrentPack } from "./tools.js";
import { MemoryEngine } from "./memory-engine.js";

// ─── 工具函数 ─────────────────────────────────────────────

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  setCorsHeaders(res);
  res.setHeader("Content-Type", "application/json");
  res.writeHead(status);
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

// ─── 路由处理器类型 ───────────────────────────────────────

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

// ─── 路由工厂 ─────────────────────────────────────────────

export function createRouteHandlers(stateDir: string, getEngine?: () => MemoryEngine | null) {

  // POST /import — 接收并保存 pack
  const handleImport: RouteHandler = async (req, res) => {
    if (req.method === "OPTIONS") { setCorsHeaders(res); res.writeHead(204); res.end(); return; }
    try {
      const data = await parseJsonBody(req);
      if (!data || typeof data !== "object") {
        sendJson(res, 400, { error: "Request body must be a Soul Pack JSON object" });
        return;
      }

      const { pack, filePath } = importPackFromJson(stateDir, data);

      const shouldActivate =
        (data as Record<string, unknown>).__activate !== false ||
        !getCurrentPack();

      if (shouldActivate) {
        setCurrentPack(pack);
      }

      sendJson(res, 200, {
        success: true,
        packId: pack.packId,
        name: pack.name,
        activated: shouldActivate,
        filePath,
        message: `Soul Pack "${pack.name}" imported successfully${shouldActivate ? " and activated" : ""}.`,
      });
    } catch (err) {
      sendJson(res, 400, { error: String(err) });
    }
  };

  // GET /list — 返回已安装的 pack 列表
  const handleList: RouteHandler = (_req, res) => {
    if (_req.method === "OPTIONS") { setCorsHeaders(res); res.writeHead(204); res.end(); return; }
    try {
      const packs = listPacks(stateDir);
      const activePack = getCurrentPack();
      sendJson(res, 200, {
        packs: packs.map((p) => ({
          ...p,
          active: activePack?.packId === p.packId,
        })),
        activePackId: activePack?.packId ?? null,
      });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
  };

  // POST /activate — 切换当前 pack
  const handleActivate: RouteHandler = async (req, res) => {
    if (req.method === "OPTIONS") { setCorsHeaders(res); res.writeHead(204); res.end(); return; }
    try {
      const body = await parseJsonBody(req) as Record<string, unknown> | null;
      const packId = typeof body?.packId === "string" ? body.packId : "";
      if (!packId) {
        sendJson(res, 400, { error: "Missing packId in request body" });
        return;
      }

      const pack = loadPack(stateDir, packId);
      if (!pack) {
        sendJson(res, 404, { error: `Pack "${packId}" not found. Install it first.` });
        return;
      }

      setCurrentPack(pack);
      sendJson(res, 200, {
        success: true,
        packId: pack.packId,
        name: pack.name,
        message: `Soul Pack "${pack.name}" activated.`,
      });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
  };

  // GET /ping — 健康检查
  const handlePing: RouteHandler = (_req, res) => {
    if (_req.method === "OPTIONS") { setCorsHeaders(res); res.writeHead(204); res.end(); return; }
    const activePack = getCurrentPack();
    sendJson(res, 200, {
      status: "ok",
      plugin: "soulpack-reader",
      version: "0.1.0",
      activePack: activePack
        ? { packId: activePack.packId, name: activePack.name }
        : null,
    });
  };

  // POST /remove — 删除 pack
  const handleRemove: RouteHandler = async (req, res) => {
    if (req.method === "OPTIONS") { setCorsHeaders(res); res.writeHead(204); res.end(); return; }
    try {
      const body = await parseJsonBody(req) as Record<string, unknown> | null;
      const packId = typeof body?.packId === "string" ? body.packId : "";
      if (!packId) {
        sendJson(res, 400, { error: "Missing packId in request body" });
        return;
      }

      const activePack = getCurrentPack();
      if (activePack?.packId === packId) {
        sendJson(res, 409, {
          error: `Cannot remove active pack "${packId}". Activate a different pack first.`,
        });
        return;
      }

      const deleted = deletePack(stateDir, packId);
      if (!deleted) {
        sendJson(res, 404, { error: `Pack "${packId}" not found.` });
        return;
      }

      sendJson(res, 200, {
        success: true,
        packId,
        message: `Pack "${packId}" removed.`,
      });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
  };

  // POST /record — 外部系统推送对话记录（核心记忆采集端点）
  const handleRecord: RouteHandler = async (req, res) => {
    if (req.method === "OPTIONS") { setCorsHeaders(res); res.writeHead(204); res.end(); return; }
    try {
      const engine = getEngine?.();
      if (!engine) {
        sendJson(res, 503, { error: "No Soul Pack is active. Load a pack first." });
        return;
      }

      const body = await parseJsonBody(req) as Record<string, unknown> | null;
      if (!body) {
        sendJson(res, 400, { error: "Request body required" });
        return;
      }

      // 支持两种格式：
      // 1. 单轮: { userInput, aiOutput, sessionId? }
      // 2. 批量: { messages: [{role, content}], sessionId? }
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;

      if (typeof body.userInput === "string" && typeof body.aiOutput === "string") {
        const result = engine.record(body.userInput, body.aiOutput, sessionId);
        sendJson(res, 200, {
          success: true,
          ...result,
          message: `Recorded 1 exchange, ${result.memoriesAdded} memories extracted.`,
        });
        return;
      }

      if (Array.isArray(body.messages)) {
        const messages = (body.messages as Array<Record<string, unknown>>)
          .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content as string,
            timestamp: typeof m.timestamp === "string" ? m.timestamp : new Date().toISOString(),
          }));

        if (messages.length === 0) {
          sendJson(res, 400, { error: "No valid messages found in batch" });
          return;
        }

        const result = engine.recordBatch(messages, sessionId);
        sendJson(res, 200, {
          success: true,
          ...result,
          message: `Recorded ${messages.length} messages, ${result.memoriesAdded} memories extracted.`,
        });
        return;
      }

      sendJson(res, 400, {
        error: "Invalid format. Use { userInput, aiOutput } for single exchange, or { messages: [{role, content}] } for batch.",
      });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
  };

  // GET /memory/status — 记忆状态概览
  const handleMemoryStatus: RouteHandler = (_req, res) => {
    if (_req.method === "OPTIONS") { setCorsHeaders(res); res.writeHead(204); res.end(); return; }
    const engine = getEngine?.();
    if (!engine) {
      sendJson(res, 503, { error: "No Soul Pack is active." });
      return;
    }
    sendJson(res, 200, engine.getStatus());
  };

  // GET /memory/search?q=xxx&limit=10 — 搜索记忆
  const handleMemorySearch: RouteHandler = (_req, res) => {
    if (_req.method === "OPTIONS") { setCorsHeaders(res); res.writeHead(204); res.end(); return; }
    const engine = getEngine?.();
    if (!engine) {
      sendJson(res, 503, { error: "No Soul Pack is active." });
      return;
    }
    const url = new URL(_req.url || "/", "http://localhost");
    const query = url.searchParams.get("q") || "";
    const limit = Math.min(Number(url.searchParams.get("limit")) || 10, 50);
    if (!query) {
      sendJson(res, 200, { memories: engine.getMemories(limit) });
      return;
    }
    sendJson(res, 200, { memories: engine.searchMemories(query, limit) });
  };

  // GET /version-check — 检查 GitHub 版本更新
  const handleVersionCheck: RouteHandler = async (_req, res) => {
    if (_req.method === "OPTIONS") { setCorsHeaders(res); res.writeHead(204); res.end(); return; }
    const currentVersion = "0.1.0";
    const result = await MemoryEngine.checkForUpdate(
      "https://api.github.com/repos/Brant123451/soulpack-reader/releases/latest",
      currentVersion,
    );
    if (!result) {
      sendJson(res, 200, { currentVersion, status: "check_failed", message: "Could not reach GitHub." });
      return;
    }
    sendJson(res, 200, {
      currentVersion,
      ...result,
      message: result.hasUpdate
        ? `Update available: v${result.latestVersion}. Download: ${result.downloadUrl}`
        : "You are on the latest version.",
    });
  };

  return {
    import: handleImport,
    list: handleList,
    activate: handleActivate,
    ping: handlePing,
    remove: handleRemove,
    record: handleRecord,
    memoryStatus: handleMemoryStatus,
    memorySearch: handleMemorySearch,
    versionCheck: handleVersionCheck,
  };
}
