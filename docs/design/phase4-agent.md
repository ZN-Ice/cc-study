# Phase 4: Agent 子系统设计文档

> **阶段**: Phase 4 — Agent 子系统
> **参考源码**: `free-code/src/tools/AgentTool/`
> **版本**: v1.0.0
> **日期**: 2026-04-26

---

## 一、设计目标

实现子 Agent 机制，使 LLM 可以通过工具调用的方式生成子 Agent，执行复杂的多步骤任务。

**核心设计原则**：
- AgentTool 就是一个普通的 Tool，实现 Tool 接口
- 子 Agent 的执行是一个**嵌套的 streaming + tool-use 循环**
- 子 Agent 使用**过滤后的工具子集**
- 子 Agent 的结果以文本摘要形式回传给父级

**简化决策**（相比参考源码）：
- 仅支持同步 Agent（无后台/异步模式）
- 3 个内置 Agent 类型（general-purpose, Explore, Plan）
- 无 fork 模式、无 worktree 隔离、无 per-agent MCP
- 无持久化 Agent 记忆

---

## 二、架构概览

```
┌──────────────────────────────────────────────────────┐
│              Parent REPL Loop                         │
│  useStreamResponse.ts                                │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐       │
│  │ API Call  │───>│ tool_use │───>│ Execute  │       │
│  │ streamChat│    │ blocks   │    │ Tools    │       │
│  └──────────┘    └──────────┘    └────┬─────┘       │
│                                        │              │
│                        ┌───────────────┘              │
│                        ▼                              │
│              ┌─────────────────┐                      │
│              │   AgentTool     │                      │
│              │   execute()     │                      │
│              └────────┬────────┘                      │
│                       │                               │
└───────────────────────┼───────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────┐
│              Sub-Agent Loop                           │
│              orchestrator.ts                          │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐       │
│  │ API Call  │───>│ tool_use │───>│ Execute  │       │
│  │ streamChat│    │ blocks   │    │ Filtered │       │
│  │ (agent    │    │          │    │ Tools    │       │
│  │  prompt)  │    │          │    │          │       │
│  └──────────┘    └──────────┘    └──────────┘       │
│                        │                              │
│                        ▼                              │
│              ┌─────────────────┐                      │
│              │  Text Summary   │                      │
│              │  → ToolResult   │                      │
│              └─────────────────┘                      │
└──────────────────────────────────────────────────────┘
```

---

## 三、类型定义

### 3.1 Agent 类型标识

```typescript
export type BuiltinAgentType = "general-purpose" | "Explore" | "Plan";
export type AgentType = BuiltinAgentType | string;  // 可扩展
```

### 3.2 AgentDefinition

```typescript
export interface AgentDefinition {
  readonly agentType: AgentType;
  readonly whenToUse: string;           // LLM 可见的描述
  readonly tools?: string[];            // 允许的工具列表（undefined = 全部）
  readonly disallowedTools?: string[];  // 禁止的工具列表
  readonly getSystemPrompt: () => string;
  readonly isReadOnly?: boolean;        // 是否只读
  readonly maxTurns?: number;           // 最大 agentic 轮次
}
```

### 3.3 AgentToolInput（Zod Schema）

```typescript
const agentToolInputSchema = z.strictObject({
  description: z.string().describe("A short (3-5 word) description"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().optional().describe("Agent type, default 'general-purpose'"),
  model: z.string().optional(),
});
```

### 3.4 AgentToolResult

```typescript
export interface AgentToolResult {
  readonly agentType: string;
  readonly content: string;
  readonly totalToolUseCount: number;
  readonly totalDurationMs: number;
}
```

### 3.5 AgentDefinitionRegistry

```typescript
export class AgentDefinitionRegistry {
  register(def: AgentDefinition): void;
  get(type: string): AgentDefinition | undefined;
  getAll(): AgentDefinition[];
}
```

---

## 四、内置 Agent 定义

### 4.1 general-purpose

| 属性 | 值 |
|------|-----|
| agentType | `"general-purpose"` |
| tools | `undefined`（全部） |
| disallowedTools | `undefined` |
| isReadOnly | `false` |
| maxTurns | `20` |

**系统提示词要点**：完成任务后简洁报告结果。

### 4.2 Explore

| 属性 | 值 |
|------|-----|
| agentType | `"Explore"` |
| disallowedTools | `["Write", "Edit", "Agent"]` |
| isReadOnly | `true` |
| maxTurns | `20` |

**系统提示词要点**：快速搜索代码库，只读模式，不做修改。

### 4.3 Plan

| 属性 | 值 |
|------|-----|
| agentType | `"Plan"` |
| disallowedTools | `["Write", "Edit", "Agent"]` |
| isReadOnly | `true` |
| maxTurns | `20` |

**系统提示词要点**：探索代码库，设计实现方案，输出分步计划。

---

## 五、编排器设计

### 5.1 工具过滤

```typescript
function filterToolsForAgent(
  parentRegistry: ToolRegistry,
  agentDef: AgentDefinition,
): ToolRegistry
```

逻辑：
1. 获取父注册表的所有工具
2. 移除 `disallowedTools` 中的工具
3. 如果 `tools` 有定义（非 undefined），取交集
4. 注册到新的 ToolRegistry 并返回

### 5.2 runSubAgent

```typescript
async function runSubAgent(params: {
  agentDefinition: AgentDefinition;
  prompt: string;
  apiConfig: APIConfig;
  parentRegistry: ToolRegistry;
  context: ToolContext;
  maxTurns?: number;
}): Promise<AgentToolResult>
```

