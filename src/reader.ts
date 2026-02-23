/**
 * Soul Pack Reader — 解析/校验/归一化
 *
 * 支持多版本输入 → 统一输出 NormalizedSoulPack
 */

import type {
  SoulPack,
  SoulState,
  SoulOverlay,
  NormalizedSoulPack,
  SoulPackAsset,
  SoulPackVoice,
} from "./types.js";

// ─── 校验 ────────────────────────────────────────────────

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export function validatePack(data: unknown): ValidationResult {
  const errors: string[] = [];
  if (!data || typeof data !== "object") {
    return { ok: false, errors: ["pack must be a JSON object"] };
  }
  const pack = data as Record<string, unknown>;

  if (typeof pack.specVersion !== "string") {
    errors.push("missing or invalid specVersion");
  }
  if (typeof pack.packId !== "string" || !pack.packId) {
    errors.push("missing or invalid packId");
  }
  if (typeof pack.name !== "string" || !pack.name) {
    errors.push("missing or invalid name");
  }
  if (!pack.persona || typeof pack.persona !== "object") {
    errors.push("missing persona object");
  } else {
    const persona = pack.persona as Record<string, unknown>;
    if (typeof persona.systemPrompt !== "string" || !persona.systemPrompt) {
      errors.push("missing persona.systemPrompt");
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateState(data: unknown): ValidationResult {
  const errors: string[] = [];
  if (!data || typeof data !== "object") {
    return { ok: false, errors: ["state must be a JSON object"] };
  }
  const state = data as Record<string, unknown>;

  if (typeof state.stateVersion !== "string") {
    errors.push("missing or invalid stateVersion");
  }
  if (typeof state.packId !== "string" || !state.packId) {
    errors.push("missing or invalid packId");
  }
  if (!Array.isArray(state.memories)) {
    errors.push("missing memories array");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ─── 解析（多版本适配）─────────────────────────────────────

export function parsePack(raw: string): SoulPack {
  const data = JSON.parse(raw);
  const result = validatePack(data);
  if (!result.ok) {
    throw new Error(`Invalid Soul Pack: ${result.errors.join("; ")}`);
  }
  return data as SoulPack;
}

export function parseState(raw: string): SoulState {
  const data = JSON.parse(raw);
  const result = validateState(data);
  if (!result.ok) {
    throw new Error(`Invalid Soul State: ${result.errors.join("; ")}`);
  }
  return data as SoulState;
}

// ─── 归一化（Pack + State + Overlay → NormalizedSoulPack）──

export function normalize(
  pack: SoulPack,
  state?: SoulState | null,
  overlay?: SoulOverlay | null,
): NormalizedSoulPack {
  // 基础字段
  let name = pack.name;
  let avatarUrl: string | null = pack.appearance?.avatarUrl ?? null;
  let emoji: string | null = pack.appearance?.emoji ?? null;
  let themeColor: string | null = pack.appearance?.themeColor ?? null;
  let expressions: Record<string, string> = { ...(pack.appearance?.expressions ?? {}) };
  let voice: SoulPackVoice | null = pack.voice ?? null;

  // 从 assets 中补充（如果 appearance 没有直接指定）
  const assets: SoulPackAsset[] = Array.isArray(pack.assets) ? pack.assets : [];
  if (!avatarUrl) {
    const defaultAvatar = assets.find((a) => a.type === "avatar");
    if (defaultAvatar) avatarUrl = defaultAvatar.url;
  }

  // 从 assets 收集表情图
  for (const asset of assets) {
    if (asset.type === "avatar-expression" && asset.label && !expressions[asset.label]) {
      expressions[asset.label] = asset.url;
    }
  }

  // 应用 overlay 覆盖
  if (overlay) {
    if (overlay.displayName) name = overlay.displayName;
    if (overlay.avatarUrl) avatarUrl = overlay.avatarUrl;
    if (overlay.voiceId && voice) voice = { ...voice, voiceId: overlay.voiceId };
    else if (overlay.voiceId) voice = { voiceId: overlay.voiceId };
  }

  // 构建 system prompt：persona + contextNotes + 记忆摘要
  const contextNotes = pack.persona.contextNotes ?? [];

  return {
    packId: pack.packId,
    name,
    systemPrompt: pack.persona.systemPrompt,
    contextNotes,
    avatarUrl,
    emoji,
    themeColor,
    expressions,
    voice,
    assets,
    extensions: pack.extensions ?? {},
    memories: state?.memories ?? [],
  };
}

// ─── 构建注入到 system prompt 的完整文本 ────────────────────

export function buildPromptInjection(normalized: NormalizedSoulPack): string {
  const parts: string[] = [];

  parts.push(`[Soul Pack: ${normalized.name}]`);
  parts.push("");
  parts.push(normalized.systemPrompt);

  if (normalized.contextNotes.length > 0) {
    parts.push("");
    parts.push("--- Context Notes ---");
    for (const note of normalized.contextNotes) {
      parts.push(`- ${note}`);
    }
  }

  // 语音/TTS 提示（让模型知道它有"声音"）
  if (normalized.voice) {
    parts.push("");
    parts.push("--- Voice Configuration ---");
    parts.push("You have a voice identity. When the host supports TTS, your replies will be spoken aloud.");
    if (normalized.voice.provider) {
      parts.push(`- TTS provider: ${normalized.voice.provider}`);
    }
    if (normalized.voice.voiceId) {
      parts.push(`- Voice: ${normalized.voice.voiceId}`);
    }
    if (normalized.voice.language) {
      parts.push(`- Language: ${normalized.voice.language}`);
    }
    parts.push("Adjust your speaking style to be natural for voice output: use shorter sentences, avoid excessive markdown formatting when voice is active.");
  }

  // 外观提示（让模型知道它有"形象"）
  if (normalized.avatarUrl || Object.keys(normalized.expressions).length > 0) {
    parts.push("");
    parts.push("--- Appearance ---");
    if (normalized.avatarUrl) {
      parts.push(`- Avatar: ${normalized.avatarUrl}`);
    }
    const exprKeys = Object.keys(normalized.expressions);
    if (exprKeys.length > 0) {
      parts.push(`- Available expressions: ${exprKeys.join(", ")}`);
      parts.push("You may reference an expression by wrapping it in double brackets, e.g. [[happy]], [[angry]], to signal your current mood to the host UI.");
    }
  }

  if (normalized.memories.length > 0) {
    parts.push("");
    parts.push("--- Soul Memories (from previous sessions) ---");
    // 只注入最近 20 条，避免 prompt 过长
    const recent = normalized.memories.slice(-20);
    for (const mem of recent) {
      const ts = mem.timestamp ? `[${mem.timestamp}] ` : "";
      parts.push(`- ${ts}${mem.content}`);
    }
  }

  return parts.join("\n");
}

// ─── 构建 OpenClaw TTS 配置覆盖 ─────────────────────────

export function buildTtsConfigOverride(voice: SoulPackVoice | null): Record<string, unknown> | null {
  if (!voice) return null;

  const tts: Record<string, unknown> = {};

  if (voice.provider === "openai") {
    tts.provider = "openai";
    tts.openai = {
      ...(voice.voiceId ? { voice: voice.voiceId } : {}),
      ...(voice.modelId ? { model: voice.modelId } : {}),
    };
  } else if (voice.provider === "elevenlabs") {
    tts.provider = "elevenlabs";
    tts.elevenlabs = {
      ...(voice.voiceId ? { voiceId: voice.voiceId } : {}),
      ...(voice.modelId ? { modelId: voice.modelId } : {}),
      ...(voice.language ? { languageCode: voice.language } : {}),
      ...(voice.stability != null
        ? { voiceSettings: { stability: voice.stability, speed: voice.speed ?? 1.0 } }
        : {}),
    };
  } else if (voice.provider === "edge") {
    tts.provider = "edge";
    tts.edge = {
      enabled: true,
      ...(voice.voiceId ? { voice: voice.voiceId } : {}),
      ...(voice.language ? { lang: voice.language } : {}),
      ...(voice.speed != null ? { rate: `${voice.speed > 1 ? "+" : ""}${Math.round((voice.speed - 1) * 100)}%` } : {}),
    };
  }

  return Object.keys(tts).length > 0 ? tts : null;
}
