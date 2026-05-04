# Phase 9 后端与扩展机制解析：tmux/iTerm2 后端、UDS/Bridge

> 这些是 free-code（Claude Code 完整实现）中存在但 cc-study 简化掉的特性。

---

## 一、为什么需要多种后端？

回顾 Teammate 系统的两种队员实现：

| 类型 | 运行方式 | 通信方式 |
|------|---------|---------|
| **进程内队员** | 与领导共享同一个 Node.js 进程 | 内存 Mailbox |
| **进程级队员** | 独立的进程 | 文件 Mailbox（`~/.claude/teams/`） |

"后端"就是回答"进程级队员的进程从哪里来、怎么管理"的问题。不同的后端对应不同的进程创建和管理方式。

```
                          Team System
                               │
              ┌────────────────┼────────────────┐
              │                │                │
         in-process      tmux/iTerm2       UDS/Bridge
        (同一进程)       (独立终端窗格)     (独立进程/跨主机)
              │                │                │
              ▼                ▼                ▼
        内存 Mailbox      文件 Mailbox      文件 Mailbox
                                             或 Socket 直连
```

---

## 二、tmux/iTerm2 后端

### 2.1 这是什么？

**tmux** 和 **iTerm2** 是终端分屏/多窗格工具。Claude Code 可以编程式地创建新的终端窗格，在每个窗格里启动一个 Claude Code 实例作为队员。

```
┌─────────────────────────────────────────────────────┐
│  tmux 会话                                          │
├──────────────────────┬──────────────────────────────┤
│                      │                              │
│   窗格 1 (Pane 0)     │   窗格 2 (Pane 1)            │
│   Leader              │   researcher teammate       │
│                      │                              │
│   $ claude            │   $ CLAUDE_CODE_AGENT_ID=   │
│   > 分析这个项目       │     researcher@my-team      │
│                      │     claude                   │
│                      │   > [等待任务...]             │
│                      │                              │
├──────────────────────┼──────────────────────────────┤
│   窗格 3 (Pane 2)     │   窗格 4 (Pane 3)            │
│   test-runner         │   (用户可以看到所有窗格)      │
│   teammate           │                              │
│                      │                              │
│   $ CLAUDE_CODE_AGENT_ID=                           │
│     test-runner@my-team                             │
│     claude                                          │
│   > [等待任务...]     │                              │
│                      │                              │
└──────────────────────┴──────────────────────────────┘
```

### 2.2 工作流程

#### 创建阶段

```typescript
// free-code 中的 spawnMultiAgent（cc-study 不实现）

async function spawnTmuxTeammate(agent: AgentDefinition, teamName: string):
  1. 确定 tmux 会话和窗格位置
     const targetPane = findNextAvailablePane(sessionName)

  2. 构建启动命令（注入身份）
     const command = `CLAUDE_CODE_AGENT_ID="${agent.id}@${teamName}" claude`

  3. 在 tmux 窗格中执行
     tmux split-window -t ${sessionName} "${command}"
     // 或 iTerm2: osascript 创建新 window/tab
     //   osascript -e 'tell app "iTerm2" to create window with command "${command}"'

  4. 记录 paneId 用于后续管理
     member.paneId = paneId
     member.backend = 'tmux'
```

#### 通信阶段

虽然队员在不同窗格的不同进程中运行，但它们在**同一台机器**上，共享文件系统。所以通信走**文件 Mailbox**：

```
Leader (Pane 0)                          Researcher (Pane 1)
      │                                        │
      │  send_message(to="researcher")         │
      │  → 写入 ~/.claude/teams/my-team/       │
      │    inboxes/researcher/msg-1.json       │
      │                                        │
      │                                        │ 轮询 inbox (useInboxPoller)
      │                                        │ 发现 msg-1.json
      │                                        │ 读取 → 处理 → 标记已读
      │                                        │
      │                                        │ 回复 leader
      │ 轮询 inbox                             │ → 写入 inboxes/team-lead/
      │ 发现回复                               │
```

#### 关闭阶段

```typescript
// 关闭 tmux teammate 的关键：必须带 paneId

async function shutdownTmuxTeammate(agent):
  // 第 1 步：发送 shutdown_request（优雅关闭）
  await sendMessage(agent.id, 'shutdown_request')

  // 第 2 步：等待 response
  const response = await waitForShutdownResponse(agent.id)

  if (response === 'shutdown_approved'):
    // 第 3 步：关闭窗格 ⚠️ 关键！paneId 在这里用上
    tmux kill-pane -t ${agent.paneId}

  if (response === 'shutdown_rejected'):
    // 队员有理由拒绝（如正在执行关键操作）
    // 领导可以稍后再试
```

