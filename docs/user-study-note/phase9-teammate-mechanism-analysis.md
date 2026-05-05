# Phase 9 Teammate 机制深度分析

> 综合 `phase9-teammate-identity.md`、`phase9-teammate-mailbox.md`、`phase9-teammate-tools.md` 三篇笔记，对 Teammate 多 Agent 协作机制进行全面分析。

---

## 一、什么是 Teammate 机制

### 1.1 一句话定义

Teammate 是 Claude Code 的**多 Agent 协作框架**。它允许一个 Claude Code 实例（领导）创建多个专门的子 Agent（队员），这些队员作为"一等公民"（first-class citizen）独立运行，通过 Mailbox 系统互相通信，协同完成复杂任务。

### 1.2 核心设计哲学：队员是协作者，不是 Sub-task

这是 Teammate 与 Fork Subagent（Phase 4 的 AgentTool）最根本的区别：

```
Fork Subagent 模式（Phase 4）:
  主 Agent → spawn 子 Agent → 等待结果 → 继续
  子 Agent 是"一次性工具调用"，生命周期绑定到父 Agent

Teammate 模式（Phase 9）:
  领导 (Leader) ←→ 队员 A (researcher)
               ←→ 队员 B (test-runner)
  队员是"持久化协作者"，有独立生命周期
```

### 1.3 系统全景图

```
┌─────────────────────────────────────────────────────────────────┐
│                      Team System Architecture                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐     TeamFile (磁盘)      ┌──────────────────┐     │
│  │  Leader  │◄──────────────────────►│   Teammate A      │     │
│  │ (用户)    │    ~/.claude/teams/     │  (researcher)     │     │
│  │          │    {team}/              │  进程内/进程级     │     │
│  │  • 创建团队 │                        │  • 独立上下文      │     │
│  │  • 分发任务 │   ┌──────────────┐    │  • 独立 AbortCtrl  │     │
│  │  • 权限审批 │   │  Inboxes/    │    │  • 受限制工具集    │     │
│  │  • 关闭队员 │   │  ├ leader/   │    └────────┬─────────┘     │
│  └──────────┘    │  ├ researcher/│             │               │
│                   │  └ test-run/ │    ┌────────┴─────────┐     │
│  ┌──────────┐    └──────────────┘    │   Teammate B      │     │
│  │  用户 UI  │                        │  (test-runner)    │     │
│  │ 权限确认   │                        │  进程内/进程级     │     │
│  │ 状态查看   │                        │  • 独立上下文      │     │
│  └──────────┘                        │  • 独立 AbortCtrl  │     │
│                                       └──────────────────┘     │
│                                                                  │
│  通信层：内存 Mailbox (进程内) + 文件 Mailbox (跨进程)           │
│  状态层：TeamFile (磁盘持久化) + AppState (内存)                 │
│  身份层：AsyncLocalStorage + dynamicTeamContext + 环境变量       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、三根支柱：身份、通信、工具

Teammate 机制建立在三个核心子系统之上：

### 2.1 身份系统（Identity）

让每个 entity 知道"我是谁、我在哪个团队、我的角色是什么"。

**三层优先级链**：

```
AsyncLocalStorage (第1层, 进程内队员)
  → dynamicTeamContext (第2层, tmux 队员动态注入)
    → 环境变量 (第3层, tmux 队员启动注入)
      → undefined (独立会话)
```

**角色判定**：

| 函数 | 独立会话 | 队员 | 领导 |
|------|---------|------|------|
| `getAgentId()` | `undefined` | `"researcher@my-team"` | `"lead@my-team"` |
| `isTeammate()` | `false` | `true` | `true` (也在团队中) |
| `isTeamLead(ctx)` | `false` | `false` | `true` |

详细分析见 [phase9-teammate-identity-analysis.md](./phase9-teammate-identity-analysis.md)。

### 2.2 通信系统（Mailbox）

两层 Mailbox 实现队员间消息传递：

```
内存 Mailbox (mailbox.ts)
  ├── Actor-Pattern 消息队列
  ├── Waiter 优先级（等待者优先于队列）
  ├── Signal 发布/订阅
  └── 用途：进程内组件间通信

文件 Mailbox (teammateMailbox.ts)
  ├── JSON 文件持久化 (~/.claude/teams/{team}/inboxes/)
  ├── 文件锁 (proper-lockfile + 指数退避)
  ├── 读/未读状态追踪
  └── 用途：跨进程队员间通信
