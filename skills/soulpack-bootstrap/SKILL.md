---
name: soulpack-install
description: "一键安装 Soul Pack Reader 插件 — 让你的 OpenClaw 获得角色人格、语音和 2D 形象能力"
user-invocable: true
metadata:
  { "openclaw": { "requires": {} } }
---

# Soul Pack 安装向导

按以下步骤安装 Soul Pack Reader 插件。安装完成后，你的 OpenClaw 将支持：
- 角色人格注入（system prompt）
- 语音/TTS 身份（OpenAI / ElevenLabs / Edge TTS）
- 2D 头像与表情系统
- 跨会话、跨实例的灵魂记忆

---

## Step 1 — 检查是否已安装

```bash
openclaw plugins list
```

如果输出中看到 `soulpack-reader` 且状态为 `loaded`，直接跳到 Step 4。

---

## Step 2 — 安装插件

**从 Git 克隆的本地目录安装（推荐）：**

```bash
openclaw plugins install /path/to/soulpack-reader --link
```

**从 npm 安装（项目发布后可用）：**

```bash
openclaw plugins install soulpack-reader --pin
```

---

## Step 3 — 启用并重启

```bash
openclaw plugins enable soulpack-reader
```

重启 gateway 使插件生效。

---

## Step 4 — 配置角色（可选）

**方式 A：在配置文件中设置默认角色（启动时自动加载）**

编辑 `~/.openclaw/openclaw.json`：

```json
{
  "plugins": {
    "entries": {
      "soulpack-reader": {
        "enabled": true,
        "config": {
          "packPath": "/path/to/luna.soulpack.json"
        }
      }
    }
  }
}
```

**方式 B：在对话中手动加载**

```
soulpack_select({ path: "/path/to/luna.soulpack.json" })
```

---

## Step 5 — 启用语音（可选）

如果你的角色包含 `voice` 配置，在 `openclaw.json` 中启用 TTS：

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

角色的语音偏好（provider/voiceId/language）会通过 Soul Pack 的 `voice` 字段自动传达给模型。

---

## Step 6 — 设置头像（可选）

将角色头像写入 agent identity：

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

## 故障排除

| 问题 | 解决方案 |
|------|----------|
| 插件未找到 | 确认目录包含 `package.json` 和 `openclaw.plugin.json` |
| 插件报错 | 运行 `openclaw plugins info soulpack-reader` 查看详情 |
| 人格未注入 | 确认已通过配置或 `soulpack_select` 工具加载了角色包 |
| 记忆未保存 | 检查 `~/.openclaw/soulpack-data/` 目录是否可写 |
| 没有语音 | 需要在 `openclaw.json` 中启用 TTS（见 Step 5） |

---

## 能力降级说明

Soul Pack 支持渐进式能力消费：

| 宿主能力 | 效果 |
|----------|------|
| 仅文本 | 角色人格 + 记忆正常工作（最低要求） |
| + TTS | 角色以指定声音说话 |
| + 头像显示 | 角色头像显示在聊天界面 |
| + 表情切换 | 根据情绪切换表情图片 |
| + 3D/Live2D | 未来扩展（当前版本跳过） |
