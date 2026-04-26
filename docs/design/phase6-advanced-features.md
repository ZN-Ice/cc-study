# Phase 6 高级特性设计文档

> **编写日期**：2026-04-26
> **对应任务**：P6003-P6008
> **源码参考**：`free-code/src/commands/`、`free-code/src/types/command.ts`、`free-code/src/utils/slashCommandParsing.ts`

---

## 一、架构概览

Phase 6 高级特性包含四个核心模块：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Phase 6 高级特性                               │
├──────────────────┬──────────────────┬───────────────────────────┤
│    斜杠命令系统    │      Hook 系统    │       记忆系统            │
│   Slash Commands  │    Hook System   │    Memory System         │
├──────────────────┴──────────────────┴───────────────────────────┤
│                    Tool 接口扩展                                  │
│              extractSearchText 方法                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、斜杠命令系统

### 2.1 命令类型定义

参考 `free-code/src/types/command.ts`：

```typescript
// src/commands/types.ts

/** 命令结果类型 */
export type LocalCommandResult =
  | { type: 'text'; value: string }
  | { type: 'compact'; compactionResult: CompactionResult; displayText?: string }
  | { type: 'skip' }

/** Prompt 类型命令 - 返回 ContentBlockParam 数组供模型使用 */
export type PromptCommand = {
  type: 'prompt'
  progressMessage: string
  contentLength: number
  argNames?: string[]
  allowedTools?: string[]
  model?: string
  source: 'builtin' | 'mcp' | 'plugin' | 'bundled' | 'managed' | 'user'
  getPromptForCommand(args: string, context: ToolUseContext): Promise<ContentBlockParam[]>
}

/** 本地命令 - 返回文本结果 */
export type LocalCommand = {
  type: 'local'
  supportsNonInteractive: boolean
  load: () => Promise<{ call: LocalCommandCall }>
}

/** 本地 JSX 命令 - 返回 React 组件 */
export type LocalJSXCommand = {
  type: 'local-jsx'
  load: () => Promise<{ call: LocalJSXCommandCall }>
}

/** 命令基类 */
export type CommandBase = {
  name: string
  description: string
  aliases?: string[]
  argumentHint?: string
  whenToUse?: string
  isEnabled?: () => boolean
  isHidden?: boolean
  availability?: ('claude-ai' | 'console')[]
  disableModelInvocation?: boolean
  userInvocable?: boolean
}

/** 完整命令类型 */
export type Command = CommandBase & (PromptCommand | LocalCommand | LocalJSXCommand)
```

### 2.2 命令注册表架构

```
src/commands/
├── index.ts           # 命令注册表入口
├── registry.ts         # 命令注册表实现
├── types.ts           # 命令类型定义
└── builtins/
    ├── help.ts        # /help 命令
    ├── compact.ts      # /compact 命令
    ├── config.tsx      # /config 命令
    ├── resume.tsx      # /resume 命令
    └── memory.tsx      # /memory 命令
```

**核心接口**：

```typescript
// src/commands/registry.ts

export interface CommandRegistry {
  getCommands(): Command[]
  findCommand(name: string): Command | undefined
  hasCommand(name: string): boolean
}

export interface CommandExecutor {
  execute(
    command: Command,
    args: string,
    context: CommandContext
  ): Promise<CommandResult>
}
```

### 2.3 斜杠命令解析

```typescript
// src/commands/slashCommandParser.ts

export interface ParsedSlashCommand {
  commandName: string
  args: string
  isMcp: boolean
}

/**
 * 解析斜杠命令输入
 * @example
 * parseSlashCommand('/search foo bar')
 * // => { commandName: 'search', args: 'foo bar', isMcp: false }
 *
 * parseSlashCommand('/mcp:tool (MCP) arg1')
 * // => { commandName: 'mcp:tool (MCP)', args: 'arg1', isMcp: true }
 */
export function parseSlashCommand(input: string): ParsedSlashCommand | null
```

### 2.4 命令执行流程

```
用户输入 "/help" 
       │
       ▼
parseSlashCommand("/help")
       │
       ▼
findCommand("help", commands)
       │
       ▼
command.load() → { call }
       │
       ▼
call(args, context)
       │
       ▼
返回 React 组件 <HelpV2 /> 或文本结果
```

### 2.5 实现命令列表

| 命令 | 类型 | 描述 |
|------|------|------|
| `/help` | LocalJSXCommand | 显示帮助列表，使用 HelpV2 组件 |
| `/compact` | LocalCommand | 上下文压缩，合并历史消息减少 token |
| `/config` | LocalJSXCommand | 打开配置设置界面 |
| `/resume [sessionId]` | LocalJSXCommand | 恢复历史会话 |
| `/memory` | LocalJSXCommand | 打开记忆文件编辑器 |

---

## 三、Hook 系统

### 3.1 Hook 类型定义

参考 `free-code/src/hooks/` 和 `settings.json` 中的 hooks 配置：