```

**12 种结构化协议消息**：

| 消息类型 | 方向 | 用途 |
|---------|------|------|
| `regular` | 任意 ↔ 任意 | 普通队员间消息 |
| `idle_notification` | 队员 → 领导 | 队员完成任务，空闲等待 |
| `permission_request` | 队员 → 领导 | 队员请求权限确认 |
| `permission_response` | 领导 → 队员 | 领导批准/拒绝权限 |
| `shutdown_request` | 领导 → 队员 | 要求队员关闭 |
| `shutdown_approved` | 队员 → 领导 | 同意关闭 |
| `shutdown_rejected` | 队员 → 领导 | 拒绝关闭 |
| `plan_approval_request` | 队员 → 领导 | 请求计划批准 |
| `plan_approval_response` | 领导 → 队员 | 批准/拒绝计划 |
| `task_assignment` | 领导 → 队员 | 分配新任务 |
| `team_permission_update` | 领导 → 全员 | 广播权限规则变更 |
| `mode_set_request` | 领导 → 队员 | 设置权限模式 |

**关闭握手协议（Shutdown Handshake）**：

```
领导                        队员
  │                          │
  ├─ shutdown_request ──────►│  写入队员 inbox
  │                          │  队员检测到请求
  │                          │  判断是否有未完成工作
  │◄── shutdown_approved ────┤  有未完成工作则拒绝
  │        OR                │
  │◄── shutdown_rejected ────┤  同意关闭则批准
  │                          │
```

**结构化消息检测**：

```typescript
function isStructuredProtocolMessage(text: string): boolean {
  // JSON 检测 + type 字段匹配已知协议类型
  // 关键作用：协议消息被路由到特定 handler，
  // 而不是被当作普通聊天消息放进 LLM 上下文
}
```

这个函数的存在揭示了设计中的一个二义性问题：同一个 inbox 文件既包含人类可读的普通消息，也包含机器协议消息，必须通过 `type` 字段区分。

### 2.3 工具系统（Team Tools）

三个核心工具构成团队操作入口：

#### 2.3.1 TeamCreateTool — 创建团队

```typescript
// 执行流程
1. 检查重名 → 2. 生成 teamId → 3. 构建 TeamFile
→ 4. 写入磁盘 → 5. 初始化 inbox 目录 → 6. 切换 context 为 team-lead
```

关键设计：Leader **不设置** `CLAUDE_CODE_AGENT_ID` 环境变量，而是通过 `AppState.teamRole = 'lead'` 标识。环境变量是给 tmux/iTerm2 远程 pane 用的。

#### 2.3.2 SendMessageTool — 消息路由

```typescript
路由规则:
  to="*"          → 广播给所有成员
  to="team-lead"  → 发给领导
  to="uds:..."    → UDS socket（cc-study 不实现）
  to="bridge:..." → Bridge 跨主机（cc-study 不实现）
  to="agent-name" → 发给指定队员
```

#### 2.3.3 In-Process Spawn — 进程内队员启动

这是整个 Team 系统最复杂的部分（free-code 中 `inProcessRunner.ts` 有 1552 行）：

```typescript
spawnInProcessTeammate(teamId, agent, leaderAbortCtrl):
  1. 生成唯一 agentId
  2. 创建**独立**的 AbortController（不链接到领导）
  3. 构建 TeammateContext（隔离的消息历史、工作目录、权限模式）
  4. 注册到 AppState（队员是"一等公民"）
  5. 启动独立任务循环

runInProcessTeammateLoop():
  while (!abortSignal.aborted):
    1. 从 team inbox 读取消息
    2. 调用 streamChat (与领导相同的 API 模式)
    3. 处理 tool_use blocks (权限检查 → 请求领导 → 执行工具)
    4. idle 时发送 idle_notification
```

**防递归保护**：队员的工具集中**禁用** `Agent` 和 `team_create`，防止队员再创建子 Agent。

**权限同步**：队员不能独立决定工具权限，必须通过 inbox 文件请求领导批准 — 这是一种 **文件-based RPC**，无需网络协议。

```
Teammate                         Leader
    │                               │
    │  写: inbox/leader/req.json    │
    │ ─────────────────────────────►│
    │                               │  [用户确认 UI]
    │  读: inbox/leader/req.json    │
    │ ◄─────────────────────────────│
    │                               │
    │  写: inbox/teammate/res.json  │
    │ ─────────────────────────────►│
    │                               │
    │  读: inbox/teammate/res.json  │
    │ ◄─────────────────────────────│
```

---

## 三、使用方式

### 3.1 典型使用流程

```
用户 ("创建一个研究团队来帮我分析这个项目")
        │
        ▼
