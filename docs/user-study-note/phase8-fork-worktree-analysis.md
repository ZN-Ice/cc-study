# Phase 8 分析：Fork + Worktree 机制

> 基于 `phase/8-fork-worktree` 分支源码分析
> 核心源码：`src/tools/AgentTool/forkSubagent.ts`, `src/utils/worktree.ts`, `src/utils/forkedAgent.ts`

---

## 问题 1：什么情况下会触发 Fork 和 Worktree 机制？

### Fork 路径触发条件

Fork 是 AgentTool 的一条**独立路由**，与传统的 inline agent（指定 `subagent_type`）并行存在。触发 fork 路径需要同时满足以下条件：

| 条件 | 代码位置 | 说明 |
|------|---------|------|
| `CC_FORK_SUBAGENT=1` 环境变量已设置 | `forkSubagent.ts:36` — `isForkSubagentEnabled()` | Feature gate，简化版用环境变量代替 GrowthBook feature flag |
| 调用 AgentTool 时**省略** `subagent_type` 参数 | `index.ts:116` — `effectiveType` 解析 | 显式指定了 `subagent_type` 就走 normal 路径；省略时且 gate 开启才进 fork |
| 当前不处于 fork 子进程中 | `forkSubagent.ts:75` — `isInForkChild()` | 递归 fork 防护，检查消息中是否存在 `<fork-boilerplate>` 标签 |

**路由决策逻辑**（`index.ts:116-117`）：

```
effectiveType = subagent_type ?? (isForkSubagentEnabled() ? undefined : "general-purpose")
isForkPath    = effectiveType === undefined
```

- `subagent_type` 有值 → 走 normal 路径（显式指定优先级最高）
- `subagent_type` 省略 + gate 开启 → 走 fork 路径（`undefined`）
- `subagent_type` 省略 + gate 关闭 → 默认走 `general-purpose` normal 路径

### Fork 触发后的行为

进入 fork 路径后，子 Agent 会：

1. **继承父的完整对话上下文** — `buildForkedMessages()` 克隆父的 assistant 消息，构建占位符 tool_results
2. **继承父的系统提示词** — 子进程使用父的 `renderedSystemPrompt`（而非自己生成）
3. **继承父的完整工具池** — `FORK_AGENT.tools = ['*']`，确保 API 请求前缀字节级一致
4. **权限冒泡** — `permissionMode: 'bubble'`，权限提示弹出到父终端
5. **模型继承** — `model: 'inherit'`，使用与父相同的模型

这样设计的最核心目的是 **Prompt Cache 共享**——多个 fork 子进程的 API 请求前缀几乎完全一致，只有最后一个 directive 文本块不同，最大化 cache 命中率。

### Fork 和 Worktree 的关系

**Fork 和 Worktree 是正交概念，并非绑定关系：**

- **Fork** = 上下文继承机制（子 Agent 继承父的对话上下文）
- **Worktree** = 文件系统隔离机制（子 Agent 在独立的 git checkout 中工作）
- 两者可以组合使用（Fork + Worktree），也可以单独使用
- 在当前的简化实现中，worktree 通过 Agent 工具参数的 `isolation: "worktree"` 字段来请求（参考 Agent 工具定义的参数 schema），而 fork 通过环境变量 + 省略 subagent_type 触发

### Worktree 触发场景

Worktree 用于需要**文件系统隔离**的场景：

- 多个子 Agent **并发执行**时防止文件修改冲突
- 子 Agent 可能修改文件，需要**隔离的工作副本**
- 子 Agent 完成后需要**干净的撤销路径**（直接删除 worktree 即可）

---

## 问题 2：Worktree 的分支命名与生命周期

### 分支命名规则

Worktree 的分支名由 `slug` 参数决定，经过以下处理链：

**Step 1 — Slug 校验**（`validateWorktreeSlug`）：
- 只允许字母、数字、点、下划线、短横线
- 支持 `/` 嵌套（如 `user/feature`）
- 最大 64 字符
- 拒绝路径穿越（`..`、`.` 段）

**Step 2 — Flatten 处理**（`flattenSlug`）：
- 将 `/` 替换为 `+`，避免 git ref D/F 冲突
- 例如：`user/feature` → `user+feature`

**Step 3 — 生成分支名**（`worktreeBranchName`）：
- 格式：`worktree-{flattenedSlug}`
- 例如：
  - `my-agent` → `worktree-my-agent`
  - `user/feature` → `worktree-user+feature`
  - `agent-a1b2c3d4` → `worktree-agent-a1b2c3d4`

### 分支的创建与使用

创建 worktree 时（`createAgentWorktree`）：

```bash
# 实际的 git 命令（worktree.ts:231-234）
git worktree add -B worktree-{slug} .claude/worktrees/{slug} origin/main
```

- `-B` 标志：如果同名分支已存在，重置到 base commit
- base 默认为 `origin/main`（或 `origin/master`，回退到 `HEAD`）
- worktree 目录在 `.claude/worktrees/{flattenedSlug}/`
- 创建后自动复制 `.claude/settings.local.json` 到 worktree

子 Agent 在这个 worktree 中工作，对文件的修改**只影响 worktree，不影响主仓库的工作目录**。

### 分支的最终处理（不会自动 merge）

**关键结论：Agent 不会自动将 worktree 分支 merge 回 main。**

整个 worktree 的生命周期如下：

```
创建 worktree
  │
  ├── 子 Agent 在 worktree 中工作
  │   └── 可能产生：文件修改、新 commit、新分支
  │
  ├── Agent 工作完成
  │   └── 调用 hasWorktreeChanges() 检测变更
  │
  ├── 无变更 ──────────→ removeAgentWorktree()
  │                        ├── git worktree remove --force
  │                        └── git branch -D worktree-{slug}
  │
  └── 有变更 ──────────→ worktree 保留，不做清理
                           └── 子 Agent 在报告中包含 commit hash
                               （由 fork 子进程的 RULE #5 保证：
                                "If you modify files, commit your changes
                                before reporting. Include the commit hash
                                in your report."）
```

**为什么不做自动 merge？**