```typescript
// src/hooks/types.ts

export type HookType = 'PreToolUse' | 'PostToolUse' | 'Stop'

export interface Hook {
  type: HookType
  name: string
  description?: string
  enabled?: boolean
}

export interface PreToolUseHook extends Hook {
  type: 'PreToolUse'
  // 工具执行前调用，返回 true 继续执行，false 阻止
  beforeToolUse: (toolName: string, input: unknown) => boolean | Promise<boolean>
}

export interface PostToolUseHook extends Hook {
  type: 'PostToolUse'
  // 工具执行后调用
  afterToolUse: (toolName: string, input: unknown, result: ToolResult) => void | Promise<void>
}

export interface StopHook extends Hook {
  type: 'Stop'
  // 收到 Stop 信号时调用
  onStop: () => void | Promise<void>
}
```

### 3.2 Hook 配置格式

```typescript
// src/hooks/config.ts

export interface HookConfig {
  preToolUse?: PreToolUseHook[]
  postToolUse?: PostToolUseHook[]
  stop?: StopHook[]
}

export interface HookSettings {
  hooks: HookConfig
}
```

**settings.json 配置示例**：

```json
{
  "hooks": {
    "preToolUse": [
      {
        "name": "log-tool-use",
        "type": "PreToolUse",
        "enabled": true
      }
    ],
    "postToolUse": [
      {
        "name": "track-usage",
        "type": "PostToolUse",
        "enabled": true
      }
    ]
  }
}
```

### 3.3 Hook 执行器

```typescript
// src/hooks/runner.ts

export class HookRunner {
  constructor(config: HookConfig)
  
  async runPreToolUseHooks(
    toolName: string,
    input: unknown
  ): Promise<boolean>
  
  async runPostToolUseHooks(
    toolName: string,
    input: unknown,
    result: ToolResult
  ): Promise<void>
  
  async runStopHooks(): Promise<void>
}
```

### 3.4 Hook 执行流程

```
Tool.execute(input)
       │
       ▼
HookRunner.runPreToolUseHooks(toolName, input)
       │
       ├── 返回 false → 拒绝执行，返回权限错误
       │
       └── 返回 true → 继续执行
                     │
                     ▼
                   tool.execute(input)
                     │
                     ▼
               HookRunner.runPostToolUseHooks(toolName, input, result)
                     │
                     ▼
                   返回 result 给调用方
```

---

## 四、记忆系统

### 4.1 记忆文件结构

记忆系统基于文件存储，参考 `free-code/src/commands/memory/`：

```
~/.claude/projects/
└── {project-id}/
    └── memory/
        ├── user.md           # 用户记忆（偏好、习惯）
        ├── feedback.md        # 反馈记忆（用户的纠正和偏好）
        ├── project.md         # 项目记忆（项目特定信息）
        └── reference.md       # 参考记忆（外部系统指针）

MEMORY.md                  # 索引文件
```

### 4.2 记忆索引格式

参考 CLAUDE.md §MEMORY.md：

```markdown
---
name: user_preferences
description: 用户偏好设置
type: user
---

- [User Preferences](user.md)
- [Feedback](feedback.md)
```

### 4.3 记忆类型分类

| 类型 | 描述 | 存储位置 |
|------|------|---------|
| user | 用户偏好和习惯 | `memory/user.md` |
| feedback | 用户的反馈和纠正 | `memory/feedback.md` |
| project | 项目特定信息 | `memory/project.md` |
| reference | 外部系统参考指针 | `memory/reference.md` |

### 4.4 记忆工具接口

```typescript
// src/tools/MemoryTool/index.ts

export interface MemoryTool extends Tool {
  name: 'memory'
  description: 'Read or write to memory files'
  
  execute(params: {
    action: 'read' | 'write'
    memoryType?: 'user' | 'feedback' | 'project' | 'reference'
    content?: string
  }, context: ToolContext): Promise<ToolResult>
}
```

---

## 五、Tool 接口扩展

### 5.1 extractSearchText 方法

为支持 `/compact` 上下文压缩，需要从工具执行结果中提取搜索文本：

```typescript
// src/tools/types.ts

export interface Tool {
  name: string
  description: string
  inputSchema: JSONSchema
  
  execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult>
  
  // 新增方法：从执行结果中提取搜索文本
  extractSearchText?: (result: ToolResult) => string | null
  
  // 现有方法保留
  validateInput?: (params: Record<string, unknown>) => ValidationResult
  checkPermissions?: (params: Record<string, unknown>, context: ToolContext) => PermissionCheckResult
  isReadOnly?: () => boolean
  isConcurrencySafe?: () => boolean
  getPath?: (input: Record<string, unknown>) => string | null
}
```

### 5.2 extractSearchText 实现指南

