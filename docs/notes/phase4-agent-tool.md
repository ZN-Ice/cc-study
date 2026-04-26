# Phase 4: AgentTool 子Agent系统 - 源码研读笔记

> 研读日期: 2026-04-22
> 参考源码: `free-code/src/tools/AgentTool/`
> 任务编号: P4001

---

## 一、AgentTool 总体架构

### 1.1 模块文件清单

```
free-code/src/tools/AgentTool/
├── AgentTool.tsx          # 主工具定义，参数Schema，Agent派生入口（~1400行，核心）
├── runAgent.ts            # 子Agent执行引擎，query循环驱动（~930行）
├── loadAgentsDir.ts       # Agent类型定义，发现/加载/解析（~756行）
├── builtInAgents.ts       # 内置Agent注册入口
├── built-in/
│   ├── generalPurposeAgent.ts  # 通用Agent定义
│   ├── exploreAgent.ts         # 代码探索Agent（只读）
│   ├── planAgent.ts            # 架构规划Agent（只读）
│   ├── verificationAgent.ts    # 验证Agent
│   ├── claudeCodeGuideAgent.ts # Claude Code指南Agent
│   └── statuslineSetup.ts      # 状态栏设置Agent
├── agentToolUtils.ts      # 工具过滤、结果终结、异步生命周期
├── prompt.ts              # Agent工具的LLM可见描述文本
├── constants.ts           # 常量（工具名、一次性Agent列表）
├── forkSubagent.ts        # Fork子Agent实验特性（上下文继承）
├── resumeAgent.ts         # 恢复已终止的Agent
├── agentColorManager.ts   # Agent颜色管理（UI显示）
├── agentMemory.ts         # Agent持久化记忆
├── agentMemorySnapshot.ts # 记忆快照管理
├── agentDisplay.ts        # Agent显示名映射
└── UI.tsx                 # Ink UI渲染组件
```

### 1.2 核心数据流

```
LLM 返回 tool_use: Agent({prompt, subagent_type, ...})
    │
    ▼
AgentTool.call()  ─── AgentTool.tsx
    │
    ├─ 解析 subagent_type → 查找 AgentDefinition
    ├─ 权限检查（filterDeniedAgents）
    ├─ MCP Server 前置检查
    ├─ 组装工具池（assembleToolPool，独立于父Agent）
    │
    ├─ [异步路径] ──────────────────────────────┐
    │   registerAsyncAgent()                     │
    │   void runAsyncAgentLifecycle()            │
    │   立即返回 {status: 'async_launched'}       │
    │                                            │
    ├─ [同步路径] ──────────────────────────────┐
    │   runAgent() → AsyncGenerator<Message>     │
    │   迭代收集消息                              │
    │   finalizeAgentTool() → 返回结果            │
    │                                            │
    └────────────────────────────────────────────┘
                    │
                    ▼
            mapToolResultToToolResultBlockParam()
            将结果转为 tool_result 回传给 LLM
```

### 1.3 设计哲学

1. **Agent 即工具**: 子Agent作为标准 Tool 注册，LLM 通过 `tool_use` 调用，与 FileRead/Bash 等工具一致
2. **独立工具池**: Worker 拥有独立的权限上下文和工具池，不受父Agent工具限制影响
3. **结果不可见原则**: 子Agent输出对用户不可见，父Agent必须主动转述结果
4. **缓存友好**: Fork路径复用父Agent的精确系统提示词和工具定义，实现字节级缓存命中

---

## 二、AgentTool.tsx - 主工具定义

### 2.1 参数Schema (inputSchema)

```typescript
type AgentToolInput = {
  // 基础参数
  description: string     // 3-5字任务描述
  prompt: string          // 给Agent的任务指令
  subagent_type?: string  // Agent类型选择

  // 模型控制
  model?: 'sonnet' | 'opus' | 'haiku'

  // 后台执行
  run_in_background?: boolean

  // 多Agent（Agent Swarms）参数
  name?: string           // Agent命名（用于SendMessage路由）
  team_name?: string      // 团队名
  mode?: PermissionMode   // 权限模式

  // 隔离模式
  isolation?: 'worktree' | 'remote'
  cwd?: string            // 工作目录覆盖
}
```