**注意**：关闭 tmux 队员不能简单地让进程 `exit(0)`——必须通过 `kill-pane` 关闭窗格，否则窗格会变成空白残留。这就是为什么笔记中说"需要带上 `paneId`，以便领导关闭正确的窗格"。

### 2.3 为什么 tmux 队员需要环境变量？

```
进程内队员:
  getAgentId() → AsyncLocalStorage → 自动隔离 → 获取 agentId

tmux 队员:
  启动时是全新的进程 → 没有 AsyncLocalStorage → 没有 dynamicTeamContext
  → 只能通过环境变量注入身份 → CLAUDE_CODE_AGENT_ID
```

这就是身份优先级链中第 3 层的存在原因——它是 tmux 后端的"身份注入点"。

### 2.4 清理顺序为什么至关重要

```typescript
// ❌ 错误的清理顺序（会导致 zombie）
await rmrf(teamDir)              // 先删目录
await tmux kill-pane -t paneId   // pane 还在，但 inbox 目录没了
// → 窗格变成空白 zombie，无法通信也无法清理

// ✅ 正确的清理顺序
await tmux kill-pane -t paneId   // 先关闭窗格（进程终止）
await sleep(500)                 // 等待进程完全退出
await rmrf(teamDir)              // 最后删目录
// → 干净无残留
```

这就是笔记中强调的"清理链完整性：顺序非常重要"——不仅是优雅关闭的问题，更是防止 zombie 进程的防御性设计。

### 2.5 tmux vs iTerm2

两者在 Claude Code 中的角色完全相同，只是底层 API 不同：

| | tmux | iTerm2 |
|------|------|--------|
| 创建窗格 | `tmux split-window` | AppleScript / `osascript` |
| 关闭窗格 | `tmux kill-pane -t {id}` | AppleScript 关闭 window/tab |
| 跨平台 | Linux / macOS | macOS only |
| 依赖 | 需要安装 tmux | 系统自带 (macOS) |

---

## 三、UDS 扩展

### 3.1 这是什么？

**UDS (Unix Domain Socket)** 是一种同主机进程间通信机制，比文件 Mailbox 更高效，比 TCP 更轻量。

```
~/.claude/teams/{team-name}/
├── team.json
├── inboxes/
│   └── ... (文件 Mailbox 仍然存在，作为 fallback)
└── team.sock                 ← UDS socket 文件
```

### 3.2 与文件 Mailbox 的对比

| | 文件 Mailbox | UDS Socket |
|------|-------------|-----------|
| 通信方式 | 写 JSON 文件 → 轮询 → 读文件 | Socket 连接 → 直接发送数据 |
| 延迟 | 高（轮询间隔 0.5~1s + 文件 I/O） | 低（事件驱动，即时推送） |
| 线程安全 | 需要文件锁（proper-lockfile） | Socket 天然串行 |
| 复杂度 | 低（纯文件操作） | 中（需要管理连接生命周期） |
| 持久化 | 天然（文件在磁盘上） | 无（需要额外实现） |
| cc-study | ✅ 实现了简化版 | ❌ 简化掉 |

### 3.3 路由方式

在 `send_message` 工具中，UDS 作为一种特殊路由地址：

```typescript
// 文件 Mailbox 路由
send_message({ to: "researcher", message: "..." })
  → 写入 ~/.claude/teams/my-team/inboxes/researcher/msg.json

// UDS 路由
send_message({ to: "uds:/tmp/my-team.sock", message: "..." })
  → 连接到 /tmp/my-team.sock
  → 直接发送消息
```

### 3.4 为什么设计 UDS？

文件 Mailbox 的问题在规模化时会暴露：

```
3 个队员 × 0.5s 轮询间隔 = 每秒 6 次文件 I/O
每次 I/O: readdir → readFile → JSON.parse → markAsRead → writeFile + 文件锁

对于高频协作场景，这不够快。UDS 提供低延迟的事件驱动替代方案。
```

---

## 四、Bridge 扩展

### 4.1 这是什么？

