# Phase 8 设计文档：Fork + Worktree

## 1. 架构概览

Phase 8 为 AgentTool 子系统新增两条关键路径：

1. **Fork 路径**：子 Agent 继承父的完整对话上下文 + 系统提示词，通过 prompt cache 优化并行执行
2. **Worktree 隔离**：子 Agent 在独立的 git worktree 中工作，防止并发文件修改冲突

```
AgentTool.execute(input)
    │
    ├─ isForkSubagentEnabled() && !subagent_type?
    │   └─ YES → Fork 路径
    │       ├─ 递归 fork 防护检查
    │       ├─ selectedAgent = FORK_AGENT
    │       ├─ buildForkedMessages(prompt, assistantMessage)
    │       ├─ [可选] createAgentWorktree(slug)
    │       ├─ [可选] buildWorktreeNotice()
    │       └─ runForkedAgent(params)
    │
    └─ NO → Normal 路径（现有逻辑）
        ├─ selectedAgent = registry.get(subagent_type)
        └─ runSubAgent(params)
```

## 2. 新增文件

| 文件 | 职责 |
|------|------|
| `src/tools/AgentTool/forkSubagent.ts` | FORK_AGENT 定义、buildForkedMessages、buildChildMessage、isInForkChild、buildWorktreeNotice |
| `src/utils/worktree.ts` | validateWorktreeSlug、createAgentWorktree、removeAgentWorktree、hasWorktreeChanges |
| `src/utils/forkedAgent.ts` | runForkedAgent、createSubagentContext、CacheSafeParams |

## 3. 接口定义

### 3.1 forkSubagent.ts

```typescript
// Feature gate（简化版：环境变量控制）
export function isForkSubagentEnabled(): boolean

// FORK_AGENT 定义
export const FORK_AGENT: AgentDefinition

// 核心：构建 fork 消息
export function buildForkedMessages(
  directive: string,
  assistantMessage: AssistantMessage,
): Message[]

// 子进程规则
export function buildChildMessage(directive: string): string

// 递归防护
export function isInForkChild(messages: Message[]): boolean

// Worktree 路径翻译提示
export function buildWorktreeNotice(
  parentCwd: string,
  worktreeCwd: string,
): string
```

### 3.2 worktree.ts

```typescript
// 安全校验
export function validateWorktreeSlug(slug: string): void

// 创建 Agent Worktree
export async function createAgentWorktree(slug: string): Promise<{
  worktreePath: string
  worktreeBranch?: string
  headCommit?: string
  gitRoot?: string
}>

// 清理
export async function removeAgentWorktree(
  worktreePath: string,
  worktreeBranch?: string,
  gitRoot?: string,
): Promise<boolean>

// 变更检测
export async function hasWorktreeChanges(
  worktreePath: string,
  headCommit: string,
): Promise<boolean>
```

### 3.3 forkedAgent.ts

```typescript
// 缓存安全参数
export interface CacheSafeParams {
  systemPrompt: string
  parentMessages: Message[]
}

// Fork 执行参数
export interface ForkedAgentParams {
  promptMessages: Message[]
  cacheSafeParams: CacheSafeParams
  agentDefinition: AgentDefinition
  apiConfig: APIConfig
  context: ToolContext
  maxTurns?: number
}

// Fork 执行结果
export interface ForkedAgentResult {
  messages: Message[]
  content: string
  totalDurationMs: number
}

// 执行入口
export async function runForkedAgent(params: ForkedAgentParams): Promise<ForkedAgentResult>
```

## 4. 数据流

### 4.1 Fork 路径完整流程

```
AgentTool.execute(input)
  │
  ├── 1. isForkSubagentEnabled() 检查
  │
  ├── 2. effectiveType = subagent_type ?? (gate on ? undefined : "general-purpose")
  │      isForkPath = effectiveType === undefined
  │
  ├── 3. if isForkPath:
  │      ├── isInForkChild(messages) → throw  // 递归防护
  │      └── selectedAgent = FORK_AGENT
  │
  ├── 4. if isForkPath:
  │      ├── systemPrompt = 父的 renderedSystemPrompt
  │      └── promptMessages = buildForkedMessages(prompt, assistantMessage)
  │
  ├── 5. [可选] isolation === 'worktree':
  │      ├── worktreeInfo = createAgentWorktree(slug)
  │      └── promptMessages.push(buildWorktreeNotice(...))
  │
  ├── 6. runForkedAgent({
  │        systemPrompt: 父系统提示词,
  │        messages: [...parentMessages, ...promptMessages],
  │        tools: 父的完整工具池,  // useExactTools
  │     })
  │
  └── 7. [可选] 清理 worktree:
         if !hasWorktreeChanges → removeAgentWorktree()
```