1. **隔离设计**：worktree 的目的是隔离，不是开发分支。它相当于一个"沙箱"
2. **安全考虑**：自动 merge 可能引入冲突或意外代码。子 Agent 的修改需要人工审查
3. **报告机制**：子 Agent 通过结构化输出报告变更内容（Files changed + commit hash），由用户/父 Agent 决定如何处理
4. **参考源码一致**：Claude Code 原版也是同样的策略——worktree 分支是临时的，cleanup 时直接删除

### 使用场景示例

| 场景 | Fork | Worktree | 分支最终处理 |
|------|------|----------|-------------|
| 只读代码搜索（Explore Agent） | 可选 | 不需要 | 不涉及 |
| 并行文件修改（重构） | 触发 | 需要 | worktree 保留，人工审查后合并 |
| 串行工具执行（普通 Agent） | 可能触发 | 不需要 | 不涉及 |
| 危险操作验证 | 触发 | 需要 | 验证后直接删除 worktree |

---

## 问题 3：Fork 和不 Fork 的子 Agent 有什么差异？

Fork 和 Normal（不 fork）是 AgentTool 的两条独立执行路径，在多方面存在根本性差异：

### 全景对比

| 维度 | Normal 路径（inline） | Fork 路径 |
|------|----------------------|-----------|
| **触发方式** | `subagent_type` 显式指定（如 `"Explore"`） | 省略 `subagent_type` + gate 开启 → 隐式触发 |
| **系统提示词** | 自己 Agent 类型的 `getSystemPrompt()` | 继承父的 `renderedSystemPrompt`（传给 fork 的 `getSystemPrompt()` 返回空字符串） |
| **工具池** | 按 AgentDefinition 过滤（`allowedTools` / `disallowedTools`） | 父的**完整**工具池 `tools: ['*']`（`useExactTools: true`） |
| **对话上下文** | 只有本次 prompt 消息 | 继承父的**完整上下文**，通过 `buildForkedMessages()` 构建 |
| **Agent 类型** | general-purpose / Explore / Plan（用户可选） | 无类型名（`agentType: "fork"`，但不可通过 `subagent_type` 选择） |
| **交互模式** | 可对话、提问、多轮交互 | 10 条严格 RULES：禁止对话、禁止提问、无输出间文本 |
| **输出格式** | 自由文本 | 结构化强制格式：`Scope:\nResult:\nKey files:\n...` |
| **最大轮次** | 20（`agentDef.maxTurns`） | 200（`FORK_AGENT.maxTurns`） |
| **执行函数** | `runSubAgent()` in `orchestrator.ts` | `runForkedAgent()` in `forkedAgent.ts` |
| **权限模式** | 按工具定义走权限链 | `permissionMode: "bubble"` — 权限冒泡到父终端确认 |
| **消息构建** | `createUserMessage(prompt)` | `buildForkedMessages(directive, assistantMsg)` — 克隆父 assistant + 占位符 tool_results |
| **Prompt Cache** | 独立缓存（从零开始） | 与父共享**前缀**（最大化 cache 命中） |
| **递归防护** | 不需要（不同 agent 类型互不冲突） | `isInForkChild()` 检测 `<fork-boilerplate>` 标签 |
| **工作目录** | 与父共享同一工作目录 | 可选 worktree 隔离 |
| **是否可并发** | 否（`isConcurrencySafe` 返回 false） | 是（设计目标之一） |
| **模型选择** | 固定 agent 定义中的模型 | `model: "inherit"` — 继承父的模型 |

### 核心差异详解

#### 1. Prompt Cache 策略（根本差异）

这是 fork 路径存在的**首要原因**：

```
Normal 路径:
  [system, user(prompt)] → 独立 API 请求，cache 独立

Fork 路径:
  父: [...history, assistant(tool_use_A), user(result_A)]
  子1: [...history, assistant(tool_use_A), user(placeholder_A, "dir_1")]
  子2: [...history, assistant(tool_use_A), user(placeholder_A, "dir_2")]
                              ↑ 字节级相同，命中 cache
```

- Normal 路径：子 Agent 每次从零开始，cache 命中率为 0
- Fork 路径：子进程的消息前缀与父进程完全一致 → 高概率命中 prompt cache

#### 2. 工具继承策略

- **Normal 路径**：`filterToolsForAgent()` 对工具池做交集/差集过滤。例如 Explore Agent 排除 `Write`、`Edit`、`Agent` 工具，确保不会误修改文件
- **Fork 路径**：`tools: ['*']` + `useExactTools: true`，使用父的**精确**工具定义。这是 cache 一致性的要求——工具定义也是 API 请求的一部分，修改会破坏 cache

#### 3. 约束与自由度

- **Normal 路径**：自由度更高，Agent 可以自主决定如何执行任务、何时结束、如何报告
- **Fork 路径**：严格约束，10 条强制规则确保：
  - 子 Agent 不产生多余对话（"不要问问题，直接执行"）
  - 结构化输出保证结果可被父 Agent 解析
  - 修改文件前提交（RULE #5）保证可追溯
  - 报告限制 500 字以内防止上下文溢出

#### 4. 递归防护

- **Normal 路径**：不同 agent 类型是互斥的，不存在递归问题
- **Fork 路径**：因为 fork 子进程也保有 Agent 工具（为了 cache 一致性），需要运行时检查消息中是否包含 `<fork-boilerplate>` 标签来防止递归 fork

---

## 问题 4：Agent 的提示词有哪些修改？Agent 如何判断什么情况用 Fork / Worktree？

### 提示词的修改点

整个系统中提示词在以下几个层次发生修改：

#### 层次一：AgentTool 描述（LLM 看到的工具定义）

`prompt.ts:27-38` 生成的描述是 LLM 判断何时使用 AgentTool 的依据：

```
Launch a new agent to handle complex, multi-step tasks autonomously.

Available agent types:
- general-purpose: General-purpose agent for...(all tools)
- Explore: Fast agent specialized for...(excludes: Write, Edit, Agent)
- Plan: Software architect agent for...(excludes: Write, Edit, Agent)

Usage notes:
- Always include a short description (3-5 words)
- When the agent is done, it will return a single message back to you
- You can optionally specify a subagent_type to use a specialized agent
- If unsure which agent type to use, omit subagent_type (defaults to general-purpose)
- Do NOT use the agent tool for simple lookups that you can do yourself
```

