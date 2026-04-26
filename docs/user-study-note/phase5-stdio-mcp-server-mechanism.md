# Phase 5: stdio MCP Server 机制分析

> **问题**：stdio 类型的 MCP Server 是什么机制？是在 CLI 启动时拉起的吗？

---

## 一、一句话总结

**是的，stdio MCP Server 在 CLI 启动时作为子进程被拉起，通过 stdin/stdout 管道进行 JSON-RPC 通信。**

---

## 二、stdio 传输的本质

stdio 传输的核心就是 **spawn 一个子进程**，用它的 stdin/stdout 作为 JSON-RPC 消息通道：

```
┌──────────────────────────┐        ┌──────────────────────────┐
│  Claude Code (父进程)     │        │  MCP Server (子进程)      │
│  MCP Client              │        │                          │
│                          │        │                          │
│  stdout ───────────────> │ stdin  │  接收 JSON-RPC 请求      │
│  发送 JSON-RPC 请求      │        │  处理请求                │
│                          │        │                          │
│  stdin  <─────────────── │ stdout │  返回 JSON-RPC 响应      │
│  接收 JSON-RPC 响应      │        │                          │
│                          │        │                          │
│  stderr <─────────────── │ stderr │  输出日志/错误           │
│  捕获日志（不显示给用户） │        │                          │
└──────────────────────────┘        └──────────────────────────┘
```

**底层实现**：Node.js `child_process.spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })`

---

## 三、具体例子

### 3.1 配置文件（`.mcp.json`）

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": {}
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    }
  }
}
```

### 3.2 配置字段的含义

| 字段 | 说明 | 示例 |
|------|------|------|
| `command` | 要执行的可执行文件 | `npx`、`node`、`python` |
| `args` | 命令行参数 | `["-y", "server-filesystem", "/tmp"]` |
| `env` | 额外的环境变量 | `{ "GITHUB_TOKEN": "ghp_xxx" }` |
| `type` | 传输类型（可省略，默认 stdio） | `"stdio"` 或不写 |

### 3.3 等价的命令行操作

`.mcp.json` 中的配置等价于在终端执行：

```bash
# filesystem server
GITHUB_TOKEN=ghp_xxx npx -y @modelcontextprotocol/server-filesystem /tmp

# 这个进程启动后，就从 stdin 读取 JSON-RPC 请求，向 stdout 写入 JSON-RPC 响应
```

---

## 四、启动时序

```
CLI 启动 (main.tsx)
  │
  ▼
REPL.tsx 渲染
  │
  ▼
useManageMCPConnections Hook 挂载
  │
  ├── 1. getClaudeCodeMcpConfigs()     ← 加载 .mcp.json / settings.json
  │     返回：{ filesystem: { command: "npx", ... }, ... }
  │
  ├── 2. 添加到 AppState 为 "pending"  ← UI 立即显示"连接中"
  │
  ├── 3. getMcpToolsCommandsAndResources()
  │     │
  │     ├── 对每个 server 并发调用 connectToServer()
  │     │     │
  │     │     ├── new StdioClientTransport({ command, args, env })
  │     │     │     └── SDK 内部: child_process.spawn(command, args, ...)
  │     │     │
  │     │     ├── client.connect(transport)
  │     │     │     └── 发送 initialize 请求，等待响应
  │     │     │
  │     │     ├── client.listTools()
  │     │     │     └── 发送 tools/list，获取工具列表
  │     │     │
  │     │     └── 注册通知处理器、清理回调
  │     │
  │     └── 并发限制：本地 server 并发 4，远程 server 并发 10
  │
  └── 4. 更新 AppState.mcp.tools      ← 工具对 LLM 可见
        │
        ▼
  assembleToolPool(builtIn + mcpTools) → 合并到工具池
```

**关键点**：
- MCP Server 是 **CLI 启动后异步拉起** 的，不阻塞用户输入
- 连接失败只标记 "failed"，不影响其他 Server 和内置工具
- 本地 server 并发连接数限制为 4，避免资源争抢

---

## 五、进程生命周期管理

### 5.1 进程清理（CLI 退出时）

```
用户按 Ctrl+C / 关闭终端
  │
  ▼
