# Soul Pack Reader

**给任何 OpenClaw 智能体赋予角色人格、语音、2D 形象和可迁移的灵魂记忆。**

> 克隆本仓库 → 安装为 OpenClaw 插件 → 你的 AI 助手就有了"灵魂"。

---

## 它能做什么？

| 能力 | 说明 |
|------|------|
| **角色人格** | 将角色性格、说话风格、规则自动注入 system prompt |
| **语音身份** | 配置 TTS 语音偏好（OpenAI / ElevenLabs / Edge TTS） |
| **2D 形象** | 头像、表情系统（default/happy/sad/thinking…） |
| **灵魂记忆** | 跨会话持久化，可导出/导入/迁移到其他实例 |
| **渐进降级** | 宿主不支持语音/头像？没关系，文本人格照样工作 |

---

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/YOUR_USER/soulpack-reader.git
```

### 2. 安装到 OpenClaw

```bash
openclaw plugins install ./soulpack-reader --link
openclaw plugins enable soulpack-reader
```

重启 gateway 生效。

### 3. 加载角色

**方式 A：配置文件自动加载**

编辑 `~/.openclaw/openclaw.json`：

```json
{
  "plugins": {
    "entries": {
      "soulpack-reader": {
        "enabled": true,
        "config": {
          "packPath": "/path/to/soulpack-reader/examples/luna.soulpack.json"
        }
      }
    }
  }
}
```

**方式 B：对话中手动加载**

```
soulpack_select({ path: "/path/to/luna.soulpack.json" })
```

### 4. 启用语音（可选）

在 `openclaw.json` 中添加 TTS 配置：

```json
{
  "messages": {
    "tts": {
      "auto": "always",
      "provider": "edge",
      "edge": { "enabled": true }
    }
  }
}
```

角色的语音偏好（声音、语言、语速）由 Soul Pack 的 `voice` 字段自动传达。

### 5. 迁移记忆

```
soulpack_export_state({ outputPath: "/backup/luna-memories.json" })
soulpack_import_state({ source: "/backup/luna-memories.json" })
```

---

## 项目结构

```
soulpack-reader/
├── .gitignore
├── LICENSE
├── README.md
├── package.json                # npm 包 + openclaw.extensions
├── openclaw.plugin.json        # 插件清单（配置 schema / UI hints）
│
├── src/
│   ├── index.ts                # Plugin 入口：hooks + tools 注册
│   ├── types.ts                # 数据规范：Pack / State / Overlay / Voice / Appearance
│   ├── reader.ts               # 解析 / 校验 / 归一化 / prompt+TTS 构建
│   ├── state.ts                # 记忆状态：加载 / 保存 / 导出 / 导入
│   └── tools.ts                # Agent 工具：select / export / import
│
├── skills/
│   ├── soulpack-usage/         # 使用说明（插件安装后自动可用，/soulpack 触发）
│   │   └── SKILL.md
│   └── soulpack-bootstrap/     # 安装向导（独立分发，/soulpack-install 触发）
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
| 仅文本 | 角色人格 + 记忆（最低要求，所有 OpenClaw 都支持） |
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

未来可以从 Ai_character_cards 网站直接下载 `.soulpack.json` 文件，
加载到任何 OpenClaw 实例。网站负责角色创作/编辑/分发，本插件负责运行时消费。

---

## License

MIT