**Bridge** 是跨主机通信的 WebSocket 桥接层。允许团队中的队员分布在**不同的机器**上。

```
┌─────────────────┐          ┌─────────────────┐
│ Machine A        │          │ Machine B        │
│                  │  WebSocket│                  │
│  Leader          │◄────────►│  researcher      │
│  claude          │  Bridge  │  claude           │
│                  │          │  agentId=         │
│                  │          │  researcher@team  │
│                  │          │                  │
│  ~/.claude/teams/│          │  ~/.claude/teams/ │
│    my-team/      │          │    my-team/       │
│                  │          │                  │
└─────────────────┘          └─────────────────┘
```

### 4.2 路由方式

```typescript
// 跨主机路由
send_message({ to: "bridge:bridge-id-123", message: "..." })
  → 通过 WebSocket 发送到远端 Bridge
  → 远端 Bridge 将消息写入对应队员的 inbox
```

### 4.3 为什么设计 Bridge？

这是 Teammate 系统的"野心最大化"——不局限于一台机器：

- **分布式编译**：队员 A 在 Mac 上编辑代码，队员 B 在 Linux 服务器上编译测试
- **专用硬件**：队员在有 GPU 的机器上运行 ML 推理，领导在本地协调
- **权限隔离**：敏感操作（如部署）在有严格权限的专用机器上执行

当然，这也是最复杂的后端，cc-study 完全没有实现。

---

## 五、后端能力矩阵

| 能力 | in-process | tmux/iTerm2 | UDS | Bridge |
|------|-----------|-------------|-----|--------|
| 进程隔离 | ❌ 共享进程 | ✅ 独立进程 | ✅ 独立进程 | ✅ 独立主机 |
| 通信延迟 | 最低（内存） | 中（文件 I/O） | 低（Socket） | 高（网络） |
| 故障隔离 | ❌ 一崩全崩 | ✅ 独立 | ✅ 独立 | ✅ 完全隔离 |
| 跨平台 | ✅ | 取决于后端 | ✅ Unix | ✅ |
| 跨主机 | ❌ | ❌ | ❌ | ✅ |
| 持久化 | ❌ | ✅（文件残留） | ✅ | ✅ |
| 复杂度 | 最低 | 中 | 中高 | 最高 |
| cc-study | ✅ | ❌ | ❌ | ❌ |
| free-code | ✅ | ✅ | ✅ | ✅ |

---

## 六、cc-study 为什么只保留 in-process？

| 砍掉的后端 | 砍掉的原因 |
|-----------|-----------|
| **tmux/iTerm2** | 需要 pane 管理（创建/关闭/ID 追踪）、环境变量注入、osascript 调用、平台差异处理。这些与核心 Teammate 逻辑无关，是运维层面的胶水代码 |
| **UDS** | 文件 Mailbox 已经能完成通信。UDS 是性能优化，不是功能必需。且需要管理 socket 生命周期（bind/listen/connect/close） |
| **Bridge** | 跨主机通信引入了 WebSocket 服务器、连接管理、断线重连、身份验证等全套网络协议复杂度，远超学习目的 |

**核心判断**：in-process 已经完整展示了 Teammate 的核心设计——身份系统、Mailbox 通信、结构化协议、Shutdown Handshake。其余后端只是"相同的协议跑在不同的传输层上"，不影响对核心概念的理解。

---

## 七、一句话总结

| 概念 | 一句话 |
|------|--------|
| **tmux/iTerm2 后端** | 把队员放在独立的终端窗格中运行，通过 paneId 管理生命周期，通过文件 Mailbox 通信 |
| **UDS** | 用 Unix Domain Socket 替代文件 Mailbox，降低同主机通信延迟 |
| **Bridge** | 用 WebSocket 桥接，让队员可以分布在不同的机器上 |

---

## 八、什么时候创建哪种队员？

### 8.1 决策机制：配置驱动，创建时决定

后端选择不是运行时的动态决策，而是在**团队创建时**通过配置决定的：

```typescript
// LLM 调用 team_create 时指定
team_create({
  name: "research-team",
  agents: [
    {
      name: "researcher",
      agentType: "general",
      backend: "in-process"     // ← 这个队员用 in-process
    },
    {
      name: "test-runner",
      agentType: "general",
      backend: "tmux"           // ← 这个队员用 tmux 窗格
    }
  ],
  config: {
    backends: ["in-process", "tmux"]  // ← 团队支持的后端列表
  }
})
```