Leader Agent 调用 team_create
  ├── name: "research-team"
  ├── agents: [
  │     { name: "researcher", agentType: "general", tools: [...] },
  │     { name: "test-runner", agentType: "general", tools: [...] }
  │   ]
        │
        ▼
TeamFile 写入磁盘 (~/.claude/teams/research-team/team.json)
        │
        ▼
Leader 发送任务
  ├── send_message(to="researcher", "请分析 src/ 目录的代码架构")
  └── send_message(to="test-runner", "请为 src/tools/ 编写测试")
        │
        ▼
队员并行工作
  ├── researcher: 读取文件 → 分析 → 发送报告给 leader
  └── test-runner: 读源码 → 写测试 → 发送结果给 leader
        │
        ▼
队员 idle_notification → leader 收到后可以分配新任务或关闭
        │
        ▼
Leader 关闭团队 → shutdown_request → shutdown_approved → 清理
```

### 3.2 队员角色定义

```typescript
// 定义队员的能力范围
interface AgentDefinition {
  id: string               // "researcher"
  name: string             // "researcher"
  agentType: string        // "general" | "explore" | ...
  tools: string[]          // 可用工具白名单
  // Team worker 默认工具集：
  // Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch
  // 明确排除: Agent, team_create
  backend?: 'in-process'   // cc-study 仅支持 in-process
}
```

### 3.3 消息交互模式

**广播模式**：领导向所有队员发送同一消息。

```typescript
send_message({ to: "*", message: "请注意，权限策略已更新" })
```

**定向模式**：向特定队员发送指令。

```typescript
send_message({ to: "researcher", message: "请深入分析 auth 模块" })
```

**汇报模式**：队员完成工作后向领导汇报。

```typescript
send_message({ to: "team-lead", message: "auth 模块分析完成，发现 3 个潜在问题" })
```

**协议模式**：系统自动处理的结构化消息（权限请求、关闭握手等），用户不必关心。

---

## 四、相比普通会话的优势

### 4.1 并行处理能力

| 普通会话 | Teammate 模式 |
|---------|--------------|
| 串行执行，一次只能做一件事 | 多个队员并行工作 |
| "先分析代码，再写测试" | 分析代码和写测试同时进行 |

```typescript
// 普通会话：串行
await analyzeCode()    // 30s
await writeTests()     // 20s
// 总耗时: 50s

// Teammate 模式：并行
await Promise.all([
  researcher.analyzeCode(),   // 30s
  testRunner.writeTests()     // 20s
])
// 总耗时: 30s (节省 40%)
```

### 4.2 专业化分工

每个队员可以是专门化的 Agent 类型，拥有不同的 prompt 和工具集：

```
普通会话: 一个 LLM 做所有事（分析 + 编码 + 测试 + 搜索）
  └── 问题：角色切换需要额外的 prompt 工程，且上下文混乱

Teammate: 每个队员专门化
  ├── researcher:  探索型 prompt + Grep/Glob 工具
  ├── implementer:  工程型 prompt + Write/Edit/Bash 工具
  └── test-runner:  测试型 prompt + Bash/Test 工具
```

### 4.3 独立的上下文窗口

```
普通会话:
  ┌─────────────────────────────────────┐
  │ 单一上下文窗口 (200K tokens)          │
  │ 分析代码 + 写测试 + 修Bug 全塞一起    │
  │ 上下文爆炸 → 需要 /compact            │
  └─────────────────────────────────────┘

Teammate:
  ┌──────────────────┐  ┌──────────────────┐
  │ researcher 上下文  │  │ test-runner 上下文 │
  │ 只看代码分析相关    │  │ 只看测试相关      │
  │ 上下文更干净        │  │ 上下文更干净      │
  └──────────────────┘  └──────────────────┘
  各自独立，互不污染
```

### 4.4 持久化团队与状态恢复

```typescript
// TeamFile 存储团队状态
interface TeamFile {
  id: string
  name: string
  members: AgentDefinition[]
  leadAgentId: string
  isActive: boolean           // 运行时状态
  lastActivity: number        // 运行时状态
  status: 'running' | 'paused' | 'shutdown'
}
```

这意味着：
- 团队可以在会话间**持久化**
- 关闭终端后可以**恢复**团队状态
- 可以实现"团队快照"用于审计

### 4.5 细粒度生命周期控制

普通会话中，Ctrl+C 中止一切。Teammate 中：

```
领导中止 ≠ 队员中止
  ├── 领导的 AbortController 不链接到队员
  ├── 队员继续工作，不受影响
  └── 需要关闭队员时使用 shutdown_request（优雅关闭）
