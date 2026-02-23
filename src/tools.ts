/**
 * Soul Pack Agent Tools — export_state / import_state / select_pack
 *
 * 注册为 OpenClaw Agent Tools，让模型可以操作灵魂记忆
 */

import fs from "node:fs";
import path from "node:path";
import { loadState, saveState, exportState, importState } from "./state.js";
import { parsePack, normalize, buildPromptInjection } from "./reader.js";
import {
  listPacks,
  loadPack,
  installPackFromUrl,
  searchRegistry,
  installFromRegistry,
} from "./pack-store.js";
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

// ─── Tool: soulpack_install ──────────────────────────────

export const installPackTool = {
  name: "soulpack_install",
  label: "Soul Pack Install",
  description:
    "Install a Soul Pack from a URL or a registry. " +
    "Provide a direct URL to a .soulpack.json file, or a registry URL + pack ID to search and install. " +
    "The pack will be saved locally and optionally activated.",
  parameters: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description:
          "Direct URL to a .soulpack.json file. If provided, downloads and installs directly.",
      },
      registryUrl: {
        type: "string",
        description:
          "Base URL of a Soul Pack registry (e.g. https://soulpack.example.com). " +
          "Used with packId or query to search and install from registry.",
      },
      packId: {
        type: "string",
        description:
          "Pack ID to install from a registry. Requires registryUrl.",
      },
      query: {
        type: "string",
        description:
          "Search query to find packs in a registry. Requires registryUrl. " +
          "Returns a list of matches for the user to choose from.",
      },
      activate: {
        type: "boolean",
        description: "Whether to activate the pack after installation. Defaults to true.",
      },
    },
  },
  async execute(
    _toolCallId: string,
    params: {
      url?: string;
      registryUrl?: string;
      packId?: string;
      query?: string;
      activate?: boolean;
    },
  ) {
    try {
      const shouldActivate = params.activate !== false;

      // 模式1: 直接 URL 安装
      if (params.url) {
        const { pack, filePath } = await installPackFromUrl(_stateDir, params.url);
        if (shouldActivate) setCurrentPack(pack);
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Soul Pack "${pack.name}" (${pack.packId}) installed from URL.\n` +
                `Saved to: ${filePath}\n` +
                (shouldActivate ? "Pack activated." : "Pack saved but not activated."),
            },
          ],
        };
      }

      // 模式2: 从 Registry 安装（by packId）
      if (params.registryUrl && params.packId) {
        const { pack, filePath } = await installFromRegistry(
          _stateDir,
          params.registryUrl,
          params.packId,
        );
        if (shouldActivate) setCurrentPack(pack);
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Soul Pack "${pack.name}" (${pack.packId}) installed from registry.\n` +
                `Saved to: ${filePath}\n` +
                (shouldActivate ? "Pack activated." : "Pack saved but not activated."),
            },
          ],
        };
      }

      // 模式3: 搜索 Registry
      if (params.registryUrl && params.query) {
        const results = await searchRegistry(params.registryUrl, params.query);
        if (results.length === 0) {
          return {
            content: [
              { type: "text" as const, text: `No packs found for query "${params.query}".` },
            ],
          };
        }
        const listing = results
          .map(
            (r, i) =>
              `${i + 1}. **${r.name}** (${r.packId})${r.author ? " by " + r.author : ""}\n` +
              `   ${r.description || "No description"}`,
          )
          .join("\n");
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Found ${results.length} pack(s) matching "${params.query}":\n\n${listing}\n\n` +
                `To install, use soulpack_install with registryUrl and packId.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text:
              "Please provide either:\n" +
              "- url: Direct URL to a .soulpack.json file\n" +
              "- registryUrl + packId: Install from a registry\n" +
              "- registryUrl + query: Search a registry",
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `Install failed: ${String(err)}` },
        ],
      };
    }
  },
};

// ─── Tool: soulpack_list ─────────────────────────────────

export const listPacksTool = {
  name: "soulpack_list",
  label: "Soul Pack List",
  description:
    "List all locally installed Soul Packs and show which one is currently active.",
  parameters: {
    type: "object" as const,
    properties: {},
  },
  async execute(_toolCallId: string, _params: Record<string, never>) {
    try {
      const packs = listPacks(_stateDir);
      const activePack = getCurrentPack();

      if (packs.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No Soul Packs installed. Use soulpack_install to install one.",
            },
          ],
        };
      }

      const listing = packs
        .map((p) => {
          const active = activePack?.packId === p.packId ? " ⚡ ACTIVE" : "";
          const features: string[] = [];
          if (p.hasVoice) features.push("voice");
          if (p.hasAppearance) features.push("avatar");
          return `- **${p.name}** (${p.packId})${active}${features.length > 0 ? " [" + features.join(", ") + "]" : ""}\n  ${p.description || "No description"}`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Installed Soul Packs (${packs.length}):\n\n${listing}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `List failed: ${String(err)}` },
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
