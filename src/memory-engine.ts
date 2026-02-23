/**
 * MemoryEngine — 独立于任何 AI 宿主的记忆中间件
 *
 * 设计原则：
 *   - 零框架依赖，纯 Node.js 标准库
 *   - 任何系统都可以通过 engine.record(user, ai) 记录对话
 *   - 也可以通过 HTTP POST /record 从外部推送
 *   - OpenClaw hooks 只是往 Engine 送数据的方式之一
 *   - 记忆有上限，超出自动截断旧条目
 *   - 对话记录（transcript）独立保存为完整文件
 *
 * 使用方式：
 *   const engine = new MemoryEngine({ stateDir, packId, maxMemories: 200 });
 *   engine.record("你好，我叫小明", "你好小明！很高兴认识你");
 *   // 记忆自动提取 + 对话自动记录 + state 自动保存
 */

import fs from "node:fs";
import path from "node:path";
import type { SoulState, SoulMemoryEntry } from "./types.js";

// ─── 配置 ─────────────────────────────────────────────────

export type MemoryEngineConfig = {
  /** 状态存储根目录 */
  stateDir: string;
  /** 关联的 packId */
  packId: string;
  /** 记忆条目上限（超出时自动截断旧条目）。默认 200 */
  maxMemories?: number;
  /** 对话记录文件上限（每个 pack 最多保留多少个 transcript）。默认 50 */
  maxTranscripts?: number;
  /** 是否保存完整对话记录。默认 true */
  saveTranscripts?: boolean;
};

const DEFAULT_MAX_MEMORIES = 200;
const DEFAULT_MAX_TRANSCRIPTS = 50;

// ─── 消息类型 ─────────────────────────────────────────────

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

// ─── MemoryEngine ─────────────────────────────────────────

export class MemoryEngine {
  private stateDir: string;
  private packId: string;
  private maxMemories: number;
  private maxTranscripts: number;
  private saveTranscripts: boolean;

  // 当前会话缓冲
  private buffer: ConversationMessage[] = [];
  private sessionId: string = "";
  private sessionStartedAt: string = "";

  constructor(config: MemoryEngineConfig) {
    this.stateDir = config.stateDir;
    this.packId = config.packId;
    this.maxMemories = config.maxMemories ?? DEFAULT_MAX_MEMORIES;
    this.maxTranscripts = config.maxTranscripts ?? DEFAULT_MAX_TRANSCRIPTS;
    this.saveTranscripts = config.saveTranscripts !== false;

    // 确保目录存在
    this.ensureDir(this.stateDir);
    this.ensureDir(this.getStatesDir());
    if (this.saveTranscripts) {
      this.ensureDir(this.getTranscriptsDir());
    }
  }

  // ─── 核心 API：记录一轮对话 ──────────────────────────────

  /**
   * 记录一轮对话（用户输入 + AI 回复）
   * 这是最核心的方法 — 任何系统都可以调用
   *
   * @returns 本轮提取的记忆数量
   */
  record(userInput: string, aiOutput: string, sessionId?: string): {
    memoriesAdded: number;
    totalMemories: number;
    transcriptPath: string | null;
  } {
    const now = new Date().toISOString();
    const sid = sessionId || this.sessionId || `session_${Date.now()}`;

    if (!this.sessionId) {
      this.startSession(sid);
    }

    // 缓冲消息
    const pair: ConversationMessage[] = [
      { role: "user", content: userInput, timestamp: now },
      { role: "assistant", content: aiOutput, timestamp: now },
    ];
    this.buffer.push(...pair);

    // 立即持久化原始对话（每轮都写盘，不依赖 endSession）
    let transcriptPath: string | null = null;
    if (this.saveTranscripts) {
      transcriptPath = this.appendTranscript(sid, pair);
    }

    // 加载状态
    const state = this.loadState();

    // 提取记忆
    const newMemories = this.extractFromPair(userInput, aiOutput, sid);
    let added = 0;
    for (const mem of newMemories) {
      this.addMemoryEntry(state, mem.content, sid, mem.tags);
      added++;
    }

    // 截断旧记忆
    this.enforceMemoryLimit(state);

    // 保存状态
    this.saveState(state);

    return {
      memoriesAdded: added,
      totalMemories: state.memories.length,
      transcriptPath,
    };
  }