```

### 4.6 权限代理

队员没有独立的权限决策权，需要时向领导请求：

```
队员: "我需要执行 npm install，请批准"
  → 写入 permission_request 到领导 inbox
    → 领导 UI 弹出确认
      → 用户批准
        → 写入 permission_response 到队员 inbox
          → 队员执行命令
```

这比普通会话中的直接权限确认更安全，因为领导可以审查队员的每一个高风险操作。

---

## 五、相比普通会话的劣势

### 5.1 更高的复杂度

| | 普通会话 | Teammate 模式 |
|------|---------|--------------|
| 代码量 | 基础 REPL 循环 | + 身份系统 + Mailbox + Team Tools + inProcessRunner (1552行) |
| 需要理解的概念 | 消息 → API → 响应 | + 身份优先级 + 文件锁 + 结构化协议 + 权限同步 |
| 调试难度 | 单一进程 | 多 entity 并发，状态分布在多个文件和 AppState 中 |

### 5.2 文件锁的开销与风险

文件 Mailbox 依赖 `proper-lockfile` 进行并发控制：

```
问题场景:
  队员 A 写入 inbox/leader/req-1.json
  队员 B 同时写入 inbox/leader/req-2.json
  └── 如果没锁：读-改-写的竞态条件 → 消息丢失
  
  proper-lockfile 解决方案:
  锁 → 读 → 追加 → 写 → 释放锁
  └── 代价：指数退避重试（最多 10 次，5-100ms 间隔）
     → 最坏延迟 1000ms+ 的锁等待
```

对于高频消息场景，文件锁会成为性能瓶颈。

### 5.3 结构化消息的二义性陷阱

同一个 inbox 文件混合了普通消息和 JSON 协议消息：

```json
// inbox/researcher.json
[
  { "from": "leader", "text": "请分析 auth 模块", ... },           // 普通消息
  { "from": "leader", "text": "{\"type\":\"shutdown_request\"}", ... }, // 协议消息
  { "from": "leader", "text": "好的，注意检查 getUser 函数", ... }     // 普通消息
]
```

`isStructuredProtocolMessage()` 必须准确区分这两类消息。如果一条普通消息恰好包含 JSON 字符串，可能被误判。这是一个需要谨慎处理的边界条件。

### 5.4 上下文切换的成本

虽然队员有独立的上下文窗口，但队员之间的**知识传递**需要显式的消息交换：

```
普通会话: LLM 自己记住所有上下文
  └── 隐式知识传递，无需额外开销

Teammate: 
  researcher 发现: "auth 模块使用 JWT，secret 在 env.AUTH_SECRET"
  需要显式地 send_message(to="test-runner", "auth 模块使用 JWT...")
  └── 知识传递需要额外通信成本和 token 消耗
```

### 5.5 资源消耗更大

```
普通会话:
  ├── 1 个 API 连接
  ├── 1 份上下文窗口的 token 消耗
  └── 1 个进程

3 人团队:
  ├── 3 个 API 连接（如果是独立进程）
  ├── 3 份上下文窗口的 token 消耗（可能是 3×200K = 600K tokens）
  └── 3 个进程（或 1 个进程 + AsyncLocalStorage 管理的 3 个上下文）
```

### 5.6 清理链的脆弱性

```typescript
// 清理顺序至关重要
async function cleanupTeam():
  1. killPane(paneId)       // 必须先关闭 pane
  2. sendShutdownRequest()  // 优雅关闭 in-process
  3. sleep(500)             // 等待清理完成
  4. rmrf(teamDir)          // 最后删目录

// 如果顺序错了（先删目录再杀 pane）
// → zombie 进程：pane 还在运行但目录已删除
```

### 5.7 任务分配没有自动负载均衡

```
普通会话: LLM 自己决定做什么、什么时候做
  └── "智能调度"（虽然可能有局限）

Teammate: 领导必须显式分配任务
  ├── 领导不知道队员是否空闲（需要 idle_notification 轮询）
  ├── 领导不知道队员的能力边界
  └── 如果 leader 给 researcher 分配了 test-runner 的任务 → 浪费
