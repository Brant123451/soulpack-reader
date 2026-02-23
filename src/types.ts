/**
 * Soul Pack v0.1 — 数据规范类型定义
 *
 * 三层架构：
 *   Pack  (静态层) — 可公开分发的人格/资产
 *   State (状态层) — 私密的灵魂记忆，可迁移
 *   Overlay (编辑层) — 用户在宿主内的改动覆盖
 */

// ─── Pack（静态层）───────────────────────────────────────

export type SoulPackAssetType =
  | "avatar"
  | "avatar-expression"
  | "voice"
  | "background"
  | "model3d"
  | "live2d"
  | "bgm"
  | "emoji"
  | string; // 允许未来扩展未知类型

export type SoulPackAsset = {
  /** 资产类型 */
  type: SoulPackAssetType;
  /** 资产标签（例如 "default", "happy", "angry"） */
  label?: string;
  /** 资产 URL 或相对路径 */
  url: string;
  /** MIME type（可选） */
  mimeType?: string;
  /** 该资产是否为必需（宿主不支持时是否降级） */
  required?: boolean;
  /** 资产的附加元数据（开放式） */
  meta?: Record<string, unknown>;
};

export type SoulPackPersona = {
  /** 注入到 system prompt 的人格设定文本 */
  systemPrompt: string;
  /** 角色名 */
  name?: string;
  /** 角色简介（可选，用于展示） */
  description?: string;
  /** 额外的 prompt fragments（可选） */
  contextNotes?: string[];
};

/** 语音/TTS 偏好配置（宿主按能力消费，不支持则忽略） */
export type SoulPackVoice = {
  /** 首选 TTS provider: "openai" | "elevenlabs" | "edge" | 其他 */
  provider?: string;
  /** voice ID 或 voice name（取决于 provider） */
  voiceId?: string;
  /** TTS model（如 elevenlabs 的 model ID，openai 的 model name） */
  modelId?: string;
  /** 说话语言（BCP-47，例如 "zh-CN", "en-US"） */
  language?: string;
  /** 语速 (0.5-2.0, 1.0=正常) */
  speed?: number;
  /** 稳定性 (0-1, elevenlabs 专用) */
  stability?: number;
  /** 附加 provider 特定配置（开放式） */
  extra?: Record<string, unknown>;
};

/** 2D 外观配置（宿主按能力消费，不支持则忽略） */
export type SoulPackAppearance = {
  /** 主头像 URL（静态图片） */
  avatarUrl?: string;
  /** 表情包：label → URL 映射（用于不同情绪展示） */
  expressions?: Record<string, string>;
  /** 主题色（CSS 颜色值，用于 UI 染色） */
  themeColor?: string;
  /** emoji 标识（单个 emoji 字符，用于简单场景） */
  emoji?: string;
  /** 附加外观配置（开放式，未来扩展 Live2D/3D 等） */
  extra?: Record<string, unknown>;
};

export type SoulPack = {
  /** 规范版本，当前 "0.1.0" */
  specVersion: string;
  /** 全局唯一的包 ID（推荐 URL-safe 格式，例如 "jarvis-v1"） */
  packId: string;
  /** 包的显示名称 */
  name: string;
  /** 人格设定 */
  persona: SoulPackPersona;
  /** 语音偏好（可选） */
  voice?: SoulPackVoice;
  /** 外观配置（可选） */
  appearance?: SoulPackAppearance;
  /** 资产清单（头像/语音/背景/3D/Live2D 等文件资源） */
  assets?: SoulPackAsset[];
  /** 厂商/第三方扩展命名空间（unknown-safe，Reader 跳过不认识的） */
  extensions?: Record<string, unknown>;
  /** 包的作者 */
  author?: string;
  /** 许可协议 */
  license?: string;
  /** 创建时间 ISO 8601 */
  createdAt?: string;
};

// ─── State（状态层 / 灵魂记忆）───────────────────────────

export type SoulMemoryEntry = {
  /** 记忆 ID（自动生成） */
  id: string;
  /** 记忆内容（自然语言摘要） */
  content: string;
  /** 记忆产生的时间 ISO 8601 */
  timestamp: string;
  /** 来源会话 ID（可选） */
  sessionId?: string;
  /** 附加标签 */
  tags?: string[];
};

export type SoulState = {
  /** 状态规范版本 */
  stateVersion: string;
  /** 关联的 packId */
  packId: string;
  /** 记忆条目（按时间正序） */
  memories: SoulMemoryEntry[];
  /** 上次更新时间 ISO 8601 */
  lastUpdated: string;
};

// ─── Overlay（用户编辑覆盖层）────────────────────────────

export type SoulOverlay = {
  /** overlay 规范版本 */
  overlayVersion: string;
  /** 关联的 packId */
  packId: string;
  /** 可覆盖的白名单字段 */
  displayName?: string;
  avatarUrl?: string;
  voiceId?: string;
  theme?: string;
  preferredLanguage?: string;
  /** 额外自定义覆盖 */
  custom?: Record<string, unknown>;
};

// ─── 归一化后的内部表示（IR）─────────────────────────────

export type NormalizedSoulPack = {
  packId: string;
  name: string;
  systemPrompt: string;
  contextNotes: string[];
  avatarUrl: string | null;
  emoji: string | null;
  themeColor: string | null;
  expressions: Record<string, string>;
  voice: SoulPackVoice | null;
  assets: SoulPackAsset[];
  extensions: Record<string, unknown>;
  memories: SoulMemoryEntry[];
};