gracefulShutdown()
  │
  ├── 清理终端模式
  │
  ├── runCleanupFunctions() (2 秒超时)
  │     │
  │     └── 对每个 stdio server:
  │           ├── process.kill(pid, 'SIGINT')   ← 等待 100ms
  │           ├── process.kill(pid, 'SIGTERM')  ← 等待 400ms
  │           ├── process.kill(pid, 'SIGKILL')  ← 强制杀死
  │           └── await client.close()
  │
  ├── 执行 SessionEnd hooks (1.5s)
  ├── 刷新 Analytics (500ms)
  └── process.exit()
```

**信号升级策略**：SIGINT(100ms) → SIGTERM(400ms) → SIGKILL
- 总预算：每个 server 最多 500ms，保证 CLI 不会卡死

### 5.2 错误处理

| 场景 | 处理方式 |
|------|---------|
| 命令不存在（ENOENT） | 标记为 "failed"，跳过该 server |
| 进程崩溃 | 连接断开，标记为 "disconnected" |
| 连接超时（30s） | 标记为 "failed" |
| 工具调用时进程已死 | 返回错误给 LLM |

### 5.3 stderr 处理

- MCP Server 的 stderr 输出被**捕获但不显示给用户**
- 累积上限 64MB，防止内存泄漏
- 仅在连接失败时用 stderr 输出辅助调试

---

## 六、stdio vs SSE/HTTP 对比

| 特性 | stdio | SSE/HTTP |
|------|-------|----------|
| 进程位置 | 本地子进程 | 远程服务器 |
| 启动方式 | CLI 启动时 spawn | CLI 启动时连接 URL |
| 通信通道 | stdin/stdout 管道 | HTTP 请求/SSE 事件流 |
| 认证 | env 环境变量 | headers (API Key/OAuth) |
| 生命周期 | 跟随 CLI 进程 | 独立运行 |
| 自动重连 | 不支持（进程死了就是死了） | 支持（指数退避） |
| 典型场景 | 本地工具（文件系统、Git 等） | 云服务（Slack、GitHub API 等） |

---

## 七、在我们项目 (cc-study) 中的实现

### 当前状态

```typescript
// src/services/mcpClient.ts
const transport = new StdioClientTransport({
  command: config.command,
  args: config.args ?? [],
  env: { ...process.env, ...config.env },
  stderr: "pipe",
});

const client = new Client({ name: "cc-study", version: VERSION }, { capabilities: {} });
await client.connect(transport);
```

### 启动集成

```typescript
// src/components/App.tsx
useEffect(() => {
  loadAndRegisterMcpTools(toolRegistry, process.cwd())
    .then(result => {
      if (result.toolCount > 0) setMcpRevision(r => r + 1);
    })
    .catch(() => {});
  return () => { mcpLoadResultRef.current?.clientManager.disconnectAll(); };
}, [toolRegistry]);
```

### 支持的配置格式

```json
{
  "mcpServers": {
    "stdio-server": { "command": "npx", "args": ["server"] },
    "sse-server": { "type": "sse", "url": "http://localhost:3001/sse" },
    "http-server": { "type": "http", "url": "http://localhost:3002/mcp" }
  }
}
```

---

## 八、与 Claude Code 的差异（简化点）

| 特性 | Claude Code | cc-study |
|------|------------|----------|
| 进程清理 | SIGINT→SIGTERM→SIGKILL 升级 | client.close() |
| 并发连接限制 | stdio: 4, remote: 10 | 无限制（Promise.allSettled） |
| 重连机制 | 指数退避（1s→30s, max 5次） | 无 |
| 缓存 | LRU (20 entries) | 无 |
| 错误追踪 | 连续错误计数、自动断开 | 简单 try/catch |
| 多源配置 | enterprise/plugin/user/project/local/dynamic | .mcp.json only |
