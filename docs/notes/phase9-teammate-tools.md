# Phase 9 源码研读：Team 协作工具系统

> 参考源码：`free-code/src/tools/TeamTool/`、`free-code/src/utils/teamHelpers.ts`、`free-code/src/utils/teamDiscovery.ts`

## 1. 概述

Team 协作工具系统是 Claude Code 用于多 Agent 协作的核心机制。与 Fork Subagent 不同，Team 系统支持：
- **持久化团队**：成员可多次通信
- **结构化消息**：支持 broadcast、direct、leader 路由
- **多后端支持**：tmux/iTerm2 远程 + in-process + UDS socket

cc-study 简化设计：**仅支持 in-process teammate**，不实现 tmux/iTerm2 pane 管理。

## 2. TeamCreateTool — 团队创建

### 2.1 执行流程

```typescript
// free-code/src/tools/TeamTool/teamCreate.ts

export const teamCreateTool = {
  name: 'team_create',
  description: 'Creates a new team of agents',

  async execute(params: { name: string; agents?: AgentDefinition[] }, context: ToolContext) {
    // Step 1: 检查重名
    if (checkDuplicateTeamName(params.name)) {
      throw new Error(`Team '${params.name}' already exists`)
    }

    // Step 2: 生成唯一 ID（带时间戳 + 随机后缀）
    const teamId = generateTeamId(params.name)

    // Step 3: 构建 TeamFile（团队元数据）
    const teamFile: TeamFile = {
      id: teamId,
      name: params.name,
      members: params.agents ?? [],
      leadAgentId: context.agentId,  // 创建者作为 leader
      createdAt: Date.now(),
      config: {
        backends: ['in-process'],  // cc-study 简化
      },
    }

    // Step 4: 写入磁盘（~/.claude/teams/{team}/team.json）
    const teamPath = getTeamFilePath(params.name)
    await writeFile(teamPath, JSON.stringify(teamFile))

    // Step 5: 初始化 inbox 目录
    await createTeamDirectories(params.name)

    // Step 6: 设置 context（当前 agent 切换到 team-lead 模式）
    context.setActiveTeam(teamId)
    context.currentTeam = teamId

    return { output: `Team '${params.name}' created with ID: ${teamId}` }
  }
}
```

### 2.2 TeamFile Schema

```typescript
// free-code/src/types/team.ts

interface TeamFile {
  id: string
  name: string
  members: AgentDefinition[]      // 团队成员列表
  leadAgentId: string            // Leader Agent ID
  createdAt: number
  config: {
    backends: ('tmux' | 'iterm2' | 'in-process' | 'uds')[]  // 支持的后端
    permissions?: PermissionConfig
  }
}

interface AgentDefinition {
  id: string
  name: string
  agentType: string
  tools: string[]
  backend?: 'tmux' | 'iterm2' | 'in-process' | 'uds'
}
```

### 2.3 Key Design: Leader 不设置 CLAUDE_CODE_AGENT_ID

```typescript
// 关键设计：Leader 保持原 agentId，不切换到 team-lead

// ❌ 错误理解：leader 需要设置 CLAUDE_CODE_AGENT_ID 环境变量
// ✅ 实际设计：leader 通过 AppState.teamRole = 'lead' 标识角色

// 原因：
// 1. Leader 可能是已存在的 agent，有自己的 agentId
// 2. TeamFile.leadAgentId 已经记录了谁是 leader
// 3. 环境变量 CLAUDE_CODE_AGENT_ID 是给 remote pane 用的（tmux/iTerm2）
// 4. In-process teammate 不需要这个环境变量

context.setTeamContext({
  role: 'lead',
  teamId,
  agentId: context.agentId  // 保持原值
})
```

## 3. SendMessageTool — 消息发送

### 3.1 路由逻辑

```typescript
// free-code/src/tools/TeamTool/sendMessage.ts

export const sendMessageTool = {
  name: 'send_message',
  description: 'Send a message to teammate(s)',

  async execute(params: {
    to: string          // "*" | "team-lead" | "agent-name" | "uds:<path>" | "bridge:<id>"
    message: string
    messageType?: 'text' | 'shutdown_request' | 'shutdown_response' | 'plan_approval_response'
  }, context: ToolContext) {

    // 路由分发
    if (params.to === '*') {
      // 广播模式：发送给所有成员
      await broadcastToTeam(context.currentTeam, params.message)
    } else if (params.to === 'team-lead') {
      // 发送给 leader
      await sendToLeader(context.currentTeam, context.agentId, params.message)
    } else if (params.to.startsWith('uds:') || params.to.startsWith('bridge:')) {
      // 扩展路由：UDS socket 或 Bridge（cc-study 不实现）
      await sendToExternalEndpoint(params.to, params.message)
    } else {
      // 直接消息：发送给指定成员
      await sendToTeammate(context.currentTeam, params.to, params.message)
    }

    return { output: `Message sent to ${params.to}` }
  }
}
```