**关键观察**：`defaults to general-purpose` 这个提示在 fork gate 开启时是**不准确的**——实际上会路由到 fork 路径。在我们的简化实现中，这个 description 尚未针对 fork 做更新。

#### 层次二：Normal 路径 — Agent 自己的系统提示词

每种 Agent 类型有自己的 `getSystemPrompt()`（`agentDefs.ts`）：

| Agent 类型 | 系统提示词要点 |
|-----------|--------------|
| general-purpose | "帮助型 AI 助手，在终端工作，完成后清晰总结" |
| Explore | **只读** + "快速搜索代码库，不要修改文件" |
| Plan | **只读** + "架构分析，输出可执行的实施计划" |

这些提示词在 `orchestrator.ts:247` 中作为 `systemPrompt` 传入 API 请求：
```typescript
const agentConfig: APIConfig = {
  ...apiConfig,
  systemPrompt: agentDefinition.getSystemPrompt(),
  tools: filteredRegistry.getToolDefinitions(),
};
```

#### 层次三：Fork 路径 — 提示词完全继承父

Fork 进程的提示词系统完全不同（`forkSubagent.ts:63-64`）：

```typescript
getSystemPrompt: () => "",  // Fork agent 自己返回空
```

实际的系统提示词来自父进程（`forkedAgent.ts:216-221`）：
```typescript
const forkConfig: APIConfig = {
  ...apiConfig,
  systemPrompt: cacheSafeParams.systemPrompt,  // 父的 renderedSystemPrompt
  tools: toolPool.getToolDefinitions(),
};
```

**这是刻意设计的**：为了 prompt cache 一致性，fork 子进程的 API 请求前缀必须与父进程完全相同。

#### 层次四：Fork 路径 — 10 条 RULES + Directive

子进程真正的"任务指令"在 `buildChildMessage(directive)` 中：

```typescript
<fork-boilerplate>
STOP. READ THIS FIRST.
RULES (non-negotiable):
1. 不要再 fork — 你已经是 fork 子进程
2. 不要对话、提问、建议下一步
3. 不要添加元评论
...
10. 结构化事实报告后停止

Output format:
  Scope: <范围>
  Result: <结果>
  Key files: <文件路径>
  Files changed: <变更列表+commit hash>
  Issues: <问题列表>
</fork-boilerplate>

Your directive: <具体任务>
```

这相当于在父系统提示词的基础上，注入了一层"执行约束 + 输出格式规范"。

#### 层次五：Worktree 路径提示

当 fork + worktree 组合使用时，额外注入 `buildWorktreeNotice()`（`forkSubagent.ts:189-199`）：

```
"You've inherited the conversation context above from a parent agent working in /parent/path.
You are operating in an isolated git worktree at /worktree/path...
Paths in the inherited context refer to the parent's working directory;
translate them to your worktree root.
Re-read files before editing if the parent may have modified them since they appear in the context.
Your changes stay in this worktree and will not affect the parent's files."
```

#### 层次六：Skills 系统的 `context` 声明

SKILL.md 的 frontmatter 可以声明 `context: "fork"`（`skills/types.ts:38`）：

```yaml
---
name: my-skill
context: fork  # inline (默认) 或 fork
---
```

- `context: "inline"`（默认）→ SkillTool 直接在父进程上下文执行 prompt
- `context: "fork"` → SkillTool 会通过 AgentTool 创建一个子 Agent 来执行

### Agent（LLM）如何判断何时使用 Fork / Worktree？

关键在于理解：**LLM 并不直接"选择"fork 或 worktree，而是通过参数组合来隐式触发**。

#### Fork 决策链

```
LLM 需要派一个子任务
  │
  ├── 任务匹配某个专用 Agent 类型？
  │   ├── 纯搜索 → 设 subagent_type="Explore"
  │   ├── 架构规划 → 设 subagent_type="Plan"
  │   └── 通用任务 → 考虑 fork
  │
  ├── gate 已开启 + 不确定用哪个 → 省略 subagent_type
  │   └── 隐式触发 fork 路径
  │
  └── gate 未开启 → 省略 subagent_type → 走 general-purpose
```

**判断依据**（对 LLM 而言）：
- AgentTool 的描述列出了可用类型 + 何时使用
- LLM 根据任务性质匹配合适的 agent 类型
- **Fork 不是"可选"的——它是当 LLM 不确定用哪个 agent 类型时的默认 fallback**

#### Worktree 决策链

在当前简化实现中，worktree 的使用方式取决于 Agent 工具的输入 schema 是否暴露了 `isolation` 参数。

在我们的代码中，`agentToolInputSchema`（`types.ts:64-79`）当前**没有** `isolation` 字段：

```typescript
export const agentToolInputSchema = z.strictObject({
  description: z.string().describe("..."),
  prompt: z.string().describe("..."),
  subagent_type: z.string().optional().describe("..."),
  model: z.string().optional().describe("..."),
  // ⚠️ 当前没有 isolation 字段
});
```

但在参考源码（free-code）中，AgentTool 的输入参数会包含 `isolation` 字段，LLM 根据以下因素判断是否需要 worktree：

| 因素 | 需要 Worktree | 不需要 Worktree |
|------|--------------|----------------|
| **任务内容** | 涉及文件修改、重构 | 只读搜索、分析 |
| **并发性** | 与其他子 Agent 并行工作 | 串行执行的单一子任务 |
| **风险级别** | 可能破坏文件结构的操作 | 安全的读取操作 |
| **回滚需求** | 可能需要撤销变更 | 不产生变更 |

**判断逻辑（LLM 视角）**：
1. 先选择 agent 类型或 fork
2. 再判断任务是否涉及文件系统变更
3. 如果是 → 设置 `isolation: "worktree"` 请求隔离
4. 如果否 → 不需要 worktree

#### 代码执行链（完整流转）