```

---

## 六、设计权衡总结

| 维度 | 普通会话 | Teammate 模式 | 权衡判断 |
|------|---------|--------------|---------|
| **并行度** | 1（串行） | N（队员数） | Teammate 明显胜出 |
| **专业化** | 通用 LLM | 专门化 Agent | Teammate 胜出 |
| **上下文效率** | 单一窗口，容易爆炸 | 多个独立窗口 | Teammate 胜出 |
| **复杂性** | 低 | 高（三根支柱） | 普通会话胜出 |
| **调试难度** | 低 | 高（并发 + 文件锁） | 普通会话胜出 |
| **资源消耗** | 低 | N 倍于队员数 | 普通会话胜出 |
| **故障隔离** | 无（一出错全停） | 部分（队员独立） | Teammate 胜出 |
| **知识传递** | 隐式（LLM 内部） | 显式（消息通信） | 普通会话胜出 |
| **权限安全** | 用户直接确认 | 领导审查代理 | Teammate 胜出 |

**核心洞察**：Teammate 用**更高的系统复杂度**交换了**并行能力、专业化和故障隔离**。它适合的任务场景是：
- 大型代码库的**并行分析**
- 多个**独立子任务**（分析 + 测试 + 文档可以同时进行）
- 需要**持久化团队**的长期项目

不适合的场景：
- 简单的单步任务（杀鸡用牛刀）
- 强依赖型的任务链（每一步依赖上一步的结果）
- 对资源消耗敏感的场景

---

## 七、学习心得

1. **Teammate ≠ Fork Subagent**：Fork 是一次性的工具调用，Teammate 是持久化的协作关系。这个区分影响了 AbortController 的设计（独立 vs 链接）、通信方式（结果返回 vs 双向 Mailbox）和生命周期管理。

2. **文件锁是分布式系统第一课**：多个进程写同一个 JSON 文件 — 没有锁就是竞态条件。proper-lockfile 的指数退避重试是生产级文件锁的标准做法，cc-study 简化掉了这一层。

3. **AbortController 独立是架构哲学**："队员不是领导的下属，而是协作者"。这个决策导致了 Shutdown Handshake 协议的诞生 — 关闭需要协商，不能强制。

4. **文件-based RPC 是巧妙的**：无需网络协议，通过 JSON 文件 + 文件锁实现了请求-响应模式。虽然不是最高效的方案，但对于 CLI 工具来说足够实用。

5. **cc-study 的简化是合理的**：砍掉 tmux/iTerm2 后端、UDS/Bridge 扩展、文件锁、权限同步等，保留了身份系统和内存 Mailbox 的核心设计。这对于理解 Teammate 的本质已经足够。

---

## 八、是否默认开启？

**不是。Teammate 功能不是默认开启的。**

### 8.1 默认状态

启动 Claude Code 时，身份解析三层优先级链全部未命中：

```
启动 claude
  │
  ├─ AsyncLocalStorage → 无（没有 runWithTeammateContext 包裹）
  ├─ dynamicTeamContext → null（没有 TeamCreateTool 设置过）
  └─ CLAUDE_CODE_AGENT_ID → 未设置
  │
  └─→ getAgentId() === undefined → 独立用户会话
```

此时 `isTeammate()` 返回 `false`，系统就是一个普通的单 Agent REPL，没有任何 Teammate 机制在运行。

### 8.2 进入 Teammate 模式的触发条件

Teammate 模式是**按需激活**的，只有以下情况才会进入：

| 触发方式 | 谁触发 | 场景 |
|---------|--------|------|
| LLM 调用 `team_create` 工具 | 用户通过对话让 Agent 创建团队 | "帮我创建一个研究团队" |
| `spawnInProcessTeammate()` 被调用 | Leader 的代码逻辑 | 创建团队后自动 spawn 队员 |
| 加入已有团队 | 用户或 Agent | tmux pane 启动时设置 `CLAUDE_CODE_AGENT_ID` |

**关键点**：用户不能像 `/help` 或 `/compact` 那样直接输入一个命令就进入 Teammate 模式。Teammate 模式是**工具驱动的**——必须通过 LLM 调用 `team_create` 工具来激活。

### 8.3 进入 Teammate 模式后发生什么

```
team_create 执行后的状态变化:

1. TeamFile 写入磁盘
   ~/.claude/teams/{team-name}/team.json

2. AppState 更新
   - currentTeam = teamId
   - teamRole = 'lead'

3. dynamicTeamContext 被设置（进程内队员场景）
   - agentId: "lead@my-team"
   - teamName: "my-team"

4. 从此刻起：
   - getAgentId() 不再返回 undefined
   - isTeammate() 返回 true
   - 系统不再是"独立会话"
