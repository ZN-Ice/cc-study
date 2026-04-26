# Phase 5: MCP (Model Context Protocol) 集成 — 源码学习笔记

> **学习目标**：理解 MCP 协议机制、Claude Code 的 MCP 客户端实现、工具发现与适配流程
>
> **参考源码**：`free-code/src/services/mcp/`、`free-code/src/tools/MCPTool/`、`free-code/src/entrypoints/mcp.ts`

---

## 一、MCP 协议机制深度分析

### 1.1 什么是 MCP？

MCP (Model Context Protocol) 是一个开放协议，用于标准化 LLM 应用与外部数据源/工具之间的通信。它基于 **JSON-RPC 2.0** 协议，定义了一套请求-响应和通知的消息格式。

**核心思想**：将 LLM 应用（Client）与外部工具/数据（Server）解耦，通过标准化协议通信，使得：
- 一个 MCP Server 可以被多个 Client 复用
- 一个 Client 可以连接多个 MCP Server
- 工具的发现、调用、权限管理全部标准化

### 1.2 JSON-RPC 2.0 通信协议

MCP 使用 JSON-RPC 2.0 作为消息格式：

**Request（请求）**：
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

**Response（响应）**：
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "search",
        "description": "Search the web",
        "inputSchema": {
          "type": "object",
          "properties": { "query": { "type": "string" } },
          "required": ["query"]
        }
      }
    ]
  }
}
```

**Error（错误）**：
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32001,
    "message": "Session expired"
  }
}
```

**Notification（通知，无 id）**：
```json
{
  "jsonrpc": "2.0",
  "method": "notifications/tools/list_changed",
  "params": {}
}
```

### 1.3 MCP 连接生命周期

```
┌─────────────────────────────────────────────────────────────────┐
│                    MCP 连接生命周期                               │
└─────────────────────────────────────────────────────────────────┘

  Client                                          Server
    │                                                │
    │  ──── initialize (name, version, caps) ──────> │
    │  <──── initialize result (server caps) ──────  │
    │  ──── initialized (notification) ────────────> │
    │                                                │
    │  ═══════ 连接建立完成 ═══════                   │
    │                                                │
    │  ──── tools/list ────────────────────────────> │
    │  <──── tools[] ──────────────────────────────  │
    │                                                │
    │  ──── tools/call { name, arguments } ────────> │
    │  <──── { content: [...] } ───────────────────  │
    │                                                │
    │  <──── notifications/tools/list_changed ─────  │  (Server 主动通知)
    │                                                │
    │  ──── close ─────────────────────────────────> │
    │                                                │
```

**关键阶段**：
1. **initialize**：Client 和 Server 交换能力信息（capabilities）
2. **tools/list**：Client 发现 Server 提供的工具
3. **tools/call**：Client 调用 Server 的工具
4. **notifications**：Server 可以主动通知 Client 工具列表变化等事件
5. **close**：断开连接

### 1.4 传输层（Transport）

MCP 协议与传输层解耦，支持多种传输方式：

| 传输方式 | 协议 | 适用场景 | 认证方式 |
|---------|------|---------|---------|
| **stdio** | stdin/stdout | 本地进程（默认） | 无需 |
| **SSE** | HTTP Server-Sent Events | 远程服务器 | OAuth |
| **HTTP** | Streamable HTTP | 远程服务器 | OAuth |
| **WebSocket** | WS/WSS | 实时双向通信 | Headers |
| **SDK** | 进程内 | SDK 集成 | 无需 |

**stdio 传输**（最常用）：
```
Client                          Server (子进程)
  │                                │
  │  spawn(command, args)          │
  │  ──── JSON-RPC via stdin ────> │
  │  <──── JSON-RPC via stdout ──  │
  │  <──── stderr (日志) ────────  │
  │                                │
  │  process.exit() / SIGTERM      │
```

**SSE 传输**：
```
Client                          Server (HTTP)
  │                                │
  │  GET /sse ───────────────────> │  (建立 SSE 连接)
  │  <──── event: endpoint ──────  │  (返回 POST 端点)
  │  <──── event: message ───────  │  (Server 推送)
  │                                │
  │  POST /messages ─────────────> │  (Client 发送请求)
  │  <──── 200 OK ───────────────  │
```

### 1.5 Server 能力声明

Server 在 initialize 响应中声明其能力：

