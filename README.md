# Soul Pack Reader

**给任何 AI 智能体赋予角色人格、语音、2D 形象和可迁移的灵魂记忆。**

> MCP Server + Skill — 兼容 Windsurf、Cursor、Claude Desktop 及任何 MCP 客户端。

---

## 核心理念

**Soul Pack 只提供素材和使用建议，不做实现层。**

智能体本身具备 AI coding 能力。拿到素材（人格设定、语音偏好、头像/表情资产、记忆）后，智能体可以自行编程实现任何功能——换头像、换声音、加表情系统、改 UI 主题色——无需 Soul Pack 替它完成。

我们的角色：**素材仓库 + 灵感建议**，不是运行时引擎。

## 它能做什么？

| 能力 | 说明 |
|------|------|
| **角色人格** | 将角色性格、说话风格、规则自动注入 system prompt |
| **语音素材** | 提供 TTS 语音偏好配置（OpenAI / ElevenLabs / Edge TTS），智能体按需自行接入 |
| **2D 形象素材** | 提供头像 URL、表情图集（default/happy/sad/thinking…），智能体按环境自行消费 |
| **灵魂记忆** | 跨会话持久化，可导出/导入/迁移到其他实例 |
| **AI coding 引导** | 告诉智能体有哪些素材可用，建议它通过编程实现宿主缺失的功能 |

---

## 快速开始

### 1. 克隆并安装

```bash
git clone https://github.com/Brant123451/soulpack-reader.git
cd soulpack-reader
npm install
```

### 2. 连接到 AI 智能体（MCP）

在你的 AI 工具中添加 MCP Server 配置：

**Windsurf** — 编辑 `~/.codeium/windsurf/mcp_config.json`：

```json
{
  "mcpServers": {
    "soulpack-reader": {
      "command": "npx",
      "args": ["tsx", "E:/path/to/soulpack-reader/src/index.ts"],
      "env": {
        "SOULPACK_DEFAULT_PACK": "E:/path/to/soulpack-reader/examples/luna.soulpack.json"
      }
    }
  }
}
```

**Cursor** — 编辑 `~/.cursor/mcp.json`，格式同上。

**Claude Desktop** — 编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`，格式同上。

> MCP Server 启动时会自动在 `127.0.0.1:18790` 开启 HTTP 端口，供网站一键安装使用。无需额外配置。
> 如需关闭，设置环境变量 `SOULPACK_HTTP_DISABLE=1`。

### 3. 加载角色

**方式 A：环境变量自动加载**

设置 `SOULPACK_DEFAULT_PACK` 指向 `.soulpack.json` 文件（见上方配置）。

**方式 B：对话中手动加载（本地文件）**

```
soulpack_select({ path: "/path/to/luna.soulpack.json" })
```

**方式 C：通过 URL 直接安装（从网站复制下载链接）**

```
soulpack_install({ url: "https://your-site.com/api/registry/packs/luna-v1/download" })
```

### 4. 迁移记忆

```
soulpack_export_state({ outputPath: "/backup/luna-memories.json" })
soulpack_import_state({ source: "/backup/luna-memories.json" })
```

---

## 项目结构

```
soulpack-reader/
├── README.md
├── SPEC.md                     # Soul Pack JSON 规范
├── package.json
├── tsconfig.json
│
├── src/
│   ├── index.ts                # MCP Server 入口（stdio）
│   ├── types.ts                # 数据类型：Pack / State / Overlay / Voice / Appearance
│   ├── reader.ts               # 解析 / 校验 / 归一化 / prompt 构建
│   ├── state.ts                # 记忆状态：加载 / 保存 / 导出 / 导入
│   ├── pack-store.ts           # 本地多 Pack 管理
│   ├── tools.ts                # 共享状态管理
│   ├── memory-engine.ts        # 独立记忆中间件核心
│   ├── memory-collector.ts     # 规则记忆提取器
│   ├── http-routes.ts          # HTTP 路由处理器
│   └── http-server.ts          # 可选独立 HTTP 服务（供网站集成）
│
├── skills/
│   ├── soulpack-usage/         # 使用说明 Skill
│   │   └── SKILL.md
│   └── soulpack-bootstrap/     # 安装向导 Skill
│       └── SKILL.md
│
└── examples/
    ├── jarvis.soulpack.json    # 示例：英式管家 Jarvis（OpenAI TTS）
    └── luna.soulpack.json      # 示例：中文伴侣 Luna（Edge TTS）
