/**
 * Soul Pack Store — 本地多 Pack 管理
 *
 * 存储目录: {stateDir}/packs/
 * 每个 pack 存为 {packId}.soulpack.json
 */

import fs from "node:fs";
import path from "node:path";
import { parsePack, validatePack } from "./reader.js";
import type { SoulPack } from "./types.js";

// ─── 路径解析 ─────────────────────────────────────────────

function resolvePacksDir(stateDir: string): string {
  const dir = path.join(stateDir, "packs");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function safeFileName(packId: string): string {
  return packId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function resolvePackPath(stateDir: string, packId: string): string {
  return path.join(resolvePacksDir(stateDir), `${safeFileName(packId)}.soulpack.json`);
}

// ─── 列出已安装的 packs ───────────────────────────────────

export type PackSummary = {
  packId: string;
  name: string;
  author?: string;
  description?: string;
  hasVoice: boolean;
  hasAppearance: boolean;
  filePath: string;
};

export function listPacks(stateDir: string): PackSummary[] {
  const packsDir = resolvePacksDir(stateDir);
  const files = fs.readdirSync(packsDir).filter((f) => f.endsWith(".soulpack.json"));
  const result: PackSummary[] = [];

  for (const file of files) {
    try {
      const filePath = path.join(packsDir, file);
      const raw = fs.readFileSync(filePath, "utf-8");
      const pack = JSON.parse(raw) as SoulPack;
      if (!pack.packId || !pack.name) continue;
      result.push({
        packId: pack.packId,
        name: pack.name,
        author: pack.author,
        description: pack.persona?.description,
        hasVoice: Boolean(pack.voice),
        hasAppearance: Boolean(pack.appearance?.avatarUrl),
        filePath,
      });
    } catch {
      // 跳过损坏的文件
    }
  }

  return result;
}

// ─── 保存 pack ─────────────────────────────────────────────

export function savePack(stateDir: string, pack: SoulPack): string {
  const filePath = resolvePackPath(stateDir, pack.packId);
  fs.writeFileSync(filePath, JSON.stringify(pack, null, 2), "utf-8");
  return filePath;
}

// ─── 加载 pack ─────────────────────────────────────────────

export function loadPack(stateDir: string, packId: string): SoulPack | null {
  const filePath = resolvePackPath(stateDir, packId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return parsePack(raw);
  } catch {
    return null;
  }
}

// ─── 删除 pack ─────────────────────────────────────────────

export function deletePack(stateDir: string, packId: string): boolean {
  const filePath = resolvePackPath(stateDir, packId);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

// ─── 从 JSON 字符串/对象导入 ──────────────────────────────

export function importPackFromJson(stateDir: string, data: unknown): { pack: SoulPack; filePath: string } {
  const validation = validatePack(data);
  if (!validation.ok) {
    throw new Error(`Invalid Soul Pack: ${validation.errors.join("; ")}`);
  }
  const pack = data as SoulPack;
  const filePath = savePack(stateDir, pack);
  return { pack, filePath };
}

// ─── 从远程 URL 安装 ──────────────────────────────────────

export async function installPackFromUrl(
  stateDir: string,
  url: string,
): Promise<{ pack: SoulPack; filePath: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch pack: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return importPackFromJson(stateDir, data);
}

// ─── 从 Registry 搜索并安装 ──────────────────────────────

export type RegistryPackInfo = {
  packId: string;
  name: string;
  author?: string;
  description?: string;
  downloadUrl: string;
};

export async function searchRegistry(
  registryUrl: string,
  query?: string,
): Promise<RegistryPackInfo[]> {
  const url = new URL("/api/registry/packs", registryUrl);
  if (query) url.searchParams.set("q", query);
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Registry search failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return (data as { packs: RegistryPackInfo[] }).packs ?? [];
}

export async function installFromRegistry(
  stateDir: string,
  registryUrl: string,
  packId: string,
): Promise<{ pack: SoulPack; filePath: string }> {
  const downloadUrl = new URL(`/api/registry/packs/${encodeURIComponent(packId)}/download`, registryUrl);
  return installPackFromUrl(stateDir, downloadUrl.toString());
}