关键设计:
- `subagent_type` 在 Fork 实验开启时变为可选，省略时触发 Fork 路径
- `run_in_background` 在 Fork 模式下被 `.omit()` 移除（Fork 强制异步）
- `isolation: 'worktree'` 创建独立 git worktree 给 Agent 工作

### 2.2 输出Schema (outputSchema)

```typescript
type Output =
  | { status: 'completed', agentId, content, totalTokens, ... }  // 同步完成
  | { status: 'async_launched', agentId, outputFile, ... }        // 异步启动
  | { status: 'teammate_spawned', ... }     // 多Agent模式（内部类型）
  | { status: 'remote_launched', ... }      // 远程执行（内部类型）
```

### 2.3 call() 方法核心流程

`call()` 是整个 AgentTool 的入口，约 1000 行，处理完整生命周期:

**阶段一：参数解析与Agent选择**

```
subagent_type 有值 → 查找对应 AgentDefinition
subagent_type 省略 + Fork开启 → Fork路径（FORK_AGENT）
subagent_type 省称 + Fork关闭 → 默认 general-purpose
```

Fork 路径的特殊处理:
- 子Agent继承父Agent的完整对话上下文
- 系统提示词复用父Agent的精确字节（`toolUseContext.renderedSystemPrompt`）
- 工具池使用父Agent的原始工具数组（`useExactTools: true`）

**阶段二：递归防护**

```typescript
// 防止 Fork 嵌套
if (toolUseContext.options.querySource === `agent:builtin:fork` ||
    isInForkChild(toolUseContext.messages)) {
  throw new Error('Fork is not available inside a forked worker.')
}
```

检测方式双重保障:
1. `querySource` 检查（压缩安全，设置在 context.options 上）
2. 消息内容扫描（查找 `<fork_boilerplate>` 标签）

**阶段三：多Agent Spawn检查**

```typescript
// Teammates 不能嵌套 Spawn 其他 Teammates
if (isTeammate() && teamName && name) {
  throw new Error('Teammates cannot spawn other teammates.')
}
// In-process teammates 不能后台执行
if (isInProcessTeammate() && run_in_background) {
  throw new Error('In-process teammates cannot spawn background agents.')
}
```

**阶段四：异步/同步分支**

- 异步条件: `run_in_background || background:true || coordinatorMode || forceAsync`
- 异步: 注册 `registerAsyncAgent()` → `void runAsyncAgentLifecycle()` → 立即返回
- 同步: 迭代 `runAgent()` 的 `AsyncGenerator` → 收集消息 → `finalizeAgentTool()`

**阶段五：同步转后台**

同步 Agent 在运行过程中可被转为后台:
```typescript
// 注册为前台任务（可被 backgroundAll() 触发）
const { backgroundSignal } = registerAgentForeground(...)

// 循环中竞速等待
while (true) {
  const raceResult = await Promise.race([
    nextMessagePromise,
    backgroundPromise
  ])
  if (raceResult.type === 'background') {
    // 启动后台续跑，返回 async_launched
  }
}
```

### 2.4 Worktree 隔离

```typescript
// 创建隔离的 git worktree
const worktreeInfo = await createAgentWorktree(`agent-${agentId.slice(0, 8)}`)

// 执行时通过 CWD 覆盖
const wrapWithCwd = (fn) =>
  cwdOverridePath ? runWithCwdOverride(cwdOverridePath, fn) : fn()

// 完成后自动清理（无变更时删除 worktree）
if (!await hasWorktreeChanges(worktreePath, headCommit)) {
  await removeAgentWorktree(worktreePath, worktreeBranch, gitRoot)
}
```

### 2.5 checkPermissions 实现

```typescript
async checkPermissions(input, context): Promise<PermissionResult> {
  // auto 模式下需要通过分类器
  if (appState.toolPermissionContext.mode === 'auto') {
    return { behavior: 'passthrough', message: '...' }
  }
  // 其他模式自动允许（权限检查委托给子Agent内部工具）
  return { behavior: 'allow', updatedInput: input }
}
```