```typescript
interface ServerCapabilities {
  tools?: {};           // 提供工具
  prompts?: {};         // 提供提示词模板
  resources?: {         // 提供资源
    subscribe?: {};     //   支持资源订阅
    listChanged?: {};   //   支持列表变更通知
  };
}
```

Client 根据 Server 能力决定后续操作：
- 有 `tools` → 调用 `tools/list` 发现工具
- 有 `prompts` → 调用 `prompts/list` 发现提示词
- 有 `resources` → 调用 `resources/list` 发现资源

---

## 二、Claude Code MCP 客户端架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     Claude Code MCP 架构                        │
└─────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────┐
  │  配置层 (config.ts)                                       │
  │  ├── enterprise: managed-mcp.json                        │
  │  ├── user: ~/.claude.json                                │
  │  ├── project: .mcp.json (向上遍历)                        │
  │  ├── local: 项目级本地配置                                 │
  │  └── dynamic: CLI --mcp-config                           │
  └──────────────────────┬───────────────────────────────────┘
                         │ 合并 + 去重
                         ▼
  ┌──────────────────────────────────────────────────────────┐
  │  连接管理层 (useManageMCPConnections.ts)                  │
  │  ├── connectToServer() → memoized by name+config         │
  │  ├── fetchToolsForClient() → LRU cached                  │
  │  ├── fetchResourcesForClient()                           │
  │  ├── fetchCommandsForClient()                            │
  │  └── 重连: 指数退避 (1s→2s→4s→8s→16s→30s), max 5        │
  └──────────────────────┬───────────────────────────────────┘
                         │
                         ▼
  ┌──────────────────────────────────────────────────────────┐
  │  通信层 (client.ts)                                       │
  │  ├── MCP SDK Client 实例                                  │
  │  ├── Transport: stdio / SSE / HTTP / WS / SDK            │
  │  ├── connect(transport) → 建立 JSON-RPC 通道             │
  │  ├── request(method, params) → 发送请求                   │
  │  └── notification handler → 处理 Server 推送              │
  └──────────────────────┬───────────────────────────────────┘
                         │ tools/list, tools/call
                         ▼
  ┌──────────────────────────────────────────────────────────┐
  │  工具适配层 (MCPTool/)                                     │
  │  ├── MCPTool 模板: buildTool() 创建基础定义               │
  │  ├── fetchToolsForClient(): 每个 Server 工具 → Tool 实例  │
  │  ├── name: mcp__{server}__{tool} 命名空间                 │
  │  ├── call(): JSON-RPC tools/call                         │
  │  └── checkPermissions(): 权限门控                        │
  └──────────────────────┬───────────────────────────────────┘
                         │ 注册到 ToolRegistry
                         ▼
  ┌──────────────────────────────────────────────────────────┐
  │  REPL 循环 (useStreamResponse.ts)                         │
  │  ├── assembleToolPool(builtIn + mcpTools)                │
  │  ├── LLM 看到: Read, Write, Bash, mcp__slack__search...  │
  │  ├── LLM 调用 mcp__slack__search → MCPTool.call()        │
  │  └── 结果回传 LLM                                        │
  └──────────────────────────────────────────────────────────┘
```

### 2.2 配置系统详解

**配置优先级**（从高到低）：
```
enterprise (独占模式)
  ↓ 如果不存在
plugin (与 manual 去重，manual 优先)
  ↓
user (~/.claude.json)
  ↓
project (.mcp.json, 从根目录向上遍历到 CWD)
  ↓
local (项目级用户设置)
```

**Server 配置 Schema**（Zod 定义）：

```typescript
// stdio 类型（默认）
McpStdioServerConfigSchema = z.object({
  type: z.literal('stdio').optional(),  // 可省略，默认 stdio
  command: z.string().min(1),           // 可执行文件路径
  args: z.array(z.string()).default([]), // 命令行参数
  env: z.record(z.string(), z.string()).optional(), // 环境变量
})

// SSE 类型
McpSSEServerConfigSchema = z.object({
  type: z.literal('sse'),
  url: z.string(),                      // SSE 端点 URL
  headers: z.record(z.string(), z.string()).optional(),
  oauth: McpOAuthConfigSchema.optional(),
})