  /**
   * 批量记录多条消息（适用于一次性导入整个对话）
   */
  recordBatch(messages: ConversationMessage[], sessionId?: string): {
    memoriesAdded: number;
    totalMemories: number;
    transcriptPath: string | null;
  } {
    const sid = sessionId || `batch_${Date.now()}`;
    if (!this.sessionId) this.startSession(sid);

    // 追加到缓冲
    this.buffer.push(...messages);

    // 加载状态
    const state = this.loadState();

    // 从完整对话中提取记忆
    const userMsgs = messages.filter((m) => m.role === "user");
    const aiMsgs = messages.filter((m) => m.role === "assistant");
    let added = 0;

    // 对话概要
    const summary = this.generateSummary(userMsgs, aiMsgs);
    if (summary) {
      this.addMemoryEntry(state, summary, sid, ["session_summary"]);
      added++;
    }

    // 逐条提取用户事实
    for (const msg of userMsgs) {
      const facts = this.extractUserFacts(msg.content);
      for (const fact of facts) {
        this.addMemoryEntry(state, fact, sid, ["user_fact"]);
        added++;
      }
    }

    // 截断
    this.enforceMemoryLimit(state);
    this.saveState(state);

    // 保存 transcript
    let transcriptPath: string | null = null;
    if (this.saveTranscripts && messages.length > 0) {
      transcriptPath = this.writeTranscript(sid, messages);
      this.enforceTranscriptLimit();
    }

    return { memoriesAdded: added, totalMemories: state.memories.length, transcriptPath };
  }

  // ─── 会话管理 ───────────────────────────────────────────

  startSession(sessionId: string): void {
    this.sessionId = sessionId;
    this.sessionStartedAt = new Date().toISOString();
    this.buffer = [];
  }