设计决策: AgentTool 自身不做权限拦截，因为子Agent内部使用的工具会各自进行权限检查。

### 2.6 mapToolResultToToolResultBlockParam

将内部结果转为 LLM 可读的 `tool_result`:

- `async_launched`: 告知 LLM 后台运行中，包含 outputFile 路径
- `completed`: 包含 Agent 输出内容 + usage 统计
- `teammate_spawned` / `remote_launched`: 内部类型，转为可读文本

优化: 一次性内置Agent（Explore/Plan）跳过 SendMessage 提示，节省 token。

---

## 三、runAgent.ts - 子Agent执行引擎

### 3.1 核心函数签名

```typescript
export async function* runAgent({
  agentDefinition,    // Agent 定义
  promptMessages,     // 初始提示消息
  toolUseContext,     // 工具使用上下文
  canUseTool,         // 权限检查函数
  isAsync,            // 是否异步
  override,           // 可选覆盖（systemPrompt, abortController, agentId）
  model,              // 模型别名
  maxTurns,           // 最大轮次
  availableTools,     // 预计算的工具池
  allowedTools,       // 允许的工具列表
  forkContextMessages,// Fork路径的父上下文消息
  useExactTools,      // 是否直接使用给定工具（Fork路径）
  worktreePath,       // worktree 路径
  ...
}): AsyncGenerator<Message, void>
```

### 3.2 执行流程

```
1. 初始化 Agent ID
2. 计算权限模式（agentPermissionMode 可能覆盖父模式）
3. 解析工具集（resolveAgentTools 或 useExactTools）
4. 构建 Agent 系统提示词
5. 初始化 MCP Server（agent 定义中的 mcpServers）
6. 合并工具池（resolvedTools + agentMcpTools）
7. 创建 subagentContext（独立或共享的 ToolUseContext）
8. 执行 SubagentStart Hooks
9. 注册 Agent 的 frontmatter Hooks
10. 预加载 Agent 指定的 Skills
11. 记录 sidechain transcript
12. 进入 query() 循环
13. yield 消息给调用者
14. finally 清理（MCP、hooks、文件缓存、transcript等）
```

### 3.3 权限模式覆盖逻辑

```typescript
// Agent 定义可覆盖父权限模式，但以下模式始终优先:
// - bypassPermissions（管理员强制）
// - acceptEdits（自动编辑）
// - auto（AI分类器模式）
if (agentPermissionMode &&
    mode !== 'bypassPermissions' &&
    mode !== 'acceptEdits' &&
    !(feature('TRANSCRIPT_CLASSIFIER') && mode === 'auto')) {
  toolPermissionContext = { ...toolPermissionContext, mode: agentPermissionMode }
}
```

异步 Agent 特殊处理:
- `shouldAvoidPermissionPrompts = true`（无法显示 UI）
- Bubble 模式: 权限提示冒泡到父终端

### 3.4 工具权限隔离

```typescript
// Worker 的 allowedTools 替换所有 session 级规则
if (allowedTools !== undefined) {
  toolPermissionContext = {
    ...toolPermissionContext,
    alwaysAllowRules: {
      cliArg: state.toolPermissionContext.alwaysAllowRules.cliArg, // 保留SDK级权限
      session: [...allowedTools],  // 替换 session 级
    },
  }
}
```

### 3.5 CLAUDE.md 优化

```typescript
// 只读Agent（Explore/Plan）跳过 CLAUDE.md 加载
// 节省 ~5-15 Gtok/week（3400万+ Explore 调用/周）
const shouldOmitClaudeMd =
  agentDefinition.omitClaudeMd &&
  !override?.userContext &&
  getFeatureValue_CACHED_MAY_BE_STALE('tengu_slim_subagent_claudemd', true)

// gitStatus 同样对只读Agent是无效负载
const resolvedSystemContext =
  agentType === 'Explore' || agentType === 'Plan'
    ? systemContextNoGit
    : baseSystemContext
```

### 3.6 MCP Server 初始化

Agent 定义中的 `mcpServers` 是增量的，叠加在父 MCP 客户端之上:

```typescript
async function initializeAgentMcpServers(agentDefinition, parentClients) {
  // 支持两种格式:
  // 1. 字符串引用: "slack" → 查找已有配置
  // 2. 内联定义: { slack: { command: "...", args: [...] } }
  // 只清理内联创建的新客户端，共享客户端保留
}
```

### 3.7 Skill 预加载

Agent frontmatter 中的 `skills` 列表在启动时预加载:

```typescript
// 解析策略: 直接匹配 → plugin前缀匹配 → 后缀匹配
function resolveSkillName(skillName, allSkills, agentDefinition): string | null
```

### 3.8 消息过滤

Fork 路径继承父消息时，过滤不完整的工具调用:

```typescript
export function filterIncompleteToolCalls(messages: Message[]): Message[] {
  // 收集有 tool_result 的 tool_use_id
  // 过滤掉包含无结果 tool_use 的 assistant 消息
  // 防止 API 报错（orphaned tool calls）
}
```

### 3.9 清理（finally 块）

```
- mcpCleanup()              清理 Agent 级 MCP Server
- clearSessionHooks()        清理会话级 Hooks
- cleanupAgentTracking()     清理 prompt cache 追踪
- readFileState.clear()      释放文件状态缓存
- initialMessages.length = 0 释放 fork 上下文
- unregisterPerfettoAgent()  释放追踪注册
- clearAgentTranscriptSubdir() 释放 transcript 子目录
- rootSetAppState(todos清理)  释放 Agent 的 todo 条目
- killShellTasksForAgent()    杀死后台 shell 任务
```

---

## 四、loadAgentsDir.ts - Agent类型系统

### 4.1 Agent 定义类型层次

```typescript
// 基础类型（所有Agent共有）
type BaseAgentDefinition = {
  agentType: string            // 唯一标识符
  whenToUse: string            // LLM 可见的用途描述
  tools?: string[]             // 允许的工具列表（默认 ['*']）
  disallowedTools?: string[]   // 禁止的工具列表
  skills?: string[]            // 预加载的 Skill
  mcpServers?: AgentMcpServerSpec[]  // Agent 级 MCP Server
  hooks?: HooksSettings        // 会话级 Hooks
  color?: AgentColorName       // UI 显示颜色
  model?: string               // 模型指定（'inherit' 继承父）
  effort?: EffortValue         // 推理力度
  permissionMode?: PermissionMode
  maxTurns?: number            // 最大轮次
  memory?: 'user'|'project'|'local'  // 持久化记忆范围
  isolation?: 'worktree'|'remote'    // 隔离模式
  omitClaudeMd?: boolean       // 跳过 CLAUDE.md
  background?: boolean         // 强制后台运行
  initialPrompt?: string       // 首轮消息前缀
  criticalSystemReminder_EXPERIMENTAL?: string
  requiredMcpServers?: string[]
  pendingSnapshotUpdate?: { snapshotTimestamp: string }
}

// 内置 Agent
type BuiltInAgentDefinition = BaseAgentDefinition & {
  source: 'built-in'
  baseDir: 'built-in'
  callback?: () => void
  getSystemPrompt: (params: { toolUseContext }) => string
}

// 用户/项目/策略 Agent
type CustomAgentDefinition = BaseAgentDefinition & {
  getSystemPrompt: () => string
  source: SettingSource   // 'userSettings' | 'projectSettings' | 'policySettings' | ...
  filename?: string
  baseDir?: string
}

// 插件 Agent
type PluginAgentDefinition = BaseAgentDefinition & {
  getSystemPrompt: () => string
  source: 'plugin'
  plugin: string
}

type AgentDefinition = BuiltInAgentDefinition | CustomAgentDefinition | PluginAgentDefinition
```

### 4.2 Agent 发现机制

```typescript
const getAgentDefinitionsWithOverrides = memoize(async (cwd): Promise<AgentDefinitionsResult> => {
  // 1. 加载内置 Agent
  const builtInAgents = getBuiltInAgents()

  // 2. 加载插件 Agent
  const pluginAgents = await loadPluginAgents()

  // 3. 加载自定义 Agent（从 .claude/agents/ 目录的 Markdown 文件）
  const markdownFiles = await loadMarkdownFilesForSubdir('agents', cwd)
  const customAgents = markdownFiles.map(parseAgentFromMarkdown)

  // 4. 合并：后注册覆盖先注册
  const activeAgents = getActiveAgentsFromList([...builtIn, ...plugin, ...custom])
})
```