### 3.2 结构性消息类型

```typescript
// 预定义的消息类型用于协作控制

type StructuredMessageType =
  | 'shutdown_request'      // 请求成员关闭
  | 'shutdown_response'     // 关闭响应
  | 'plan_approval_response' // 计划审批响应
  | 'idle_notification'      // 空闲通知
  | 'permission_request'    // 权限请求（teammate → leader）
  | 'permission_response'   // 权限响应（leader → teammate）

interface StructuredMessage {
  type: StructuredMessageType
  from: string
  to: string
  payload: Record<string, unknown>
  timestamp: number
}
```

### 3.3 Bridge/UDS 扩展（cc-study 简化）

```typescript
// cc-study 不实现以下扩展：

// UDS (Unix Domain Socket)：用于同主机进程间通信
// to="uds:/tmp/my-team.sock"

// Bridge：用于跨主机通信（通过 WebSocket 桥接）
// to="bridge:bridge-id-123"

// cc-study 简化：只支持 in-process，通过 AppState.inboxes 直接传递
```

## 4. In-Process Teammate（spawnInProcess.ts）

### 4.1 spawnInProcessTeammate 完整流程

```typescript
// free-code/src/tools/TeamTool/spawnInProcess.ts

export async function spawnInProcessTeammate(
  teamId: string,
  agent: AgentDefinition,
  leaderAbortController: AbortController  // ⚠️ 注意：这是 leader 的 controller
): Promise<InProcessTeammateHandle> {

  // Step 1: 生成唯一 agentId
  const agentId = `teammate-${agent.name}-${generateShortId()}`

  // Step 2: 创建独立的 AbortController（关键设计！）
  // ⚠️ 这是独立于 leader 的，不链接到 leaderAbortController
  const abortController = new AbortController()

  // Step 3: 构建 TeammateContext（与 Leader 隔离的上下文）
  const teammateContext: TeammateContext = {
    agentId,
    teamId,
    agentType: agent.agentType,
    tools: agent.tools,
    abortSignal: abortController.signal,
    // ⚠️ 独立的消息历史，不共享 leader 的 messages
    messages: [],
    // 独立的工作目录
    workingDirectory: getTeamWorkingDir(teamId),
    // 独立的权限模式
    permissionMode: agent.permissionMode ?? 'ask',
  }

  // Step 4: 注册到 AppState（关键设计：teammate 是 "first-class citizen"）
  AppState.set(agentId, {
    type: 'in-process',
    status: 'running',
    agentType: agent.agentType,
    abortController,  // 存储独立的 controller
    context: teammateContext,
  })

  // Step 5: 启动独立的任务循环
  const taskId = taskManager.createTask({
    agentId,
    type: 'teammate',
    abortSignal: abortController.signal,
  })

  // 异步启动，不阻塞 leader
  runInProcessTeammateLoop(teammateContext, taskId)

  return {
    agentId,
    abort: () => abortController.abort(),
    getStatus: () => AppState.get(agentId)?.status,
  }
}
```

### 4.2 Key Design: 独立的 AbortController

```typescript
// 关键设计洞察：

// ❌ 不要错误理解：
// abortController = new AbortController(leaderAbortController)  // 这样链接

// ✅ 正确理解：
const abortController = new AbortController()  // 完全独立

// 为什么这样设计？
// 1. Leader abort 时不应该自动 abort 所有 teammate
// 2. Teammate 应该能独立完成工作，不受 leader 影响
// 3. Leader 可以通过 send_message('shutdown_request') 优雅关闭 teammate
// 4. 这样 teammate 才是 "first-class citizen"，不是 leader 的 "subtask"

// Leader 如何关闭 teammate？
// 1. Leader 发送 shutdown_request
// 2. Teammate 收到后优雅停止（调用 abortController.abort()）
// 3. Teammate 发送 shutdown_response
```

## 5. In-Process Teammate（inProcessRunner.ts）

> ⚠️ free-code 中该文件有 **1552 行**，是 Team 系统最复杂的部分

### 5.1 核心循环结构

