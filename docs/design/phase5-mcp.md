# Phase 5: MCP 集成设计文档

> **目标**：实现 MCP (Model Context Protocol) 客户端，支持连接外部 MCP Server 并将其工具整合到 REPL 工具系统中
>
> **参考源码**：`free-code/src/services/mcp/`、`free-code/src/tools/MCPTool/`
>
> **设计原则**：最小实现，只支持 stdio 传输，跳过 OAuth/enterprise/Server 模式

---

## 一、架构设计

### 1.1 模块划分

```
src/
├── services/
│   ├── mcpClient.ts          # MCP 客户端核心（连接、工具发现、工具调用）
│   └── mcpConfig.ts          # MCP Server 配置加载（.mcp.json）
├── tools/
│   ├── MCPTool.ts            # MCP 工具适配器（MCP 工具 → 内部 Tool）
│   └── index.ts              # 更新：合并 MCP 工具到 createDefaultRegistry
└── components/
    └── App.tsx                # 更新：启动时连接 MCP Server
```

### 1.2 数据流

```
启动阶段:
  App.tsx → loadMcpConfig() → .mcp.json
        → connectToMcpServer(config) → MCP Client 连接
        → fetchMcpTools(client) → 发现工具
        → registerMcpTools(registry) → 注册到 ToolRegistry
        → API config.tools 包含 MCP 工具定义

运行阶段:
  LLM 调用 mcp__slack__search
    → registry.get("mcp__slack__search")
    → MCPTool.execute(args, context)
    → mcpClient.callTool("search", args)
    → JSON-RPC over stdio
    → 结果 → ToolResult
```

---

## 二、接口设计

### 2.1 MCP Server 配置

```typescript
// src/services/mcpConfig.ts

/** MCP Server 配置（.mcp.json 格式） */
interface McpServerConfig {
  /** 传输类型，默认 stdio */
  type?: "stdio";
  /** 可执行文件命令 */
  command: string;
  /** 命令行参数 */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
}

/** .mcp.json 文件格式 */
interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

/**
 * 加载 MCP 配置。
 * 查找顺序：CWD/.mcp.json → 向上遍历到根目录
 */
function loadMcpConfig(cwd: string): McpConfigFile;
```

### 2.2 MCP 客户端

```typescript
// src/services/mcpClient.ts

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/** MCP 连接状态 */
type McpConnectionState =
  | { status: "disconnected" }
  | { status: "connecting"; serverName: string }
  | { status: "connected"; serverName: string; client: Client }
  | { status: "failed"; serverName: string; error: Error };

/** MCP 工具信息（从 Server 发现） */
interface McpToolInfo {
  /** Server 中的原始工具名 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 输入参数 JSON Schema */
  inputSchema: Record<string, unknown>;
}

/** MCP 客户端管理器 */
class McpClientManager {
  /** 所有连接状态 */
  private connections: Map<string, McpConnectionState>;

  /**
   * 连接到 MCP Server。
   * 使用 memoize 避免重复连接。
   */
  async connect(name: string, config: McpServerConfig): Promise<void>;

  /**
   * 断开指定 Server 连接。
   */
  async disconnect(name: string): Promise<void>;

  /**
   * 断开所有连接。
   */
  async disconnectAll(): Promise<void>;

  /**
   * 获取指定 Server 的工具列表。
   */
  async fetchTools(serverName: string): Promise<McpToolInfo[]>;

  /**
   * 调用指定 Server 的工具。
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string>;

  /**
   * 获取所有已连接 Server 的工具。
   */
  async fetchAllTools(): Promise<Map<string, McpToolInfo[]>>;
}
```

### 2.3 MCP 工具适配器

```typescript
// src/tools/MCPTool.ts

import { z } from "zod";
import type { Tool, ToolResult, ToolContext } from "./types.js";

/** MCP 工具输入 Schema（接受任意 JSON 对象） */
const McpInputSchema = z.object({}).passthrough();

/**
 * 创建一个 MCP 工具适配器。
 * 将 MCP Server 的工具转换为内部 Tool 接口。
 */
function createMcpTool(
  serverName: string,
  toolInfo: McpToolInfo,
  clientManager: McpClientManager,
): Tool {
  return {
    name: `mcp__${normalizeName(serverName)}__${toolInfo.name}`,
    description: truncate(toolInfo.description, 2048),
    inputSchema: McpInputSchema,

    validateInput: async () => ({ ok: true }),

    checkPermissions: async () => {
      // MCP 工具默认需要用户确认
      return { behavior: "ask" as const };
    },

    execute: async (input, context): Promise<ToolResult> => {
      try {
        const result = await clientManager.callTool(
          serverName,
          toolInfo.name,
          input as Record<string, unknown>,
        );
        return { output: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { output: `MCP tool error: ${message}`, error: true };
      }
    },
  };
}

/**
 * 规范化名称：非字母数字字符替换为下划线。
 */
function normalizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}
```

### 2.4 集成到 ToolRegistry

```typescript
// src/tools/index.ts (更新)

/**
 * 创建包含 MCP 工具的注册表。
 */
async function createRegistryWithMcp(cwd: string): Promise<ToolRegistry> {
  const registry = createDefaultRegistry();

  // 加载 MCP 配置
  const config = loadMcpConfig(cwd);
  if (!config) return registry;

  const manager = new McpClientManager();

  // 连接所有 Server 并注册工具
  for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
    try {
      await manager.connect(serverName, serverConfig);
      const tools = await manager.fetchTools(serverName);
      for (const toolInfo of tools) {
        const tool = createMcpTool(serverName, toolInfo, manager);
        registry.register(tool);
      }
    } catch (err) {
      console.error(`Failed to connect MCP server "${serverName}":`, err);
    }
  }

  return registry;
}
```

