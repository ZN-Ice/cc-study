# Phase 9 Teammate 身份概念辨析

> 基于 `docs/notes/phase9-teammate-identity.md` 的研读，回答三组核心概念的关系与差异。

---

## 问题：独立的用户会话 vs 团队中的队员 vs 进程内队员 vs 进程级队员

### 前置：三层身份解析优先级

理解这些概念之前，必须先理解 `getAgentId()` / `getAgentName()` 的三层优先级链：

```
1. AsyncLocalStorage (teammateContext.ts)  ← 进程内队员（最高优先级）
     ↓ 无
2. dynamicTeamContext (模块级状态)         ← tmux 队员加入时设置
     ↓ 无
3. 环境变量 (CLAUDE_CODE_AGENT_ID)        ← tmux 队员启动时设置
     ↓ 无
  → undefined (独立会话，最低优先级)
```

---

## 1. 独立用户会话 (Independent User Session)

**定义**：三层优先级链全部未命中，`getAgentId()` 返回 `undefined` 的 Claude Code 实例。

**判定逻辑**：

```typescript
// 等价于
getAgentId() === undefined
isTeammate() === false      // 既不在 in-process context，也没有 dynamicTeamContext
isTeamLead() === false       // 没有 leadAgentId
```

**特征**：

| 维度 | 值 |
|------|-----|
| agentId | `undefined` |
| teamName | 无 |
| 上下文隔离 | 不需要（只有一个自己） |
| 通信对象 | 无 teammate，只与用户对话 |
| AbortController | 自己管理，不与其他 entity 共享 |
| 角色 | 纯粹的用户-助手交互 |

**典型场景**：用户打开一个 Claude Code 终端，直接输入对话。这是最基础的模式。

---

## 2. 团队中的队员 (Teammate in a Team) — 抽象概念

**定义**：这是一个**逻辑概念**，泛指所有 `isTeammate() === true` 的 entity。不是一个具体的实现层次。

**判定逻辑**：

```typescript
function isTeammate(): boolean {
  // 方式 1：在 in-process 队员上下文中
  if (isInProcessTeammate()) return true
  // 方式 2：有动态团队上下文（需要 agentId AND teamName）
  return !!(dynamicTeamContext?.agentId && dynamicTeamContext?.teamName)
}
```

**关键认知**："团队中的队员"不是一个具体的进程模型，而是一个**身份标识概念**。它的两个具体实现形式就是下面要讲的"进程内队员"和"进程级队员"。

**队员的共同特征**：

- 都有 `agentId`（如 `"researcher@my-team"`）
- 都有 `teamName`（如 `"my-team"`）
- 都不等于 `leadAgentId`（否则就是领导）
- 都有独立的 AbortController（不链接到领导）
- 都通过某种 Mailbox 与团队成员通信
- 都是"一等公民"（first-class citizen），不是领导的 subtask

**队员 vs 领导的判定**：

```typescript
function isTeamLead(teamContext): boolean {
  // 方式 1：agentId 精确匹配 leadAgentId
  if (getAgentId() === teamContext.leadAgentId) return true
  // 方式 2：向后兼容 — 没有 agentId 但有 TeamContext
  // 说明这是最初创建团队的那个 session（领导）
  if (!getAgentId()) return true
  return false
}
```

---

## 3. 进程内队员 (In-Process Teammate) — AsyncLocalStorage 实现

**定义**：与领导在**同一个 Node.js 进程**中运行的队员，通过 `AsyncLocalStorage` 实现并发上下文隔离。

**身份来源**：三层优先级链的**第 1 层** — `teammateContext.ts` 中的 AsyncLocalStorage。

**核心机制**：

```typescript
// teammateContext.ts 的核心类型
type TeammateContext = {
  agentId: string              // "researcher@my-team"
  agentName: string            // "researcher"
  teamName: string             // "my-team"
  isInProcess: true            // 区分标志
  parentSessionId: string      // 领导 session ID
  abortController: AbortController  // 独立的！
}

// AsyncLocalStorage 实例
const storage = new AsyncLocalStorage<TeammateContext>()

// 进入队员上下文
function runWithTeammateContext(ctx: TeammateContext, fn: () => T): T {
  return storage.run(ctx, fn)
}

// 读取当前上下文
function getTeammateContext(): TeammateContext | undefined {
  return storage.getStore()
}
```

