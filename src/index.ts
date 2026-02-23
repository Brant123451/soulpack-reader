/**
 * Soul Pack Reader — OpenClaw Plugin 入口
 *
 * 功能：
 *   1. before_prompt_build: 将当前 Soul Pack 的人格 + 记忆 + 语音/外观提示注入 system prompt
 *   2. session_end: 自动生成本次会话的记忆摘要并持久化到 state
 *   3. 注册 3 个 agent tools: soulpack_select / soulpack_export_state / soulpack_import_state
 *   4. 语音(TTS): 将 pack 中的 voice 偏好映射到 OpenClaw TTS 配置提示
 *   5. 外观(2D): 将 pack 中的 appearance 写入 agent identity（avatar/emoji）
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
  buildTtsConfigOverride,
} from "./reader.js";
import { loadState, saveState, addMemory } from "./state.js";
import {
  setRuntimeContext,
  setCurrentPack,
  getCurrentPack,
  getCurrentPackId,
  selectPackTool,
  exportStateTool,
  importStateTool,
} from "./tools.js";
import type { SoulPack } from "./types.js";

// ─── 状态存储目录 ─────────────────────────────────────────

function resolveDefaultStateDir(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, ".openclaw", "soulpack-data");
}

// ─── 自动加载 pack（从插件配置中读取 packPath）─────────────

function tryAutoLoadPack(pluginConfig: Record<string, unknown> | undefined): SoulPack | null {
  const packPath = pluginConfig?.packPath;
  if (typeof packPath !== "string" || !packPath) return null;

  const resolved = path.resolve(packPath);
  if (!fs.existsSync(resolved)) return null;

  try {
    const raw = fs.readFileSync(resolved, "utf-8");
    return parsePack(raw);
  } catch {
    return null;
  }
}

// ─── Plugin 定义 ──────────────────────────────────────────

const soulpackPlugin = {
  id: "soulpack-reader",
  name: "Soul Pack Reader",
  description:
    "Load character persona packs (Soul Packs) with voice, 2D appearance, and portable memory. " +
    "Injects persona into system prompt, configures TTS voice, and persists soul memories across sessions.",
  kind: "extension" as const,
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    const pluginConfig = api.pluginConfig as Record<string, unknown> | undefined;
    const stateDir =
      (typeof pluginConfig?.stateDir === "string" && pluginConfig.stateDir) ||
      resolveDefaultStateDir();

    // 确保状态目录存在
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }

    setRuntimeContext(stateDir);

    // 尝试从配置自动加载 pack
    const autoPack = tryAutoLoadPack(pluginConfig);
    if (autoPack) {
      setCurrentPack(autoPack);
      const features: string[] = [];
      if (autoPack.voice) features.push("voice");
      if (autoPack.appearance?.avatarUrl) features.push("avatar");
      if (autoPack.appearance?.expressions) features.push(`${Object.keys(autoPack.appearance.expressions).length} expressions`);
      api.logger.info(
        `Soul Pack loaded: "${autoPack.name}" (${autoPack.packId})` +
        (features.length > 0 ? ` [${features.join(", ")}]` : ""),
      );
    }

    // ─── Hook: before_prompt_build ──────────────────────
    api.on("before_prompt_build", (event, _ctx) => {
      const pack = getCurrentPack();
      if (!pack) return;

      const packId = getCurrentPackId();
      const state = loadState(stateDir, packId);
      const normalized = normalize(pack, state);
      const injection = buildPromptInjection(normalized);

      return {
        prependContext: injection,
      };
    });

    // ─── Hook: session_end ──────────────────────────────
    api.on("session_end", (event, ctx) => {
      const pack = getCurrentPack();
      if (!pack) return;

      const packId = getCurrentPackId();
      const state = loadState(stateDir, packId);

      const memoryContent =
        `Session completed (${event.messageCount} messages` +
        (event.durationMs ? `, ${Math.round(event.durationMs / 1000)}s` : "") +
        `). Session ID: ${event.sessionId || ctx.sessionId || "unknown"}.`;

      addMemory(state, memoryContent, event.sessionId || ctx.sessionId);
      saveState(stateDir, state);
    });

    // ─── Tools ──────────────────────────────────────────
    api.registerTool(selectPackTool as any, { name: "soulpack_select" });
    api.registerTool(exportStateTool as any, { name: "soulpack_export_state" });
    api.registerTool(importStateTool as any, { name: "soulpack_import_state" });
  },
};

export default soulpackPlugin;