```
LLM 调用 AgentTool
  │
  ├── 传入参数
  │   ├── description: "重构模块X"
  │   ├── prompt: "请将 X 模块重构..."
  │   ├── subagent_type: undefined  ← 省略（隐式 fork）
  │   └── isolation: "worktree"     ←（接口扩展后）
  │
  ├── 服务端路由（index.ts）
  │   ├── isForkSubagentEnabled() → true
  │   ├── effectiveType = undefined → isForkPath = true
  │   └── 路由到 executeForkPath()
  │
  ├── fork 路径准备（executeForkPath）
  │   ├── isInForkChild() 检查 → 通过
  │   ├── buildForkedMessages() → 克隆父上下文
  │   └── 可选: isolation === "worktree"
  │       ├── createAgentWorktree(slug) → 创建工作隔离目录
  │       └── buildWorktreeNotice() → 注入路径提示
  │
  └── 执行（runForkedAgent）
      ├── systemPrompt = 父的 renderedSystemPrompt
      ├── tools = 父的完整工具池
      ├── cwd = worktree 路径（如果启用）
      └── 运行流式循环
```

---

## 问题 5：Fork 模式为什么默认关闭？"GrowthBook feature flag" 是什么？

### 现状：Fork 默认关闭

在我们的实现中，fork 模式默认关闭。必须设置 `CC_FORK_SUBAGENT=1` 才能启用。

在参考源码（free-code）中，情况类似——甚至更严格：

| 层级 | 参考源码（free-code） | 我们的实现 |
|------|----------------------|-----------|
| **编译时** | `feature('FORK_SUBAGENT')` 检查。`FORK_SUBAGENT` **不在** `defaultFeatures` 列表（只有 `VOICE_MODE`），也**不在** `fullExperimentalFeatures` 列表 | 无编译时检查 |
| **运行时** | 无额外检查（编译时已 DCE） | `process.env.CC_FORK_SUBAGENT === "1"` |
| **额外防护** | `isCoordinatorMode()` → false、`getIsNonInteractiveSession()` → false | 无 |

**关键发现**：在 free-code 的 `scripts/build.ts` 中，`FORK_SUBAGENT` 既不是默认功能也不是实验功能。它只能通过**显式**传 `--feature=FORK_SUBAGENT` 构建才能启用。这意味着即使 Anthropic 内部，fork 模式也是一个需要**特殊构建**才开启的特性。

### 为什么默认关闭？

#### 1. 语义破坏性（最重要）

Fork 改变了 `subagent_type` 省略时的语义：

```
fork 关闭时: Agent 工具说 "omit subagent_type → general-purpose"
              开发者/LLM 的预期行为一致

fork 开启时: Agent 工具说 "omit subagent_type → general-purpose"（描述未更新）
              实际行为 → fork 路径
              描述与实际行为不一致！
```

这就是为什么 `prompt.ts:36` 的描述需要同步更新（当前还未做）。开启 fork 而不更新描述，会让 LLM 产生错误预期。

#### 2. 复杂性成本

Fork 路径引入了正常路径不需要的复杂度：

| 关注点 | Normal 路径 | Fork 路径 |
|--------|-----------|----------|
| 递归防护 | 不需要 | `isInForkChild()` 检查消息中 `<fork-boilerplate>` 标签 |
| 上下文管理 | 简单 `createUserMessage(prompt)` | `buildForkedMessages()` 克隆父上下文 + 占位符 |
| 工作目录 | 共享父的 cwd | 需要协调 worktree 路径翻译 |
| 权限处理 | 标准权限链 | `permissionMode: "bubble"` 冒泡到父终端 |
| 输出解析 | 自由文本 | 结构化格式（Scope:/Result:/...）需解析 |
| 超时风险 | 20 轮限制 | 200 轮限制，可能失控 |
| 工具冲突 | 串行执行无并发问题 | 并行子 Agent 需要 worktree 避免文件冲突 |

这些复杂性只有在真正需要并行 + cache 共享时才值得承担。

#### 3. Prompt Cache 收益仅在并行时显著

Fork 的核心优势——cache 共享——只有满足以下条件时才有效：
- **多个子 Agent 并行执行**（serial fork 也能共享，但收益小）
- **子 Agent 的 API 请求前缀与父足够相似**（需要 `useExactTools` + 继承父 systemPrompt）
- **Anthropic API 的 prompt caching 服务端开启**（需要 Enterprise 或更高套餐）

对于单子 Agent 串行场景，fork 的开销（消息构建、递归防护、worktree 管理）> 收益。

#### 4. 功能尚未完整

我们的 fork 路径当前是**简化版本**。设计文档列明了 8 项简化（`design/phase8-fork-worktree.md:251-260`）：

| 简化项 | 参考源码已实现 | 我们当前 |
|--------|-------------|---------|
| Feature Gate | GrowthBook 动态控制 | 环境变量 |
| Tmux 集成 | 支持分离式后台执行 | ❌ 未实现 |
| Sparse checkout | 支持部分 checkout | ❌ 未实现 |
| Sidechain transcript | 记录子进程完整对话 | ❌ 未实现 |
| Analytics | 使用量追踪 | ❌ 未实现 |
| Hook-based worktree | 支持非 git VCS | ❌ 未实现 |
| .worktreeinclude | 自动复制 gitignored 文件 | ❌ 未实现 |
| Stale worktree 清理 | 30 天自动清理 | ❌ 未实现 |

由于这些缺失，fork 路径在生产级使用中可能遇到各种边界问题。

#### 5. 向后兼容

如果 fork 默认开启：
- 所有依赖 `subagent_type` 省略 → `general-purpose` 的代码行为改变
- 已有 Agent 调用突然变成 fork 模式（10 条规则限制、结构化输出）
- 可能导致下游解析逻辑崩溃

### "GrowthBook feature flag" 详解

#### 参考源码中的 Feature Flag 系统

```
注释原文: "Feature Gate：使用环境变量 CC_FORK_SUBAGENT=1 代替 GrowthBook feature flag"
```

这句话说的是：参考源码使用了一个名叫 GrowthBook 的 feature flag 服务来控制 fork 功能开关，而我们用环境变量替代了它。

#### 完整的技术栈

在参考源码中，实际的 feature flag 体系分两层：

**第一层：构建时静态 Flag（`bun:bundle`）**

```
// free-code/src/tools/AgentTool/forkSubagent.ts:1
import { feature } from 'bun:bundle'

// free-code/scripts/build.ts:82
const defaultFeatures = ['VOICE_MODE']  // 只有 VOICE_MODE 默认开启

// free-code/scripts/build.ts:184-185
for (const feature of features) {
  cmd.push(`--feature=${feature}`)  // 传给 bun build
}
```

