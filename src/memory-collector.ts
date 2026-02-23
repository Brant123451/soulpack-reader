/**
 * Memory Collector — 从对话中收集并生成结构化记忆
 *
 * 功能：
 *   1. 缓冲会话中的 user/assistant 消息
 *   2. 在 agent_end 时提取关键记忆点
 *   3. 保存完整对话记录到本地 transcript 文件
 *   4. 生成结构化记忆条目存入 SoulState
 */

import fs from "node:fs";
import path from "node:path";
import type { SoulState, SoulMemoryEntry } from "./types.js";
import { addMemory, saveState } from "./state.js";

// ─── 会话消息缓冲 ────────────────────────────────────────

export type BufferedMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
};

let _sessionBuffer: BufferedMessage[] = [];
let _sessionId = "";

export function resetBuffer(sessionId: string): void {
  _sessionBuffer = [];
  _sessionId = sessionId;
}

export function pushUserMessage(content: string): void {
  _sessionBuffer.push({
    role: "user",
    content,
    timestamp: new Date().toISOString(),
  });
}

export function pushAssistantMessage(content: string): void {
  _sessionBuffer.push({
    role: "assistant",
    content,
    timestamp: new Date().toISOString(),
  });
}

export function getBuffer(): BufferedMessage[] {
  return _sessionBuffer;
}

export function getSessionId(): string {
  return _sessionId;
}

// ─── 对话记录保存 ─────────────────────────────────────────

function resolveTranscriptDir(stateDir: string): string {
  const dir = path.join(stateDir, "transcripts");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 保存完整对话记录到本地文件
 * 格式: transcripts/{packId}/{sessionId}.json
 */
export function saveTranscript(
  stateDir: string,
  packId: string,
  sessionId: string,
  messages: BufferedMessage[],
): string {
  const safePackId = packId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_") || `session_${Date.now()}`;
  const packDir = path.join(resolveTranscriptDir(stateDir), safePackId);
  if (!fs.existsSync(packDir)) {
    fs.mkdirSync(packDir, { recursive: true });
  }

  const filePath = path.join(packDir, `${safeSessionId}.json`);
  const transcript = {
    packId,
    sessionId,
    startedAt: messages[0]?.timestamp || new Date().toISOString(),
    endedAt: messages[messages.length - 1]?.timestamp || new Date().toISOString(),
    messageCount: messages.length,
    messages,
  };

  fs.writeFileSync(filePath, JSON.stringify(transcript, null, 2), "utf-8");
  return filePath;
}

// ─── 从 agent_end 的 messages[] 提取对话内容 ──────────────

/**
 * 从 OpenClaw 的 messages[] 格式提取 user/assistant 消息
 * messages 格式可能是: { role, content } 或 { role, content: [{type, text}] }
 */
export function extractMessagesFromAgentEnd(rawMessages: unknown[]): BufferedMessage[] {
  const result: BufferedMessage[] = [];

  for (const msg of rawMessages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as Record<string, unknown>;
    const role = m.role as string;
    if (role !== "user" && role !== "assistant") continue;

    let content = "";
    if (typeof m.content === "string") {
      content = m.content;
    } else if (Array.isArray(m.content)) {
      // content: [{type: "text", text: "..."}]
      content = (m.content as Array<Record<string, unknown>>)
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text as string)
        .join("\n");
    }

    if (!content.trim()) continue;

    result.push({
      role: role as "user" | "assistant",
      content: content.trim(),
      timestamp: new Date().toISOString(),
    });
  }

  return result;
}

// ─── 记忆提取：从对话中生成结构化记忆 ─────────────────────

/**
 * 从对话内容提取关键记忆点
 *
 * 提取策略（无需 LLM，纯规则）：
 * 1. 用户自述信息 → "User mentioned: ..."
 * 2. 对话主题摘要 → "Discussion topic: ..."
 * 3. 关键交互 → 首尾消息概要
 * 4. 情感标记 → 检测情绪关键词
 */