```

### 8.4 退出 Teammate 模式

退出也不是自动的，需要显式操作：

```
离开团队:
  ├── 队员发送 shutdown_approved → runInProcessTeammateLoop 退出
  ├── 领导调用 cleanupTeam()
  │     ├── killPane (tmux 队员)
  │     ├── sendShutdownRequest (in-process 队员)
  │     └── rmrf(teamDir)
  └── dynamicTeamContext 被设为 null
  │
  └─→ 回到 getAgentId() === undefined → 独立会话
```

### 8.5 为什么不是默认开启

1. **资源成本**：每个队员都是独立的 LLM 调用 → 多倍的 token 消耗和 API 费用
2. **复杂度**：文件锁、Mailbox 轮询、权限同步都是持续运行的额外开销
3. **适用性**：大多数对话（"帮我解释这段代码"、"修复这个 bug"）不需要并行处理能力
4. **按需激活**：让 LLM 自己判断何时需要创建团队，这本身就是一个智能决策

简言之：Teammate 是一个**opt-in**（主动选择加入）的功能，不是 **opt-out**（默认开启、需要手动关闭）。它的设计哲学是"需要时才组建团队"，而非"上来就给你配个团队"。

---

## 九、团队是否固化与复用？

这是一个关键的生命周期问题。答案是分层的：**磁盘上可以固化，但默认行为是会话结束即清理。可以同时存在多个团队。**

### 9.1 团队的磁盘存储结构

```
~/.claude/teams/
├── research-team/              ← 团队 1
│   ├── team.json               ← TeamFile（配置 + 运行时状态）
│   └── inboxes/
│       ├── researcher/
│       ├── test-runner/
│       └── team-lead/
│
├── deploy-squad/               ← 团队 2（可同时存在）
│   ├── team.json
│   └── inboxes/
│       ├── builder/
│       └── team-lead/
│
└── bug-hunters/                ← 团队 3
    ├── team.json
    └── inboxes/
```

每个团队对应 `~/.claude/teams/` 下的一个独立目录，**多个团队可以同时存在于磁盘上**，互不干扰。

### 9.2 TeamFile 的双重身份：配置 + 运行时状态

```typescript
interface TeamFile {
  // ===== 配置层面（创建时确定，可持久复用） =====
  id: string                    // "team-1714800000-abc123"
  name: string                  // "research-team"
  members: AgentDefinition[]    // 成员定义
  leadAgentId: string           // 谁创建的
  createdAt: number
  config: {
    backends: ('in-process')[]  // 支持的后端
  }

  // ===== 运行时层面（会话期间动态变化） =====
  isActive: boolean             // 当前是否活跃
  lastActivity: number          // 最后活动时间
  status: 'running' | 'paused' | 'shutdown'  // 团队状态
}
```

**关键洞察**：TeamFile 不只是静态配置文件，它还承载运行时状态。这使得"团队快照"成为可能——读一个 TeamFile 就能知道这个团队的历史和当前状态。

### 9.3 默认行为：会话结束即清理

正常退出流程中，`cleanupTeam()` 被注册为 SIGINT/SIGTERM 的 handler：

```typescript
// 退出时的清理链：
async function cleanupTeam(teamName):
  1. killPane(paneId)           // 先杀 tmux 远程 pane
  2. sendShutdownRequest()      // 优雅关闭 in-process 队员
  3. sleep(500)                 // 等待队员退出
  4. rmrf(teamDir)              // ⚠️ 删除整个团队目录
```

**注意第 4 步：`rmrf(getTeamBasePath(teamName))`** — 这会删除 `~/.claude/teams/{team-name}/` 整个目录。

所以默认情况下，**团队不会固化——正常退出时它被清理了**。

### 9.4 什么情况下团队会残留在磁盘上？

| 场景 | 团队是否残留 | 说明 |
|------|------------|------|
| 正常退出（Ctrl+C / exit） | ❌ 被清理 | `cleanupTeam()` 触发 `rmrf` |
| 进程崩溃（crash） | ✅ 残留 | 清理函数未执行 |
| 强制杀进程（kill -9） | ✅ 残留 | SIGKILL 无法被拦截 |
| 终端意外关闭 | ✅ 残留 | 清理信号未触发 |
| `status: 'paused'` 后退出 | ✅ 可能保留 | 取决于实现是否跳过 `rmrf` |

**残留的文件结构完全可用**——它们就是合法的 JSON 文件，包含完整的团队配置和最后的状态。

### 9.5 能否复用残留的团队？

从设计上看，**有复用的理论可能性**，因为：

1. **TeamFile 包含完整元数据**：id、name、members、leadAgentId 都在
2. **`status` 字段设计有三态**：`running` / `paused` / `shutdown`，其中 `paused` 明确暗示了"可以恢复"
3. **`teamDiscovery.ts` 有能力读取团队状态**：
   ```typescript
   getTeammateStatuses(teamName):
     1. 读取 team.json
     2. 过滤掉 team-lead（领导自己）
     3. 返回每个队员的活跃状态
   ```

但**不会自动恢复**。新启动的会话中，身份链三层全空 → 独立会话。必须有一个"恢复团队"的主动动作：
- 读取残留的 TeamFile
- 重新设置 `dynamicTeamContext`
- 或者通过 `CLAUDE_CODE_AGENT_ID` 环境变量重新加入

### 9.6 能否同时管理多个团队？

**一个会话同一时刻只能属于一个团队**，但磁盘上可以有多个团队目录：

```
同一时刻的限制：
  AppState.currentTeam = "research-team"  // 单值，不能同时是两个团队
  getAgentId() → "lead@research-team"     // 只返回一个身份