优先级（后者覆盖前者）:
```
built-in → plugin → userSettings → projectSettings → flagSettings → policySettings
```

### 4.3 Markdown Agent 文件格式

```markdown
---
name: my-agent
description: "when to use this agent"
tools:
  - Bash
  - Read
  - Grep
disallowedTools:
  - Write
model: haiku
effort: low
permissionMode: plan
maxTurns: 10
color: blue
memory: project
isolation: worktree
background: false
initialPrompt: /init
mcpServers:
  - slack
skills:
  - my-skill
hooks:
  PreToolUse:
    - matcher: Bash
      command: "echo 'checking'"
---

You are a specialized agent for...
(system prompt content here)
```

### 4.4 MCP Server 依赖检查

```typescript
// Agent 可声明必需的 MCP Server
function hasRequiredMcpServers(agent, availableServers): boolean {
  return agent.requiredMcpServers.every(pattern =>
    availableServers.some(server =>
      server.toLowerCase().includes(pattern.toLowerCase())
    )
  )
}
```

---

## 五、builtInAgents.ts - 内置Agent注册

### 5.1 注册函数

```typescript
export function getBuiltInAgents(): AgentDefinition[] {
  // SDK 用户可禁用所有内置 Agent
  if (isEnvTruthy(CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS) && isNonInteractiveSession) {
    return []
  }

  // Coordinator 模式返回专用 Agent 集合
  if (isEnvTruthy(CLAUDE_CODE_COORDINATOR_MODE)) {
    return getCoordinatorAgents()
  }

  const agents = [GENERAL_PURPOSE_AGENT, STATUSLINE_SETUP_AGENT]

  // Explore/Plan Agent 受 GrowthBook 开关控制
  if (areExplorePlanAgentsEnabled()) {
    agents.push(EXPLORE_AGENT, PLAN_AGENT)
  }

  // 非 SDK 入口点包含 Claude Code 指南 Agent
  if (isNonSdkEntrypoint) {
    agents.push(CLAUDE_CODE_GUIDE_AGENT)
  }

  // 验证 Agent 受 GrowthBook 开关控制
  if (featureEnabled) {
    agents.push(VERIFICATION_AGENT)
  }

  return agents
}
```

### 5.2 内置Agent一览

| Agent | 类型 | 工具 | 模型 | 特点 |
|-------|------|------|------|------|
| general-purpose | 通用 | `*`（全部） | 继承 | 默认Agent，全功能 |
| Explore | 搜索 | 禁止Write/Edit/Agent/Notebook | haiku(外部)/inherit(内部) | 只读，省略CLAUDE.md |
| Plan | 规划 | 禁止Write/Edit/Agent/Notebook | inherit | 只读，架构规划 |
| verification | 验证 | 受限 | - | 受功能开关控制 |
| claude-code-guide | 指南 | - | - | 仅非SDK入口 |
| statusline-setup | 设置 | - | - | 状态栏配置 |

---

## 六、agentToolUtils.ts - 工具过滤与结果终结

### 6.1 工具过滤 (filterToolsForAgent)

```typescript
function filterToolsForAgent({ tools, isBuiltIn, isAsync, permissionMode }): Tools {
  return tools.filter(tool => {
    // MCP 工具始终允许
    if (tool.name.startsWith('mcp__')) return true

    // plan 模式允许 ExitPlanMode
    if (toolMatchesName(tool, EXITPlanMode) && permissionMode === 'plan') return true

    // 全局禁用列表（所有Agent都不能用）
    if (ALL_AGENT_DISALLOWED_TOOLS.has(tool.name)) return false

    // 自定义Agent额外禁用列表
    if (!isBuiltIn && CUSTOM_AGENT_DISALLOWED_TOOLS.has(tool.name)) return false

    // 异步Agent工具白名单
    if (isAsync && !ASYNC_AGENT_ALLOWED_TOOLS.has(tool.name)) {
      // 例外: Agent Swarms + In-process teammates
      // 允许 AgentTool + IN_PROCESS_TEAMMATE_ALLOWED_TOOLS
      return false
    }

    return true
  })
}
```