**同一团队中可以混用不同后端**——一个队员跑在进程内，另一个跑在独立 tmux 窗格里。

### 8.2 决策流程

```
team_create 被调用
    │
    ├── agent.backend 已指定？
    │   ├── YES → 使用 agent.backend
    │   │         ├── "in-process"  → spawnInProcessTeammate()
    │   │         ├── "tmux"        → spawnTmuxTeammate()
    │   │         ├── "iterm2"      → spawnITerm2Teammate()
    │   │         ├── "uds"         → spawnUDSTeammate()
    │   │         └── "bridge"      → spawnBridgeTeammate()
    │   │
    │   └── NO → 使用默认值
    │            └── 默认 = "in-process"（零依赖、总是可用）
    │
    └── 验证 agent.backend 在 config.backends 列表中
        ├── 在 → 继续
        └── 不在 → ❌ Error: "Backend 'bridge' not supported by team"
```

### 8.3 各后端的选择逻辑

| 后端 | 何时选择 | 典型场景 |
|------|---------|---------|
| **in-process** | 默认选择，大多数情况 | 快速任务、不需要可视监控、低开销优先 |
| **tmux/iTerm2** | 需要**可视监控**队员输出，或需要进程隔离 | 长时间任务、用户想"偷看"队员在干什么、调试 |
| **UDS** | 需要进程隔离但**低延迟通信** | 高频交互场景（如队员频繁请求权限确认） |
| **Bridge** | 需要**跨机器**分布 | 多主机协作、专用硬件、安全隔离 |

### 8.4 为什么默认是 in-process？

```
in-process  无需创建终端窗格、无需注入环境变量、无需文件锁
            启动最快，开销最低

tmux        需要：检测 tmux 是否安装 → 创建窗格 → 注入环境变量 → 等待进程启动
            启动成本高，依赖外部工具

UDS         需要：创建 socket 文件 → bind → listen → 连接管理
            in-process 的内存 Mailbox 已经够快，UDS 是优化不是必需

Bridge      需要：WebSocket 服务器 → 连接 → 认证 → 心跳维持
            复杂度最高，只有跨主机时才有必要
```

**核心原则**：能用 in-process 就用 in-process。只有当你**明确需要其他后端提供的额外能力**（可视监控、进程隔离、跨主机）时，才选择其他后端。

### 8.5 实际使用中的典型模式

#### 模式 1：全 in-process（最常见，cc-study 唯一支持）

```
team_create({
  name: "quick-analysis",
  agents: [
    { name: "researcher" },      // backend 默认 in-process
    { name: "test-runner" }      // backend 默认 in-process
  ]
})

→ 两个队员都在领导进程内，内存 Mailbox 通信
→ 最快、最简单
→ 缺点：用户看不到队员的工作过程（只能等结果）
```

#### 模式 2：混合（free-code 支持）

```
team_create({
  name: "visual-debug",
  agents: [
    { name: "researcher", backend: "in-process" },  // 后台默默工作
    { name: "debugger",   backend: "tmux" }         // 用户在窗格里可以看到
  ]
})

→ researcher 在后台安静运行
→ debugger 在可见的 tmux 窗格中运行
→ 用户可以随时切换到 debugger 窗格查看原始输出
→ 适合：一个队员做"脏活累活"，另一个队员需要人工监督
```

#### 模式 3：全 tmux（调试/演示用）

```
team_create({
  name: "workshop",
  agents: [
    { name: "presenter",  backend: "tmux" },
    { name: "note-taker", backend: "tmux" }
  ]
})

→ 两个队员在独立的 tmux 窗格中
→ 用户可以同时看到两个队员的完整输出
→ 适合：教学演示、团队调试、对 Teammate 系统本身进行 debug
```

### 8.6 为什么 cc-study 不需要纠结这个问题？

cc-study 只实现了 in-process，所以答案很简单：**永远创建进程内队员**。但理解 free-code 的多后端设计意图很重要：

```
free-code 的设计哲学:
  "给用户和 LLM 选择权——不同的任务需要不同的隔离级别和可见性"

cc-study 的设计哲学:
  "理解核心机制就够——后端只是传输层，不影响身份/通信/协议的本质"
```

### 8.7 一句话总结

