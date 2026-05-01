# Phase 8 源码研读：Worktree 隔离机制

> 参考源码：`free-code/src/utils/worktree.ts`, `free-code/src/utils/forkedAgent.ts`

## 1. 概述

Worktree 隔离为子 Agent 提供独立的文件系统工作目录，避免多个 Agent 并发修改同一文件时产生冲突。基于 `git worktree` 实现，每个子 Agent 获得相同仓库的一个独立 checkout。

## 2. 核心 API

### 2.1 validateWorktreeSlug — 路径安全检查

```typescript
const VALID_WORKTREE_SLUG_SEGMENT = /^[a-zA-Z0-9._-]+$/
const MAX_WORKTREE_SLUG_LENGTH = 64

function validateWorktreeSlug(slug: string): void {
  if (slug.length > MAX_WORKTREE_SLUG_LENGTH) throw Error
  for (const segment of slug.split('/')) {
    if (segment === '.' || segment === '..') throw Error
    if (!VALID_WORKTREE_SLUG_SEGMENT.test(segment)) throw Error
  }
}
```

- 每个 `/` 分隔的段独立验证
- 允许 `user/feature` 形式的嵌套（内部 flatten 为 `user+feature`）
- 防止路径穿越（`../`）、绝对路径（`/` 开头）、驱动器号（`C:\`）

### 2.2 createAgentWorktree — 创建 Agent Worktree

```typescript
async function createAgentWorktree(slug: string): Promise<{
  worktreePath: string
  worktreeBranch?: string
  headCommit?: string
  gitRoot?: string
  hookBased?: boolean
}>
```

**流程**：
1. `validateWorktreeSlug(slug)` — 安全检查
2. 检查 `hasWorktreeCreateHook()` — 优先使用 hook-based 创建
3. 回退到 git worktree：
   - `findCanonicalGitRoot()` — 找到主仓库根（即使从 worktree 内发起）
   - `getOrCreateWorktree()` — 创建或恢复已有 worktree
   - `performPostCreationSetup()` — 后续配置

**关键决策**：使用 `findCanonicalGitRoot`（而非 `findGitRoot`），确保 agent worktree 总是创建在主仓库的 `.claude/worktrees/` 下，不会嵌套在已有 worktree 内。

### 2.3 getOrCreateWorktree — 创建或恢复

**快速恢复路径**（已有 worktree 时跳过 fetch）：
1. `readWorktreeHeadSha(worktreePath)` — 直接读取 .git 指针文件
2. 如果存在，返回 `{ existed: true }`

**新建路径**：
1. `mkdir(worktreesDir, { recursive: true })` — 确保 `.claude/worktrees/` 存在
2. `git fetch origin <defaultBranch>` — 获取最新代码（如果本地没有则跳过）
3. `git worktree add -B <branch> <path> <baseBranch>` — 创建 worktree
4. 支持 sparse-checkout（`settings.worktree.sparsePaths`）

### 2.4 performPostCreationSetup — 后续配置

1. **复制 settings.local.json** 到 worktree 的 `.claude/` 目录
2. **配置 git hooks** — 让 worktree 使用主仓库的 `.husky/` 或 `.git/hooks/`
3. **Symlink 目录** — 通过 `settings.worktree.symlinkDirectories` 配置（如 `node_modules`）
4. **复制 .worktreeinclude 文件** — 将 gitignored 文件按 pattern 复制到 worktree

### 2.5 removeAgentWorktree — 清理

```typescript
async function removeAgentWorktree(
  worktreePath: string,
  worktreeBranch?: string,
  gitRoot?: string,
  hookBased?: boolean,
): Promise<boolean>
```

- Hook-based: 调用 `executeWorktreeRemoveHook`
- Git-based: `git worktree remove --force` + `git branch -D`

### 2.6 hasWorktreeChanges — 变更检测

```typescript
async function hasWorktreeChanges(
  worktreePath: string,
  headCommit: string,
): Promise<boolean>
```

两个检查：
1. `git status --porcelain` — 工作目录是否有未提交变更
2. `git rev-list --count <headCommit>..HEAD` — 是否有新 commit

任一为真或有错误 → 返回 true（fail-closed）

## 3. 路径结构

```
repo-root/
├── .claude/
│   └── worktrees/
│       ├── agent-a1b2c3d4/     # Agent worktree (slug: agent-a1b2c3d4)
│       │   ├── .git            # → 主仓库 .git 的链接
│       │   ├── src/            # 独立的文件系统 checkout
│       │   ├── node_modules →  # symlink 到主仓库
│       │   └── .claude/
│       │       └── settings.local.json  # 从主仓库复制
│       └── wf_abcd1234-567/
├── .git/
└── ...
```

## 4. Forked Agent 生命周期 (forkedAgent.ts)

### 4.1 CacheSafeParams — 缓存共享参数

```typescript
type CacheSafeParams = {
  systemPrompt: SystemPrompt       // 系统提示词
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  toolUseContext: ToolUseContext    // 含工具定义、模型等
  forkContextMessages: Message[]   // 父上下文消息
}
```

**Cache Key 组成**：system prompt + tools + model + messages (prefix) + thinking config

### 4.2 createSubagentContext — 上下文隔离

```typescript
function createSubagentContext(
  parentContext: ToolUseContext,
  overrides?: SubagentContextOverrides,
): ToolUseContext
```

**隔离策略**（默认全隔离）：
- `readFileState`：克隆父缓存
- `abortController`：创建子控制器（父 abort 会传播）
- `getAppState`：包装为 `shouldAvoidPermissionPrompts: true`
- `setAppState` 等回调：no-op
- UI 回调（`setToolJSX` 等）：undefined

**可选共享**（显式 opt-in）：
- `shareSetAppState`
- `shareSetResponseLength`
- `shareAbortController`

### 4.3 runForkedAgent — 执行入口

```typescript
async function runForkedAgent(params: ForkedAgentParams): Promise<ForkedAgentResult>
```

**流程**：
1. `createSubagentContext(toolUseContext, overrides)` — 创建隔离上下文
2. `initialMessages = [...forkContextMessages, ...promptMessages]`
3. 运行 `query()` 循环（与主循环相同的流式处理）
4. 累计 usage（input_tokens, output_tokens, cache metrics）
5. 记录 sidechain transcript
6. 返回 `{ messages, totalUsage }`

## 5. 清理策略

### 5.1 stale worktree 自动清理

```typescript
const EPHEMERAL_WORKTREE_PATTERNS = [
  /^agent-a[0-9a-f]{7}$/,              // AgentTool
  /^wf_[0-9a-f]{8}-[0-9a-f]{3}-\d+$/, // WorkflowTool
  /^wf-\d+$/,                          // Legacy
  /^bridge-[A-Za-z0-9_]+(-[A-Za-z0-9_]+)*$/, // Bridge
  /^job-[a-zA-Z0-9._-]{1,55}-[0-9a-f]{8}$/, // Template job
]
```

**清理条件**：
1. slug 匹配临时 pattern（不碰用户命名的 worktree）
2. mtime 超过 cutoff（30天）
3. `git status --porcelain -uno` 无变更
4. `git rev-list HEAD --not --remotes` 无未推送 commit
5. 不是当前 session 的 worktree

## 6. 设计洞察

1. **快恢复优先**：已有 worktree 直接读取 .git 指针，跳过 git fetch（省 6-8s）
2. **Flatten slug**：`user/feature` → `user+feature`，避免 git ref D/F 冲突和嵌套目录
3. **Hook-based 扩展**：支持非 git VCS 通过 hook 替代 git worktree
4. **Symlink 节省空间**：`node_modules` 等大目录通过 symlink 共享
5. **Fail-closed**：git 命令失败时保守处理（跳过清理），避免丢失数据
6. **上下文隔离**：fork agent 的所有可变状态默认隔离，需要共享时显式 opt-in