// HTTP 类型（Streamable HTTP）
McpHTTPServerConfigSchema = z.object({
  type: z.literal('http'),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
})
```

**配置文件示例**（`.mcp.json`）：
```json
{
  "mcpServers": {
    "slack": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-slack"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-github"],
      "env": { "GITHUB_TOKEN": "..." }
    },
    "postgres": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-postgres", "postgresql://..."]
    }
  }
}
```

### 2.3 连接管理详解

**connectToServer() 流程**：

```
connectToServer(name, config)
  │
  ├── 1. 创建 Transport
  │   ├── stdio → StdioClientTransport({ command, args, env })
  │   ├── sse  → SSEClientTransport(url, { headers })
  │   ├── http → StreamableHTTPClientTransport(url, { headers })
  │   └── ws   → WebSocketTransport(url, { headers })
  │
  ├── 2. 创建 Client 实例
  │   new Client(
  │     { name: 'claude-code', version: '...' },
  │     { capabilities: { roots: {}, elicitation: {} } }
  │   )
  │
  ├── 3. client.connect(transport) with timeout (30s)
  │   └── 发送 initialize 请求，等待响应
  │
  ├── 4. 提取 Server 信息
  │   ├── capabilities: { tools, prompts, resources }
  │   ├── serverInfo: { name, version }
  │   └── instructions: "..." (Server 指令)
  │
  ├── 5. 注册处理器
  │   ├── ListRootsRequest → 返回 CWD 作为根目录
  │   ├── ElicitRequestSchema → 默认取消
  │   └── onerror → 错误检测与重连触发
  │
  ├── 6. 注册清理回调
  │   ├── SIGINT → SIGTERM → SIGKILL 退出信号
  │   └── onclose → 清除缓存，允许重连
  │
  └── 7. 返回 ConnectedMCPServer | FailedMCPServer
```

**memoization 策略**：`connectToServer` 按 `name + JSON.stringify(config)` 做 memoize，相同配置不会重复连接。

### 2.4 工具发现详解

**fetchToolsForClient() 流程**：

```
fetchToolsForClient(client, serverName)
  │
  ├── LRU 缓存检查 (max 20 entries)
  │   └── 命中 → 直接返回缓存
  │
  ├── client.request({ method: 'tools/list' }, ListToolsResultSchema)
  │   └── JSON-RPC 请求，返回工具列表
  │
  ├── 遍历每个 MCP 工具，转换为内部 Tool 格式:
  │   {
  │     name: `mcp__${normalizedServerName}__${toolName}`,
  │     // 命名空间隔离，避免冲突
  │
  │     description: tool.description,  // 截断到 2048 字符
  │     inputSchema: tool.inputSchema,  // JSON Schema → Zod 转换
  │
  │     mcpInfo: { serverName, toolName },
  │     isMcp: true,
  │
  │     // 来自 MCP annotations
  │     isReadOnly: () => tool.annotations?.readOnlyHint ?? false,
  │     isConcurrencySafe: () => tool.annotations?.readOnlyHint ?? false,
  │     isDestructive: () => tool.annotations?.destructiveHint ?? false,
  │     isOpenWorld: () => tool.annotations?.openWorldHint ?? false,
  │
  │     call: async (args, context) => { ... },  // JSON-RPC tools/call
  │   }
  │
  └── 返回 Tool[] 缓存
```

**命名空间规则**：
```
Server 名称: "slack"
工具名称: "search"
→ 注册名: "mcp__slack__search"

Server 名称: "My Server!" (特殊字符)
→ 规范化: "My_Server_" (非字母数字替换为 _)
→ 注册名: "mcp__My_Server___search"
```

### 2.5 工具调用详解

**MCPTool.call() 流程**：

```
MCPTool.call(args, context)
  │
  ├── ensureConnectedClient()
  │   └── 检查连接是否存活，必要时重连
  │
  ├── callMCPToolWithUrlElicitationRetry()
  │   │
  │   ├── callMCPTool()
  │   │   ├── client.callTool({
  │   │   │     name: originalToolName,      // 不带命名空间前缀
  │   │   │     arguments: args,
  │   │   │     _meta: { progressToken }
  │   │   │   }, schema, { signal, timeout })
  │   │   │
  │   │   ├── 成功 → processMCPResult()
  │   │   │   ├── text content → 直接返回
  │   │   │   ├── image content → 转 base64
  │   │   │   └── resource content → 读取并格式化
  │   │   │
  │   │   ├── isError: true → throw McpToolCallError
  │   │   ├── 401 → throw McpAuthError
  │   │   └── 404 + -32001 → throw McpSessionExpiredError
  │   │
  │   └── McpSessionExpiredError → 重试 1 次
  │       └── clearServerCache → 重新连接 → 重新调用
  │
  └── 返回 ToolResult
