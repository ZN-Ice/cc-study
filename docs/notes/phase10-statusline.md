# Phase 10: StatusLine 组件研读笔记

> 研读日期：2026-05-05
> 参考源码：`free-code/src/components/StatusLine.tsx`

## 一、组件概览

StatusLine 是 Claude Code 底部的状态栏组件，显示模型名称、Token 用量、成本估算、上下文窗口使用率、Rate Limits 等实时指标。

### 架构特点

1. **外部命令驱动**：StatusLine 不直接格式化显示数据，而是构建一个 `StatusLineCommandInput` 数据结构，调用用户自定义的 `/statusline` 命令来生成输出
2. **300ms 防抖更新**：通过 `scheduleUpdate()` 避免频繁重渲染
3. **Ansi 渲染**：命令输出通过 `<Ansi>` 组件渲染，支持颜色和格式
4. **memo 优化**：使用 `React.memo()` 和前后状态比较避免无效渲染

## 二、核心数据结构

### StatusLineCommandInput

```typescript
interface StatusLineCommandInput {
  model: {
    id: string;           // 模型 ID
    display_name: string; // 显示名称
  };
  workspace: {
    current_dir: string;
    project_dir: string;
    added_dirs: string[];
  };
  cost: {
    total_cost_usd: number;
    total_duration_ms: number;
    total_api_duration_ms: number;
    total_lines_added: number;
    total_lines_removed: number;
  };
  context_window: {
    total_input_tokens: number;
    total_output_tokens: number;
    context_window_size: number;
    current_usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
    };
    used_percentage: number;
    remaining_percentage: number;
  };
  rate_limits?: {
    five_hour?: { remaining: number; limit: number; reset: number };
    seven_day?: { remaining: number; limit: number; reset: number };
  };
  vim?: { mode: "normal" | "insert" | "visual" };
  agent?: { name: string };
  remote?: { session_id: string };
  worktree?: { name: string; path: string; branch: string };
}
```

### 数据来源

| 数据项 | 来源模块 | 函数 |
|--------|---------|------|
| 总成本 | `cost-tracker.ts` | `getTotalCost()` |
| 总耗时 | `cost-tracker.ts` | `getTotalDuration()`, `getTotalAPIDuration()` |
| Input Tokens | `cost-tracker.ts` | `getTotalInputTokens()` |
| Output Tokens | `cost-tracker.ts` | `getTotalOutputTokens()` |
| 代码变更行数 | `cost-tracker.ts` | `getTotalLinesAdded()`, `getTotalLinesRemoved()` |
| 当前使用量 | `tokens.ts` | `getCurrentUsage()` |
| 上下文窗口 | `context.js` | `getContextWindowForModel()` |

## 三、更新触发流程

```
┌──────────────────────────────────────────────────────┐
│ 触发条件（任一变化）                                    │
│ - lastAssistantMessageId 变化（新消息）                 │
│ - permissionMode 变化                                  │
│ - vimMode 变化                                         │
│ - mainLoopModel 变化                                   │
└────────────────────┬─────────────────────────────────┘
                     ▼
┌──────────────────────────────────────────────────────┐
│ scheduleUpdate()                                      │
│ - 300ms debounce                                      │
│ - 比较新数据与 prevData，跳过无变化更新                  │
└────────────────────┬─────────────────────────────────┘
                     ▼
┌──────────────────────────────────────────────────────┐
│ doUpdate()                                            │
│ - buildStatusLineCommandInput() 构建完整数据            │
│ - executeStatusLineCommand() 执行外部命令               │
│ - setAppState({ statusLineText }) 存储结果            │
└────────────────────┬─────────────────────────────────┘
                     ▼
┌──────────────────────────────────────────────────────┐
│ <Ansi>{statusLineText}</Ansi> 渲染                     │
└──────────────────────────────────────────────────────┘
```

## 四、cc-study 简化方案

cc-study 作为学习项目，采用简化方案：

1. **不调用外部命令**：直接在组件内格式化输出（使用 `format.ts` 工具函数）
2. **简化数据模型**：只显示 model、tokens、cost、executing tools
3. **无防抖**：直接响应 state 变化（Ink 会自动批处理）
4. **纯文本渲染**：使用 `<Text>` 组件，不依赖 Ansi

### 简化后的 Props

```typescript
interface StatusLineProps {
  model: string;
  tokenUsage: TokenUsage | null;
  totalCost: number;           // cents
  executingTools: readonly string[];
  isLoading: boolean;
  sessionDuration: number;     // ms
}
```

### 简化后的渲染规则

```
# 空闲状态
model-name | 12.3k input · 4.5k output · $1.58 · 2m 15s

# 工具执行中
model-name | [Executing: Read, Grep] · $1.58 · 2m 15s

# 等待 API 响应
model-name | ● Thinking... · 12.3k tokens · 2m 15s
```

## 五、关键设计决策

1. **为何不直接用外部命令**：外部命令模式需要实现 shell 调用和 Ansi 解析，对学习项目过于复杂
2. **数据流**：`api.ts` → `useStreamResponse`（聚合 tokens/cost/timing）→ `StatusLine`（渲染）
3. **位置**：固定在终端底部（App.tsx 中 PromptInput 下方）