但可以：
  - 退出 research-team → cleanupTeam → 再创建 deploy-squad
  - 磁盘上同时存在 research-team/ 和 deploy-squad/ 的残留目录
  - 多终端：终端 A 是 research-team 的 leader，终端 B 是 deploy-squad 的 member
```

### 9.7 生命周期全景图

```
创建                                   复用
  │                                     │
  ▼                                     ▼
┌─────────┐   team_create   ┌─────────┐  读取残留    ┌──────────┐
│ 独立会话  │ ──────────────► │ 团队活跃  │ ◄─────────── │ 残留目录   │
│ (默认)   │                 │ running  │              │ (崩溃后)  │
└─────────┘                 └────┬─────┘              └──────────┘
                                 │
                      ┌──────────┼──────────┐
                      ▼          ▼          ▼
                  shutdown   paused     crash/kill
                      │          │          │
                      ▼          │          ▼
                 ┌─────────┐    │    ┌──────────────┐
                 │ rmrf    │    │    │ 目录残留磁盘   │
                 │ 团队消失  │    │    │ (可被再次读取) │
                 └─────────┘    │    └──────────────┘
                                ▼
                          ┌─────────┐
                          │ 可恢复   │
                          │ (未实现) │
                          └─────────┘
```

### 9.8 结论

| 问题 | 答案 |
|------|------|
| 团队会固化吗？ | **默认不会**——正常退出时 `rmrf` 清理。但崩溃后残留的目录就是事实上的"固化" |
| 能复用吗？ | **设计上支持**（`status: 'paused'`、可读取的 TeamFile），但**没有自动恢复机制** |
| 能同时存在多个团队吗？ | **磁盘上可以**（不同目录），但**同一会话只能属于一个团队** |

这个设计的意图很清晰：团队是**临时的协作单元**，不是永久配置。正常使用中创建→工作→清理。但崩溃恢复能力暗示：也许未来版本会把 `paused` 状态做成真正的"暂停-恢复"功能。

---

## 十、同一会话多次 team_create 的行为分析

### 10.1 前置约束

从 `team_create` 的执行流程可知：

```typescript
// team_create 的核心步骤
async execute(params):
  // Step 1: 检查重名（唯一的显式防护）
  if (checkDuplicateTeamName(params.name)) → throw Error

  // Step 2-5: 生成 teamId、构建 TeamFile、写入磁盘、创建 inbox 目录
  // ⚠️ 注意：没有检查"你是不是已经在另一个团队里？"

  // Step 6: 覆盖当前团队上下文（单值，不是追加）
  context.setActiveTeam(teamId)
  context.currentTeam = teamId   // 直接覆盖，不保存旧值
```

### 10.2 场景矩阵

#### 场景 A：同一会话，相同团队名，重复创建

```
输入 1: "帮我创建 research-team 来分析代码"
  → team_create(name="research-team")
  → 成功，上下文切换到 research-team

输入 2: "用 research-team 再分析一下测试覆盖率"
  → LLM 可能再次尝试 team_create(name="research-team")
  → checkDuplicateTeamName("research-team") → 磁盘上 team.json 已存在
  → ❌ 抛出 Error: "Team 'research-team' already exists"
```

**结果**：被重名检查拦截，报错。这是唯一的硬防护。

#### 场景 B：同一会话，不同团队名，上一个已清理

```
输入 1: "创建 research-team 分析代码"
  → team_create(name="research-team") → 成功
  → 工作完成 → cleanupTeam("research-team")
  → rmrf ~/.claude/teams/research-team/