```

**关键点**：
- 工具调用时使用**原始工具名**（不带 `mcp__server__` 前缀）
- 超时时间极长（~27.8 小时），因为某些工具可能需要很长时间
- 支持**进度报告**（onprogress 回调）
- 支持 **URL Elicitation**（需要用户提供 URL 授权）

### 2.6 错误处理与重连

**错误分类**：

| 错误类型 | 检测方式 | 处理策略 |
|---------|---------|---------|
| `McpAuthError` | HTTP 401 | 标记为 needs-auth，触发 OAuth 流程 |
| `McpSessionExpiredError` | HTTP 404 + JSON-RPC -32001 | 清除缓存，重连 1 次 |
| `McpToolCallError` | `isError: true` | 返回错误信息给 LLM |
| 连接错误 | ECONNRESET, EPIPE 等 | 累计 3 次后触发重连 |
| 未知错误 | 其他 | 返回错误信息给 LLM |

**重连策略**：
```
初始延迟: 1s
退避因子: 2x
最大延迟: 30s
最大重试: 5 次

1s → 2s → 4s → 8s → 16s → 30s (放弃)
```

---

## 三、MCP 工具适配层

### 3.1 MCPTool 模板

MCPTool 是一个**模板对象**，在 `fetchToolsForClient()` 中被克隆并定制：

```typescript
const MCPTool = buildTool({
  isMcp: true,
  name: 'mcp',                          // 被覆盖为 mcp__server__tool
  inputSchema: z.object({}).passthrough(), // 接受任意输入
  maxResultSizeChars: 100_000,           // 结果最大 100KB

  async call() { return { data: '' } },  // 被覆盖
  async description() { ... },           // 被覆盖为 Server 工具描述
  async prompt() { ... },                // 被覆盖
  userFacingName: () => 'mcp',           // 被覆盖为 "serverName - toolName (MCP)"
})
```

### 3.2 工具转换规则

每个 MCP Server 工具 → 内部 Tool 的映射：

| MCP 属性 | 内部属性 | 说明 |
|---------|---------|------|
| `tool.name` | 后缀于 `name` | `mcp__{server}__{tool}` |
| `tool.description` | `description` | 截断到 2048 字符 |
| `tool.inputSchema` | `inputSchema` | JSON Schema → Zod |
| `tool.annotations.readOnlyHint` | `isReadOnly()` | 并发控制 |
| `tool.annotations.destructiveHint` | `isDestructive()` | 权限控制 |
| `tool.annotations.openWorldHint` | `isOpenWorld()` | 安全分类 |
| `tool._meta?.['anthropic/searchHint']` | `searchHint` | UI 折叠分类 |

### 3.3 工具池合并

`assembleToolPool()` 将内置工具和 MCP 工具合并：

```typescript
function assembleToolPool(permissionContext, mcpTools) {
  const builtInTools = getTools(permissionContext)
  const allowedMcpTools = filterToolsByDenyRules(mcpTools, permissionContext)

  // 按名称排序（prompt cache 稳定性）
  const byName = (a, b) => a.name.localeCompare(b.name)
  return uniqBy(
    [...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)),
    'name'  // 内置工具名冲突时优先
  )
}
```

**deny 规则过滤**：`mcp__server` 前缀的 deny 规则会拒绝该 Server 的所有工具。

---

## 四、MCP Server 模式（Claude Code 作为 Server）

除了作为 Client，Claude Code 还可以**作为 MCP Server** 被其他应用调用：

```
┌────────────────────────────────────┐
│  外部应用 (如 IDE)                   │
│  作为 MCP Client                    │
└──────────────┬─────────────────────┘
               │ JSON-RPC via stdio
               ▼