`import { feature } from 'bun:bundle'` 是 Bun 的**编译时宏系统**。
- `feature('FORK_SUBAGENT')` 在编译时求值
- 若为 `false`，整个 `if` 分支被**死代码消除（DCE）**，最终二进制中完全不包含 fork 代码
- 构建命令如：`bun run build --feature=FORK_SUBAGENT`

```
Build 时 ──→ feature('FORK_SUBAGENT') 求值
              │
              ├── true  → 保留 fork 代码到二进制
              └── false → DCE，二进制中没有 fork 代码（零运行时开销）
```

**第二层：运行时动态 Flag（Statsig/GrowthBook）**

从 `free-code/src/services/` 目录结构和源码引用看，Claude Code 集成了 **Statsig** 作为运行时 feature flag 平台：

```
free-code/src/services/
├── statsig.ts     (在 free-code CLAUDE.md 架构图中列出)
└── ...
```

Statsig / GrowthBook 提供：
- **灰度发布**：先向 1% 用户开启，观察稳定后逐步扩大到 100%
- **A/B 实验**：对比开启/关闭的用户体验指标
- **即时关闭**：发现问题时远程关闭，无需发版
- **用户细分**：按地域、账号类型、使用行为等条件控制

**两层结合使用：**

```
bun:bundle 编译时               Statsig/GrowthBook 运行时
                                 
FORK_SUBAGENT 代码 ─→ 二进制中包含 ─→ 仅在白名单用户中激活
（未传 --feature） ─→ DCE 掉    ─→ 不存在于二进制，无法激活
```

编译时 flag 决定"代码是否存在"，运行时 flag 决定"是否激活"。

#### GrowthBook 是什么？

| 属性 | 说明 |
|------|------|
| **全名** | GrowthBook |
| **类型** | 开源 feature flag 和 A/B 测试平台 |
| **用途** | 控制功能开关、灰度发布、实验分析 |
| **竞品** | LaunchDarkly、Statsig、Split |
| **官网** | growthbook.io |

核心工作流程：

```
开发者提交新功能代码
  │
  ├── 代码中包含 feature('FORK_SUBAGENT') 检查
  │
  ├── 构建时: feature flag 名称被编码到二进制
  │
  ├── 运行时: GrowthBook SDK 从服务端拉取 flag 状态
  │   ├── 用户 ID 在实验组 → flag = true
  │   └── 用户 ID 在对照组 → flag = false
  │
  └── 代码根据 flag 状态走不同分支
```

#### 我们为什么用环境变量替代？

```
参考源码: feature('FORK_SUBAGENT') → GrowthBook 远程控制
                                   → 灰度发布、A/B 测试、即时关闭

我们的简化: process.env.CC_FORK_SUBAGENT === "1" → 本地环境变量
                                                  → 需要重启进程才能改变
                                                  → 没有灰度、没有远程控制
```

**环境变量的优缺点：**

| 对比项 | GrowthBook | 环境变量 |
|--------|-----------|---------|
| 灰度发布 | 支持（1% → 10% → 100%） | 不支持 |
| 远程控制 | 支持（后台开关，无需部署） | 不支持 |
| A/B 测试 | 支持 | 不支持 |
| 用户细分 | 支持（按属性筛选） | 不支持 |
| 复杂度 | 需要 SDK 集成、网络请求 | 零（一行 `process.env`） |
| 学习目的 | 需要搭建额外服务 | 够用 |

**结论**：对于学习项目，环境变量是最合适的简化方案。不需要依赖外部服务、不需要配置 SDK，专注于理解 fork 的核心机制本身。当理解了 "feature gate 控制" 这个模式后，切换到 GrowthBook 只是换一个函数调用的问题。

---

## 问题 6：Fork 是 Worktree 的前置条件吗？

### 直接答案

**技术上是"否"，实际使用中是"是"。**

### 技术层面（代码独立性）

`worktree.ts` 是一个**完全独立**的工具模块，与 fork 代码零耦合：

```typescript
// worktree.ts 的导出函数 — 没有一行 fork 相关代码
export function validateWorktreeSlug(slug: string): void
export function worktreeBranchName(slug: string): string
export async function createAgentWorktree(slug: string): Promise<AgentWorktreeInfo>
export async function removeAgentWorktree(...): Promise<boolean>
export async function hasWorktreeChanges(...): Promise<boolean>
```

你可以完全不经过 fork 路径，直接调用 `createAgentWorktree()` 来创建一个隔离工作目录。它本质上就是 `git worktree add` 的封装。

### 实际层面（代码集成现状）

但在当前的代码库中，worktree 的**所有消费方**都依赖于 fork：

| 代码位置 | 角色 | 与 fork 的关系 |
|---------|------|--------------|
| `forkedAgent.ts:70` | `worktreePath?: string` 参数定义 | 参数在 `ForkedAgentParams` 中（forged agent 专用参数） |
| `forkedAgent.ts:230` | `const effectiveCwd = worktreePath ?? context.workingDirectory` | 实际使用 worktree 路径替换 cwd — 只在 forked agent 循环中 |
| `forkSubagent.ts:189-199` | `buildWorktreeNotice()` | 描述写着 "Notice injected into **fork children** running in an isolated worktree" |
| `src/tools/AgentTool/index.ts` | 工具路由 | **当前未引用任何 worktree 函数** |

关键发现：`createAgentWorktree` 和 `removeAgentWorktree` **在当前源码中没有被任何执行路径调用**。它们已经被实现、测试完毕，但尚未接入真正的 Agent 工具执行流。

### 设计文档中的定位

从设计文档的数据流图看，worktree 是 fork 路径下的**可选子步骤**：

```
AgentTool.execute(input)
  │
  ├── isForkPath?
  │   ├── YES → Fork 路径
  │   │    ├── buildForkedMessages(...)
  │   │    ├── [可选] isolation === 'worktree':    ← worktree 在这里
  │   │    │    ├── createAgentWorktree(slug)
  │   │    │    └── buildWorktreeNotice(...)
  │   │    └── runForkedAgent(...)
  │   │
  │   └── NO → Normal 路径
  │        └── runSubAgent(...)                     ← 没有 worktree 选项
```

