# Phase 9: Teammate System 设计文档

## 一、概述

Teammate System 实现多 Agent 团队协作机制，支持团队领导（Team Lead）通过文件式邮箱（Mailbox）和进程内上下文隔离（AsyncLocalStorage）协调多个队员（Teammate）的工作。

### 核心概念

| 概念 | 说明 |
|------|------|
| **Team Lead** | 团队领导，创建和管理团队，协调整体工作 |
| **Teammate** | 队员，在团队中执行特定任务的 Agent |
| **Mailbox** | 基于文件的 JSON 消息队列，实现队员间通信 |
| **TeammateContext** | 进程内队员的上下文隔离机制 |
| **TeamFile** | 团队配置文件（config.json），记录成员和元数据 |

---

## 二、架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    Team Lead (REPL)                         │
│  - 创建团队 (TeamCreateTool)                                 │
│  - 发送消息 (SendMessageTool)                                │
│  - 查看队员状态 (teamDiscovery)                               │
└────────────────────┬────────────────────────────────────────┘
                     │
          ┌──────────┴──────────┐
          │   Team File System  │
          │  ~/.claude/teams/   │
          │  ├── {team}/config.json       │
          │  └── {team}/inboxes/          │
          │      ├── {agent}.json         │
          └──┬──────────────────┬──────────┘
             │                  │
    ┌────────▼───────┐  ┌──────▼──────────┐
    │  Teammate A    │  │  Teammate B      │
    │  (in-process)  │  │  (in-process)     │
    │  AsyncLocal    │  │  AsyncLocal       │
    │  Storage ctx   │  │  Storage ctx      │
    └────────────────┘  └──────────────────┘
```

### 数据流

```
1. Team Creation:
   User → TeamCreateTool → writeTeamFile() → ~/.claude/teams/{team}/config.json

2. Message Sending:
   User → SendMessageTool → writeToMailbox() → ~/.claude/teams/{team}/inboxes/{agent}.json

3. Teammate Spawn:
   SendMessageTool → spawnInProcessTeammate() → createTeammateContext() → runWithTeammateContext()
```

---

## 三、核心模块接口

### 3.1 Teammate Identity (src/utils/teammate.ts)

```typescript
// 动态团队上下文（模块级状态）
interface DynamicTeamContext {
  agentId: string;
  agentName: string;
  teamName: string;
  color?: string;
  planModeRequired: boolean;
  parentSessionId?: string;
}

// 核心函数
function getAgentId(): string | undefined;
function getAgentName(): string | undefined;
function getTeamName(): string | undefined;
function isTeammate(): boolean;
function isTeamLead(teamContext: { leadAgentId: string } | undefined): boolean;
function setDynamicTeamContext(ctx: DynamicTeamContext | null): void;
function clearDynamicTeamContext(): void;
```

**身份解析优先级**：
1. AsyncLocalStorage（进程内队员）→ teammateContext.ts
2. dynamicTeamContext（模块级状态）
3. 环境变量

### 3.2 TeammateContext (src/utils/teammateContext.ts)

```typescript
type TeammateContext = {
  agentId: string;        // "researcher@my-team"
  agentName: string;      // "researcher"
  teamName: string;       // "my-team"
  color?: string;
  planModeRequired: boolean;
  parentSessionId: string;
  isInProcess: true;
  abortController: AbortController;
}

function getTeammateContext(): TeammateContext | undefined;
function runWithTeammateContext<T>(context: TeammateContext, fn: () => T): T;
function isInProcessTeammate(): boolean;
function createTeammateContext(config): TeammateContext;
```

**实现方式**：使用 `async_hooks.AsyncLocalStorage` 实现并发安全的上下文隔离。

### 3.3 Mailbox (src/utils/mailbox.ts) — 内存队列

```typescript
type MessageSource = "user" | "teammate" | "system" | "tick" | "task";

interface Message {
  id: string;
  source: MessageSource;
  content: string;
  from?: string;
  color?: string;
  timestamp: string;
}

