# Phase 10: UI 优化设计文档

> 创建日期：2026-05-05
> 参考源码：`free-code/src/components/StatusLine.tsx`, `free-code/src/cost-tracker.ts`, `free-code/src/utils/format.ts`, `free-code/src/components/VirtualMessageList.tsx`

## 一、目标

在现有 cc-study REPL 基础上增加 UI 优化特性：
1. **StatusLine**：底部状态栏，显示 model、token 用量、成本、执行状态
2. **Token/Cost 追踪**：从 API 响应中捕获 token 数据，累加会话级成本
3. **执行时间显示**：API 调用耗时 + 工具执行耗时
4. **滚动支持**：消息列表分页（长对话可导航）
5. **AgentProgress 增强**：添加 token count 和 model name

---

## 二、系统架构

### 2.1 当前架构

```
App.tsx
 ├─ Header (version, model, debug)
 ├─ MessageList (renders all messages, No scrolling)
 ├─ Spinner (thinking/responding/executing)
 ├─ AgentProgress (agentType, toolUseCount, elapsed time)
 ├─ PermissionConfirm
 └─ PromptInput
```

### 2.2 目标架构

```
App.tsx
 ├─ Header (version, model, debug)
 ├─ MessageList (paginated, NEW: page navigation)
 ├─ Spinner (thinking/responding/executing)
 ├─ AgentProgress (enhanced: +tokenCount, +model)
 ├─ PermissionConfirm
 ├─ PromptInput
 └─ StatusLine (NEW: tokens, cost, executing tools, timing)
```

### 2.3 数据流

```
┌──────────────────────────────────────────────────────────────┐
│                        API Layer                              │
│  api.ts: streamChat()                                         │
│  MODIFIED: parse message_start → extract usage               │
│  NEW: SSEStreamEvent type includes usage                     │
└───────────────────────┬──────────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────────┐
│                     Hook Layer                                │
│  useStreamResponse.ts                                         │
│  NEW: tokenUsage, totalCost, apiDurationMs, toolDurations    │
│  NEW: integrate cost-tracker.ts                              │
└───────────────────────┬──────────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────────┐
│                    Component Layer                            │
│  StatusLine.tsx (NEW): token display, cost, timers           │
│  AgentProgress.tsx (MODIFIED): +tokenCount, +model           │
│  MessageList.tsx (MODIFIED): +pagination                     │
└──────────────────────────────────────────────────────────────┘
```

---

## 三、组件设计

### 3.1 StatusLine

**位置**：App.tsx 底部，PromptInput 下方

**Props**：
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

**渲染状态**：

| 状态 | 显示内容 |
|------|---------|
| 空闲（无 tokens） | `claude-sonnet-4-6` |
| 空闲（有 tokens） | `claude-sonnet-4-6 \| 12.3k in · 4.5k out · $1.58 · 2m 15s` |
| 工具执行中 | `claude-sonnet-4-6 \| [Executing: Read, Grep] · $1.58 · 2m 15s` |
| 等待 API | `claude-sonnet-4-6 \| ● Thinking... · 12.3k tokens · 2m 15s` |

**颜色方案**：
- model name: `dim`
- token counts: default
- cost: `green` (if > $0)
- executing tools: `yellow`
- thinking indicator: `magenta`
- separator `|`: `dim`

### 3.2 AgentProgress（增强）

**当前 Props**：
```typescript
interface AgentProgressProps {
  agentType: string;
  description?: string;
  toolUseCount: number;
  startTime: number;
  recentTools?: readonly string[];
}
```

**增强后 Props**（添加字段）：
```typescript
interface AgentProgressProps {
  // ...existing fields
  tokenCount?: number;       // NEW
  model?: string;            // NEW
}
```

**增强后渲染**：
```
🤖 Agent (Explore): investigating codebase
   12 tool uses · 1.5k tokens · claude-sonnet-4-6 · 45s
   ▸ Read: src/components/App.tsx
   ▸ Grep: useStreamResponse
```

### 3.3 MessageList（分页）

**当前 Props**：
```typescript
interface MessageListProps {
  messages: readonly Message[];
  streamingText: string | null;
}
```

**增强后 Props**：
```typescript
interface MessageListProps {
  messages: readonly Message[];
  streamingText: string | null;
  pageSize?: number;  // default: 20, NEW
}
```

**内部状态**：
```typescript
// usePagination hook
interface PaginationState {
  showAll: boolean;
  currentPage: number;
}
```

**分页规则**：
1. 消息数 ≤ `pageSize` → 显示全部
2. 消息数 > `pageSize` 且未点击 Show All → 显示最后 N 条 + footer
3. Show All 模式 → 显示全部
4. 流式输出中 → 自动跳转显示最新

**Footer 显示**：
```
─── 15 more messages ─── [Show All] ───
```

---

## 四、数据层设计

### 4.1 format.ts

```typescript
// src/utils/format.ts

export function formatDuration(ms: number): string;
// 规则：
// < 1000ms → "Xs" or "X.Xs" (rounded to 1 decimal if < 10s)
// < 60000ms → "Xs" (整秒)
// < 3600000ms → "Xm Ys"
// >= 3600000ms → "Xh Ym Zs"

export function formatNumber(n: number): string;
// 规则：使用 Intl.NumberFormat('en-US') 千分位分隔

export function formatCost(cents: number): string;
// 规则：cents → "$X.XX" (2 decimal places, always)
```

