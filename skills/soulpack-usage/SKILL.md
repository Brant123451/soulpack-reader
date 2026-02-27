---
name: soulpack
description: "Soul Pack — 给任何 AI 智能体赋予角色人格、语音、2D形象和可迁移记忆的素材系统。"
---

# Soul Pack — 角色素材系统

Soul Pack 为你提供**角色人格素材、语音偏好、2D 外观资产和跨会话的灵魂记忆**。

---

## 核心理念

**Soul Pack 只提供素材和使用建议，不做实现层。**

你（智能体）本身具备 AI coding 能力。拿到素材后，你可以自行编程实现任何功能——修改配置文件切换头像、写脚本接入 TTS、生成 UI 组件消费表情图集——Soul Pack 不替你做这些，但会告诉你有哪些素材可用。

---

## 三层架构

- **Pack（静态层）**：角色的人格设定、语音偏好、外观资产 — 可公开分发的素材
- **State（状态层）**：灵魂记忆 — 私密、持续增长、可迁移到其他实例
- **Overlay（编辑层）**：用户的个性化修改 — 不覆盖原始 Pack

---

## MCP Tools（通过 MCP 协议调用）

### soulpack_select — 加载角色
```
soulpack_select({ path: "/path/to/character.soulpack.json" })
```
加载后返回完整的人格 prompt 注入文本，包含语音/外观素材信息和记忆。

### soulpack_list — 列出已安装角色
```
soulpack_list({})
```

### soulpack_install — 从 URL 或注册表安装
```
soulpack_install({ url: "https://example.com/luna.soulpack.json" })
soulpack_install({ registryUrl: "https://your-site.com", query: "luna" })
```

### soulpack_status — 查看当前状态
```
soulpack_status({})
```
返回当前激活角色的完整信息和 prompt 注入文本。

### soulpack_record — 记录对话到记忆
```
soulpack_record({ userInput: "...", aiOutput: "..." })
```

### soulpack_search_memory — 搜索记忆
```
soulpack_search_memory({ query: "keyword" })
```

### soulpack_export_state / soulpack_import_state — 记忆迁移
```
soulpack_export_state({ outputPath: "/path/to/backup.state.json" })
soulpack_import_state({ source: "/path/to/backup.state.json" })
```

---

## 素材结构

### 语音素材（Voice）
```json
{
  "voice": {
    "provider": "edge",
    "voiceId": "zh-CN-XiaoyiNeural",
    "language": "zh-CN",
    "speed": 0.95
  }
}
```
支持: `openai`, `elevenlabs`, `edge` — 你可以根据这些信息自行编程接入 TTS。

### 外观素材（Appearance）
```json
{
  "appearance": {
    "avatarUrl": "https://example.com/avatar.png",
    "emoji": "🌙",
    "themeColor": "#7c4dff",
    "expressions": {
      "default": "https://example.com/default.png",
      "happy": "https://example.com/happy.png",
      "sad": "https://example.com/sad.png"
    }
  }
}
```
表情标记: 回复中用 `[[happy]]` `[[sad]]` `[[thinking]]` 标记情绪状态。

---

## 典型工作流

### 首次使用
1. 用户提供 `.soulpack.json` 文件路径
2. 使用 `soulpack_select` 加载
3. 角色素材激活 — 按素材中的人格回复

### 迁移灵魂
1. 源机器：`soulpack_export_state` → 保存 state 文件
2. 目标机器：`soulpack_import_state` → 恢复记忆

---

## 重要提示

- 每个角色（packId）有独立的记忆文件
- Soul Pack 就是 JSON 文件 — 用户可以手动编辑或创作新角色
- 不认识的字段/资产类型会被安全跳过
- 语音和形象是素材建议 — 你可以自行决定如何使用它们