```

---

## Soul Pack JSON 规范 (v0.1.0)

```jsonc
{
  "specVersion": "0.1.0",
  "packId": "luna-v1",              // 全局唯一 ID
  "name": "Luna",                   // 显示名称

  // ─── 人格 ───
  "persona": {
    "systemPrompt": "你是 Luna...", // 注入 system prompt 的核心文本
    "name": "Luna",
    "description": "简介",
    "contextNotes": ["备注1"]       // 额外提示片段
  },

  // ─── 语音（可选）───
  "voice": {
    "provider": "edge",             // "openai" | "elevenlabs" | "edge"
    "voiceId": "zh-CN-XiaoyiNeural",
    "language": "zh-CN",
    "speed": 0.95
  },

  // ─── 外观（可选）───
  "appearance": {
    "avatarUrl": "https://...",     // 主头像
    "emoji": "🌙",                  // 简单标识
    "themeColor": "#7c4dff",        // UI 主题色
    "expressions": {                // 表情包
      "default": "https://...",
      "happy": "https://...",
      "sad": "https://..."
    }
  },

  // ─── 资产清单（可选，补充 appearance）───
  "assets": [
    { "type": "avatar", "label": "default", "url": "https://..." },
    { "type": "avatar-expression", "label": "happy", "url": "https://..." }
  ],

  // ─── 扩展命名空间（unknown-safe）───
  "extensions": {}
}
```

---

## Soul State JSON 规范 (v0.1.0)

```json
{
  "stateVersion": "0.1.0",
  "packId": "luna-v1",
  "memories": [
    {
      "id": "mem_1708700000_1",
      "content": "用户喜欢在深夜聊天，偏好轻松话题",
      "timestamp": "2026-02-23T15:00:00Z",
      "sessionId": "session-abc",
      "tags": ["preference"]
    }
  ],
  "lastUpdated": "2026-02-23T15:00:00Z"
}
```

---

## 架构设计

### 三层架构

```
运行时效果 = Pack（静态人格） + Overlay（用户编辑） + State（灵魂记忆）
```

- **Pack**：可公开分发，版本化升级，你不断迭代
- **State**：私密，持续增长，用户的记忆不会因为你升级 Pack 而丢失
- **Overlay**：用户在宿主内改名/改头像/改语音，不修改原始 Pack

### 可升级性

- **`specVersion`**：从 v0.1.0 开始，语义化版本
- **Unknown-safe**：Reader 遇到不认识的字段/资产类型跳过，不崩溃
- **内部归一化（IR）**：多版本输入 → 统一 `NormalizedSoulPack` 输出
- **三层分离**：Pack 升级不覆盖用户编辑和记忆

### 渐进式能力消费

| 宿主能力 | 效果 |
|----------|------|
| 仅文本 | 角色人格 + 记忆（最低要求，任何智能体都支持） |
| + TTS | 角色以指定声音说话 |
| + 头像 | 角色头像显示在聊天界面 |
| + 表情 | 根据情绪自动切换表情图 |
| + 3D/Live2D | 未来扩展（当前版本安全跳过） |

---

## 创作你自己的角色

1. 复制 `examples/luna.soulpack.json` 为模板
2. 修改 `persona.systemPrompt` 为你的角色设定
3. 设置 `voice`（选择一个 TTS provider + voice ID）
4. 准备头像图片，填入 `appearance.avatarUrl`
5. 保存为 `my-character.soulpack.json`
6. 用 `soulpack_select` 加载测试

---

## 与 Ai_character_cards 网站联动

网站是角色素材的创作和分发平台，Soul Pack Reader 是本地素材消费端：

1. 用户在网站上浏览/编辑角色
2. 点击 **"下载 .soulpack.json"** 保存到本地，或复制角色的 **下载链接**
3. 在 AI 对话中用 `soulpack_select`（本地路径）或 `soulpack_install`（URL）加载

网站端提供 Registry API（`/api/registry/packs`），智能体可通过 `soulpack_install` 直接搜索和安装：

```bash
soulpack_install({ registryUrl: "https://your-site.com", query: "助手" })
```

**不需要任何本地服务在线。** 网站负责创作/编辑/分发，Soul Pack Reader 通过 MCP 工具直接拉取。智能体自行决定如何使用素材。

---

## License

MIT