```typescript
// free-code/src/tools/TeamTool/inProcessRunner.ts

export async function runInProcessTeammateLoop(
  context: TeammateContext,
  taskId: string
): Promise<void> {

  while (!context.abortSignal.aborted) {

    // Step 1: 构建消息（从 team inbox 读取 + 历史消息）
    const messages = await buildTeammateMessages(context)

    // Step 2: 调用 streamChat（与 leader 相同的 API 调用模式）
    const streamResult = await streamChat({
      messages,
      systemPrompt: getTeammateSystemPrompt(context),
      tools: context.tools,
      signal: context.abortSignal,
    })

    // Step 3: 收集 blocks（text / tool_use / thinking）
    const blocks = collectBlocks(streamResult)

    // Step 4: 如果有 tool_use，执行权限检查 + 工具
    for (const block of blocks) {
      if (block.type === 'tool_use') {
        // 权限检查（teammate 不能独立决定，需要请求 leader）
        const allowed = await checkToolPermission(context, block.toolName)
        if (!allowed) {
          // 请求 leader 批准（通过 inbox 文件）
          await sendPermissionRequestToLeader(context, block.toolName)
          // 等待响应（轮询 inbox）
          const response = await waitForPermissionResponse(context, block.toolName)
          if (!response.approved) continue
        }

        // 执行工具
        const result = await executeTool(block.toolName, block.toolInput, context)

        // 将结果添加到消息历史
        context.messages.push(createToolResultMessage(block.id, result))
      }
    }

    // Step 5: 如果是 idle 状态，发送 idle_notification
    if (streamResult.isIdle) {
      await sendIdleNotification(context)
    }
  }
}
```

### 5.2 权限同步（permissionSync）

```typescript
// permissionSync 是 "微型的分布式系统" 模式

// Teammate 端：
async function sendPermissionRequestToLeader(
  context: TeammateContext,
  toolName: string
): Promise<void> {
  const request = {
    type: 'permission_request',
    from: context.agentId,
    toolName,
    timestamp: Date.now(),
  }

  // 写入 leader 的 inbox（文件系统的 inbox 目录）
  const leaderInboxPath = getLeaderInboxPath(context.teamId)
  await writeFile(`${leaderInboxPath}/${context.agentId}-${Date.now()}.json`,
    JSON.stringify(request))
}

// Leader 端（需要实现 permission UI）：
async function checkLeaderInbox(): Promise<void> {
  const inboxPath = getLeaderInboxPath(AppState.currentTeam)
  const files = await readdir(inboxPath)

  for (const file of files) {
    const request = JSON.parse(await readFile(file))

    if (request.type === 'permission_request') {
      // 弹出 UI 让用户确认
      const approved = await showPermissionDialog(request.toolName)

      // 写入响应到 teammate 的 inbox
      const responsePath = getTeammateInboxPath(context.teamId, request.from)
      await writeFile(`${responsePath}/${file}`, JSON.stringify({
        type: 'permission_response',
        approved,
      }))
    }
  }
}

// Teammate 端等待响应：
async function waitForPermissionResponse(
  context: TeammateContext,
  toolName: string
): Promise<{ approved: boolean }> {
  const inboxPath = getTeammateInboxPath(context.teamId, context.agentId)

  // 轮询直到收到响应或超时
  for (let i = 0; i < 30; i++) {  // 30 * 200ms = 6s 超时
    const files = await readdir(inboxPath)
    const responseFile = files.find(f => f.includes('permission_response'))

    if (responseFile) {
      const response = JSON.parse(await readFile(`${inboxPath}/${responseFile}`))
      await deleteFile(`${inboxPath}/${responseFile}`)
      return { approved: response.approved }
    }

    await sleep(200)
  }

  return { approved: false }
}
```

### 5.3 Compact 支持

```typescript
// free-code 支持上下文压缩（类似 /compact 命令）

const autoCompactThreshold = 0.85  // 使用 85% 时自动压缩

async function checkAndCompact(context: TeammateContext): Promise<void> {
  const usage = await calculateTokenUsage(context.messages)

  if (usage.ratio > autoCompactThreshold) {
    // 调用 compact 算法（与 /compact 命令相同）
    const compacted = await compactMessages(context.messages)
    context.messages = compacted

    // 发送通知给 leader
    await sendMessage(context, 'team-lead', {
      type: 'context_compacted',
      newTokenCount: calculateTokens(compacted),
    })
  }
}
```

### 5.4 Stop Hook（idle_notification）