export function extractMemories(
  messages: BufferedMessage[],
  sessionId: string,
): Omit<SoulMemoryEntry, "id">[] {
  if (messages.length === 0) return [];

  const userMessages = messages.filter((m) => m.role === "user");
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const memories: Omit<SoulMemoryEntry, "id">[] = [];
  const now = new Date().toISOString();

  // 1. 对话概要（始终生成）
  const topicSummary = generateTopicSummary(userMessages, assistantMessages);
  if (topicSummary) {
    memories.push({
      content: topicSummary,
      timestamp: now,
      sessionId,
      tags: ["session_summary"],
    });
  }

  // 2. 提取用户自述信息（"我是..."、"我喜欢..."、"我的..."）
  const userFacts = extractUserFacts(userMessages);
  for (const fact of userFacts) {
    memories.push({
      content: fact,
      timestamp: now,
      sessionId,
      tags: ["user_fact"],
    });
  }

  // 3. 提取用户偏好和请求
  const preferences = extractPreferences(userMessages);
  for (const pref of preferences) {
    memories.push({
      content: pref,
      timestamp: now,
      sessionId,
      tags: ["preference"],
    });
  }

  // 4. 如果对话较长，保存关键交互片段
  if (messages.length >= 6) {
    const keyExchanges = extractKeyExchanges(messages);
    for (const exchange of keyExchanges) {
      memories.push({
        content: exchange,
        timestamp: now,
        sessionId,
        tags: ["key_exchange"],
      });
    }
  }

  return memories;
}

// ─── 辅助提取函数 ─────────────────────────────────────────

function generateTopicSummary(
  userMsgs: BufferedMessage[],
  assistantMsgs: BufferedMessage[],
): string | null {
  if (userMsgs.length === 0) return null;

  const totalChars = userMsgs.reduce((sum, m) => sum + m.content.length, 0) +
    assistantMsgs.reduce((sum, m) => sum + m.content.length, 0);

  // 取用户第一条和最后一条消息的前 80 字符作为话题线索
  const firstUser = truncate(userMsgs[0].content, 80);
  const lastUser = userMsgs.length > 1 ? truncate(userMsgs[userMsgs.length - 1].content, 80) : "";

  let summary = `Session with ${userMsgs.length} user messages and ${assistantMsgs.length} responses (~${totalChars} chars). `;
  summary += `Started with: "${firstUser}"`;
  if (lastUser && lastUser !== firstUser) {
    summary += ` → ended with: "${lastUser}"`;
  }
  summary += ".";

  return summary;
}

/**
 * 提取用户的自述信息
 * 匹配模式: "我是/我叫/我的/我喜欢/I am/I'm/my name/I like/I love"
 */
function extractUserFacts(userMsgs: BufferedMessage[]): string[] {
  const facts: string[] = [];
  const patterns = [
    // 中文模式
    /(?:我(?:是|叫|的名字是|姓))\s*(.{2,30})/g,
    /(?:我(?:喜欢|爱好|热爱|对.{1,6}感兴趣))\s*(.{2,50})/g,
    /(?:我(?:在|住在|来自))\s*(.{2,30})/g,
    /(?:我(?:今年|现在))\s*(.{2,20})/g,
    /(?:我的(?:工作|职业|专业)(?:是)?)\s*(.{2,30})/g,
    // 英文模式
    /(?:(?:I am|I'm|I'm)\s+)(.{2,50})/gi,
    /(?:my name is\s+)(.{2,30})/gi,
    /(?:I (?:like|love|enjoy)\s+)(.{2,50})/gi,
    /(?:I (?:live in|work (?:at|as|in))\s+)(.{2,50})/gi,
  ];

  for (const msg of userMsgs) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(msg.content)) !== null) {
        const sentence = extractSentenceAround(msg.content, match.index, match[0].length);
        const fact = `User shared: ${truncate(sentence, 120)}`;
        if (!facts.includes(fact)) {
          facts.push(fact);
        }
      }
    }
  }

  // 限制最多 5 条
  return facts.slice(0, 5);
}

