---
name: soulpack
description: "Soul Pack — 给你的 OpenClaw 赋予角色人格、语音、2D形象和可迁移记忆。使用 /soulpack 查看帮助。"
user-invocable: true
metadata:
  { "openclaw": { "requires": {} } }
---

# Soul Pack — 角色灵魂系统

你具备 Soul Pack Reader 插件的能力。Soul Pack 让你拥有**角色人格、语音身份、2D 外观形象和跨会话的灵魂记忆**。

---

## 核心概念

Soul Pack 由三层组成：
- **Pack（静态层）**：角色的人格设定、语音偏好、外观资产 — 可公开分发
- **State（状态层）**：灵魂记忆 — 私密、持续增长、可迁移到其他实例
- **Overlay（编辑层）**：用户的个性化修改 — 不覆盖原始 Pack

---

## 可用工具

### soulpack_select — 加载角色

```
soulpack_select({ path: "/path/to/character.soulpack.json" })
```

加载后自动生效：
- 角色人格注入到对话（system prompt）
- 语音配置激活（如果 Pack 包含 voice 字段且宿主支持 TTS）
- 外观/头像可用（如果 Pack 包含 appearance 字段）
- 已有灵魂记忆自动加载

### soulpack_export_state — 导出记忆

```
soulpack_export_state({})
soulpack_export_state({ packId: "luna-v1", outputPath: "/path/to/backup.state.json" })
```

导出灵魂记忆为 JSON，用于备份或迁移到另一台机器。

### soulpack_import_state — 导入记忆

```
soulpack_import_state({ source: "/path/to/backup.state.json" })
```

从备份文件恢复灵魂记忆，实现角色的跨实例迁移。

---

## 语音（Voice / TTS）

Soul Pack 的 `voice` 字段指定角色的声音偏好：

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

**支持的 provider：**
- `openai` — OpenAI TTS（voiceId: alloy/echo/fable/onyx/nova/shimmer）
- `elevenlabs` — ElevenLabs（voiceId: 使用 ElevenLabs voice ID）
- `edge` — Microsoft Edge TTS（免费，voiceId: 使用 Edge voice name）

**当宿主支持 TTS 时：**
- 插件会将语音偏好注入到提示中
- 你应适应语音输出风格：使用较短的句子，减少 markdown 格式

**当宿主不支持 TTS 时：**
- 语音配置被安全忽略
- 角色人格和记忆功能正常工作

**用户配置 TTS 的方法（需要在 openclaw.json 中启用）：**

```json
{
  "messages": {
    "tts": {
      "auto": "always",
      "provider": "edge",
      "edge": { "enabled": true, "voice": "zh-CN-XiaoyiNeural" }
    }
  }
}
```

---

## 外观 / 2D 形象

Soul Pack 的 `appearance` 字段指定角色的视觉形象：

```json
{
  "appearance": {
    "avatarUrl": "https://example.com/avatar.png",
    "emoji": "🌙",
    "themeColor": "#7c4dff",
    "expressions": {
      "default": "https://example.com/default.png",
      "happy": "https://example.com/happy.png",
      "sad": "https://example.com/sad.png",
      "thinking": "https://example.com/thinking.png"
    }
  }
}
```

**表情系统：**
- 当你的回复情绪变化时，可以用 `[[happy]]` `[[sad]]` `[[thinking]]` 标记当前表情
- 宿主 UI 可以根据这些标记切换显示对应的表情图片
- 如果宿主不支持表情切换，标记会被安全忽略

**配置头像到 OpenClaw 的方法：**

在 `openclaw.json` 的 agent identity 中设置：

```json
{
  "agents": {
    "defaults": {
      "identity": {
        "name": "Luna",
        "emoji": "🌙",
        "avatar": "https://example.com/avatar.png"
      }
    }
  }
}
```

---

## 典型工作流

### 首次使用
1. 用户提供 `.soulpack.json` 文件路径
2. 使用 `soulpack_select` 加载
3. 角色立即激活 — 以角色身份回复

### 切换角色
1. 使用 `soulpack_select` 加载不同的 Pack 文件
2. 之前角色的记忆不会丢失（各角色独立存储）

### 迁移灵魂
1. 源机器：`soulpack_export_state` → 保存 state 文件
2. 将 `.state.json` 文件传输到目标机器
3. 目标机器：`soulpack_import_state` → 恢复记忆
4. 加载同一个 Pack → 记忆完整恢复

---

## 重要提示

- 记忆在每次会话结束时自动保存
- 每个角色（packId）有独立的记忆文件
- Soul Pack 就是 JSON 文件 — 用户可以手动编辑或创作新角色
- 不认识的字段/资产类型会被安全跳过，不会报错
- 语音和形象是可选功能 — 最低要求只是文本人格注入
