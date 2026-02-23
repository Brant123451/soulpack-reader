/**
 * Soul State 管理 — 加载/保存/导出/导入
 *
 * MVP 阶段使用本地 JSON 文件存储
 */

import fs from "node:fs";
import path from "node:path";
import type { SoulState, SoulMemoryEntry } from "./types.js";

// ─── 存储路径解析 ─────────────────────────────────────────

function resolveStateDir(baseDir: string): string {
  const dir = path.join(baseDir, "soulpack-states");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function resolveStatePath(baseDir: string, packId: string): string {
  const safeId = packId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(resolveStateDir(baseDir), `${safeId}.state.json`);
}

// ─── 加载 ─────────────────────────────────────────────────

export function loadState(baseDir: string, packId: string): SoulState {
  const filePath = resolveStatePath(baseDir, packId);
  if (!fs.existsSync(filePath)) {
    return createEmptyState(packId);
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as SoulState;
    if (data.packId !== packId) {
      return createEmptyState(packId);
    }
    return data;
  } catch {
    return createEmptyState(packId);
  }
}

// ─── 保存 ─────────────────────────────────────────────────

export function saveState(baseDir: string, state: SoulState): void {
  const filePath = resolveStatePath(baseDir, state.packId);
  state.lastUpdated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}

// ─── 添加记忆 ─────────────────────────────────────────────

let memoryCounter = 0;

function generateMemoryId(): string {
  memoryCounter++;
  return `mem_${Date.now()}_${memoryCounter}`;
}

export function addMemory(
  state: SoulState,
  content: string,
  sessionId?: string,
  tags?: string[],
): SoulMemoryEntry {
  const entry: SoulMemoryEntry = {
    id: generateMemoryId(),
    content,
    timestamp: new Date().toISOString(),
    sessionId,
    tags,
  };
  state.memories.push(entry);
  state.lastUpdated = new Date().toISOString();
  return entry;
}

// ─── 导出 / 导入 ──────────────────────────────────────────

export function exportState(state: SoulState): string {
  return JSON.stringify(state, null, 2);
}

export function importState(raw: string, expectedPackId?: string): SoulState {
  const data = JSON.parse(raw) as SoulState;
  if (!data.stateVersion || !data.packId || !Array.isArray(data.memories)) {
    throw new Error("Invalid Soul State format");
  }
  if (expectedPackId && data.packId !== expectedPackId) {
    throw new Error(
      `Pack ID mismatch: expected "${expectedPackId}", got "${data.packId}"`,
    );
  }
  return data;
}

// ─── 空状态工厂 ───────────────────────────────────────────

export function createEmptyState(packId: string): SoulState {
  return {
    stateVersion: "0.1.0",
    packId,
    memories: [],
    lastUpdated: new Date().toISOString(),
  };
}
