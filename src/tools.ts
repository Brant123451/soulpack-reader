/**
 * Soul Pack Reader — Shared State Management
 *
 * Minimal state management module shared between MCP server (index.ts)
 * and optional HTTP server. No framework dependencies.
 */

import type { SoulPack } from "./types.js";
import type { MemoryEngine } from "./memory-engine.js";

// ─── State dir ───────────────────────────────────────────────

let _stateDir = "";

export function setStateDir(dir: string): void {
  _stateDir = dir;
}

export function getStateDir(): string {
  return _stateDir;
}

// ─── Current pack (via ref callbacks for cross-module sync) ──

let _getPack: () => SoulPack | null = () => null;
let _setPack: (pack: SoulPack) => void = () => {};

export function setCurrentPackRef(
  getter: () => SoulPack | null,
  setter: (pack: SoulPack) => void,
): void {
  _getPack = getter;
  _setPack = setter;
}

export function getCurrentPack(): SoulPack | null {
  return _getPack();
}

export function setCurrentPack(pack: SoulPack): void {
  _setPack(pack);
}

export function getCurrentPackId(): string {
  return _getPack()?.packId ?? "";
}

// ─── Engine ref (for HTTP routes) ────────────────────────────

let _getEngine: () => MemoryEngine | null = () => null;

export function setEngineRef(getter: () => MemoryEngine | null): void {
  _getEngine = getter;
}

export function getEngine(): MemoryEngine | null {
  return _getEngine();
}