```typescript
// Teammate 完成任务时发送 idle_notification

async function sendIdleNotification(context: TeammateContext): Promise<void> {
  await sendMessage(context, 'team-lead', {
    type: 'idle_notification',
    agentId: context.agentId,
    reason: 'task_complete',  // 或 'waiting_for_input', 'blocked'
  })
}

// Leader 收到后可以决定是否关闭 teammate 或发送新任务
```

## 6. teamHelpers.ts — 团队文件操作

### 6.1 目录结构

```typescript
// ~/.claude/teams/{team-name}/
//   ├── team.json           # 团队元数据（TeamFile）
//   ├── config.json         # 团队配置（可选）
//   └── inboxes/
//       ├── leader/         # leader 的 inbox（teammate 写，leader 读）
//       └── {teammate-name}/ # 每个 teammate 的 inbox

const getTeamBasePath = (teamName: string) =>
  `${getClaudeDir()}/teams/${teamName}`

const getTeamFilePath = (teamName: string) =>
  `${getTeamBasePath(teamName)}/team.json`

const getInboxPath = (teamName: string, agentId: string) =>
  `${getTeamBasePath(teamName)}/inboxes/${agentId}`
```

### 6.2 生命周期管理

```typescript
// 创建团队
async function createTeam(teamName: string, config: TeamConfig): Promise<void> {
  const basePath = getTeamBasePath(teamName)

  // 创建目录结构
  await mkdirp(`${basePath}/inboxes/leader`)
  await mkdirp(`${basePath}/inboxes`)

  // 写入 team.json
  await writeFile(`${basePath}/team.json`, JSON.stringify(config))

  // 注册清理函数（SIGINT / SIGTERM 时调用）
  registerCleanup(`team-${teamName}`, async () => {
    await cleanupTeam(teamName)
  })
}

// 成员加入
async function joinTeam(teamName: string, agent: AgentDefinition): Promise<void> {
  const teamFile = await readTeamFile(teamName)
  teamFile.members.push(agent)
  await writeTeamFile(teamName, teamFile)

  // 创建 inbox 目录
  await mkdirp(getInboxPath(teamName, agent.id))
}

// 成员离开
async function leaveTeam(teamName: string, agentId: string): Promise<void> {
  const teamFile = await readTeamFile(teamName)
  teamFile.members = teamFile.members.filter(m => m.id !== agentId)
  await writeTeamFile(teamName, teamFile)

  // 清理 inbox
  await rmrf(getInboxPath(teamName, agentId))
}

// 清理（退出时）
async function cleanupTeam(teamName: string): Promise<void> {
  const teamFile = await readTeamFile(teamName)

  // 通知所有成员关闭
  for (const member of teamFile.members) {
    if (member.backend === 'tmux' || member.backend === 'iterm2') {
      // 关闭远程 pane
      await killPane(member.paneId)
    }
  }

  // 删除目录（最后一步）
  await rmrf(getTeamBasePath(teamName))
}
```

### 6.3 关键设计：SIGINT 时 kill pane BEFORE 删除目录

```typescript
// free-code 的清理顺序非常关键：

async function cleanupTeamOnSigint(teamName: string): Promise<void> {
  const teamFile = await readTeamFile(teamName)

  // ⚠️ 第一步：先 kill 所有远程 pane
  // 如果先删目录，pane 还在运行但目录没了，会导致 zombie 进程
  for (const member of teamFile.members) {
    if (member.backend === 'tmux' || member.backend === 'iterm2') {
      await killPane(member.paneId)  // 关闭 tmux/iTerm2 pane
    }
  }

  // 第二步：发送 shutdown_request 给 in-process teammate
  for (const member of teamFile.members) {
    if (member.backend === 'in-process') {
      await sendMessage(member.id, 'shutdown_request')
    }
  }

  // 第三步：等待短暂时间让 member 优雅关闭
  await sleep(500)

  // 第四步：最后删除目录
  await rmrf(getTeamBasePath(teamName))
}
```

## 7. teamDiscovery.ts — 团队发现

### 7.1 获取成员状态

```typescript
// free-code/src/utils/teamDiscovery.ts

export async function getTeammateStatuses(
  teamName: string
): Promise<TeammateStatus[]> {
  // Step 1: 读取 team.json
  const teamFile = await readTeamFile(teamName)

  // Step 2: 过滤掉 team-lead（leader 自己不需要状态）
  const members = teamFile.members.filter(m => m.id !== teamFile.leadAgentId)

  // Step 3: 映射到状态
  return members.map(member => ({
    id: member.id,
    name: member.name,
    agentType: member.agentType,
    isActive: isActive(member.id),  // 来自 AppState
    lastSeen: getLastSeen(member.id),
  }))
}

// 状态管理
export function setMemberActive(agentId: string, active: boolean): void {
  AppState.set(`status:${agentId}`, {
    isActive: active,
    lastSeen: Date.now(),
  })
}

export function isActive(agentId: string): boolean {
  const status = AppState.get(`status:${agentId}`)
  return status?.isActive ?? false
}
```

