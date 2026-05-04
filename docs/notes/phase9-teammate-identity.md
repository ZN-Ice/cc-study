# Phase 9 源码研读：Teammate 身份与上下文隔离

> 参考源码：`free-code/src/utils/teammate.ts`, `free-code/src/utils/teammateContext.ts`

## 1. 概述

Teammate 是 Claude Code 的多 Agent 协作机制的核心概念。每个 Claude Code 实例通过**身份标识**（agent ID）判断自己是"独立的用户会话"还是"团队中的队员"。上下文隔离通过两层机制实现：

- **AsyncLocalStorage**：进程内队员（in-process teammate）的并发上下文隔离
- **dynamicTeamContext**：进程级队员（tmux/iTerm2 启动的独立进程）的动态运行时状态

两层配合使同一个进程既能充当团队领导，又能同时运行多个队员，而不会发生状态冲突。

## 2. 三层身份解析优先级

自由代码实现了三层优先级结构，`getAgentId()` / `getAgentName()` 按以下顺序查找：

```
1. AsyncLocalStorage (teammateContext.ts)  ← 进程内队员
     ↓ 无
2. dynamicTeamContext (模块级状态)         ← tmux 队员加入时设置
     ↓ 无
3. 环境变量 (CLAUDE_CODE_AGENT_ID)        ← tmux 队员启动时设置
     ↓ 无
  → undefined (独立会话)
```

### 2.1 AsyncLocalStorage — `teammateContext.ts`

```typescript
// 核心类型
type TeammateContext = {
  agentId: string          // "researcher@my-team"
  agentName: string        // "researcher"
  teamName: string         // "my-team"
  color?: string           // UI 颜色
  planModeRequired: boolean
  parentSessionId: string  // 领导 session ID
  isInProcess: true        // 区分标志
  abortController: AbortController
}

// AsyncLocalStorage 实例
const storage = new AsyncLocalStorage<TeammateContext>()

// 关键函数
getTeammateContext(): TeammateContext | undefined
runWithTeammateContext(ctx, fn): T  // 在指定上下文中执行 fn
isInProcessTeammate(): boolean
createTeammateContext(config): TeammateContext
```

**关键设计**：`runWithTeammateContext()` 为每个队员提供独立的 `AbortController`，使队员的中断不影响其他队员或领导。AbortController 作为上下文的一部分存储，队员的运行循环通过 `context.abortSignal.aborted` 检查是否被中止。

### 2.2 dynamicTeamContext — `teammate.ts`

模块级可变状态，在团队领导调用 `TeamCreateTool` 时设置，在离开团队时清除：

```typescript
let dynamicTeamContext: {
  agentId: string
  agentName: string
  teamName: string
  color?: string
  planModeRequired: boolean
  parentSessionId?: string
} | null = null
```

## 3. 身份判断逻辑

### 3.1 `isTeammate()` — 我是否是队员？

```typescript
function isTeammate(): boolean {
  // 优先检查：是否在 in-process 队员上下文中
  if (isInProcessTeammate()) return true
  // 其次：是否设置了动态团队上下文（需要 agentId AND teamName）
  return !!(dynamicTeamContext?.agentId && dynamicTeamContext?.teamName)
}
```

### 3.2 `isTeamLead()` — 我是否是团队领导？

判断逻辑更复杂，需要传入 teamContext（包含 `leadAgentId`）：

```typescript
function isTeamLead(teamContext: { leadAgentId: string } | undefined): boolean {
  if (!teamContext?.leadAgentId) return false

  const myAgentId = getAgentId()
  // 方式 1：我的 agent ID 匹配 leadAgentId
  if (myAgentId === teamContext.leadAgentId) return true
  // 方式 2：向后兼容 — 没有 agent ID 但有团队上下文
  // 说明这是最初创建团队的那个 session（领导）
  if (!myAgentId) return true
  return false
}
```

这个"双重识别"机制解决了 tmux 中团队领导的兼容性问题：最初创建团队的 session 可能没有设置 agent ID（旧版本），但仍然应该被视为领导。

## 4. 简化设计（cc-study 版）

相比 free-code 完整实现，cc-study 做了以下简化：

| 方面 | free-code | cc-study |
|------|-----------|----------|
| 进程模型 | tmux/iTerm2 + in-process | 仅 in-process |
| 状态管理 | AppState (React) | 模块级变量 |
| 环境变量 | CLAUDE_CODE_AGENT_ID 等 | 不需要 |
| dynamicTeamContext 设置 | TeamCreateTool 通过 setAppState | 直接调用 setDynamicTeamContext() |
| hasActiveInProcessTeammates | 检查 AppState.tasks | 简化（未实现） |
| planModeRequired | 环境变量 + context | 仅 context |

## 5. 学习心得

1. **AsyncLocalStorage 的精妙之处**：它不是简单的全局变量替代。当多个队员在同一个进程中并发运行时，每个队员通过 `runWithTeammateContext()` 获得独立的执行上下文，如同自己运行在独立的 Node.js 进程中。

2. **优先级链的必要性**：三种身份来源按优先级排列，使系统能正确处理"tmux 队员加入已有团队"这种场景。

3. **向后兼容的代价**：`isTeamLead()` 中的 `!myAgentId` 回退逻辑是个典型的技术债务，但在没有强制 agent ID 的早期版本中是必要的。

4. **isolated AbortController**：每个队员有独立的 AbortController（不链接到领导的），确保领导 query 中断时队员继续运行。这是设计中的关键决策——中断领导不等于中断队员。
