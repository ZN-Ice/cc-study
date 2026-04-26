# Phase 6 源码研读笔记：斜杠命令系统

> **任务**：P6001
> **日期**：2026-04-26
> **源码路径**：`free-code/src/commands/`、`free-code/src/types/command.ts`

---

## 一、斜杠命令系统架构

Claude Code 的斜杠命令系统用于在 REPL 中直接执行特定操作（帮助、配置、会话恢复等），而不经过 LLM。

### 1.1 命令类型

```
Command (联合类型)
├── PromptCommand     → 返回 ContentBlockParam[] 供模型使用
├── LocalCommand      → 返回文本结果（同步）
└── LocalJSXCommand → 返回 React 组件（渲染 UI）
```

### 1.2 命令基类 CommandBase

```typescript
interface CommandBase {
  name: string                    // 命令名称
  description: string             // 描述（显示在帮助中）
  aliases?: string[]              // 别名
  argumentHint?: string           // 参数提示 "[command]"
  whenToUse?: string             // 使用时机说明
  isEnabled?: () => boolean      // 是否启用
  isHidden?: boolean             // 是否隐藏
  userInvocable?: boolean        // 是否可用户调用
  disableModelInvocation?: boolean // 是否禁止 LLM 调用
}
```

---

## 二、PromptCommand 详解

返回 `ContentBlockParam[]` 供模型注入到上下文中。

```typescript
interface PromptCommand extends CommandBase {
  type: 'prompt'
  progressMessage: string          // 执行中的进度消息
  contentLength: number           // 内容长度（用于预算管理）
  argNames?: string[]             // 参数名列表
  allowedTools?: string[]         // 允许使用的工具
  model?: string                 // 指定模型
  source: 'builtin' | 'mcp' | 'plugin' | 'bundled' | 'managed' | 'user'
  getPromptForCommand(
    args: string,
    context: ToolUseContext
  ): Promise<ContentBlockParam[]>
}
```

**执行流程**：
1. 用户输入 `/skill-name arg`
2. 解析为 `{ commandName, args }`
3. 调用 `getPromptForCommand(args, context)`
4. 返回的 ContentBlockParam 注入到发送给 LLM 的消息中
5. LLM 处理这些内容并生成响应

---

## 三、LocalCommand 详解

返回文本结果，直接显示给用户。

```typescript
type LocalCommandCall = (
  args: string,
  context: CommandContext,
) => Promise<LocalCommandResult>

type LocalCommandResult =
  | { type: 'text'; value: string }
  | { type: 'skip' }

interface LocalCommand extends CommandBase {
  type: 'local'
  supportsNonInteractive: boolean   // 是否支持非交互模式
  load: () => Promise<{ call: LocalCommandCall }>
}
```

**注意**：`load()` 是异步工厂方法，返回包含 `call` 函数的对象。这允许命令按需加载依赖。

---

## 四、LocalJSXCommand 详解

返回 React 组件，用于渲染复杂的交互 UI。

```typescript
type LocalJSXCommandOnDone = (
  result?: string,
  options?: {
    display?: 'skip' | 'system' | 'user'
    shouldQuery?: boolean
    metaMessages?: string[]
    nextInput?: string
    submitNextInput?: boolean
  }
) => void

type LocalJSXCommandCall = (
  onDone: LocalJSXCommandOnDone,
  context: CommandContext,
  args: string,
) => Promise<React.ReactNode | null>

interface LocalJSXCommand extends CommandBase {
  type: 'local-jsx'
  load: () => Promise<{ call: LocalJSXCommandCall }>
}
```

**设计亮点**：
- `onDone` 回调允许组件完成后通知调用者
- `options` 支持多种后处理行为（跳过、显示为系统消息、设置下次输入等）
- 命令可以返回 React 节点自行渲染

---

## 五、命令注册表架构

```
commands/index.ts
├── getCommands()       → 获取所有命令（含动态加载）
├── findCommand(name)  → 按名称或别名查找
├── hasCommand(name)   → 检查命令是否存在
└── getCommand(name)   → 获取命令或抛出异常
```

### 5.1 动态加载机制

```typescript
// 内置命令在模块级别定义
const BUILTIN_COMMANDS: Command[] = [helpCommand, compactCommand, ...]

// MCP/Plugin 命令通过动态加载
export function getCommands(): Command[] {
  return [
    ...BUILTIN_COMMANDS,
    ...loadMcpCommands(),
    ...loadPluginCommands(),
  ]
}
```

### 5.2 命令名称解析

```typescript
export function getCommandName(cmd: CommandBase): string {
  return cmd.userFacingName?.() ?? cmd.name
}
```

支持 `userFacingName()` 方法，允许命令自定义显示名称。