## 8. 简化设计对比（cc-study vs free-code）

| 特性 | free-code | cc-study |
|------|-----------|----------|
| **TeamFile 路径** | `~/.claude/teams/{team}/config.json` + `team.json` | 仅 `team.json` |
| **后端支持** | tmux + iTerm2 + in-process + UDS + Bridge | 仅 in-process |
| **AppState** | 完整的状态管理（status、inbox、context） | 简化版 |
| **spawnMultiAgent** | 支持 tmux/iTerm2 多 pane 并行 | 不实现 |
| **InProcessTeammate** | 1552 行的复杂 runner | 简化为函数 |
| **permissionSync** | 通过 inbox 文件的请求响应机制 | 不实现 |
| **compact 支持** | autoCompactThreshold 自动压缩 | 不实现 |
| **Perfetto tracing** | 完整的分布式追踪 | 不实现 |
| **cleanupSessionTeams** | 复杂的多层清理（kill pane → rm dir） | 简化 rm dirs |

## 9. 学习心得

### 9.1 独立的 AbortController 使 Teammate 成为 "first-class citizen"

在 Fork Subagent 中，子进程的 AbortController 通常链接到父进程。但 Team 系统不同：

```typescript
// Fork 模式（链接）：
const abortController = new AbortController(leaderAbortController.signal)

// Team 模式（独立）：
const abortController = new AbortController()  // 完全独立
```

这意味着：
- Leader abort 不自动终止 teammate
- Teammate 有独立的生命周期
- Leader 必须通过 `send_message('shutdown_request')` 优雅关闭

这是架构设计的选择：**Teammate 不是 Leader 的 "subtask"，而是平等的协作者**。

### 9.2 permissionSync 是 "微型分布式系统"

通过文件系统（inbox 目录）实现请求响应模式：

```
Teammate                          Leader
    │                                 │
    │  写: inbox/leader/req-123.json  │
    │ ─────────────────────────────► │
    │                                 │
    │         [用户确认 UI]           │
    │                                 │
    │  读: inbox/leader/req-123.json  │
    │ ◄───────────────────────────── │
    │                                 │
    │  写: inbox/teammate/res-123.json│
    │ ─────────────────────────────► │
    │                                 │
    │  读: inbox/teammate/res-123.json│
    │ ◄───────────────────────────── │
    │                                 │
```

这是一种 **文件-based RPC**，无需网络协议。

### 9.3 TeamFile 是 "配置 + 运行时状态"

TeamFile 不只是静态配置，还记录运行时状态：

```typescript
interface TeamFile {
  // 元数据（配置）
  id: string
  name: string
  members: AgentDefinition[]
  leadAgentId: string

  // 运行时状态
  isActive: boolean
  lastActivity: number
  status: 'running' | 'paused' | 'shutdown'
}
```

这使得：
- 团队可以在重启后恢复
- 状态变化可以持久化
- 可以实现 "团队快照"

### 9.4 清理链完整性：顺序非常重要

```typescript
// 错误顺序（会导致 zombie）：
await rmrf(teamDir)     // 先删目录
await killPane(paneId)  // pane 还在，但目录没了，无法清理

// 正确顺序：
await killPane(paneId)  // 先关闭 pane
await sendShutdown()    // 优雅关闭 in-process
await sleep(500)        // 等待清理完成
await rmrf(teamDir)     // 最后删目录
```

清理顺序是 **资源释放 → 优雅关闭 → 最终清理**。

### 9.5 防递归 Agent Guard

```typescript
// 在 team 模式下，Agent 工具被禁用（防止递归）

const TEAM_WORKER_TOOLS = [
  'Read', 'Write', 'Edit', 'Bash',
  'Glob', 'Grep', 'WebSearch', 'WebFetch',
  // ⚠️ 明确排除：
  // 'Agent',           // 禁用 Agent 工具
  // 'team_create',     // 禁用创建新 team
]

// 实现：
const disallowedTools = ['Agent', 'team_create']

function canUseTool(toolName: string): boolean {
  return !disallowedTools.includes(toolName)
}
```

这确保：
- Teammate 不会创建新的 sub-agent
- Teammate 不会加入其他 team
- 保持团队结构的稳定性