Normal 路径完全没有 worktree 的选项。Worktree 只在 fork 路径中作为一个可选增强存在。

### 为什么只有 Fork 路径需要 Worktree？

| 场景 | Normal 路径 | Fork 路径 |
|------|-----------|----------|
| **执行方式** | 串行（`isConcurrencySafe` 返回 false） | 设计为可并行 |
| **文件冲突风险** | 低（同一时刻只有一个 Agent 写文件） | 高（多个子 Agent 可能同时写同一文件） |
| **生命周期** | 父进程同步等待 | 可后台异步执行 |
| **撤销方式** | 无法单独撤销改动 | 直接删除 worktree 即可干净回滚 |
| **上下文隔离** | 不需要（串行执行不会有状态交叉） | 需要（并行执行可能有状态交叉） |

Worktree 解决的核心问题是**并发 Agent 的文件冲突**。Normal 路径是串行的，同一时刻只有一个 Agent 在操作文件，自然不会冲突。

### 反例：Fork 不一定需要 Worktree

反过来，fork 也不一定需要 worktree。当 fork 子 Agent 只做**只读操作**（搜索、分析、阅读）时，不需要 worktree：

```
Fork + 无 Worktree（读任务）:
  fork 子进程只需读取文件做分析
  → 不需要隔离，共享父工作目录即可
  → 没有写冲突风险

Fork + Worktree（写任务）:
  fork 子进程需要修改文件做重构
  → 需要隔离，防止并行子 Agent 冲突
  → 需要干净的撤销路径
```

这就是为什么 worktree 在设计中是**可选**的（`[可选] isolation === 'worktree'`）。

### 总结

```
关系矩阵:

                  Normal 路径          Fork 路径
                  ───────────         ─────────
无 Worktree:      ✅ 标准模式          ✅ 只读子任务
有 Worktree:      ❌ 不提供            ✅ 写任务隔离

结论:
  - Worktree 不依赖 Fork 的代码（技术独立）
  - Worktree 依赖 Fork 的集成（实际使用）
  - Fork 可以没有 Worktree（只读任务）
  - Worktree 不能脱离 Fork（当前代码中没有 Normal + Worktree 的组合）
```

```
Normal 路径（inline sub-agent）
  哲学："我是一个独立的工具人"
  特点：有自己的人格（系统提示词）、工具集、行为方式
  适用：需要特定技能的任务（搜索、规划、审查）
  代价：不能共享 cache

Fork 路径
  哲学："我是父的克隆体"
  特点：继承父的一切，但被严格约束行为方式
  适用：需要并行执行、需要共享 cache、通用任务
  代价：不灵活（10 条规则限制）
  └── Worktree 是 Fork 的可选增强
      哲学："我是克隆体，还带了独立的沙箱"
      适用：涉及文件修改的并行任务
      代价：需要额外的创建/清理开销
```

---

## 问题 7：free-code 参考源码中 Fork 和 Worktree 的关系

> 分析基于 `free-code/src/tools/AgentTool/AgentTool.tsx`、`free-code/src/utils/worktree.ts`、`free-code/src/utils/forkedAgent.ts`

### 核心发现：Worktree 独立于 Fork

**在参考源码中，worktree 创建不绑定 fork 路径。** 这是与我们的简化实现最关键的区别。

AgentTool.tsx 中的路由逻辑清晰地展示了这个关系：

```
AgentTool.execute(input)
  │
  ├── 解析 effectiveType → 决定 isForkPath
  │
  ├── 解析 effectiveIsolation               ← 独立于 fork 判断
  │   └── effectiveIsolation = isolation ?? selectedAgent.isolation
  │                              ↑ 输入参数      ↑ Agent 定义默认值
  │
  ├── [条件] effectiveIsolation === 'worktree'  ← gating 条件
  │   ├── ✅ 创建 worktree（无论是否 fork）
  │   └── 生成 worktreeInfo
  │
  ├── [条件] isForkPath && worktreeInfo       ← worktree NOTICE 专属
  │   └── ✅ 注入 buildWorktreeNotice()
  │
   ...
```

### 关键代码证据

#### 1. Worktree 创建入口（AgentTool.tsx:579-593）

```typescript
// free-code/src/tools/AgentTool/AgentTool.tsx
// worktree 创建条件是 effectiveIsolation，不是 isForkPath
if (effectiveIsolation === 'worktree') {
  const slug = `agent-${earlyAgentId.slice(0, 8)}`;
  worktreeInfo = await createAgentWorktree(slug, {
    worktreePathPrefix: '.claude/worktrees',
  });
}
```

这证明 worktree 可以在 Normal 路径和 Fork 路径中同时使用。

#### 2. Worktree Notice 注入（AgentTool.tsx:598-602）

```typescript
// worktree NOTICE 的注入条件：必须同时是 fork + worktree
if (isForkPath && worktreeInfo) {
  promptMessages.push(createUserMessage({
    content: buildWorktreeNotice(getCwd(), worktreeInfo.worktreePath)
  }));
}
```

**这是唯一的"fork + worktree 组合"特化逻辑**。只有 fork 子进程需要路径翻译提示——因为 fork 子进程继承了父的上下文，而上下文中的路径指向父的目录。Normal 路径的子 Agent 有自己独立的系统提示词，不需要这种路径翻译。

#### 3. EffectiveIsolation 解析（AgentTool.tsx:431）

```typescript
const effectiveIsolation = isolation ?? selectedAgent.isolation;
```

`effectiveIsolation` 有两个来源：
- **输入参数**：`input.isolation` — LLM 或调用者显式指定
- **Agent 定义默认值**：`selectedAgent.isolation` — Agent 自己的配置

这意味着：
- 有些 Agent 类型可以声明自己的 isolation 默认值
- 调用者可以通过参数 override 默认值

#### 4. fork + worktree 的执行参数差异（AgentTool.tsx:622-636）

```typescript
if (isForkPath) {
  runAgentParams.override = { systemPrompt: renderedSystemPrompt };
  // fork + worktree 时，worktreePath 通过 forkContextMessages 携带
} else {
  // normal + worktree 时，通过 wrapWithCwd 切换工作目录
  if (worktreeInfo) {
    runAgentParams.initialCwd = worktreeInfo.worktreePath;
  }
}
```