---

## 三、核心实现细节

### 3.1 连接建立（Stdio 传输）

```typescript
async connect(name: string, config: McpServerConfig): Promise<void> {
  // 1. 创建 stdio transport
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    env: { ...process.env, ...config.env },
  });

  // 2. 创建 MCP Client
  const client = new Client(
    { name: "cc-study", version: VERSION },
    { capabilities: {} },
  );

  // 3. 连接
  await client.connect(transport);

  // 4. 保存连接状态
  this.connections.set(name, {
    status: "connected",
    serverName: name,
    client,
  });
}
```

### 3.2 工具发现

```typescript
async fetchTools(serverName: string): Promise<McpToolInfo[]> {
  const conn = this.connections.get(serverName);
  if (!conn || conn.status !== "connected") {
    throw new Error(`MCP server "${serverName}" not connected`);
  }

  // 发送 tools/list 请求
  const result = await conn.client.request(
    { method: "tools/list" },
    ListToolsResultSchema,
  );

  return result.tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema as Record<string, unknown>,
  }));
}
```

### 3.3 工具调用

```typescript
async callTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const conn = this.connections.get(serverName);
  if (!conn || conn.status !== "connected") {
    throw new Error(`MCP server "${serverName}" not connected`);
  }

  // 发送 tools/call 请求
  const result = await conn.client.request(
    {
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    },
    CallToolResultSchema,
  );

  // 处理结果
  if (result.isError) {
    throw new Error(
      result.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n"),
    );
  }

  // 提取文本内容
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}
```

### 3.4 配置加载

```typescript
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

function loadMcpConfig(cwd: string): McpConfigFile | null {
  // 从 CWD 向上查找 .mcp.json
  let dir = cwd;
  while (true) {
    const configPath = join(dir, ".mcp.json");
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, "utf-8");
        return JSON.parse(raw) as McpConfigFile;
      } catch {
        // 解析失败，继续查找
      }
    }

    const parent = dirname(dir);
    if (parent === dir) break; // 到达根目录
    dir = parent;
  }

  return null;
}
```

---

## 四、错误处理策略

### 4.1 连接错误

| 错误场景 | 处理方式 |
|---------|---------|
| 命令不存在 | 记录错误，跳过该 Server |
| 连接超时 | 记录错误，跳过该 Server |
| Server 崩溃 | 标记为 disconnected，下次调用时报错 |
| 初始化失败 | 记录错误，跳过该 Server |

### 4.2 工具调用错误

| 错误场景 | 处理方式 |
|---------|---------|
| 工具不存在 | 返回错误信息给 LLM |
| 参数验证失败 | 返回错误信息给 LLM |
| Server 无响应 | 返回超时错误 |
| Server 崩溃 | 返回错误信息，标记连接断开 |

### 4.3 错误信息格式

```typescript
// 工具调用失败
{
  output: "MCP tool error: Connection refused",
  error: true
}

// 工具返回错误
{
  output: "Error: Invalid query syntax",
  error: true
}
```

---

## 五、测试规划

### 5.1 单元测试

| 测试文件 | 测试用例 | 说明 |
|---------|---------|------|
| `mcpConfig.test.ts` | 5 | 配置加载、查找、解析 |
| `mcpClient.test.ts` | 8 | 连接、断开、工具发现、工具调用、错误处理 |
| `MCPTool.test.ts` | 6 | 工具创建、命名空间、执行、错误处理 |

### 5.2 集成测试

| 测试文件 | 测试用例 | 说明 |
|---------|---------|------|
| `mcpIntegration.test.ts` | 4 | 完整流程：配置→连接→发现→调用 |

### 5.3 Mock 策略

- **MCP SDK Client**：Mock `Client.connect()`、`Client.request()`
- **子进程**：Mock `StdioClientTransport`
- **文件系统**：Mock `readFileSync`、`existsSync`

---

## 六、依赖

### 6.1 新增依赖

```json
{
  "@modelcontextprotocol/sdk": "^1.0.0"
}
```

### 6.2 依赖说明

- `@modelcontextprotocol/sdk`：MCP 官方 TypeScript SDK
  - `Client`：MCP 客户端类
  - `StdioClientTransport`：stdio 传输实现
  - Schema 类型：`ListToolsResultSchema`、`CallToolResultSchema`

---

## 七、集成点

### 7.1 App.tsx 更新

```typescript
// 启动时连接 MCP Server
useEffect(() => {
  const initMcp = async () => {
    const mcpRegistry = await createRegistryWithMcp(process.cwd());
    // 合并 MCP 工具到主 registry
    for (const tool of mcpRegistry.getAll()) {
      if (!toolRegistry.has(tool.name)) {
        toolRegistry.register(tool);
      }
    }
    // 更新 API config 中的 tools
    // ...
  };
  initMcp();
}, []);
```

### 7.2 ToolContext 扩展

无需扩展。MCP 工具通过 `McpClientManager` 闭包访问连接状态，不需要额外的上下文信息。

---

## 八、实现顺序

1. **Step 1**: 安装 `@modelcontextprotocol/sdk` 依赖
2. **Step 2**: 实现 `src/services/mcpConfig.ts`（配置加载）
3. **Step 3**: 实现 `src/services/mcpClient.ts`（客户端核心）
4. **Step 4**: 实现 `src/tools/MCPTool.ts`（工具适配器）
5. **Step 5**: 更新 `src/tools/index.ts`（合并 MCP 工具）
6. **Step 6**: 更新 `src/components/App.tsx`（启动时连接）
7. **Step 7**: 编写测试
8. **Step 8**: 集成验证
