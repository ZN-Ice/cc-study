# Phase 2: 工具系统设计文档

> 设计日期：2026-04-11
> 参考源码：free-code/src/tools.ts, free-code/src/Tool.ts

---

## 一、架构设计

### 1.1 分层结构

```
src/tools/
├── types.ts           # Tool 接口、ToolResult、ToolContext 等类型定义
├── registry.ts        # ToolRegistry 工具注册表
├── executor.ts        # ToolExecutor 执行引擎（处理 tool_use 循环）
├── FileReadTool.ts    # 文件读取工具
├── FileWriteTool.ts   # 文件写入工具
├── FileEditTool.ts    # 文件编辑工具
├── BashTool.ts        # Shell 命令执行工具
├── GlobTool.ts        # 文件模式匹配工具
└── GrepTool.ts        # 内容搜索工具
```

### 1.2 核心接口

```typescript
// Tool 接口
interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

// 工具执行上下文
interface ToolContext {
  workingDirectory: string;
  abortSignal: AbortSignal;
}

// 工具执行结果
interface ToolResult {
  output: string;
  error?: boolean;
}

// 工具注册表
interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  getAll(): Tool[];
  getToolDefinitions(): Array<{ name: string; description: string; input_schema: unknown }>;
}
```

---

## 二、API 层集成

### 2.1 tool_use 处理流程

```
streamChat() 返回 events
  → 解析 content_block_start (type: "tool_use")
  → 收集 tool_use input deltas
  → content_block_stop 时完整获取 {id, name, input}
  → ToolExecutor.executeTool(name, input)
  → 构建 tool_result message
  → 将 tool_result 添加到消息列表
  → 重新调用 streamChat()
```

### 2.2 messages.ts 扩展

ToolUseBlock 和 ToolResultBlock 已在 Phase 1 定义。需要确保 API 调用时正确传递工具定义。

---

## 三、工具实现规格

### 3.1 FileReadTool

**name**: "Read"
**参数**: `{ file_path: string, offset?: number, limit?: number }`
**功能**:
- 读取文本文件
- 添加行号前缀（cat -n 格式）
- offset/limit 分页
- maxSizeBytes 预检查（256KB）

### 3.2 FileWriteTool

**name**: "Write"
**参数**: `{ file_path: string, content: string }`
**功能**:
- 创建/覆盖文件
- 自动创建父目录
- 原子写入（tmp + rename）

### 3.3 FileEditTool

**name**: "Edit"
**参数**: `{ file_path: string, old_string: string, new_string: string, replace_all?: boolean }`
**功能**:
- 精确字符串替换
- replace_all 模式
- 唯一性检查（非 replace_all 时）
- `() => newString` 避免 $ 特殊字符问题

### 3.4 BashTool

**name**: "Bash"
**参数**: `{ command: string, timeout?: number }`
**功能**:
- child_process.spawn 执行
- stdout/stderr 捕获
- 超时控制（默认 120s）
- AbortSignal 取消

### 3.5 GlobTool

**name**: "Glob"
**参数**: `{ pattern: string, path?: string }`
**功能**:
- fast-glob 模式匹配
- 结果按修改时间排序
- 最多 100 个结果

### 3.6 GrepTool

**name**: "Grep"
**参数**: `{ pattern: string, path?: string, glob?: string, output_mode?: "content"|"files_with_matches" }`
**功能**:
- 子进程调用 ripgrep
- 支持正则搜索
- 三种输出模式

---

## 四、执行引擎设计

### 4.1 ToolExecutor

```typescript
class ToolExecutor {
  constructor(private registry: ToolRegistry) {}
  
  // 处理 LLM 返回的 tool_use blocks
  async processToolUses(
    toolUses: ToolUseBlock[],
    context: ToolContext
  ): Promise<ToolResultBlock[]>
  
  // 执行单个工具
  async executeTool(
    name: string,
    input: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult>
}
```

### 4.2 API 调用扩展

需要在 `streamChat()` 调用时传入 `tools` 参数：

```typescript
interface StreamChatOptions {
  messages: readonly Message[];
  config: APIConfig;
  signal: AbortSignal;
  tools?: ToolDefinition[];  // 新增
}
```

---

## 五、测试规划

### 5.1 单元测试

| 测试文件 | 覆盖目标 | 用例数 |
|---------|---------|--------|
| registry.test.ts | 注册/获取/工具定义生成 | 5 |
| fileReadTool.test.ts | 文本读取/行号/分页/错误 | 8 |
| fileWriteTool.test.ts | 创建/覆盖/原子写入 | 6 |
| fileEditTool.test.ts | 替换/replaceAll/唯一性/删除 | 10 |
| bashTool.test.ts | 执行/超时/取消/错误 | 6 |
| globTool.test.ts | 模式匹配/排序/限制 | 5 |
| grepTool.test.ts | 搜索/输出模式/过滤 | 5 |

### 5.2 覆盖率目标

- 工具系统: 80%+
- 执行引擎: 70%+