**执行流程**：

```
1. 构建过滤工具池
   filteredRegistry = filterToolsForAgent(parentRegistry, agentDef)

2. 构建子 Agent 的 APIConfig
   agentConfig = {
     ...apiConfig,
     systemPrompt: agentDef.getSystemPrompt(),
     tools: filteredRegistry.getToolDefinitions(),
   }

3. 构建初始消息
   messages = [createUserMessage(prompt)]

4. 进入 streaming loop
   for (turn = 0; turn < maxTurns; turn++) {
     if (signal.aborted) break

     // 调用 API
     stream = streamChat(messages, agentConfig, signal)
     { content, stopReason } = collectStreamResponse(stream)

     // 记录 assistant 消息
     messages.push(createAssistantMessage({ content, ... }))

     // 检查是否需要执行工具
     if (stopReason !== "tool_use") break

     // 执行工具
     toolResults = []
     for (toolUse of toolUseBlocks) {
       result = executeTool(filteredRegistry, toolUse.name, toolUse.input, context)
       toolResults.push({ type: "tool_result", ... })
     }

     // 记录 tool_result 消息
     messages.push(createUserMessage(toolResults))
   }

5. 提取最终文本
   content = 最后一条 assistant 消息中的 text blocks
   return { agentType, content, totalToolUseCount, totalDurationMs }
```

### 5.3 关键设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 同步 vs 异步 | 同步 | 简化实现，首期够用 |
| 取消传播 | 共享 AbortSignal | 父级取消时子 Agent 自然终止 |
| 权限 | 无独立权限检查 | 父级已授权 AgentTool，子工具集是预定义的安全子集 |
| 消息 | 内部维护，不暴露给父级 | Agent 的中间过程对用户透明 |
| 递归防护 | Explore/Plan 禁用 Agent 工具 + maxTurns | 双重保险 |

---

## 六、Tool 接口扩展（P4005）

### 6.1 ToolContext 扩展

```typescript
export interface ToolContext {
  workingDirectory: string;
  abortSignal: AbortSignal;
  apiConfig?: APIConfig;       // AgentTool 需要调用 streamChat
  toolRegistry?: ToolRegistry; // AgentTool 需要过滤工具
}
```

### 6.2 Tool 接口辅助方法

```typescript
interface Tool<T extends z.ZodType = z.ZodType> {
  // ... 现有方法 ...

  /** 是否为只读工具（可安全并行） */
  isReadOnly?(input: z.infer<T>): boolean;

  /** 是否可安全并发执行 */
  isConcurrencySafe?(input: z.infer<T>): boolean;

  /** 提取文件路径（用于并行冲突检测） */
  getPath?(input: z.infer<T>): string | undefined;
}
```

### 6.3 各工具实现

| 工具 | isReadOnly | isConcurrencySafe | getPath |
|------|-----------|-------------------|---------|
| FileReadTool | `true` | `true` | `input.file_path` |
| FileWriteTool | `false` | `false` | `input.file_path` |
| FileEditTool | `false` | `false` | `input.file_path` |
| BashTool | 动态判断 | `false` | - |
| GlobTool | `true` | `true` | - |
| GrepTool | `true` | `true` | - |
| AgentTool | `false` | `false` | - |

---

## 七、集成点

### 7.1 工具注册

```typescript
// src/tools/index.ts
import { AgentTool } from "./AgentTool/index.js";

export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  // ... 现有 6 个工具 ...
  registry.register(AgentTool);
  return registry;
}
```

### 7.2 ToolContext 传递

```typescript
// src/hooks/useStreamResponse.ts (line ~249)
const ctx: ToolContext = {
  workingDirectory: toolContext?.workingDirectory ?? process.cwd(),
  abortSignal: controller.signal,
  apiConfig: config,          // NEW
  toolRegistry: toolRegistry, // NEW
};
```

### 7.3 无需修改的模块

- `src/services/api.ts` — streamChat 已支持独立调用
- `src/messages.ts` — 消息类型已完备
- `src/components/App.tsx` — apiConfig.tools 通过 registry 动态生成

---

## 八、测试规划

### 8.1 测试文件

| 文件 | 测试内容 | 用例数 |
|------|---------|--------|
| `tests/unit/tools/agent/types.test.ts` | AgentDefinitionRegistry | 6-8 |
| `tests/unit/tools/agent/agentDefs.test.ts` | 内置 Agent 定义 | 6-8 |
| `tests/unit/tools/agent/orchestrator.test.ts` | 工具过滤 + runSubAgent | 10-12 |
| `tests/unit/tools/agent/agentTool.test.ts` | AgentTool 生命周期 | 6-8 |
| `tests/unit/tools/agent/helpers.test.ts` | isReadOnly/isConcurrencySafe/getPath | 6-8 |

### 8.2 Mock 策略

```typescript
// Mock streamChat，与现有 useStreamResponse.test.ts 一致
vi.mock("../../../src/services/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, streamChat: vi.fn() };
});
```

### 8.3 覆盖率目标

Agent 模块：70%+

---

## 九、文件结构

```
src/tools/AgentTool/
  types.ts         — 类型定义 + AgentDefinitionRegistry
  agentDefs.ts     — 3 个内置 Agent 定义
  prompt.ts        — LLM 可见的工具描述
  orchestrator.ts  — runSubAgent + filterToolsForAgent
  index.ts         — AgentTool 对象（实现 Tool 接口）

tests/unit/tools/agent/
  types.test.ts
  agentDefs.test.ts
  orchestrator.test.ts
  agentTool.test.ts
  helpers.test.ts
```