| 问题 | 答案 |
|------|------|
| **什么时候创建进程内队员？** | **默认**——能创建就创建。最快、开销最低、无外部依赖 |
| **什么时候创建进程级队员？** | 当需要**可视监控**（想看到队员的输出）、**进程隔离**（防崩溃级联）、或**跨主机协作**时 |
| **混用可以吗？** | 可以——同一团队中不同队员用不同后端，各取所长 |

---

## 九、进程级队员会自动创建 tmux 窗口吗？

**是的，全自动。** 用户不需要手动 `tmux split-window`。

### 9.1 自动创建流程

当 `team_create` 中指定 `agent.backend = "tmux"` 时，系统自动执行以下操作：

```typescript
// free-code 中的 spawnTmuxTeammate（简化示意）

async function spawnTmuxTeammate(agent, teamName):
  // 第 1 步：确定在哪个 tmux 会话和位置创建窗格
  const sessionName = getCurrentTmuxSession()  // 检测当前是否在 tmux 中

  if (!sessionName):
    // 不在 tmux 中 → 先创建一个 tmux 会话
    tmux new-session -d -s "claude-team"

  // 第 2 步：自动分割窗格
  // 水平分割（左右）或垂直分割（上下）
  tmux split-window -t ${sessionName} -v   // 垂直分割出新窗格

  // 第 3 步：在新窗格中注入身份并启动 Claude Code
  const command = `CLAUDE_CODE_AGENT_ID="${agent.id}@${teamName}" claude`
  tmux send-keys -t ${newPaneId} "${command}" Enter

  // 第 4 步：记录 paneId 用于后续管理
  agent.paneId = newPaneId
```

### 9.2 用户视角的体验

假设用户在一个普通终端中运行 Claude Code：

```
用户输入前:                      team_create 后（自动变化）:
┌─────────────┐              ┌─────────────┬──────────────┐
│             │              │             │              │
│  $ claude   │              │  Leader     │  researcher  │
│  > 创建研究  │   ──────►   │  (用户在这)  │  (自动出现)   │
│    团队     │              │             │              │
│             │              │  $ claude   │  $ claude    │
│             │              │  > 团队已   │  agentId=    │
│             │              │    创建     │  researcher  │
│             │              │             │  @my-team    │
│             │              │             │  > [工作中]   │
└─────────────┘              └─────────────┴──────────────┘
```

用户什么都没做——没有按快捷键，没有输入 tmux 命令——终端自动分裂出一个新窗格，里面跑着队员。

### 9.3 这为什么是重要设计？

```
❌ 如果是手动：
  用户: "创建研究团队"
  Claude: "请在 tmux 中按 Ctrl+B % 创建一个新窗格，
          然后输入 CLAUDE_CODE_AGENT_ID=researcher@my-team claude"
  用户: "..."

✅ 实际设计（自动）：
  用户: "创建研究团队"
  Claude: 调用 team_create → spawnTmuxTeammate → 自动创建窗格
  用户: 看到终端自动分裂，队员开始工作
```

**核心理念**：Teammate 机制对用户应该是**透明的**——你说"创建团队"，团队就出现了。创建窗格、注入环境变量、启动进程这些底层操作全部由 `spawnTmuxTeammate()` 自动完成。

### 9.4 不同后端的自动化程度

| 后端 | 自动化行为 |
|------|-----------|
| **in-process** | 在同一个 Node.js 进程中 `runWithTeammateContext()` 启动运行循环，用户感知不到 |
| **tmux** | 自动执行 `tmux split-window` 创建新窗格，用户**看得见**新窗格出现 |
| **iTerm2** | 自动执行 `osascript` 创建新 window/tab，用户**看得见**新窗口/tab 弹出 |
| **UDS** | 自动 fork 新进程 + 创建 socket 连接，用户感知不到（后台进程） |
| **Bridge** | 自动建立 WebSocket 连接到远程机器，用户感知不到（如果远端无 GUI） |

### 9.5 和"身份优先级链"的关系

现在可以理解为什么身份链需要三层——每一层对应不同的自动化启动场景：

```
第 1 层: AsyncLocalStorage
  → 对应 in-process spawn
  → runWithTeammateContext(ctx, fn) 自动设置

第 2 层: dynamicTeamContext
  → 对应 tmux/iTerm2 spawn 后的"加入"动作
  → 队员进程启动后、开始轮询 inbox 前，自动通过某种方式设置

第 3 层: 环境变量 CLAUDE_CODE_AGENT_ID
  → 对应 tmux pane 启动时的注入点
  → spawnTmuxTeammate 在启动命令中自动注入
```