### 4.2 cost-tracker.ts

```typescript
// src/cost-tracker.ts

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

interface CostEntry {
  tokens: TokenUsage;
  costCents: number;
  durationMs: number;
  model: string;
  timestamp: number;
}

// Write
export function addUsage(entry: CostEntry): void;

// Read
export function getTotalCost(): number;         // cents
export function getTotalTokens(): TokenUsage;
export function getSessionDuration(): number;   // ms
export function getTotalAPIDuration(): number;  // ms
export function getCostEntries(): readonly CostEntry[];

// Reset (for tests)
export function reset(): void;
```

**成本计算策略**：
- Input: $3/M tokens → 0.3 cents/1K tokens
- Output: $15/M tokens → 1.5 cents/1K tokens
- Cache write: $3.75/M → 0.375 cents/1K
- Cache read: $0.30/M → 0.03 cents/1K

在 `useStreamResponse` 中调用：
```typescript
const inputCost = (usage.inputTokens / 1000) * 0.3;
const outputCost = (usage.outputTokens / 1000) * 1.5;
addUsage({ tokens: usage, costCents: inputCost + outputCost, durationMs, model, timestamp: Date.now() });
```

### 4.3 api.ts 修改

**类型扩展**：
```typescript
// 新增 MessageStartEvent 类型
export interface MessageStartEvent {
  readonly type: "message_start";
  readonly message: {
    readonly id: string;
    readonly model?: string;
    readonly usage?: APIUsage;
  };
}

export interface APIUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// 扩展到 SSEStreamEvent
export type SSEStreamEvent =
  | MessageStartEvent     // NEW
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | PingEvent
  | ErrorEvent;
```

### 4.4 types.ts 修改

```typescript
// ToolResult 扩展
export interface ToolResult {
  output: string;
  error?: boolean;
  metadata?: Record<string, unknown>;
  durationMs?: number;   // NEW
}

// AgentProgressEvent 扩展
export interface AgentProgressEvent {
  agentId: string;
  agentType: string;
  description?: string;
  toolUseCount: number;
  startTime: number;
  recentTools: readonly string[];
  tokenCount?: number;    // NEW
  model?: string;         // NEW
}
```

---

## 五、useStreamResponse 修改

### 新增返回字段

```typescript
interface UseStreamResponseReturn {
  // ...existing fields
  readonly tokenUsage: TokenUsage | null;      // NEW
  readonly totalCost: number;                   // NEW (cents)
  readonly apiDurationMs: number | null;        // NEW
  readonly toolDurations: readonly { name: string; durationMs: number }[];
  readonly sessionDuration: number;             // NEW
}
```

### 内部修改点

1. **捕获 usage**：`collectStreamResponse` 处理 `message_start` 事件
2. **记录 API 耗时**：`Date.now() - t0` 在 streamChat 前后
3. **记录工具耗时**：在 executeAllToolBatches 前后计时
4. **累加成本**：调用 `addUsage()` 每次 API 调用
5. **暴露 session duration**：从第一条消息开始累计

---

## 六、测试规划

| 测试文件 | 覆盖内容 | 用例数（预估） |
|---------|---------|-------------|
| `tests/unit/utils/format.test.ts` | formatDuration, formatNumber, formatCost | 15 |
| `tests/unit/cost-tracker.test.ts` | addUsage, getters, reset | 12 |
| `tests/unit/services/apiUsage.test.ts` | SSE usage event parsing | 8 |
| `tests/unit/hooks/useStreamResponseTiming.test.ts` | token capture, timing | 8 |
| `tests/unit/components/statusLine.test.ts` | StatusLine rendering states | 10 |
| `tests/unit/components/agentProgress.test.ts` | Enhanced AgentProgress | 8 |
| `tests/unit/components/messageList.test.ts` | Pagination behavior | 10 |

**总计**：约 71 个新测试用例

---

## 七、设计决策记录

### 7.1 StatusLine：内联计算 vs 外部命令

| 选项 | 优点 | 缺点 | 选择 |
|------|------|------|------|
| 内联计算（React 组件内格式化） | 简单、无依赖、可测试 | 不可定制 | ✅ 选择 |
| 外部命令（free-code 方式） | 高度可定制 | 需要 Shell 执行、Ansi 解析，过于复杂 | ❌ |

### 7.2 滚动：虚拟滚动 vs 分页

| 选项 | 优点 | 缺点 | 选择 |
|------|------|------|------|
| 虚拟滚动 | 内存效率高 | 实现复杂（~1000+ lines）、Ink 兼容性差 | ❌ |
| 分页 | 简单、可靠、易测试 | 体验略差（需手动操作） | ✅ 选择 |

### 7.3 成本：精确模型定价 vs 简化估算

| 选项 | 优点 | 缺点 | 选择 |
|------|------|------|------|
| 精确定价表 | 准确 | 需维护定价表、模型映射 | ❌ |
| 简化估算（$3/M in + $15/M out） | 简单、够用 | 不精确 | ✅ 选择 |

### 7.4 成本持久化：会话持久 vs 内存累计

| 选项 | 优点 | 缺点 | 选择 |
|------|------|------|------|
| 会话持久（free-code 方式） | 跨会话保留 | 需要序列化/反序列化 | ❌ |
| 内存累计 | 简单、无副作用 | 重启丢失 | ✅ 选择 |
