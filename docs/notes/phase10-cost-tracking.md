# Phase 10: Token/Cost 追踪系统研读笔记

> 研读日期：2026-05-05
> 参考源码：`free-code/src/cost-tracker.ts`, `free-code/src/utils/tokens.ts`

## 一、cost-tracker.ts 架构

### 设计模式

Claude Code 使用 **模块级单例** 模式实现成本追踪。所有状态存储在模块作用域的私有变量中，通过导出的 getter 函数访问。

```typescript
// 模块级私有状态（单例）
let totalCostUSD = 0;
let totalDuration = 0;
let totalAPIDuration = 0;
let totalLinesAdded = 0;
let totalLinesRemoved = 0;
let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalCacheReadInputTokens = 0;
let totalCacheCreationInputTokens = 0;
let totalWebSearchRequests = 0;
let totalRetryDuration = 0;
let modelUsage: Record<string, ModelUsage> = {};
```

### 核心 API

| 函数 | 类型 | 说明 |
|------|------|------|
| `addToTotalSessionCost(cost, usage, model)` | 写入 | 主入口，累积一次 API 调用的成本和 tokens |
| `getTotalCost()` | 读取 | 累计总成本（USD） |
| `getTotalDuration()` | 读取 | 累计总耗时（ms） |
| `getTotalInputTokens()` | 读取 | 累计 Input Tokens |
| `getTotalOutputTokens()` | 读取 | 累计 Output Tokens |
| `getTotalLinesAdded()` | 读取 | 累计新增代码行数 |
| `getTotalLinesRemoved()` | 读取 | 累计删除代码行数 |
| `formatTotalCost()` | 格式化 | 多行格式化输出 |
| `saveCurrentSessionCosts()` | 持久化 | 保存到项目配置 |
| `restoreCostStateForSession()` | 持久化 | 恢复会话成本 |
| `resetCostState()` | 测试 | 重置所有状态 |

### 数据流

```
API Response (usage + cost)
    ↓
addToTotalSessionCost({
    cost: { inputCost, outputCost, cacheCost },
    usage: { inputTokens, outputTokens, cacheTokens },
    model: "claude-sonnet-4-6",
    duration: 1234,
    fpsMetrics?: { ... }
})
    ↓
累计到模块级变量
    ↓
StatusLine 通过 getter 读取实时数据
```

### 成本计算

Claude Code 使用 Anthropic 官方定价表按模型累计：
- `addToTotalModelUsage()` 按模型分组统计
- `formatModelUsage()` 按模型展示详细使用量
- 支持 advisor（子 Agent）成本的递归累积

## 二、tokens.ts 关键函数

### getTokenUsage(message)
从 Assistant 消息中提取 `usage` 字段，跳过合成消息（无 id）。

### tokenCountFromLastAPIResponse(messages)
从消息列表末尾向前遍历，找到最后一条包含 `usage` 的 Assistant 消息，返回 token 计数。

### getCurrentUsage(messages)
返回当前会话的实时使用量：
```typescript
{
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}
```

### tokenCountWithEstimation(messages)
**核心函数**——计算上下文窗口占用。处理并行工具调用拆分的情况（同一 `message.id` 的多条记录）。

### doesMostRecentAssistantMessageExceed200k(messages)
检查最近消息是否超过 200K token 阈值，用于触发警告或压缩。

## 三、cc-study 简化方案

### 简化原则

1. **不需要会话持久化**：学习项目不需要跨会话保存成本
2. **不需要按模型分组**：简化到单模型会话级累计
3. **不需要代码行数追踪**：去掉 `linesAdded/linesRemoved`
4. **不需要 FPS 指标**：去掉性能监控

### 简化后的 API

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

// 写入
export function addUsage(entry: CostEntry): void;

// 读取
export function getTotalCost(): number;        // cents
export function getTotalTokens(): TokenUsage;
export function getSessionDuration(): number;  // ms
export function getCostEntries(): readonly CostEntry[];
export function getTotalAPIDuration(): number; // ms

// 测试
export function reset(): void;
```

### 成本计算策略

为简化计算，使用 Claude 层级近似定价：
- Input: ~$3/M tokens → 0.3 cents/1K tokens
- Output: ~$15/M tokens → 1.5 cents/1K tokens

在 `useStreamResponse` 中每次 API 调用后计算：
```typescript
const inputCost = (usage.inputTokens / 1000) * 0.3;  // cents
const outputCost = (usage.outputTokens / 1000) * 1.5;  // cents
addUsage({ tokens: usage, costCents: inputCost + outputCost, ... });
```

## 四、API Token 数据获取

### Anthropic API Streaming Events

流式响应中包含 `message_start` 事件，携带 `usage` 字段：

```json
{
  "type": "message_start",
  "message": {
    "id": "msg_xxx",
    "model": "claude-sonnet-4-6",
    "usage": {
      "input_tokens": 1234,
      "output_tokens": 567,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 0
    }
  }
}
```

### 当前 cc-study 缺失

在 `src/services/api.ts` 中，`collectStreamResponse` 只处理 `content_block_*` 事件和 `message_delta`，**不处理 `message_start` 事件**，因此 token usage 数据被丢弃。

### 修改方案

1. 扩展 `MessageStartEvent` 类型定义，添加 `usage` 字段
2. 在 `collectStreamResponse` 中捕获 `message_start` 事件
3. 将 usage 数据返回给调用方（`useStreamResponse`）