┌────────────────────────────────────┐
│  Claude Code (MCP Server 模式)      │
│  entrypoints/mcp.ts                │
│                                    │
│  ListToolsRequest → 返回内置工具    │
│  CallToolRequest → 执行工具        │
└────────────────────────────────────┘
```

这使得 Claude Code 的工具能力可以被其他应用复用。

---

## 五、OAuth 认证机制

### 5.1 认证流程

```
┌──────────────┐                    ┌──────────────┐
│  Claude Code  │                    │  Auth Server  │
│  (Client)     │                    │  (OAuth)      │
└──────┬───────┘                    └──────┬───────┘
       │                                    │
       │  1. 发现认证端点                    │
       │  GET /.well-known/oauth-authorization-server
       │ ─────────────────────────────────> │
       │ <───────────────────────────────── │
       │                                    │
       │  2. 动态客户端注册 (DCR)            │
       │  POST /register                    │
       │ ─────────────────────────────────> │
       │ <──── { client_id, ... } ───────── │
       │                                    │
       │  3. 打开浏览器授权                  │
       │  GET /authorize?response_type=code │
       │  &client_id=...&redirect_uri=...   │
       │  &code_challenge=... (PKCE)        │
       │ ───────────> 浏览器 ──────────────>│
       │                                    │
       │  4. 回调返回授权码                  │
       │  GET /callback?code=...            │
       │ <───────────────────────────────── │
       │                                    │
       │  5. 交换 Token                     │
       │  POST /token                       │
       │ ─────────────────────────────────> │
       │ <──── { access_token, ... } ────── │
       │                                    │
```

### 5.2 Token 管理

- **存储**：macOS Keychain（`serverName|configHash` 为 key）
- **刷新**：自动检测过期，使用 refresh_token 刷新
- **锁文件**：跨进程安全的 token 刷新（防止并发刷新冲突）
- **XAA**：Cross-App Access，企业 IdP 联合认证

---

## 六、关键常量

| 常量 | 值 | 用途 |
|------|-----|------|
| `MCP_TIMEOUT` | 30s | 连接超时 |
| `MCP_REQUEST_TIMEOUT_MS` | 60s | 单次 HTTP 请求超时 |
| `DEFAULT_MCP_TOOL_TIMEOUT_MS` | ~27.8h | 工具调用超时 |
| `MAX_MCP_DESCRIPTION_LENGTH` | 2048 | 工具描述截断长度 |
| `MCP_FETCH_CACHE_SIZE` | 20 | LRU 缓存大小 |
| `MAX_RECONNECT_ATTEMPTS` | 5 | 最大重连次数 |
| `INITIAL_BACKOFF_MS` | 1000 | 初始退避延迟 |
| `MAX_BACKOFF_MS` | 30000 | 最大退避延迟 |
| `MCP_OUTPUT_WARNING_THRESHOLD_TOKENS` | 10000 | 大响应警告阈值 |

---

## 七、设计决策总结

### 7.1 为什么用 JSON-RPC 而不是 gRPC/REST？
- JSON-RPC 足够简单，适合 LLM 工具调用场景
- 与 LLM 的 JSON 输入输出天然契合
- 支持双向通知（Server → Client）
- 不需要额外的 IDL 定义

### 7.2 为什么工具名需要命名空间？
- 避免不同 MCP Server 的工具名冲突
- `mcp__slack__search` vs `mcp__github__search` 明确来源
- 便于权限管理（可以 deny 整个 server 的工具）

### 7.3 为什么 connectToServer 需要 memoize？
- 同一个 Server 的多次 tools/list 调用共享连接
- 避免重复建立连接的开销
- memoize key = name + config，配置变化时重新连接

### 7.4 为什么工具调用超时设为 ~27.8 小时？
- 某些 MCP 工具可能需要很长时间（如大数据查询）
- 由 Client 端的 AbortSignal 控制实际超时
- Server 端的超时由各自的实现决定

### 7.5 为什么需要 Session Expiry 检测？
- SSE/HTTP 连接可能因网络变化而断开
- Server 可能重启导致 session 丢失
- 404 + -32001 是 MCP 特定的 session 过期信号
- 检测到后清除缓存，允许自动重连

---

## 八、对我们项目的启示

### 8.1 简化策略
- **只支持 stdio 传输**（Phase 5 最简实现）
- **跳过 OAuth**（stdio 不需要认证）
- **跳过 enterprise 策略**（个人项目不需要）
- **跳过 Server 模式**（只做 Client）

### 8.2 核心实现
1. **MCP Client**：基于 MCP SDK 的 Client 类
2. **配置加载**：读取 `.mcp.json` 配置文件
3. **工具发现**：`tools/list` → 转换为内部 Tool 格式
4. **工具调用**：`tools/call` → 返回 ToolResult
5. **连接管理**：memoized connect + 基础重连

### 8.3 集成点
- `src/services/mcpClient.ts`：MCP 客户端
- `src/tools/MCPTool.ts`：MCP 工具适配器
- `src/services/mcpConfig.ts`：配置加载
- `src/tools/index.ts`：合并 MCP 工具到 registry
- `src/components/App.tsx`：启动时连接 MCP Server
