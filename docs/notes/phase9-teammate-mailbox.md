# Phase 9 源码研读：Mailbox 通信系统

> 参考源码：`free-code/src/utils/teammateMailbox.ts`, `free-code/src/utils/mailbox.ts`

## 1. 概述

Claude Code 的 Teammate 通信系统有两层：

- **内存 Mailbox**（`mailbox.ts`）：进程内事件队列，用于组件间解耦通信
- **文件 Mailbox**（`teammateMailbox.ts`）：跨进程消息系统，基于 JSON 文件和文件锁

两层系统协同工作：内存 Mailbox 管理内部消息流，文件 Mailbox 作为跨进程的持久化通道。

## 2. 内存 Mailbox（`mailbox.ts`）

### 2.1 设计模式：Actor-Pattern 消息队列

```typescript
class Mailbox {
  private queue: Message[] = []
  private waiters: Waiter[] = []   // 等待特定消息的 Promise resolver
  private changed = createSignal() // 发布/订阅通知
  private _revision = 0            // 单调递增的修订版本号

  send(msg): void     // 发送消息
  poll(fn?): Message | undefined  // 同步轮询
  receive(fn?): Promise<Message>  // 异步等待
  subscribe(fn): () => void       // 订阅变更
}
```

**关键特性**：

- **Waiter 优先级**：`send()` 先检查 waiters（Promise awaiters），有匹配的立即 resolve，不等进入队列
- **Revision 计数器**：每次 send 都递增，用于判断是否有新消息到达
- **Signal 模式**：通过简单的发布/订阅实现响应式通知

### 2.2 消息结构

```typescript
type Message = {
  id: string
  source: "user" | "teammate" | "system" | "tick" | "task"
  content: string
  from?: string
  color?: string       // UI 渲染用的颜色提示
  timestamp: string    // ISO 格式
}
```

## 3. 文件 Mailbox（`teammateMailbox.ts`）

### 3.1 存储结构

```
~/.claude/teams/
└── {team_name}/
    └── inboxes/
        ├── researcher.json    ← TeammateMessage[]
        ├── test-runner.json
        └── team-lead.json
```

每个 inbox 文件是一个 `TeammateMessage[]` JSON 数组，通过文件锁实现并发安全。

### 3.2 TeammateMessage 结构

```typescript
type TeammateMessage = {
  from: string          // 发送者名称
  text: string          // 消息体（可以是 JSON 结构化消息）
  timestamp: string     // ISO 时间戳
  read: boolean         // 是否已读
  color?: string        // 发送者的 UI 颜色
  summary?: string      // 5-10 词的 UI 预览
}
```

### 3.3 文件锁机制

自由代码使用 `proper-lockfile`（带指数退避重试）实现文件锁：

```typescript
const LOCK_OPTIONS = {
  retries: { retries: 10, minTimeout: 5, maxTimeout: 100 }
}

// writeToMailbox 的锁流程
release = await lockfile.lock(inboxPath, { lockfilePath, ...LOCK_OPTIONS })
// ... 读 → 追加 → 写 ...
await release()
```

cc-study 做了简化，使用 try/catch 和 JSON 读写代替文件锁。

### 3.4 核心操作

| 操作 | 说明 |
|------|------|
| `writeToMailbox(recipient, msg)` | 写入收件人 inbox，带文件锁 |
| `readMailbox(agent)` | 读取全部消息（未读 + 已读） |
| `readUnreadMessages(agent)` | 过滤仅未读消息 |
| `markMessagesAsRead(agent)` | 全部标记已读 |
| `markMessageAsReadByIndex(agent, idx)` | 单条标记已读 |
| `clearMailbox(agent)` | 清空收件箱 |
| `markMessagesAsReadByPredicate(agent, pred)` | 按条件标记已读 |

## 4. 结构化协议消息

文件 Mailbox 不仅传纯文本消息，还支持多层结构化 JSON 协议：

### 4.1 消息类型矩阵