**关键特征**：

| 维度 | 进程内队员 |
|------|-----------|
| 进程模型 | 与领导**共享同一个** Node.js 进程 |
| 上下文隔离 | `AsyncLocalStorage` 自动为每个队员提供独立存储空间 |
| 并发安全 | 多个队员并发执行，各自的 `getAgentId()` 返回各自的值，不会串台 |
| AbortController | **完全独立**，不链接到领导的 AbortController。领导 abort 不会自动终止队员 |
| 通信方式 | 内存 Mailbox（`mailbox.ts`）— 进程内事件队列 |
| 生命周期 | 由 `spawnInProcessTeammate()` 创建，`runInProcessTeammateLoop()` 驱动运行循环 |
| `parentSessionId` | 有，指向领导的 session |

**为什么 AsyncLocalStorage 如此精妙？**

它不是简单的全局变量替代。当多个队员在同一进程中并发运行时：

```typescript
// 队员 A 和队员 B 在同一个进程中并发运行
await Promise.all([
  runWithTeammateContext(ctxA, async () => {
    // ctxA.agentId = "researcher@my-team"
    console.log(getAgentId()) // → "researcher@my-team"
  }),
  runWithTeammateContext(ctxB, async () => {
    // ctxB.agentId = "test-runner@my-team"
    console.log(getAgentId()) // → "test-runner@my-team"
  }),
])
```

每个队员通过 `runWithTeammateContext()` 获得独立的执行上下文，**如同自己运行在独立的 Node.js 进程中**。这是 Node.js `AsyncLocalStorage` 在并发场景下的经典应用。

**独立的 AbortController 是设计的核心决策**：

```typescript
// ❌ 不是这样（链接到领导）
const abortController = new AbortController(leaderAbortController.signal)

// ✅ 是这样（完全独立）
const abortController = new AbortController()
```

这意味着：
- 领导 Ctrl+C 不会自动杀死队员
- 队员可以独立完成工作
- 领导必须通过 `send_message('shutdown_request')` 优雅关闭队员

---

## 4. 进程级队员 (Process-Level Teammate) — dynamicTeamContext / 环境变量实现

**定义**：在**独立进程**中运行的队员，通过 tmux pane 或 iTerm2 window 启动。身份来源可以是模块级变量或环境变量。

**身份来源**：三层优先级链的**第 2 层**（`dynamicTeamContext`）或**第 3 层**（环境变量 `CLAUDE_CODE_AGENT_ID`）。

### 4.1 dynamicTeamContext（第 2 层）

模块级可变状态，由团队领导在调用 `TeamCreateTool` 时设置：

```typescript
// teammate.ts 中的模块级变量
let dynamicTeamContext: {
  agentId: string
  agentName: string
  teamName: string
  color?: string
  planModeRequired: boolean
  parentSessionId?: string
} | null = null
```

设置时机：领导通过 `TeamCreateTool` → `setAppState()` → 触发 `setDynamicTeamContext()`。

清除时机：队员离开团队时。

### 4.2 环境变量 CLAUDE_CODE_AGENT_ID（第 3 层）

当 tmux/iTerm2 pane 启动时，从环境变量中读取：

```bash
# tmux 启动时设置
CLAUDE_CODE_AGENT_ID="researcher@my-team" claude
```

这是最"外部"的身份来源，用于跨进程场景。

### 关键特征对比

| 维度 | 进程内队员 | 进程级队员 |
|------|-----------|-----------|
| 进程模型 | 共享同一个 Node.js 进程 | 独立的 Node.js 进程（不同 tmux pane） |
| 身份来源 | AsyncLocalStorage（第 1 层） | dynamicTeamContext（第 2 层）或环境变量（第 3 层） |
| 上下文隔离 | AsyncLocalStorage 自动隔离 | 天然隔离（不同进程） |
| 通信方式 | 内存 Mailbox | **文件 Mailbox**（JSON 文件 + 文件锁） |
| AbortController | 独立，不链接领导 | 独立进程，天然隔离 |
| 启动方式 | `spawnInProcessTeammate()` | tmux/iTerm2 创建新 pane |
| 关闭方式 | `shutdown_request` → `abortController.abort()` | `shutdown_request` → 带 `paneId` 关闭 pane |
| cc-study 实现 | ✅ 已实现 | ❌ 简化掉（仅 in-process） |