### 6.2 工具解析 (resolveAgentTools)

```typescript
function resolveAgentTools(agentDefinition, availableTools, isAsync): ResolvedAgentTools {
  // 三级过滤:
  // 1. filterToolsForAgent() - 全局/内置/异步过滤
  // 2. disallowedTools 排除
  // 3. tools 白名单（'*' 表示全部）

  // 特殊: Agent(x,y) 工具规格中的 agentType 限制
  // "Agent(worker, researcher)" → allowedAgentTypes = ["worker", "researcher"]
}
```

### 6.3 结果终结 (finalizeAgentTool)

```typescript
function finalizeAgentTool(agentMessages, agentId, metadata): AgentToolResult {
  // 提取最后一条 assistant 消息的文本内容
  // 如果最后一条无文本，回退到最近的含文本 assistant 消息

  // 统计指标
  const totalTokens = getTokenCountFromUsage(lastAssistantMessage.usage)
  const totalToolUseCount = countToolUses(agentMessages)

  // 发送分析事件
  logEvent('tengu_agent_tool_completed', { ... })

  // 缓存淘汰提示
  logEvent('tengu_cache_eviction_hint', { scope: 'subagent_end', ... })

  return { agentId, agentType, content, totalDurationMs, totalTokens, totalToolUseCount, usage }
}
```

### 6.4 异步Agent生命周期 (runAsyncAgentLifecycle)

```typescript
async function runAsyncAgentLifecycle({
  taskId, abortController, makeStream, metadata, ...
}): Promise<void> {
  try {
    // 迭代 makeStream()（即 runAgent()）
    for await (const message of makeStream(onCacheSafeParams)) {
      // 追加到 AppState（实时 UI）
      // 更新进度追踪
      // 发送 SDK 事件
    }

    // 终结结果
    completeAsyncAgent(agentResult, rootSetAppState)

    // Handoff 安全检查（auto 模式）
    const handoffWarning = await classifyHandoffIfNeeded(...)
    enqueueAgentNotification({ status: 'completed', ... })
  } catch (error) {
    if (error instanceof AbortError) {
      killAsyncAgent(taskId)
      enqueueAgentNotification({ status: 'killed', ... })
    } else {
      failAsyncAgent(taskId, msg)
      enqueueAgentNotification({ status: 'failed', ... })
    }
  }
}
```

### 6.5 Handoff 安全分类

```typescript
async function classifyHandoffIfNeeded({
  agentMessages, tools, toolPermissionContext, ...
}): Promise<string | null> {
  // 仅在 auto 权限模式下执行
  // 构建子Agent的 transcript
  // 调用 classifyYoloAction() 分析安全性
  // 返回 null（通过）或警告文本（包含安全原因）
}
```

---

## 七、prompt.ts - Agent工具描述

### 7.1 动态描述生成

```typescript
async function getPrompt(agentDefinitions, isCoordinator, allowedAgentTypes): Promise<string>
```

核心内容:
- Agent 列表（内联或通过 system-reminder 附件注入）
- Fork 实验的"When to fork"指南
- "Writing the prompt"写作指导
- 使用示例
- 并发建议

### 7.2 描述注入优化

```typescript
function shouldInjectAgentListInMessages(): boolean {
  // 默认方式: Agent列表嵌入工具描述（~10.2% 的缓存创建 token）
  // 优化方式: 通过 agent_listing_delta 附件消息注入
  // 好处: 工具Schema不变 → 不破坏 prompt cache
}
```

---

## 八、constants.ts - 常量定义

```typescript
export const AGENT_TOOL_NAME = 'Agent'
export const LEGACY_AGENT_TOOL_NAME = 'Task'   // 向后兼容（权限规则、Hooks、恢复会话）

// 一次性内置Agent - 父Agent从不 SendMessage 继续
// 跳过 agentId/SendMessage/usage 尾部，节省 ~135 chars * 34M Explore runs/week
export const ONE_SHOT_BUILTIN_AGENT_TYPES: ReadonlySet<string> = new Set([
  'Explore',
  'Plan',
])

export const VERIFICATION_AGENT_TYPE = 'verification'
```