/**
 * 提取用户偏好和请求
 */
function extractPreferences(userMsgs: BufferedMessage[]): string[] {
  const prefs: string[] = [];
  const patterns = [
    // 中文
    /(?:(?:请|帮我|能不能|可以).{2,8}(?:用|改成|换成|说))\s*(.{2,40})/g,
    /(?:我(?:想|要|希望|觉得))\s*(.{2,50})/g,
    /(?:不要|别|不用)\s*(.{2,30})/g,
    // 英文
    /(?:(?:please|could you|can you)\s+)(.{2,60})/gi,
    /(?:I (?:want|need|prefer|would like)\s+)(.{2,50})/gi,
    /(?:don't|do not)\s+(.{2,40})/gi,
  ];

  for (const msg of userMsgs) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(msg.content)) !== null) {
        const sentence = extractSentenceAround(msg.content, match.index, match[0].length);
        const pref = `User preference: ${truncate(sentence, 120)}`;
        if (!prefs.includes(pref)) {
          prefs.push(pref);
        }
      }
    }
  }

  return prefs.slice(0, 3);
}

/**
 * 提取关键交互片段（首轮 + 末轮 + 最长用户消息）
 */
function extractKeyExchanges(messages: BufferedMessage[]): string[] {
  const exchanges: string[] = [];

  // 找最长的用户消息（通常是最有信息量的）
  const userMsgs = messages.filter((m) => m.role === "user");
  if (userMsgs.length > 2) {
    const longest = userMsgs.reduce((a, b) =>
      a.content.length > b.content.length ? a : b,
    );
    if (longest.content.length > 50) {
      exchanges.push(
        `Important user message: "${truncate(longest.content, 150)}"`,
      );
    }
  }

  return exchanges.slice(0, 2);
}

// ─── 字符串工具 ───────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
  const clean = str.replace(/\n+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 3) + "...";
}

function extractSentenceAround(text: string, index: number, matchLen: number): string {
  // 往前找句子起点
  let start = index;
  for (let i = index - 1; i >= Math.max(0, index - 60); i--) {
    if ("。！？.!?\n".includes(text[i])) {
      start = i + 1;
      break;
    }
    start = i;
  }

  // 往后找句子终点
  let end = index + matchLen;
  for (let i = end; i < Math.min(text.length, end + 60); i++) {
    end = i + 1;
    if ("。！？.!?\n".includes(text[i])) {
      break;
    }
  }

  return text.slice(start, end).trim();
}

// ─── 完整记忆处理流程 ─────────────────────────────────────

/**
 * 处理 agent_end 事件：提取记忆 + 保存对话记录
 */
export function processAgentEnd(
  stateDir: string,
  packId: string,
  sessionId: string,
  rawMessages: unknown[],
  state: SoulState,
): {
  memoriesAdded: number;
  transcriptPath: string | null;
} {
  // 从 agent_end 的 messages 提取对话内容
  const messages = extractMessagesFromAgentEnd(rawMessages);

  // 合并缓冲区中的消息（来自 message_received/llm_output hooks）
  const buffer = getBuffer();
  const allMessages = messages.length > 0 ? messages : buffer;

  if (allMessages.length === 0) {
    return { memoriesAdded: 0, transcriptPath: null };
  }

  // 1. 保存完整对话记录
  let transcriptPath: string | null = null;
  try {
    transcriptPath = saveTranscript(stateDir, packId, sessionId, allMessages);
  } catch {
    // 记录失败不影响记忆提取
  }

  // 2. 提取结构化记忆
  const memoryEntries = extractMemories(allMessages, sessionId);
  for (const entry of memoryEntries) {
    addMemory(state, entry.content, entry.sessionId, entry.tags);
  }

  // 3. 去重：如果记忆太多，只保留最近 100 条
  if (state.memories.length > 100) {
    state.memories = state.memories.slice(-100);
  }

  return {
    memoriesAdded: memoryEntries.length,
    transcriptPath,
  };
}
