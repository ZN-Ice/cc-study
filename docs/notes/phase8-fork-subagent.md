# Phase 8 源码研读：Fork Subagent 机制

> 参考源码：`free-code/src/tools/AgentTool/forkSubagent.ts`

## 1. 概述

Fork Subagent 是 Claude Code 的一种特殊子 Agent 模式。与传统的 inline agent（指定 `subagent_type` 运行）不同，fork 模式让子进程**继承父 Agent 的完整对话上下文和系统提示词**，从而实现：

- **Prompt Cache 共享**：子进程的 API 请求前缀与父进程字节级一致，直接命中缓存
- **并行工作**：多个 fork 子进程可以同时执行不同任务
- **统一交互模型**：所有 Agent 调用都变成异步 `<task-notification>` 模式

## 2. 核心组件

### 2.1 Feature Gate — `isForkSubagentEnabled()`

```typescript
export function isForkSubagentEnabled(): boolean {
  if (feature('FORK_SUBAGENT')) {
    if (isCoordinatorMode()) return false    // coordinator 有自己的委派模型
    if (getIsNonInteractiveSession()) return false  // 非交互模式不支持
    return true
  }
  return false
}
```

关键点：fork gate 开启时，`subagent_type` 在 schema 上变为 optional，省略则触发 fork。

### 2.2 FORK_AGENT 定义

```typescript
export const FORK_AGENT = {
  agentType: 'fork',
  tools: ['*'],              // 继承父工具池（prompt cache 需要）
  maxTurns: 200,
  model: 'inherit',          // 继承父模型
  permissionMode: 'bubble',  // 权限冒泡到父终端
  getSystemPrompt: () => '', // 实际使用父的 renderedSystemPrompt
}
```

设计决策：
- `tools: ['*']` + `useExactTools`：子进程接收父的**精确**工具定义，确保 API 请求前缀相同
- `permissionMode: 'bubble'`：子进程需要权限时，弹出提示到父终端确认
- `getSystemPrompt` 返回空字符串：实际使用父进程已渲染的系统提示词（通过 `toolUseContext.renderedSystemPrompt` 传递字节精确版本）

### 2.3 buildForkedMessages — 消息构建算法

这是 fork 模式的核心算法，目标是为 prompt cache 构建字节级相同的前缀：

```
输入：
  - directive: string（子任务指令）
  - assistantMessage: 父 Agent 当前的 assistant 消息（含 tool_use blocks）

输出：
  [fullAssistantMessage, toolResultMessage]
```

**算法步骤**：

1. **克隆父 assistant 消息**（含所有 tool_use、thinking、text blocks）
2. **收集所有 tool_use blocks**
3. **为每个 tool_use 构建占位符 tool_result**（文本内容完全相同：`"Fork started — processing in background"`）
4. **构建单一 user 消息**：`[所有占位符 tool_results, per-child directive 文本块]`

**为什么这样可以实现 cache 共享？**

```
父 Agent:  [...history, assistant(tool_use_A, tool_use_B), user(result_A, result_B)]
Fork 子1:  [...history, assistant(tool_use_A, tool_use_B), user(placeholder_A, placeholder_B, "directive_1")]
Fork 子2:  [...history, assistant(tool_use_A, tool_use_B), user(placeholder_A, placeholder_B, "directive_2")]
```

- `history` + `assistant(...)` 是完全相同的字节
- 占位符 tool_results 也是完全相同的文本
- 只有最后一个 directive 文本块不同
- Anthropic API 的 cache 以 `message` 为边界，所以大部分前缀都能命中 cache

### 2.4 buildChildMessage — 子进程规则（10 条 RULES）

```
<fork-boilerplate>
STOP. READ THIS FIRST.

RULES (non-negotiable):
1. 不要再 fork — 你已经是 fork 子进程
2. 不要对话、提问、建议下一步
3. 不要添加元评论
4. 直接使用工具执行
5. 修改文件前先 commit
6. 工具调用之间不要输出文本
7. 严格限制在 directive 范围内
8. 报告控制在 500 字以内
9. 回复必须以 "Scope:" 开头
10. 结构化事实报告后停止

Output format:
  Scope: <范围>
  Result: <结果>
  Key files: <文件路径>
  Files changed: <变更列表>
  Issues: <问题列表>
</fork-boilerplate>

Your directive: <具体指令>
```

### 2.5 isInForkChild — 递归 fork 防护

```typescript
export function isInForkChild(messages: MessageType[]): boolean {
  return messages.some(m => {
    if (m.type !== 'user') return false
    const content = m.message.content
    if (!Array.isArray(content)) return false
    return content.some(
      block => block.type === 'text' && block.text.includes('<fork-boilerplate>')
    )
  })
}
```

因为 fork 子进程保留了 Agent 工具（为了 cache 一致性），需要运行时检测防止递归 fork。

### 2.6 buildWorktreeNotice — 路径翻译提示

当 fork + worktree 组合使用时，注入提示告知子进程：
- 当前在隔离的 worktree 目录中
- 继承的上下文路径需要翻译
- 修改前重新读取文件（可能过时）

## 3. 路由逻辑（AgentTool.tsx 中的调度）

```typescript
const effectiveType = subagent_type ?? (isForkSubagentEnabled() ? undefined : 'general-purpose')
const isForkPath = effectiveType === undefined

if (isForkPath) {
  // 递归 fork 防护
  if (isInForkChild(messages)) throw new Error(...)
  selectedAgent = FORK_AGENT
} else {
  selectedAgent = agents.find(a => a.agentType === effectiveType)
}

// Fork 路径：继承父系统提示词
if (isForkPath) {
  forkParentSystemPrompt = toolUseContext.renderedSystemPrompt
  promptMessages = buildForkedMessages(prompt, assistantMessage)
} else {
  promptMessages = [createUserMessage({ content: prompt })]
}

// Fork 路径参数
runAgentParams = {
  override: isForkPath ? { systemPrompt: forkParentSystemPrompt } : ...,
  availableTools: isForkPath ? toolUseContext.options.tools : workerTools,
  forkContextMessages: isForkPath ? toolUseContext.messages : undefined,
  ...(isForkPath && { useExactTools: true }),
}
```

## 4. 设计洞察

1. **Cache 一致性是核心约束**：所有 fork 设计决策都围绕 "API 请求前缀字节级一致" 这个目标
2. **占位符策略**：tool_results 用完全相同的文本，让多子进程共享大部分 prefix
3. **权限冒泡**：fork 子进程在后台运行，但权限确认需要弹出给用户
4. **递归防护**：通过消息内容检测 `<fork-boilerplate>` 标签
5. **Worktree 隔离是可选增强**：fork 不一定需要 worktree，但组合使用时提供文件系统隔离