---

## 九、forkSubagent.ts - Fork 子Agent实验

### 9.1 Fork 概念

Fork 是一种特殊的子Agent模式:
- 子Agent**继承父Agent的完整对话上下文**（而非从零开始）
- 复用父Agent的**系统提示词**和**工具定义**（字节级一致，prompt cache 友好）
- 所有 Fork 都在后台运行（统一 `<task-notification>` 交互模型）
- Fork 之间可并行执行，共享 prompt cache

### 9.2 Fork Agent 定义

```typescript
export const FORK_AGENT: BuiltInAgentDefinition = {
  agentType: 'fork',
  tools: ['*'],                    // 使用父Agent的精确工具池
  maxTurns: 200,
  model: 'inherit',                // 继承父模型（缓存长度一致）
  permissionMode: 'bubble',        // 权限提示冒泡到父终端
  source: 'built-in',
  getSystemPrompt: () => '',       // 实际使用父的 renderedSystemPrompt
}
```

### 9.3 消息构建

```typescript
function buildForkedMessages(directive, assistantMessage): MessageType[] {
  // 1. 克隆父 assistant 消息（保留所有 tool_use/thinking/text）
  // 2. 为每个 tool_use 构建占位 tool_result（相同文本）
  // 3. 追加 per-child 指令文本

  // 结果: [...history, assistant(all_tool_uses), user(placeholder_results..., directive)]
  // 只有最后的 directive 不同 → 最大化 cache 命中
}
```

### 9.4 Fork 指令模板

Fork 子Agent收到严格的指令格式:

```
<fork_boilerplate>
STOP. READ THIS FIRST.

You are a forked worker process. You are NOT the main agent.

RULES (non-negotiable):
1. Do NOT spawn sub-agents; execute directly
2. Do NOT converse, ask questions, or suggest next steps
3. USE your tools directly: Bash, Read, Write, etc.
4. If you modify files, commit your changes before reporting
5. Stay strictly within your directive's scope
6. Keep your report under 500 words

Output format:
  Scope: <your assigned scope>
  Result: <the answer or key findings>
  Key files: <relevant file paths>
  Files changed: <list with commit hash>
  Issues: <list>
</fork_boilerplate>
```

### 9.5 递归防护

```typescript
// 双重检查
function isInForkChild(messages): boolean {
  return messages.some(m =>
    m.type === 'user' &&
    m.message.content.some(block =>
      block.type === 'text' &&
      block.text.includes('<fork_boilerplate>')
    )
  )
}

// AgentTool.call() 中:
if (querySource === 'agent:builtin:fork' || isInForkChild(messages)) {
  throw new Error('Fork is not available inside a forked worker.')
}
```

---

## 十、agentMemory.ts - Agent 持久化记忆

### 10.1 记忆范围

| 范围 | 路径 | 版本控制 | 用途 |
|------|------|---------|------|
| user | `~/.claude/agent-memory/<agentType>/` | 不受控 | 跨项目通用学习 |
| project | `.claude/agent-memory/<agentType>/` | Git受控 | 团队共享项目知识 |
| local | `.claude/agent-memory-local/<agentType>/` | 不受控 | 本地机器特有 |

### 10.2 记忆加载

```typescript
function loadAgentMemoryPrompt(agentType, scope): string {
  // 创建记忆目录（fire-and-forget）
  void ensureMemoryDirExists(memoryDir)

  // 返回记忆 prompt（指导 Agent 如何使用记忆文件）
  return buildMemoryPrompt({
    displayName: 'Persistent Agent Memory',
    memoryDir,
    extraGuidelines: [scopeNote],
  })
}
```

### 10.3 安全检查

```typescript
function isAgentMemoryPath(absolutePath): boolean {
  // 规范化路径防止 traversal
  const normalizedPath = normalize(absolutePath)
  // 检查三个范围的基础目录
}
```

---

## 十一、resumeAgent.ts - Agent 恢复

### 11.1 恢复机制