class Mailbox {
  get length(): number;
  send(msg: Message): void;
  poll(fn?: (msg: Message) => boolean): Message | undefined;
  receive(fn?: (msg: Message) => boolean): Promise<Message>;
  subscribe(listener: () => void): () => void;
}
```

### 3.4 TeammateMailbox (src/utils/teammateMailbox.ts) — 文件式邮箱

```typescript
interface TeammateMessage {
  from: string;
  text: string;
  timestamp: string;
  read: boolean;
  color?: string;
  summary?: string;
}

// 结构化消息类型
type IdleNotificationMessage = { type: "idle_notification"; from: string; ... };
type PermissionRequestMessage = { type: "permission_request"; request_id: string; ... };
type ShutdownRequestMessage = { type: "shutdown_request"; requestId: string; ... };
type PlanApprovalRequestMessage = { type: "plan_approval_request"; from: string; ... };
type TaskAssignmentMessage = { type: "task_assignment"; taskId: string; ... };

// 核心函数
function getInboxPath(agentName: string, teamName?: string): string;
function readMailbox(agentName: string, teamName?: string): Promise<TeammateMessage[]>;
function writeToMailbox(recipientName: string, message: Omit<TeammateMessage, "read">, teamName?: string): Promise<void>;
function markMessagesAsRead(agentName: string, teamName?: string): Promise<void>;
function clearMailbox(agentName: string, teamName?: string): Promise<void>;
function formatTeammateMessages(messages): string; // XML 格式
```

**存储结构**：
```
~/.claude/teams/{team_name}/inboxes/{agent_name}.json
```
内容为 `TeammateMessage[]` 数组。

### 3.5 TeamFile Schema (src/utils/teamHelpers.ts 简化版)

```typescript
interface TeamFile {
  name: string;
  description?: string;
  createdAt: number;
  leadAgentId: string;
  leadSessionId?: string;
  members: TeamMember[];
}

interface TeamMember {
  agentId: string;
  name: string;
  agentType?: string;
  model?: string;
  prompt?: string;
  color?: string;
  planModeRequired?: boolean;
  joinedAt: number;
  cwd: string;
  isActive?: boolean;
}
```

### 3.6 TeamCreateTool (src/tools/TeamCreateTool/index.ts)

```typescript
// 输入 Schema
{
  team_name: string;           // 团队名称（必填）
  description?: string;        // 团队描述
  agent_type?: string;         // 领队 Agent 类型
}

// 输出
{
  team_name: string;
  team_file_path: string;
  lead_agent_id: string;
}

// 执行流程
1. 检查是否已在团队中
2. 生成唯一团队名（冲突时用随机 slug）
3. 创建 TeamFile
4. 写入 ~/.claude/teams/{team}/config.json
5. 设置 dynamicTeamContext
6. 分配颜色给领队
```

### 3.7 SendMessageTool (src/tools/SendMessageTool/index.ts)

```typescript
// 输入 Schema
{
  to: string;                  // 收件人名称、"*"（广播）、"team-lead"（领队）
  summary?: string;            // 5-10 字 UI 预览
  message: string;             // 消息内容
}

// 输出
{
  success: boolean;
  message: string;
  routing?: { sender, target, ... };
  recipients?: string[];       // 广播时
}

// 执行流程
1. 解析 to 字段（直接/广播/领队）
2. 获取发送者身份
3. 写入收件人 inbox
4. 返回路由信息
```

### 3.8 In-Process Spawn (src/utils/teammate/spawnInProcess.ts)

```typescript
interface InProcessSpawnConfig {
  name: string;         // 队员名称
  teamName: string;     // 团队名称
  prompt: string;       // 初始任务
  color?: string;
  planModeRequired?: boolean;
  model?: string;
}

interface InProcessSpawnOutput {
  success: boolean;
  agentId: string;      // "name@teamName"
  taskId?: string;
  error?: string;
}

// 简化为直接运行函数，不涉及 AppState
function spawnInProcessTeammate(config: InProcessSpawnConfig): InProcessSpawnOutput;
```

### 3.9 Team Discovery (src/utils/teamDiscovery.ts)

```typescript
interface TeammateStatus {
  name: string;
  agentId: string;
  agentType?: string;
  model?: string;
  status: "running" | "idle" | "unknown";
  color?: string;
  cwd: string;
}

