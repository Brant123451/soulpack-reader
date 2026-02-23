/**
 * Soul Pack Reader — OpenClaw Plugin 入口
 *
 * 架构：
 *   MemoryEngine 是独立于 AI 宿主的记忆中间件核心。
 *   OpenClaw hooks 只是往 Engine 送数据的方式之一。
 *   外部系统（智能家居等）可通过 HTTP POST /record 直接推送对话。
 *
 * 功能：
 *   1. before_prompt_build: 注入人格 + 记忆
 *   2. llm_output: 捕获 AI 回复 → MemoryEngine.record()
 *   3. agent_end / session_end: 补充记忆提取
 *   4. HTTP /record: 独立于 AI 的记忆采集端点
 *   5. Agent tools: select / export / import / install / list
 *   6. 版本检查: GET /version-check
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import {
  parsePack,
  normalize,
  buildPromptInjection,
} from "./reader.js";
import {
  setRuntimeContext,
  setCurrentPack,
  getCurrentPack,
  getCurrentPackId,
  selectPackTool,
  exportStateTool,
  importStateTool,
  installPackTool,
  listPacksTool,
} from "./tools.js";
import { createRouteHandlers } from "./http-routes.js";
import { MemoryEngine } from "./memory-engine.js";
import type { SoulPack } from "./types.js";

// ─── 全局 MemoryEngine 实例（供 HTTP 路由和 hooks 共享）────

let _engine: MemoryEngine | null = null;

export function getEngine(): MemoryEngine | null {
  return _engine;
}

// ─── 状态存储目录 ─────────────────────────────────────────

function resolveDefaultStateDir(): string {
  return path.join(os.homedir(), ".openclaw", "soulpack-data");
}

// ─── 自动加载 pack ────────────────────────────────────────

function tryAutoLoadPack(pluginConfig: Record<string, unknown> | undefined): SoulPack | null {
  const packPath = pluginConfig?.packPath;
  if (typeof packPath !== "string" || !packPath) return null;
  const resolved = path.resolve(packPath);
  if (!fs.existsSync(resolved)) return null;
  try {
    return parsePack(fs.readFileSync(resolved, "utf-8"));
  } catch {
    return null;
  }
}

// ─── 从 event.messages 提取最后一条用户消息 ───────────────

function extractLastUserMessage(messages: unknown[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") continue;
    const m = msg as Record<string, unknown>;
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content.trim() || null;
    if (Array.isArray(m.content)) {
      const text = (m.content as Array<Record<string, unknown>>)
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text as string)
        .join("\n")
        .trim();
      return text || null;
    }
  }
  return null;
}

// ─── Plugin 定义 ──────────────────────────────────────────

const CURRENT_VERSION = "0.2.0";

const soulpackPlugin = {
  id: "soulpack-reader",
  name: "Soul Pack Reader",
  description:
    "Load character persona packs (Soul Packs) with voice, 2D appearance, and portable memory. " +
    "Memory is recorded independently of the AI host via MemoryEngine.",
  kind: "extension" as const,
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    const pluginConfig = api.pluginConfig as Record<string, unknown> | undefined;
    const stateDir =
      (typeof pluginConfig?.stateDir === "string" && pluginConfig.stateDir) ||
      resolveDefaultStateDir();

    const maxMemories = typeof pluginConfig?.maxMemories === "number"
      ? pluginConfig.maxMemories : 200;
    const maxTranscripts = typeof pluginConfig?.maxTranscripts === "number"
      ? pluginConfig.maxTranscripts : 50;

    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }

    setRuntimeContext(stateDir);

    // 尝试从配置自动加载 pack
    const autoPack = tryAutoLoadPack(pluginConfig);
    if (autoPack) {
      setCurrentPack(autoPack);

      // 创建 MemoryEngine 实例
      _engine = new MemoryEngine({
        stateDir,
        packId: autoPack.packId,
        maxMemories,
        maxTranscripts,
      });

      const features: string[] = [];
      if (autoPack.voice) features.push("voice");
      if (autoPack.appearance?.avatarUrl) features.push("avatar");
      if (autoPack.appearance?.expressions) {
        features.push(`${Object.keys(autoPack.appearance.expressions).length} expressions`);
      }
      api.logger.info(
        `Soul Pack loaded: "${autoPack.name}" (${autoPack.packId})` +
        (features.length > 0 ? ` [${features.join(", ")}]` : "") +
        ` | memory: ${_engine.getMemoryCount()}/${maxMemories}`,
      );
    }

    // 缓冲最后一条用户消息（用于在 llm_output 时配对）
    let _lastUserInput = "";

    // ─── Hook: before_prompt_build ──────────────────────
    api.on("before_prompt_build", (event, _ctx) => {
      const pack = getCurrentPack();
      if (!pack) return;

      // 提取最新用户消息以供后续 llm_output 配对
      if (Array.isArray(event.messages)) {
        const userMsg = extractLastUserMessage(event.messages);
        if (userMsg) _lastUserInput = userMsg;
      }

      // 从 MemoryEngine 读取记忆注入 prompt
      const engine = _engine;
      const packId = getCurrentPackId();
      const state = engine ? engine.loadState() : { memories: [] };
      const normalized = normalize(pack, state as any);
      const injection = buildPromptInjection(normalized);

      return { prependContext: injection };
    });

    // ─── Hook: llm_output（核心：通过 MemoryEngine 记录）───
    api.on("llm_output", (event, _ctx) => {
      if (!getCurrentPack() || !_engine) return;

      const aiTexts = event.assistantTexts ?? [];
      const aiOutput = aiTexts.filter(Boolean).join("\n");
      if (!aiOutput || !_lastUserInput) return;

      // 通过 MemoryEngine 记录对话（独立于任何 hook 框架）
      const result = _engine.record(_lastUserInput, aiOutput, event.sessionId);
      if (result.memoriesAdded > 0) {
        api.logger.info(
          `Soul memory: +${result.memoriesAdded} (total: ${result.totalMemories}/${maxMemories})`,
        );
      }

      _lastUserInput = "";
    });

    // ─── Hook: session_end（结束会话 + 保存 transcript）───
    api.on("session_end", (_event, _ctx) => {
      if (_engine) {
        _engine.endSession();
      }
      _lastUserInput = "";
    });

    // ─── 版本检查（启动时异步检查）─────────────────────
    MemoryEngine.checkForUpdate(
      "https://api.github.com/repos/Brant123451/soulpack-reader/releases/latest",
      CURRENT_VERSION,
    ).then((result) => {
      if (result?.hasUpdate) {
        api.logger.info(
          `[soulpack-reader] Update available: v${result.latestVersion} (current: v${CURRENT_VERSION}). ` +
          `Download: ${result.downloadUrl}`,
        );
      }
    }).catch(() => {});

    // ─── Tools ──────────────────────────────────────────
    api.registerTool(selectPackTool as any, { name: "soulpack_select" });
    api.registerTool(exportStateTool as any, { name: "soulpack_export_state" });
    api.registerTool(importStateTool as any, { name: "soulpack_import_state" });
    api.registerTool(installPackTool as any, { name: "soulpack_install" });
    api.registerTool(listPacksTool as any, { name: "soulpack_list" });

    // ─── HTTP Routes ────────────────────────────────────
    const routes = createRouteHandlers(stateDir, getEngine);
    api.registerHttpRoute({ path: "/import", handler: routes.import });
    api.registerHttpRoute({ path: "/list", handler: routes.list });
    api.registerHttpRoute({ path: "/activate", handler: routes.activate });
    api.registerHttpRoute({ path: "/ping", handler: routes.ping });
    api.registerHttpRoute({ path: "/remove", handler: routes.remove });
    api.registerHttpRoute({ path: "/record", handler: routes.record });
    api.registerHttpRoute({ path: "/memory/status", handler: routes.memoryStatus });
    api.registerHttpRoute({ path: "/memory/search", handler: routes.memorySearch });
    api.registerHttpRoute({ path: "/version-check", handler: routes.versionCheck });

    api.logger.info(
      `Soul Pack v${CURRENT_VERSION} ready | ` +
      `HTTP: /import /list /activate /ping /remove /record /memory/status /memory/search /version-check`,
    );
  },
};

export default soulpackPlugin;