```typescript
async function resumeAgentBackground({
  agentId, prompt, toolUseContext, ...
}): Promise<ResumeAgentResult> {
  // 1. 从磁盘读取 transcript 和 metadata
  const [transcript, meta] = await Promise.all([
    getAgentTranscript(agentId),
    readAgentMetadata(agentId),
  ])

  // 2. 过滤无效消息
  const resumedMessages = filterWhitespaceOnlyAssistantMessages(
    filterOrphanedThinkingOnlyMessages(
      filterUnresolvedToolUses(transcript.messages)
    )
  )

  // 3. 重建 contentReplacementState（prompt cache 稳定）
  const resumedReplacementState = reconstructForSubagentResume(...)

  // 4. 重新组装工具池
  const workerTools = assembleToolPool(workerPermissionContext, mcpTools)

  // 5. 调用 runAsyncAgentLifecycle() 续跑
}
```

---

## 十二、设计模式总结

### 12.1 使用的设计模式

| 模式 | 应用位置 | 说明 |
|------|---------|------|
| AsyncGenerator | runAgent() | 流式产出消息，支持中断和背压 |
| 工厂模式 | buildTool() | 声明式工具定义，默认值合并 |
| 策略模式 | AgentDefinition | 不同Agent有不同的工具集、权限、提示词策略 |
| 观察者模式 | Progress Tracker / Hooks | Agent 生命周期事件通知 |
| 模板方法 | getSystemPrompt() | 内置/自定义/插件Agent共用接口，实现各异 |
| 备忘录 | resumeAgent | 保存/恢复 Agent 执行状态 |
| 装饰器 | wrapWithCwd, runWithAgentContext | 透明注入上下文 |
| 竞速模式 | Promise.race([message, background]) | 同步转后台的中断机制 |
| 延迟Schema | lazySchema() | 避免模块初始化时的循环依赖 |

### 12.2 关键设计决策

1. **Worker 独立工具池**: `assembleToolPool(workerPermissionContext)` 而非复用父工具，确保权限隔离
2. **结果不直接可见**: 子Agent输出回传为 `tool_result`，父Agent必须主动转述给用户
3. **字节级缓存一致性**: Fork 路径通过 `useExactTools` 和 `renderedSystemPrompt` 实现缓存命中
4. **三层递归防护**: querySource + 消息扫描 + Fork Agent 不可被显式选择
5. **异步安全**: 异步Agent使用独立 AbortController，不随用户 ESC 取消
6. **一次性Agent优化**: Explore/Plan 跳过 SendMessage 提示文本，节省 token

### 12.3 性能优化

1. **CLAUDE.md 省略**: Explore/Plan 等只读Agent不加载 CLAUDE.md，节省 5-15 Gtok/周
2. **gitStatus 省略**: 只读Agent不需要初始 gitStatus（可达 40KB）
3. **Prompt Cache 保护**: Agent 列表通过附件注入而非嵌入描述，避免缓存失效
4. **缓存淘汰提示**: 子Agent完成时发送 `tengu_cache_eviction_hint`
5. **Memoize**: `getAgentDefinitionsWithOverrides` 使用 lodash memoize 缓存

---

## 十三、cc-study 简化设计要点

与 Claude Code 源码的差异:

1. **不实现 Fork 路径**: Fork 实验特性依赖 prompt cache 等高级机制，简化版跳过
2. **不实现多Agent模式**: Agent Swarms / Teammates / tmux 机制过于复杂
3. **不实现 Worktree 隔离**: 简化为固定工作目录
4. **不实现 Agent Memory**: 持久化记忆系统留到 Phase 6
5. **不实现 Resume**: Agent 恢复机制依赖 transcript 持久化
6. **不实现 Handoff 分类器**: auto 权限模式的 AI 分类器简化为默认行为
7. **不实现远程执行**: CCR 远程 Agent 机制跳过

保留的核心:
- AgentDefinition 类型系统（内置 + 自定义 Markdown）
- `runAgent()` 的 AsyncGenerator 消息循环
- `filterToolsForAgent()` 工具过滤
- `finalizeAgentTool()` 结果终结
- 同步/异步双路径执行
- 递归防护（基本的消息扫描检测）
- Agent 列表动态注入描述