整个流程的**自动化闭环**：
```
team_create → spawnXxxTeammate → 自动创建窗格/进程
                                → 自动注入身份
                                → 自动启动轮询
                                → 队员开始工作
```

用户只需要说一句话，其他全自动。

---

## 十、为什么实际使用时没有看到 tmux 窗口？

### 10.1 最可能的原因：默认用的是 in-process

回顾后端选择逻辑：

```typescript
// team_create 时的默认行为
agent.backend 未指定 → 默认 "in-process"
```

**in-process 队员不创建任何可见窗口**。它们在同一个 Node.js 进程内通过 `AsyncLocalStorage` 隔离上下文、通过内存 Mailbox 通信。用户看到的终端没有任何变化——只是回复更快了（因为多个队员在并行工作）。

```
用户说 "创建研究团队"
        │
        ▼
team_create 被调用
        │
        ▼
agent.backend 未指定 → 默认 in-process
        │
        ▼
spawnInProcessTeammate()
  ├── 不创建 tmux 窗格（没有 split-window）
  ├── 不弹出 iTerm2 窗口
  ├── 只在进程内启动运行循环
  └── 用户终端画面毫无变化
        │
        ▼
用户看到的结果：像什么都没发生一样
但实际上：队员已经在后台并行工作了
```

### 10.2 就像"你看不到线程，但线程确实在跑"

in-process teammate 对用户来说是**完全透明的**——类似于操作系统调度线程：

```
你打开一个 App → 操作系统创建了多个线程
你看不到这些线程，但它们确实在并行运行

同理：
你说"创建团队" → Claude Code spawn 了多个 in-process 队员
你看不到窗格，但它们确实在并行调用 API、执行工具
```

### 10.3 什么时候才会看到 tmux 窗口？

只有两种可能：

**可能一：LLM 明确指定了 `backend: "tmux"`**

```
用户: "创建研究团队，把研究员放在独立的 tmux 窗格里让我能看到"
  → LLM 在 team_create 中加入 backend: "tmux"
  → spawnTmuxTeammate() 被调用
  → tmux split-window 被执行
  → ✅ 用户看到新窗格出现
```

**可能二：功能可能被 Feature Flag 控制**

从 free-code 的架构中可以看到 `statsig.ts`（功能开关服务）。Teammate 的 tmux 后端可能被 feature flag 控制，在部分用户/版本中未启用。

### 10.4 如何验证队员确实在后台运行？

虽然看不到 tmux 窗格，但可以通过以下方式验证 in-process 队员的存在：

```
1. 注意响应速度
   → 如果你让团队同时分析 3 个模块，结果比串行快 2-3 倍
   → 这就是并行队员在工作的证据

2. 注意 API 调用次数
   → 如果 token 消耗比平时多（多个队员各自调用 API）
   → 后台确实有多个队员在工作

3. 注意队员的消息回复
   → 队员完成工作后会通过 send_message 汇报给领导
   → 这些消息会出现在对话中
```

### 10.5 设计意图：默认 invisible

这不是 bug，是**有意为之**：

```
设计者的权衡：

in-process（默认）:
  ✅ 零摩擦——用户不需要应对突然出现的窗格
  ✅ 不乱——用户终端布局保持不变
  ✅ 快——没有进程启动开销
  ❌ 不可见——用户不知道队员在干什么

tmux（需显式指定）:
  ✅ 可视化——用户能看到队员的完整输出
  ✅ 可交互——用户可以切到队员窗格直接操作
  ❌ 有摩擦——终端布局改变，用户可能困惑
  ❌ 慢——需要创建窗格、启动进程
```

**哲学**：默认选择"不打扰用户"的方案（in-process），只有用户明确需要可视化时才创建窗口。

### 10.6 结论

| 你的体验 | 原因 |
|---------|------|
| 说"创建团队"，没看到 tmux 窗口 | ✅ 正常——默认 in-process，看不见是预期行为 |
| 队员确实在工作（并行、更快） | ✅ 正常——in-process 队员在后台静默运行 |
| 想看到 tmux 窗格 | 需要明确告诉 LLM "用 tmux 窗格显示队员" |
| 功能完全没有反应 | ⚠️ 可能 Teammate 功能在当前版本/账户中未启用 |