**进程级队员的文件 Mailbox 通信**：

```
~/.claude/teams/{team_name}/
└── inboxes/
    ├── researcher.json    ← TeammateMessage[]（队员的收件箱）
    ├── test-runner.json
    └── team-lead.json     ← 领导的收件箱
```

每个 inbox 文件是一个 `TeammateMessage[]` JSON 数组，通过 `proper-lockfile`（带指数退避重试）实现并发安全。这是**文件-based RPC**，无需网络协议。

---

## 5. 三者差异总结表

| 维度 | 独立用户会话 | 进程内队员 | 进程级队员 |
|------|------------|-----------|-----------|
| **概念层次** | 最基础模式 | "团队中的队员"的具体实现之一 | "团队中的队员"的具体实现之一 |
| **身份来源** | 无（三层全未命中） | AsyncLocalStorage（第 1 层） | dynamicTeamContext（第 2 层）或环境变量（第 3 层） |
| **agentId** | `undefined` | `"researcher@my-team"` | `"researcher@my-team"` |
| **teamName** | 无 | `"my-team"` | `"my-team"` |
| **进程模型** | 独立进程 | 与领导共享进程 | 独立进程（tmux pane） |
| **上下文隔离** | 不需要 | AsyncLocalStorage | 进程天然隔离 |
| **通信方式** | 无 | 内存 Mailbox | 文件 Mailbox（JSON + 锁） |
| **AbortController** | 自己管理 | 独立，不链接领导 | 独立进程 |
| **isTeammate()** | `false` | `true` | `true` |
| **isTeamLead()** | `false` | `false`（除非 ID 匹配 leadAgentId） | `false`（除非 ID 匹配 leadAgentId） |
| **parentSessionId** | 无 | 有（指向领导） | 可选 |
| **cc-study 支持** | ✅ | ✅ | ❌ 简化掉 |

---

## 6. 优先级链的设计意图

三层优先级不是随意排列的，每一层都有明确的设计意图：

```
AsyncLocalStorage（第 1 层）
  ↓ 意图：进程内有队员在跑时，以 AsyncLocalStorage 为准。
          因为这是最"近"的、最精确的身份来源。

dynamicTeamContext（第 2 层）
  ↓ 意图：tmux teammate 加入现有团队后，通过 setAppState 同步身份。
          比环境变量更精确，因为它是在运行时动态设置的。

环境变量（第 3 层）
  ↓ 意图：tmux pane 启动时没有 AppState，只能通过环境变量注入身份。
          这是最"远"的、最基础的身份来源。

undefined（独立会话）
  ↓ 意图：三层全空 = 这就是一个普通用户会话。
```

这个优先级链确保了一个巧妙的场景：**当领导同时运行了 in-process 队员和 tmux 队员时**，各自的身份解析不会互相干扰 — in-process 队员走第 1 层，tmux 队员走第 2/3 层。

---

## 7. 学习心得

1. **"队员"是逻辑概念，不是物理概念**：进程内队员和进程级队员是同一抽象概念的两种物理实现。理解这一点才能理解为什么 `isTeammate()` 检查两个来源，为什么 Mailbox 有两层实现（内存 + 文件）。

2. **AsyncLocalStorage 是 Node.js 并发编程的利器**：它让"同一个进程中的多个队员"这件事变得可行，否则管理并发上下文会极其痛苦。

3. **独立的 AbortController 是设计哲学**："队员不是领导的 subtask，而是平等的协作者"。这个决策影响了整个系统的行为 — 领导中断不中断队员，关闭需要握手协议。

4. **优先级链是向后兼容的产物**：第 3 层的环境变量和第 2 层的 dynamicTeamContext 本质是同一件事的两种表达，只是因为历史演进出现了两层。

5. **cc-study 的简化是合理的**：砍掉进程级队员（tmux/iTerm2）大幅简化了复杂性 — 不需要文件锁、不需要 pane 管理、不需要环境变量注入。对于学习和原型验证来说，in-process 已经足够展示核心设计。