输入 2: "创建 deploy-squad 帮我部署"
  → team_create(name="deploy-squad") → 成功（旧团队已清理）
  → 上下文切换到 deploy-squad
```

**结果**：正常。这是预期的顺序使用模式。

#### 场景 C：同一会话，不同团队名，上一个未清理 ⚠️

```
输入 1: "创建 research-team"
  → team_create(name="research-team")
  → spawn in-process teammates: researcher, analyst
  → 上下文: currentTeam = "research-team"

输入 2: "创建 deploy-squad"（没有先关闭 research-team）
  → team_create(name="deploy-squad")
  → checkDuplicateTeamName("deploy-squad") → 通过（不同名）
  → ❌ 没有检查"你是否已在一个团队里"
  → TeamFile 写入: ~/.claude/teams/deploy-squad/team.json
  → context.currentTeam = "deploy-squad"  ← 覆盖！
  → ✅ 创建成功

但此时发生了什么？
```

**内存层面**：

```
创建前:
  AppState.currentTeam = "research-team"
  getAgentId() → "lead@research-team"

创建后:
  AppState.currentTeam = "deploy-squad"      ← 被覆盖
  getAgentId() → "lead@deploy-squad"          ← 身份变了
  dynamicTeamContext.teamName = "deploy-squad"
```

**旧团队的队员状态**：

```
research-team 的队员（researcher, analyst）:
  ├── 独立的 AbortController（不链接到领导！）
  ├── 继续运行 — 他们不知道领导"变心"了
  ├── idle_notification 写入 research-team/ 的 inbox
  ├── 但领导已经切换到 deploy-squad，不再轮询 research-team 的 inbox
  └── → 僵尸队员 (zombie teammate)
```

**磁盘层面**：

```
~/.claude/teams/
├── research-team/            ← 残留！未被清理
│   ├── team.json             ← status 可能还是 "running"
│   └── inboxes/
│       ├── researcher/       ← 僵尸队员还在往这里写消息
│       ├── analyst/
│       └── team-lead/
│
└── deploy-squad/             ← 新团队
    ├── team.json
    └── inboxes/
```

**总结**：可以创建成功，但旧团队变成**僵尸团队**——文件残留、队员仍在运行、无人监听其 inbox。

#### 场景 D：从队员身份尝试创建团队

```
// 队员的工具白名单
const TEAM_WORKER_TOOLS = [
  'Read', 'Write', 'Edit', 'Bash',
  'Glob', 'Grep', 'WebSearch', 'WebFetch',
  // 明确排除: 'Agent', 'team_create'  ← 禁用！
]

// 队员调用 team_create
→ canUseTool('team_create') → false
→ ❌ 工具不可用
```

**结果**：队员不能创建团队。只有领导才能。

### 10.3 有没有"会话内切换团队"的机制？

**没有。** 整个设计中不存在"从 team A 切换到 team B"的 API：

- `cleanupTeam()` 是**销毁**，不是"切出"
- 没有 `switchTeam()` 或 `leaveTeam()`（leaveTeam 只对 member 有意义，对 leader 来说就是 cleanupTeam）
- `context.currentTeam` 被直接覆盖，旧值丢失

这意味着：如果你想在同一次会话中顺序使用两个团队，你必须**先清理旧的再创建新的**。直接创建第二个会让第一个变成僵尸。

### 10.4 现状总结

| 操作 | 结果 |
|------|------|
| 同一会话，同名 team_create ×2 | ❌ 报错 "Team already exists" |
| 同一会话，不同名，先清理再创建 | ✅ 正常，顺序使用 |
| 同一会话，不同名，不清理就创建 | ⚠️ 创建成功，但旧团队变僵尸（文件残留、队员孤立运行） |
| 队员身份调用 team_create | ❌ 工具不可用（防递归） |
| 会话内切换团队 | ❌ 不支持，无此 API |

**设计评价**：`team_create` 只有一个防护——重名检查。它没有"是否已在团队中"的前置检查，也没有`switchTeam` 机制。这个设计假设的用法是"一个会话只服务于一个团队"，多次创建要么走正常清理流程，要么产生僵尸团队。这是一个**实用但不完美的简化**——对于 CLI 工具的典型用法（一次对话一个任务主题）来说足够，但在边缘场景下会留下残留。这也解释了为什么 `cleanupTeam()` 在正常退出时必须 `rmrf` ——如果不清理，僵尸团队的累积会污染 `~/.claude/teams/` 目录。