function getTeammateStatuses(teamName: string): TeammateStatus[];
function discoverTeams(): string[];  // 扫描 ~/.claude/teams/
```

---

## 四、简化决策

相比 free-code 完整实现，cc-study 做以下简化：

| 简化项 | 原因 |
|--------|------|
| 无 tmux/iTerm2 后端 | cc-study 无需终端多窗格支持 |
| 无 AppState 集成 | cc-study 无 React 状态管理 |
| 无 proper-lockfile | 使用简单 JSON 读写 + 错误处理替代 file locking |
| 无 analytics/logEvent | 学习项目无需遥测 |
| 无 full inProcessRunner | 简化为调用 orchestrator 运行 agent 循环 |
| 简化 TeamFile（无 tmuxPaneId） | 仅 in-process 模式，无需窗格 ID |
| 无 swarm/backends 目录 | 仅需 in-process backend |
| AsyncLocalStorage 简化 | 如环境不支持，降级为 module-level 状态 |

---

## 五、文件结构

```
src/
├── utils/
│   ├── teammate.ts              # 队员身份 + 动态团队上下文
│   ├── teammateContext.ts       # AsyncLocalStorage 上下文隔离
│   ├── mailbox.ts               # 内存 Mailbox 类
│   ├── teammateMailbox.ts       # 文件式邮箱操作
│   ├── teamHelper.ts            # TeamFile 读写 + 路径工具
│   ├── teamMemory.ts            # 团队记忆操作
│   ├── teamDiscovery.ts         # 团队发现
│   └── teammate/
│       ├── spawnInProcess.ts    # In-process 队员 spawn
│       ├── inProcessRunner.ts   # In-process 队员运行器
│       └── constants.ts         # 常量
└── tools/
    ├── TeamCreateTool/
    │   └── index.ts             # 团队创建工具
    └── SendMessageTool/
        └── index.ts             # 消息发送工具

tests/unit/
├── teammate/
│   ├── teammate.test.ts         # 身份/上下文测试
│   ├── mailbox.test.ts          # 邮箱测试
│   ├── teammateMailbox.test.ts  # 文件邮箱测试
│   ├── teamHelper.test.ts       # TeamFile 测试
│   ├── teamDiscovery.test.ts    # 发现测试
│   └── spawnInProcess.test.ts   # Spawn 测试
└── tools/
    ├── teamCreateTool.test.ts   # TeamCreate 测试
    └── sendMessageTool.test.ts  # SendMessage 测试
```

---

## 六、测试规划

### 6.1 P9006 Teammate Identity 测试
- getAgentId/getAgentName 默认返回 undefined
- setDynamicTeamContext 后正确返回身份
- isTeammate 在设置后返回 true
- isTeamLead 匹配 leadAgentId 逻辑
- 多 Agent 上下文的并发隔离

### 6.2 P9007 Mailbox 测试
- 内存 Mailbox send/receive/poll 基本操作
- 多个 waiter 的并发处理
- 文件邮箱 read/write/markRead/clear
- 收件箱不存在时的容错处理
- 文件锁定的并发写入（简化版）

### 6.3 P9009 TeamCreateTool 测试
- 创建新团队，验证 TeamFile 写入
- 团队名冲突时生成唯一名
- 领队自动加入 members 列表
- 重复创建团队的处理

### 6.4 P9010 SendMessageTool 测试
- 直接消息发送
- 广播到所有成员
- 结构化消息（shutdown_request 等）
- 收件人不存在时的错误处理

### 6.5 P9011 In-Process Spawn 测试
- spawn 生成正确 agentId
- TeammateContext 创建和传递
- runner 执行基本 agent 循环

---

## 七、集成点

1. **AgentTool types.ts**：AgentType 扩展 "teammate" 选项
2. **Tool Registry**：注册 TeamCreateTool、SendMessageTool
3. **REPL**：无需修改（通过工具调用触发）

---

**版本**：v0.1.0
**创建日期**：2026-05-03
**对应阶段**：Phase 9