Normal + worktree 路径使用 `initialCwd` 切换目录，而 fork + worktree 路径通过消息注入（`buildWorktreeNotice`）告知目录变化。

#### 5. Worktree 结果回传（agentToolUtils.ts）

```typescript
// agentToolUtils.ts — runAsyncAgentLifecycle
// worktree 信息通过 getWorktreeResult 回调传播
const getWorktreeResult = async () => ({
  worktreePath: worktreeInfo?.worktreePath,
  worktreeBranch: worktreeInfo?.worktreeBranch,
});

// 在 Agent 完成/失败/被 kill 时，worktree 信息被传播到 agent notification
// 这样父进程可以知道子 Agent 在哪个 worktree 中工作
```

完成或失败后的清理逻辑（AgentTool.tsx:644-684）：

```typescript
async function cleanupWorktreeIfNeeded(worktreeInfo, agentId) {
  if (!worktreeInfo) return null;
  
  const hasChanges = await hasWorktreeChanges(
    worktreeInfo.worktreePath,
    worktreeInfo.headCommit!,
    worktreeInfo.gitRoot,
  );
  
  if (hasChanges) {
    // 有变更 → 保留 worktree，返回路径信息
    return { worktreePath, worktreeBranch };
  } else {
    // 无变更 → 删除 worktree 和分支
    await removeAgentWorktree(worktreePath, worktreeBranch, gitRoot);
    return null;
  }
}
```

### forkSubagent.ts — Feature Gate 策略差异

参考源码（free-code）和我们简化版本在 gate 机制上有本质不同：

| 维度 | 参考源码（free-code） | 我们的简化实现 |
|------|---------------------|--------------|
| **gate 机制** | `import { feature } from 'bun:bundle'` — 编译时宏 | 运行时 `process.env` 检查 |
| **DCE** | feature 关闭时 → fork 代码在二进制中不存在 | 代码始终存在，运行时跳过 |
| **构建要求** | 必须传 `--feature=FORK_SUBAGENT` 构建 | 无需特殊构建，设置环境变量即可 |
| **Agent 定义** | `FORK_AGENT` 仅当 `feature('FORK_SUBAGENT')` 为 true 时编译进 registry | `FORK_AGENT` 始终在 registry 中 |
| **路由逻辑** | `effectiveType = subagent_type ?? general-purpose`（fork 通过注册 agent 类型实现）| `effectiveType = subagent_type ?? (gate ? undefined : "general-purpose")` |

### 参考源码中 Worktree 的完整创建流程

```
createAgentWorktree(slug, options?)
  │
  ├── validateWorktreeSlug(slug)
  │   └── 安全检查：字符集、长度、路径穿越
  │
  ├── 优先 Hook-based: executeWorktreeCreateHook()
  │   └── 当 `settings.worktree.hooks` 配置时
  │       └── 支持非 git VCS 的 worktree 创建
  │
  ├── 回退 Git-based:
  │   ├── findCanonicalGitRoot() → 主仓库根
  │   ├── getOrCreateWorktree()
  │   │   ├── 快速恢复路径：读取 .git 指针 → 直接返回（省 6-8s）
  │   │   └── 新建路径：
  │   │       ├── mkdir(.claude/worktrees/, recursive)
  │   │       ├── git fetch origin <defaultBranch>（跳过如果本地没有）
  │   │       ├── git worktree add -B <branch> <path> <base>
  │   │       └── 可选 sparse-checkout
  │   ├── performPostCreationSetup()
  │   │   ├── 复制 settings.local.json
  │   │   ├── 配置 git hooks → 使用主仓库的 .husky/ 或 .git/hooks/
  │   │   ├── Symlink 目录（node_modules 等）
  │   │   └── 复制 .worktreeinclude 文件
  │   └── 返回 { worktreePath, worktreeBranch, headCommit, gitRoot }
  │
  └── 异常处理：
      ├── git 命令失败 → throw（Agent 创建失败）
      └── 目录已存在 → 快速恢复（不做 fetch）
```

### AgentTool.tsx 完整路由矩阵

参考源码中，fork 和 worktree 组合形成 4 种可能的执行模式：

```
                    Normal 路径 (isForkPath=false)     Fork 路径 (isForkPath=true)
                    ─────────────────────────────     ─────────────────────────
无 Worktree:        standard sub-agent               fork sub-agent
(effectiveIsolation  • 独立 system prompt              • 继承父 system prompt
  !== 'worktree')    • 独立工具池                        • 父的完整工具池
                     • 独立上下文                        • 继承父上下文
                     • 串行执行                          • 可用并行
                     • runSubAgent()                    • runForkedAgent()

有 Worktree:        normal + worktree                 fork + worktree
(effectiveIsolation  • 标准 sub-agent                    • fork sub-agent
  === 'worktree')    • 独立 system prompt               • 继承父 system prompt
                     • 独立工具池                        • 父的完整工具池
                     • 独立上下文                        • 继承父上下文
                     • 在 worktree 中工作               • 在 worktree 中工作
                     • initialCwd 切换目录               • buildWorktreeNotice 告知
                     • 自动清理 / 保留                   • 自动清理 / 保留
                     • 清理时回传结果                    • 清理时回传结果
```

### 参考源码与简化实现的关键差异汇总

| 差异点 | free-code（参考源码） | 我们的实现 |
|--------|---------------------|----------|
| **Worktree 绑定关系** | 独立于 fork，normal + worktree 可行 | 当前仅设计在 fork 路径下 |
| **Feature Gate** | `bun:bundle` 编译时宏 + 静态分析 DCE | 运行时环境变量 |
| **Agent 的 isolation 默认值** | `selectedAgent.isolation` — Agent 定义可声明 | 未实现 |
| **isolation 来源** | 输入参数 + Agent 定义双重来源 | 未实现（schema 无 isolation 字段） |
| **Normal + Worktree** | 通过 `initialCwd` 切换目录 | 未实现 |
| **Sparse checkout** | 支持 | 简化跳过 |
| **Hook-based 创建** | 支持非 git VCS | 简化跳过 |
| **.worktreeinclude** | 自动复制 gitignored 文件 | 简化跳过 |
| **Symlink 配置** | 支持 node_modules 等 | 简化跳过 |
| **Stale 清理** | 30 天自动清理 | 简化跳过 |
| **Worktree 结果回传** | 通过 `getWorktreeResult` 回调 | 未实现 |
| **Tmux 集成** | 支持 | 简化跳过 |

