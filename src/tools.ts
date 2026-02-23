/**
 * Soul Pack Agent Tools — export_state / import_state / select_pack
 *
 * 注册为 OpenClaw Agent Tools，让模型可以操作灵魂记忆
 */

import fs from "node:fs";
import path from "node:path";
import { loadState, saveState, exportState, importState } from "./state.js";
import { parsePack, normalize, buildPromptInjection } from "./reader.js";
import type { SoulPack } from "./types.js";

// ─── 运行时上下文（由 index.ts 注入） ──────────────────────

let _stateDir = "";
let _currentPackId = "";
let _currentPack: SoulPack | null = null;

export function setRuntimeContext(stateDir: string) {
  _stateDir = stateDir;
}

export function setCurrentPack(pack: SoulPack) {
  _currentPack = pack;
  _currentPackId = pack.packId;
}

export function getCurrentPackId(): string {
  return _currentPackId;
}

export function getCurrentPack(): SoulPack | null {
  return _currentPack;
}

export function getStateDir(): string {
  return _stateDir;
}

// ─── Tool: soulpack_select ────────────────────────────────

export const selectPackTool = {
  name: "soulpack_select",
  label: "Soul Pack Select",
  description:
    "Load and activate a Soul Pack (character persona). " +
    "Provide a local file path to a .soulpack.json file. " +
    "Once loaded, the persona and memories will be injected into the conversation.",
  parameters: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Absolute path to a .soulpack.json file",
      },
    },
    required: ["path"],
  },
  async execute(_toolCallId: string, params: { path: string }) {
    try {
      const filePath = path.resolve(params.path);
      if (!fs.existsSync(filePath)) {
        return {
          content: [{ type: "text" as const, text: `File not found: ${filePath}` }],
        };
      }
      const raw = fs.readFileSync(filePath, "utf-8");
      const pack = parsePack(raw);
      setCurrentPack(pack);

      const state = loadState(_stateDir, pack.packId);
      const normalized = normalize(pack, state);
      const injection = buildPromptInjection(normalized);

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Soul Pack "${pack.name}" (${pack.packId}) loaded successfully.\n` +
              `Memories: ${state.memories.length} entries.\n` +
              `Persona prompt injected (${injection.length} chars).`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `Failed to load Soul Pack: ${String(err)}` },
        ],
      };
    }
  },
};

// ─── Tool: soulpack_export_state ──────────────────────────

export const exportStateTool = {
  name: "soulpack_export_state",
  label: "Soul Pack Export State",
  description:
    "Export the current Soul Pack's memory state as JSON. " +
    "The output can be saved to a file or transferred to another instance.",
  parameters: {
    type: "object" as const,
    properties: {
      packId: {
        type: "string",
        description:
          "Pack ID to export. If omitted, uses the currently active pack.",
      },
      outputPath: {
        type: "string",
        description:
          "Optional: absolute file path to write the exported state to. " +
          "If omitted, the state JSON is returned directly.",
      },
    },
  },
  async execute(
    _toolCallId: string,
    params: { packId?: string; outputPath?: string },
  ) {
    try {
      const packId = params.packId || _currentPackId;
      if (!packId) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No pack ID specified and no pack is currently active. Load a pack first or provide packId.",
            },
          ],
        };
      }

      const state = loadState(_stateDir, packId);
      const json = exportState(state);

      if (params.outputPath) {
        const outPath = path.resolve(params.outputPath);
        fs.writeFileSync(outPath, json, "utf-8");
        return {
          content: [
            {
              type: "text" as const,
              text: `State exported to ${outPath} (${state.memories.length} memories, ${json.length} bytes).`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Soul State for "${packId}" (${state.memories.length} memories):\n\n${json}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `Export failed: ${String(err)}` },
        ],
      };
    }
  },
};

// ─── Tool: soulpack_import_state ──────────────────────────

export const importStateTool = {
  name: "soulpack_import_state",
  label: "Soul Pack Import State",
  description:
    "Import a Soul Pack memory state from a JSON file or raw JSON string. " +
    "This replaces the current state for the specified pack.",
  parameters: {
    type: "object" as const,
    properties: {
      source: {
        type: "string",
        description:
          "Absolute path to a .state.json file, or a raw JSON string containing the state.",
      },
      packId: {
        type: "string",
        description:
          "Expected pack ID for validation. If omitted, accepts any pack ID from the state.",
      },
    },
    required: ["source"],
  },
  async execute(
    _toolCallId: string,
    params: { source: string; packId?: string },
  ) {
    try {
      let raw: string;
      const sourcePath = path.resolve(params.source);

      if (fs.existsSync(sourcePath)) {
        raw = fs.readFileSync(sourcePath, "utf-8");
      } else {
        // 尝试当作 JSON 字符串解析
        raw = params.source;
      }

      const state = importState(raw, params.packId);
      saveState(_stateDir, state);

      return {
        content: [
          {
            type: "text" as const,
            text:
              `State imported for pack "${state.packId}". ` +
              `${state.memories.length} memories restored. ` +
              `Last updated: ${state.lastUpdated}.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `Import failed: ${String(err)}` },
        ],
      };
    }
  },
};