| 类型 | 方向 | 用途 |
|------|------|------|
| `regular` | 任意 ↔ 任意 | 普通队员间消息 |
| `idle_notification` | 队员 → 领导 | 队员完成任务，空闲等待 |
| `permission_request` | 队员 → 领导 | 队员需要权限确认 |
| `permission_response` | 领导 → 队员 | 领导批准/拒绝权限请求 |
| `shutdown_request` | 领导 → 队员 | 要求队员关闭 |
| `shutdown_approved` | 队员 → 领导 | 队员同意关闭 |
| `shutdown_rejected` | 队员 → 领导 | 队员拒绝关闭（有未完成工作） |
| `plan_approval_request` | 队员 → 领导 | 请求计划批准 |
| `plan_approval_response` | 领导 → 队员 | 批准/拒绝计划 |
| `task_assignment` | 领导 → 队员 | 分配新任务 |
| `team_permission_update` | 领导 → 全员 | 广播权限规则更新 |
| `mode_set_request` | 领导 → 队员 | 设置权限模式 |

### 4.2 关闭握手协议（Shutdown Handshake）

```
领导                      队员
  │                        │
  ├─ shutdown_request ────>│  (写入队员 inbox)
  │                        │  (队员检测到 shutdown_request)
  │                        │  (判断是否有未完成工作)
  │<── shutdown_approved ──┤  (写入领导 inbox)
  │      OR                │
  │<── shutdown_rejected ──┤  (有理由)
  │                        │
```

**趣点**：`shutdown_approved` 不能简单地 `exit(0)`——在 tmux 环境中需要带上 `paneId`，以便领导关闭正确的窗格。

### 4.3 结构化消息检测

```typescript
function isStructuredProtocolMessage(text: string): boolean {
  // 检查是否是 JSON，且 type 字段匹配已知协议类型
  // 这些消息需要被 useInboxPoller 路由到特定 handler
  // 而不是直接作为原始 LLM 上下文消费
}
```

这个检测函数的存在原因是：结构化的协议消息（如 `permission_request`）必须被特定 handler 处理，不能被简单地当作普通队员聊天消息放进 LLM 的上下文窗口。

## 5. 轮询机制

自由代码通过 `useInboxPoller` Hook 实现周期性轮询：

```
while (队员仍在运行) {
  await sleep(POLL_INTERVAL)  // 0.5s 或 1s
  messages = await readUnreadMessages(myName, teamName)
  
  for each message:
    if isStructuredProtocolMessage(message):
      route to specific handler   // 权限/关闭/计划批准的 handler
    else:
      add to user context         // 作为普通消息进入 LLM 上下文
  
  markMessagesAsRead(myName, teamName)
}
```

## 6. 简化设计（cc-study 版）

| 方面 | free-code | cc-study |
|------|-----------|----------|
| 文件锁 | proper-lockfile (重试+退避) | 简单 try/catch + JSON 读写 |
| sandbox_permission | 支持沙箱网络权限请求 | 未实现 |
| team_permission_update | 广播规则更新 | 未实现 |
| mode_set_request | 领导设置队员模式 | 未实现 |
| getLastPeerDmSummary | 从最后消息提取 DM 摘要 | 未实现 |
| isStructuredProtocolMessage | 路由判断 | 未实现（协议消息仅定义） |
| sendShutdownRequestToMailbox | 带 paneId 和 backendType | 简化（仅 in-process） |

## 7. 学习心得

1. **文件锁是分布式系统的第一课**：多个进程写入同一个 JSON 文件——如果没有锁，读-改-写的竞态条件会丢消息。自由代码的 `LOCK_OPTIONS` 使用指数退避重试，这是生产级文件锁的标准做法。

2. **结构化消息的二义性问题**：同一个 inbox 文件里可能有普通人类语言消息，也有 JSON 结构化协议消息。`isStructuredProtocolMessage()` 通过检测 JSON `type` 字段来区分，这是简单但有效的区分策略。

3. **区分"已读"和"已消费"**：消息 state 有 `read: boolean`，但还有一个更细粒度的概念——"已消费"（被 handler 处理过）。自由代码通过 `markMessagesAsReadByPredicate()` 和 `isStructuredProtocolMessage()` 的组合来实现这个区分。

4. **inbox 是基于 agent name 而非 agent ID**：自由代码用了 agent name 作为收件箱文件名，这很聪明——它比 UUID 更可读，对调试更友好。