### 4.2 buildForkedMessages 算法

```
输入: directive, assistantMessage (含 tool_use blocks)

输出: [clonedAssistant, toolResultUserMsg]

其中:
  clonedAssistant = {
    ...assistantMessage,
    content: [...assistantMessage.content],  // 浅拷贝所有 content blocks
  }

  toolResultUserMsg = createUserMessage([
    // 占位符 tool_results（每个都相同）
    { type: "tool_result", tool_use_id: block.id, content: "Fork started — processing in background" },
    // ... 重复
    // per-child directive
    { type: "text", text: buildChildMessage(directive) },
  ])
```

### 4.3 Worktree 创建流程

```
createAgentWorktree(slug)
  │
  ├── validateWorktreeSlug(slug)     // 安全检查
  │
  ├── git worktree 创建:
  │   ├── gitRoot = findGitRoot()
  │   ├── worktreePath = join(gitRoot, ".claude/worktrees", flattenSlug(slug))
  │   ├── git worktree add -B <branch> <path> <base>
  │   └── performPostCreationSetup():
  │       ├── copy settings.local.json
  │       └── symlink node_modules (if configured)
  │
  └── 返回 { worktreePath, worktreeBranch, headCommit, gitRoot }
```

## 5. AgentTool 修改点

在 `src/tools/AgentTool/index.ts` 的 `execute()` 中增加 fork 路由：

```typescript
// 现有代码：
const agentType = input.subagent_type ?? "general-purpose";

// 修改为：
const effectiveType = input.subagent_type ?? (isForkSubagentEnabled() ? undefined : "general-purpose");
const isForkPath = effectiveType === undefined;

if (isForkPath) {
  // Fork 路径
  if (isInForkChild(/* messages from context */)) {
    return { output: "Error: Cannot fork inside a forked worker", error: true };
  }
  // ... fork 逻辑
} else {
  // Normal 路径（保持现有逻辑）
  const agentDef = agentDefinitions.get(agentType) as AgentDefinition;
  // ... 现有 runSubAgent 调用
}
```

## 6. 测试规划

### 6.1 Fork 模式测试 (tests/unit/tools/forkSubagent.test.ts)

| 测试场景 | 验证点 |
|---------|--------|
| isForkSubagentEnabled 默认 false | 环境变量未设置时返回 false |
| buildForkedMessages 基本功能 | 正确克隆 assistant + 构建 placeholder results |
| buildForkedMessages 无 tool_use | 退化为简单 user message |
| buildChildMessage 包含 10 条规则 | 输出含 fork-boilerplate 标签和 directive |
| isInForkChild 检测 | 消息含 fork-boilerplate 时返回 true |
| buildWorktreeNotice 路径翻译 | 包含两个路径信息 |
| FORK_AGENT 属性验证 | tools=['*'], permissionMode='bubble' |

### 6.2 Worktree 隔离测试 (tests/unit/utils/worktree.test.ts)

| 测试场景 | 验证点 |
|---------|--------|
| validateWorktreeSlug 合法值 | 普通slug、嵌套slug通过 |
| validateWorktreeSlug 路径穿越 | `../`、绝对路径抛错 |
| validateWorktreeSlug 过长 | 超过64字符抛错 |
| validateWorktreeSlug 非法字符 | 含特殊字符抛错 |
| createAgentWorktree 创建流程 | 在临时 git 仓库中创建 worktree |
| removeAgentWorktree 清理 | 正确移除 worktree 和分支 |
| hasWorktreeChanges 无变更 | 干净目录返回 false |
| hasWorktreeChanges 有变更 | 有未提交文件返回 true |

## 7. 简化决策

相比参考源码，我们做以下简化：

1. **Feature Gate**：使用环境变量 `CC_FORK_SUBAGENT=1` 代替 GrowthBook feature flag
2. **Tmux 集成**：暂不实现 tmux 相关功能
3. **Sparse checkout**：暂不实现 sparse-checkout
4. **Sidechain transcript**：暂不实现 transcript 记录
5. **Analytics**：暂不实现 analytics 事件
6. **Hook-based worktree**：暂不实现 hook 扩展，仅支持 git worktree
7. **.worktreeinclude**：暂不实现文件复制
8. **Stale worktree 清理**：暂不实现自动清理

这些功能可在后续迭代中按需添加。
