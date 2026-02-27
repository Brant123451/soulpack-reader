---
name: soulpack-install
description: "安装 Soul Pack Reader — MCP Server + Skill，为任何 AI 智能体提供角色素材"
---

# Soul Pack Reader 安装向导

Soul Pack Reader 是一个独立的 MCP Server，可以连接到任何支持 MCP 协议的 AI 智能体（Windsurf、Cursor、Claude Desktop 等）。

安装后你的智能体将获得角色素材：
- 角色人格（system prompt 注入）
- 语音偏好素材（OpenAI / ElevenLabs / Edge TTS 配置）
- 2D 形象素材（头像、表情图集）
- 跨会话灵魂记忆

---

## Step 1 — 安装依赖

```bash
cd /path/to/soulpack-reader
npm install
```

---

## Step 2 — 配置 MCP 连接

在你的 AI 工具中添加 MCP Server 配置：

**Windsurf / Cursor / Claude Desktop** — 编辑 MCP 配置文件：

```json
{
  "mcpServers": {
    "soulpack-reader": {
      "command": "npx",
      "args": ["tsx", "/path/to/soulpack-reader/src/index.ts"],
      "env": {
        "SOULPACK_STATE_DIR": "~/.soulpack",
        "SOULPACK_DEFAULT_PACK": "/path/to/luna.soulpack.json"
      }
    }
  }
}
```

---

## Step 3 — 验证连接

在对话中调用：
```
soulpack_list({})
```
如果返回已安装的 pack 列表（或空列表提示），说明 MCP 连接正常。

---

## Step 4 — 加载角色（可选）

**方式 A：环境变量自动加载**
设置 `SOULPACK_DEFAULT_PACK` 环境变量指向 `.soulpack.json` 文件。

**方式 B：对话中手动加载**
```
soulpack_select({ path: "/path/to/luna.soulpack.json" })
```

**方式 C：通过 URL 安装（从网站复制下载链接）**
```
soulpack_install({ url: "https://your-site.com/api/registry/packs/luna-v1/download" })
```

---

## Step 5 — 使用素材（智能体自行实现）

Soul Pack 只提供素材。智能体拿到素材后可以自行编程实现功能：
- 根据 voice 配置编写 TTS 接入代码
- 根据 appearance 素材修改 UI 配置
- 根据 expressions 图集实现表情切换

---

## 故障排除

| 问题 | 解决方案 |
|------|----------|
| MCP 连接失败 | 确认 `npx tsx` 可用，路径正确 |
| 人格未注入 | 调用 `soulpack_status` 检查是否有激活的 pack |
| 记忆未保存 | 检查 `~/.soulpack/` 目录是否可写 |
| URL 安装失败 | 确认网站的下载链接可访问，返回合法 JSON |
