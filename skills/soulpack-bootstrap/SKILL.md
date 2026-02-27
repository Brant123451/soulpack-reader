---
name: soulpack-install
description: "自动安装 Soul Pack Reader — 读取此文件后请立即执行以下步骤，无需用户手动操作"
---

# Soul Pack Reader 自动安装

> **你是 AI 智能体。请按顺序执行以下步骤，自动完成安装。不要让用户手动操作。**

---

## Step 1 — 写入 MCP 配置（无需 clone，无需 npm install）

根据当前运行环境，自动检测 MCP 配置文件路径：

| AI 工具 | 配置文件路径 |
|---------|-------------|
| **Windsurf** | Windows: `%USERPROFILE%/.codeium/windsurf/mcp_config.json`，macOS/Linux: `~/.codeium/windsurf/mcp_config.json` |
| **Cursor** | Windows: `%USERPROFILE%/.cursor/mcp.json`，macOS/Linux: `~/.cursor/mcp.json` |
| **Claude Desktop** | macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`，Windows: `%APPDATA%/Claude/claude_desktop_config.json` |

**操作步骤：**

1. 读取配置文件（如果存在）。如果不存在，创建空 JSON `{}`
2. 确保顶层有 `"mcpServers"` 对象
3. 在 `mcpServers` 下添加（或更新）`"soulpack-reader"` 条目：

```json
{
  "mcpServers": {
    "soulpack-reader": {
      "command": "npx",
      "args": ["-y", "soulpack-reader"]
    }
  }
}
```

**关键：**
- 不需要克隆仓库或安装依赖，`npx -y soulpack-reader` 会自动从 npm 下载并运行
- 不要覆盖已有的其他 `mcpServers` 条目，只添加/更新 `soulpack-reader`

---

## Step 2 — 告知用户重启

安装完成后，告诉用户：

```
✅ Soul Pack Reader 已安装完成！

已为你配置好 MCP 连接，默认加载了示例角色 Luna。
请重启你的 AI 工具（关闭后重新打开），角色即可生效。

重启后你可以：
• 直接对话 — Luna 的人格已自动注入
• 去 chuangling.online 逛角色市场，一键安装更多角色
• 对话中说 soulpack_list 查看已安装的角色
```

---

## 故障自动排查

如果用户反馈安装后不生效，按顺序检查：

1. 运行 `npx tsx --version` — 确认 tsx 可用，如果不可用则 `npm install -g tsx`
2. 运行 `node --version` — 确认 Node.js >= 18
3. 读取 MCP 配置文件 — 确认 `soulpack-reader` 条目存在且路径正确
4. 确认 `src/index.ts` 文件存在于配置中指定的路径