### 架构设计启示

1. **Worktree 是独立基础设施**：free-code 中将 worktree 视为通用隔离机制，而非 fork 专属特性。Agent 定义可以声明自己的 isolation 需求，不依赖 fork 路径。

2. **Notice 是 fork 的 path translation 问题**：`buildWorktreeNotice()` 作为唯一的 fork+worktree 特化代码，存在的原因纯粹是技术性的——fork 子进程继承了含有旧路径的上下文。Normal 路径的子 Agent 不需要这个，因为其上下文不包含对父路径的引用。

3. **构建时 DCE 是性能决策**：free-code 使用 `bun:bundle` 的编译时宏实现 DCE，使得 fork 代码在不需要时零成本。这是对二进制体积和运行时性能的极致追求。

4. **完整设计是逐步演进的**：free-code 中的 worktree 功能有 1520 行代码（vs 我们的简化版约 200 行），涵盖了快速恢复、清理策略、hook 扩展、sparse checkout 等生产级特性。这提醒我们，我们当前的简化版只是一个**最小可行子集**，距离生产级还有很大距离。

---

## 问题 8：free-code 有哪些内置 Agent？它们的 worktree/isolation 是写死的还是运行时决定的？

### 内置 Agent 列表

free-code 的内置 Agent 定义在 `src/tools/AgentTool/builtInAgents.ts` 中，通过 `getBuiltInAgents()` 注册：

| Agent 类型 | 来源文件 | 是否默认包含 | 关键特性 |
|-----------|---------|------------|---------|
| `general-purpose` | `built-in/generalPurposeAgent.ts` | ✅ 总是 | `tools: ['*']`，通用助手 |
| `statusline-setup` | `built-in/statuslineSetup.ts` | ✅ 总是 | `tools: ['Read', 'Edit']`，状态行配置专用 |
| `Explore` | `built-in/exploreAgent.ts` | 条件包含¹ | `disallowedTools` 排除 Write/Edit/Agent |
| `Plan` | `built-in/planAgent.ts` | 条件包含¹ | 继承 Explore 的 tools，架构规划 |
| `claude-code-guide` | `built-in/claudeCodeGuideAgent.ts` | 非 SDK 入口 | WebSearch/Bash/find 工具，`permissionMode: 'dontAsk'` |
| `verification` | `built-in/verificationAgent.ts` | GrowthBook flag² | `background: true`，对抗性验证 |
| `fork`（合成）| `forkSubagent.ts` | 编译时 gate | `maxTurns: 200`，`model: 'inherit'`，`permissionMode: 'bubble'` |

> ¹ `areExplorePlanAgentsEnabled()` — 由 `CLI_EXPLORATION_PLAN_TYPE` 或 `features` 配置控制
> ² GrowthBook flag `tengu_hive_evidence` 为 true 时才包含

### 所有内置 Agent 的 `isolation` 都是 `undefined`

**没有任何一个内置 Agent 写死了 `isolation` 属性。** 每个内置 Agent 的 `isolation` 字段都是未设置的（`undefined`）。

这意味着对于内置 Agent，`effectiveIsolation` 的值完全取决于模型在调用时是否传入了 `isolation` 参数。

### `effectiveIsolation` 的解析规则

```
effectiveIsolation = isolation ?? selectedAgent.isolation
                        ↑                    ↑
                模型调用时传入的参数       Agent 定义中写死的值
```

**决策矩阵：**

| `isolation`（模型传入） | `selectedAgent.isolation`（Agent 定义） | `effectiveIsolation` |
|------------------------|----------------------------------------|---------------------|
| `undefined` | `undefined`（所有内置 Agent） | `undefined` → 不创建 worktree |
| `"worktree"` | `undefined` | `"worktree"` → 创建 worktree |
| `undefined` | `"worktree"`（用户定义 Agent） | `"worktree"` → 创建 worktree |
| `"worktree"` | `"worktree"` | `"worktree"` → 创建 worktree |

**关键结论：**

1. **内置 Agent 的 isolation 是写死的 `undefined`** — 代码中明确不设置此字段
2. **worktree 是否激活是运行时模型决定的** — 模型可以在调用 AgentTool 时传入 `isolation: "worktree"` 来请求隔离
3. **用户定义 Agent 可以写死** — 在 `.claude/agents/` 目录的 SKILL.md 或 JSON 配置中，可以设置 `isolation: worktree`，这时即使模型不传参也会走 worktree
4. **`isolation` 参数是可选的** — 输入 schema 中用 `.optional()` 声明，模型可以选择传或不传

### 输入 Schema 中的 isolation 定义

```typescript
// free-code/src/tools/AgentTool/AgentTool.tsx:99
isolation: (process.env.USER_TYPE === 'ant'
  ? z.enum(['worktree', 'remote'])   // Anthropic 内部员工还可以选 'remote'
  : z.enum(['worktree'])             // 外部用户只能选 'worktree'
).optional()                         // 可选参数
```

外部用户只能传 `"worktree"`，Anthropic 内部员工（`USER_TYPE === 'ant'`）还可以传 `"remote"` 实现远程隔离执行。

### `isWorktreeModeEnabled()` — 全局开关

```typescript
// free-code/src/utils/worktreeModeEnabled.ts
export function isWorktreeModeEnabled(): boolean {
  return true  // 始终开启
}
```

这个函数**总是返回 true**。注释说明之前由 GrowthBook flag 控制，但由于 `CACHED_MAY_BE_STALE` 模式导致首次启动时静默禁用，所以改为无条件开启。

所以整个决策链条是：

```
isWorktreeModeEnabled() → 始终 true（全局 worktree 基础功能可用）
         │
         ▼
effectiveIsolation = isolation ?? selectedAgent.isolation
         │
         ├── "worktree" → 创建隔离 worktree 目录
         └── undefined → 不隔离，共享父目录
```

**全局开关已经开了，但具体用不用取决于每个 Agent 调用是否请求 worktree。**