```typescript
// 各工具实现示例

class FileReadTool implements Tool {
  extractSearchText(result: ToolResult): string | null {
    if (result.error) return null
    // 返回文件内容的前 N 个字符，用于上下文压缩索引
    return result.output.substring(0, MAX_EXTRACT_LENGTH)
  }
}

class BashTool implements Tool {
  extractSearchText(result: ToolResult): string | null {
    if (result.error) return null
    // 返回命令输出的摘要
    return result.output.split('\n').slice(0, 10).join('\n')
  }
}
```

---

## 六、集成点

### 6.1 与 REPL 集成

```typescript
// src/screens/REPL.tsx

// 在用户输入处理中添加斜杠命令检测
const handleInput = async (input: string) => {
  if (input.startsWith('/')) {
    const parsed = parseSlashCommand(input)
    if (parsed) {
      const command = findCommand(parsed.commandName, commands)
      if (command) {
        await executeCommand(command, parsed.args, commandContext)
        return
      }
    }
  }
  // 非斜杠命令，走正常 API 处理流程
  await sendToAPI(input)
}
```

### 6.2 与工具系统集成

```typescript
// src/tools/executor.ts

// 在工具执行前后注入 Hook
export async function executeToolWithHooks(
  tool: Tool,
  params: Record<string, unknown>,
  context: ToolContext,
  hookRunner: HookRunner
): Promise<ToolResult> {
  // Pre Hook
  const canProceed = await hookRunner.runPreToolUseHooks(tool.name, params)
  if (!canProceed) {
    return { output: '', error: true, metadata: { reason: 'hookRejected' } }
  }
  
  // Execute
  const result = await tool.execute(params, context)
  
  // Post Hook
  await hookRunner.runPostToolUseHooks(tool.name, params, result)
  
  return result
}
```

### 6.3 与 MCP 集成

```typescript
// src/services/mcpClient.ts

// MCP 服务器启动时注册其提供的斜杠命令
interface McpServer {
  name: string
  commands: Command[]
  tools: Tool[]
}

// MCP 命令注册到命令表
export function registerMcpCommands(servers: McpServer[]): void {
  for (const server of servers) {
    for (const cmd of server.commands) {
      commandRegistry.register(cmd)
    }
  }
}
```

---

## 七、测试规划

### 7.1 斜杠命令测试

| 测试用例 | 描述 |
|---------|------|
| parseSlashCommand 解析 | `/cmd arg` → {cmd, arg} |
| parseSlashCommand MCP | `/mcp:tool (MCP) arg` → {mcp:tool (MCP), arg, isMcp: true} |
| findCommand 查找 | 正确返回命令或 undefined |
| help 命令渲染 | HelpV2 组件正确显示命令列表 |
| compact 命令执行 | 返回压缩结果 |
| config 命令渲染 | Settings 组件正确显示 |

### 7.2 Hook 系统测试

| 测试用例 | 描述 |
|---------|------|
| PreToolUse 允许 | 返回 true 时工具正常执行 |
| PreToolUse 拒绝 | 返回 false 时工具不执行 |
| PostToolUse 调用 | 工具执行后正确调用 |
| StopHook 调用 | 收到停止信号时调用 |
| 多个 Hook 顺序 | 按注册顺序执行 |

### 7.3 记忆系统测试

| 测试用例 | 描述 |
|---------|------|
| 记忆文件读取 | 正确读取 MEMORY.md |
| 记忆类型分类 | user/feedback/project/reference 正确分类 |
| 记忆文件写入 | 写入对应类型文件 |

### 7.4 Tool 扩展测试

| 测试用例 | 描述 |
|---------|------|
| extractSearchText 实现 | 各工具正确提取搜索文本 |
| extractSearchText 返回 null | 错误结果返回 null |

---

## 八、文件结构

```
src/
├── commands/
│   ├── index.ts              # 命令注册表
│   ├── types.ts              # 命令类型定义
│   ├── slashCommandParser.ts # 斜杠命令解析
│   ├── executor.ts           # 命令执行器
│   └── builtins/
│       ├── help.ts           # /help
│       ├── compact.ts         # /compact
│       ├── config.tsx         # /config
│       ├── resume.tsx         # /resume
│       └── memory.tsx         # /memory
├── hooks/
│   ├── types.ts             # Hook 类型定义
│   ├── config.ts            # Hook 配置
│   ├── runner.ts             # Hook 执行器
│   └── settings.ts           # Hook 设置管理
├── tools/
│   ├── types.ts             # Tool 接口（含 extractSearchText）
│   ├── MemoryTool/          # 记忆工具
│   │   ├── index.ts
│   │   ├── reader.ts
│   │   └── writer.ts
│   └── registry.ts
└── components/
    └── Help/
        └── HelpV2.tsx
```

---

## 九、优先级

1. **P6004** - 斜杠命令系统基础架构（命令注册表、解析器）
2. **P6004** - 内置命令实现（help, config）
3. **P6005** - Hook 系统实现
4. **P6006** - 记忆系统实现
5. **P6008** - Tool.extractSearchText 扩展
6. **P6007** - 测试编写

---

**版本**：v1.0
**状态**：设计完成