  endSession(): {
    transcriptPath: string | null;
  } {
    // record() 已在每轮调用时增量写盘，这里只做清理
    let transcriptPath: string | null = null;

    if (this.saveTranscripts && this.buffer.length > 0) {
      // 返回当前 session 的 transcript 文件路径
      const safeSid = (this.sessionId || `s_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "_");
      transcriptPath = path.join(this.getTranscriptsDir(), `${safeSid}.json`);
      this.enforceTranscriptLimit();
    }

    // 重置
    this.buffer = [];
    this.sessionId = "";
    this.sessionStartedAt = "";
    return { transcriptPath };
  }

  // ─── 记忆查询 ───────────────────────────────────────────

  getMemories(limit?: number): SoulMemoryEntry[] {
    const state = this.loadState();
    const memories = state.memories;
    if (limit && limit < memories.length) {
      return memories.slice(-limit);
    }
    return memories;
  }

  getMemoryCount(): number {
    return this.loadState().memories.length;
  }

  /** 搜索记忆（简单关键词匹配） */
  searchMemories(query: string, limit = 10): SoulMemoryEntry[] {
    const state = this.loadState();
    const q = query.toLowerCase();
    return state.memories
      .filter((m) => m.content.toLowerCase().includes(q))
      .slice(-limit);
  }

  /** 按标签过滤记忆 */
  getMemoriesByTag(tag: string, limit = 20): SoulMemoryEntry[] {
    const state = this.loadState();
    return state.memories
      .filter((m) => m.tags?.includes(tag))
      .slice(-limit);
  }

  // ─── 记忆管理 ───────────────────────────────────────────

  /** 手动添加一条记忆 */
  addManualMemory(content: string, tags?: string[]): SoulMemoryEntry {
    const state = this.loadState();
    const entry = this.addMemoryEntry(state, content, this.sessionId || undefined, tags);
    this.enforceMemoryLimit(state);
    this.saveState(state);
    return entry;
  }

  /** 删除指定记忆 */
  deleteMemory(memoryId: string): boolean {
    const state = this.loadState();
    const idx = state.memories.findIndex((m) => m.id === memoryId);
    if (idx < 0) return false;
    state.memories.splice(idx, 1);
    this.saveState(state);
    return true;
  }

  /** 清空所有记忆 */
  clearMemories(): void {
    const state = this.loadState();
    state.memories = [];
    this.saveState(state);
  }

  // ─── 版本检查 ───────────────────────────────────────────

  /**
   * 检查 GitHub 仓库是否有新版本
   * @param repoUrl GitHub API URL, e.g. "https://api.github.com/repos/Brant123451/soulpack-reader/releases/latest"
   * @param currentVersion 当前版本，例如 "0.1.0"
   */
  static async checkForUpdate(
    repoUrl: string,
    currentVersion: string,
  ): Promise<{ hasUpdate: boolean; latestVersion: string; downloadUrl: string } | null> {
    try {
      const response = await fetch(repoUrl, {
        headers: { "Accept": "application/vnd.github.v3+json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      const data = await response.json() as Record<string, unknown>;
      const tagName = (data.tag_name as string || "").replace(/^v/, "");
      const htmlUrl = data.html_url as string || "";
      if (!tagName) return null;
      return {
        hasUpdate: tagName !== currentVersion && tagName > currentVersion,
        latestVersion: tagName,
        downloadUrl: htmlUrl,
      };
    } catch {
      return null;
    }
  }

  // ─── 状态信息 ───────────────────────────────────────────

  getStatus(): {
    packId: string;
    totalMemories: number;
    maxMemories: number;
    activeSession: string | null;
    bufferSize: number;
    transcriptCount: number;
  } {
    return {
      packId: this.packId,
      totalMemories: this.getMemoryCount(),
      maxMemories: this.maxMemories,
      activeSession: this.sessionId || null,
      bufferSize: this.buffer.length,
      transcriptCount: this.countTranscripts(),
    };
  }

  // ─── 内部方法：记忆提取 ─────────────────────────────────

  private extractFromPair(
    userInput: string,
    aiOutput: string,
    sessionId: string,
  ): { content: string; tags: string[] }[] {
    const results: { content: string; tags: string[] }[] = [];

    // 提取用户事实
    const facts = this.extractUserFacts(userInput);
    for (const f of facts) {
      results.push({ content: f, tags: ["user_fact"] });
    }

    // 对话摘要（简短版）
    const userSnippet = truncate(userInput, 80);
    const aiSnippet = truncate(aiOutput, 80);
    results.push({
      content: `Conversation: User said "${userSnippet}" → AI responded "${aiSnippet}"`,
      tags: ["exchange"],
    });

    return results;
  }

  private extractUserFacts(text: string): string[] {
    const facts: string[] = [];
    const patterns = [
      /(?:我(?:是|叫|的名字是|姓))\s*(.{2,30})/g,
      /(?:我(?:喜欢|爱好|热爱|对.{1,6}感兴趣))\s*(.{2,50})/g,
      /(?:我(?:在|住在|来自))\s*(.{2,30})/g,
      /(?:我(?:今年|现在))\s*(.{2,20})/g,
      /(?:我的(?:工作|职业|专业)(?:是)?)\s*(.{2,30})/g,
      /(?:(?:I am|I'm)\s+)(.{2,50})/gi,
      /(?:my name is\s+)(.{2,30})/gi,
      /(?:I (?:like|love|enjoy)\s+)(.{2,50})/gi,
      /(?:I (?:live in|work (?:at|as|in))\s+)(.{2,50})/gi,
    ];

    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const sentence = extractSentenceAround(text, match.index, match[0].length);
        const fact = `User shared: ${truncate(sentence, 120)}`;
        if (!facts.includes(fact)) facts.push(fact);
      }
    }
    return facts.slice(0, 5);
  }

  private generateSummary(
    userMsgs: ConversationMessage[],
    aiMsgs: ConversationMessage[],
  ): string | null {
    if (userMsgs.length === 0) return null;
    const totalChars =
      userMsgs.reduce((s, m) => s + m.content.length, 0) +
      aiMsgs.reduce((s, m) => s + m.content.length, 0);
    const first = truncate(userMsgs[0].content, 80);
    const last = userMsgs.length > 1 ? truncate(userMsgs[userMsgs.length - 1].content, 80) : "";
    let summary = `Session: ${userMsgs.length} user msgs, ${aiMsgs.length} AI msgs (~${totalChars} chars). `;
    summary += `Started: "${first}"`;
    if (last && last !== first) summary += ` → ended: "${last}"`;
    return summary + ".";
  }

  // ─── 内部方法：存储 ─────────────────────────────────────

  private getStatesDir(): string {
    return path.join(this.stateDir, "soulpack-states");
  }

  private getTranscriptsDir(): string {
    return path.join(this.stateDir, "transcripts", this.safeId());
  }

  private safeId(): string {
    return this.packId.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  private getStatePath(): string {
    return path.join(this.getStatesDir(), `${this.safeId()}.state.json`);
  }

  loadState(): SoulState {
    const filePath = this.getStatePath();
    if (!fs.existsSync(filePath)) return this.createEmptyState();
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as SoulState;
      return data.packId === this.packId ? data : this.createEmptyState();
    } catch {
      return this.createEmptyState();
    }
  }

  private saveState(state: SoulState): void {
    state.lastUpdated = new Date().toISOString();
    this.ensureDir(this.getStatesDir());
    fs.writeFileSync(this.getStatePath(), JSON.stringify(state, null, 2), "utf-8");
  }

  private createEmptyState(): SoulState {
    return {
      stateVersion: "0.1.0",
      packId: this.packId,
      memories: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  private memoryCounter = 0;

  private addMemoryEntry(
    state: SoulState,
    content: string,
    sessionId?: string,
    tags?: string[],
  ): SoulMemoryEntry {
    this.memoryCounter++;
    const entry: SoulMemoryEntry = {
      id: `mem_${Date.now()}_${this.memoryCounter}`,
      content,
      timestamp: new Date().toISOString(),
      sessionId,
      tags,
    };
    state.memories.push(entry);
    return entry;
  }

  /** 截断旧记忆到上限 */
  private enforceMemoryLimit(state: SoulState): void {
    if (state.memories.length > this.maxMemories) {
      const excess = state.memories.length - this.maxMemories;
      state.memories = state.memories.slice(excess);
    }
  }

  // ─── 内部方法：Transcript ───────────────────────────────

  /**
   * 增量追加对话到 transcript 文件（每轮 record() 调用一次）
   * 如果文件已存在则读取并追加；否则新建。
   * 保证每一轮对话都立即写盘，不丢数据。
   */
  private appendTranscript(sessionId: string, newMessages: ConversationMessage[]): string {
    const dir = this.getTranscriptsDir();
    this.ensureDir(dir);
    const safeSid = (sessionId || `s_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = path.join(dir, `${safeSid}.json`);

    let transcript: {
      packId: string;
      sessionId: string;
      startedAt: string;
      endedAt: string;
      messageCount: number;
      messages: ConversationMessage[];
    };

    // 读取已有 transcript 或新建
    if (fs.existsSync(filePath)) {
      try {
        transcript = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        transcript.messages.push(...newMessages);
      } catch {
        transcript = this.createTranscriptObject(sessionId, newMessages);
      }
    } else {
      transcript = this.createTranscriptObject(sessionId, newMessages);
    }

    transcript.endedAt = newMessages[newMessages.length - 1]?.timestamp || new Date().toISOString();
    transcript.messageCount = transcript.messages.length;

    fs.writeFileSync(filePath, JSON.stringify(transcript, null, 2), "utf-8");
    return filePath;
  }

  /**
   * 全量写入 transcript（用于 recordBatch）
   */
  private writeTranscript(sessionId: string, messages: ConversationMessage[]): string {
    const dir = this.getTranscriptsDir();
    this.ensureDir(dir);
    const safeSid = (sessionId || `s_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = path.join(dir, `${safeSid}.json`);
    fs.writeFileSync(filePath, JSON.stringify(
      this.createTranscriptObject(sessionId, messages),
      null, 2,
    ), "utf-8");
    return filePath;
  }

  private createTranscriptObject(sessionId: string, messages: ConversationMessage[]) {
    return {
      packId: this.packId,
      sessionId,
      startedAt: messages[0]?.timestamp || new Date().toISOString(),
      endedAt: messages[messages.length - 1]?.timestamp || new Date().toISOString(),
      messageCount: messages.length,
      messages,
    };
  }

  private countTranscripts(): number {
    const dir = this.getTranscriptsDir();
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length;
  }

  /** 删除最旧的 transcript 文件直到满足上限 */
  private enforceTranscriptLimit(): void {
    const dir = this.getTranscriptsDir();
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ name: f, path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime);

    while (files.length > this.maxTranscripts) {
      const oldest = files.shift()!;
      try { fs.unlinkSync(oldest.path); } catch { /* ignore */ }
    }
  }

  // ─── 工具 ──────────────────────────────────────────────

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// ─── 字符串工具（模块级） ─────────────────────────────────

function truncate(str: string, maxLen: number): string {
  const clean = str.replace(/\n+/g, " ").trim();
  return clean.length <= maxLen ? clean : clean.slice(0, maxLen - 3) + "...";
}

function extractSentenceAround(text: string, index: number, matchLen: number): string {
  let start = index;
  for (let i = index - 1; i >= Math.max(0, index - 60); i--) {
    if ("。！？.!?\n".includes(text[i])) { start = i + 1; break; }
    start = i;
  }
  let end = index + matchLen;
  for (let i = end; i < Math.min(text.length, end + 60); i++) {
    end = i + 1;
    if ("。！？.!?\n".includes(text[i])) break;
  }
  return text.slice(start, end).trim();
}