---

## 六、斜杠命令解析器

### 6.1 parseSlashCommand

```typescript
function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null

  const parts = trimmed.slice(1).split(/\s+/)
  const commandName = parts[0]
  const args = parts.slice(1).join(' ')

  return {
    commandName,
    args,
    isMcp: commandName.includes('(MCP)'),
  }
}
```

### 6.2 解析示例

| 输入 | 结果 |
|------|------|
| `/help` | `{ commandName: 'help', args: '', isMcp: false }` |
| `/help compact` | `{ commandName: 'help', args: 'compact', isMcp: false }` |
| `/mcp:tool (MCP) arg1` | `{ commandName: 'mcp:tool (MCP)', args: 'arg1', isMcp: true }` |

---

## 七、CommandContext 命令上下文

```typescript
interface CommandContext {
  abortSignal: AbortSignal           // 中止信号
  workingDirectory: string           // 工作目录
  canUseTool?: (toolName: string) => boolean  // 工具权限检查
  setMessages?: (updater: (prev: Message[]) => Message[]) => void  // 消息更新
  resume?: (
    sessionId: string,
    log: unknown,
    entrypoint: ResumeEntrypoint,
  ) => Promise<void>
}

type ResumeEntrypoint =
  | 'cli_flag'
  | 'slash_command_picker'
  | 'slash_command_session_id'
  | 'slash_command_title'
  | 'fork'
```

---

## 八、内置命令实现

### 8.1 /help 命令 (LocalJSXCommand)

显示所有可用命令列表，或特定命令的详细帮助。

```typescript
export const helpCommand: Command = {
  type: 'local-jsx',
  name: 'help',
  description: 'Show available commands and their descriptions',
  argumentHint: '[command]',
  userInvocable: true,
  load: async () => ({ call: helpCall }),
}
```

### 8.2 /compact 命令 (LocalCommand)

压缩上下文，合并历史消息减少 token 使用。

```typescript
export const compactCommand: Command = {
  type: 'local',
  name: 'compact',
  description: 'Compact the conversation to save tokens',
  supportsNonInteractive: true,
  load: async () => ({ call: compactCall }),
}
```

### 8.3 /resume 命令 (LocalJSXCommand)

恢复历史会话。

```typescript
export const resumeCommand: Command = {
  type: 'local',
  name: 'resume',
  description: 'Resume a previous conversation session',
  argumentHint: '[session-id]',
  supportsNonInteractive: true,
  userInvocable: true,
  load: async () => ({ call: resumeCall }),
}
```

---

## 九、与 REPL 的集成

### 9.1 用户输入处理

```typescript
async function handleInput(input: string) {
  // 检测斜杠命令
  if (input.startsWith('/')) {
    const parsed = parseSlashCommand(input)
    if (parsed) {
      const command = findCommand(parsed.commandName)
      if (command && command.userInvocable) {
        await executeCommand(command, parsed.args, commandContext)
        return
      }
    }
  }
  // 非斜杠命令 → 发送给 LLM
  await sendToLLM(input)
}
```

### 9.2 执行流程

```
用户输入 "/help compact"
        │
        ▼
parseSlashCommand("/help compact")
        │
        ▼
findCommand("help")
        │
        ▼
helpCommand.load() → { call }
        │
        ▼
call("compact", context)
        │
        ▼
返回 HelpV2 React 组件 或 文本结果
```

---

## 十、设计决策记录

### 10.1 为什么使用 load() 工厂方法？

**原因**：命令可能依赖外部资源（文件系统、MCP 连接等），异步加载避免阻塞。

**替代方案对比**：
- 直接导入：简单但无法处理异步依赖
- 静态注册：需要预先注册，扩展性差
- 工厂方法（chosen）：按需加载，灵活且性能好

### 10.2 Local vs LocalJSX 的分离

**原因**：
- Local：纯文本输出，不需要 UI
- LocalJSX：复杂交互，需要 React 组件

**设计**：通过联合类型明确区分，避免混淆。

### 10.3 onDone 回调的设计

**原因**：命令组件可能需要异步获取数据，通过回调通知完成。

**优点**：
- 非阻塞：组件可以渲染加载状态
- 灵活性：支持多种后处理行为

---

## 十一、已实现文件

```
src/commands/
├── index.ts              # 命令注册表
├── types.ts              # 命令类型定义
├── slashCommandParser.ts # 斜杠命令解析
└── builtins/
    ├── help.ts           # /help
    ├── compact.ts        # /compact
    ├── config.tsx        # /config
    ├── resume.tsx        # /resume
    └── memory.tsx        # /memory
```

---

**版本**：v1.0
**状态**：已完成源码研读
