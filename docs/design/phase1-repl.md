# Phase 1: REPL 交互循环 - 设计文档

> 版本：v1.0.0
> 日期：2026-04-05
> 前置：Phase 0 项目骨架（已完成）
> 源码参考：`free-code/src/screens/REPL.tsx`, `messages.ts`, `services/claude.ts`

---

## 一、设计目标

实现一个终端交互式 REPL (Read-Eval-Print Loop)，支持：
1. 用户输入 → API 流式调用 → 响应渲染的完整循环
2. 多轮对话（消息列表维护）
3. 流式逐 token 渲染
4. Ctrl+C 中断请求
5. 加载状态指示

## 二、模块划分

```
src/
├── messages.ts              # 消息类型定义
├── services/
│   └── api.ts               # Anthropic API 流式调用封装
├── components/
│   ├── App.tsx              # (已有) 改造为 REPL 入口
│   ├── PromptInput.tsx      # 用户输入组件
│   ├── MessageList.tsx      # 消息列表渲染
│   ├── Message.tsx          # 单条消息渲染
│   └── Spinner.tsx          # 加载指示器
├── constants/
│   ├── version.ts           # (已有) 版本号
│   └── prompts.ts           # 系统提示词
└── hooks/
    └── useStreamResponse.ts # 流式响应 Hook
```

## 三、核心数据结构

### 3.1 消息类型系统

```typescript
// src/messages.ts

/** 消息唯一标识 */
type MessageId = string;

/** 内容块联合类型 */
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  | { type: "thinking"; thinking: string };

/** 用户消息 */
interface UserMessage {
  readonly type: "user";
  readonly id: MessageId;
  readonly content: ContentBlock[];
  readonly timestamp: number;
}

/** 助手消息 */
interface AssistantMessage {
  readonly type: "assistant";
  readonly id: MessageId;
  readonly content: ContentBlock[];
  readonly timestamp: number;
  readonly model: string;
  readonly stopReason: "end_turn" | "max_tokens" | "tool_use" | "stop_sequence" | null;
}

/** 消息联合类型 */
type Message = UserMessage | AssistantMessage;
```

### 3.2 流式事件

```typescript
/** API 流式事件 */
type StreamEvent =
  | { type: "message_start"; message: { id: string; model: string } }
  | { type: "content_block_start"; index: number; content_block: ContentBlock }
  | { type: "content_block_delta"; index: number; delta: { type: "text_delta"; text: string } }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: { stop_reason: string } }
  | { type: "message_stop" };

/** 流式回调 */
interface StreamCallbacks {
  onToken: (token: string) => void;
  onComplete: (message: AssistantMessage) => void;
  onError: (error: Error) => void;
}
```

### 3.3 API 配置

```typescript
interface APIConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly maxTokens: number;
  readonly systemPrompt: string;
  readonly temperature: number;
}
```

### 3.4 API 配置解析

API URL 和 API Key 均支持从配置文件覆盖，优先级如下：

**API URL**：
1. `~/.claude/settings.json` 中的 `env.ANTHROPIC_BASE_URL`（拼接 `/v1/messages`）
2. 默认值 `https://api.anthropic.com/v1/messages`

**API Key**：
1. `~/.claude/settings.json` 中的 `env.ANTHROPIC_AUTH_TOKEN`
2. 环境变量 `ANTHROPIC_API_KEY`
3. 空字符串（兜底）

```typescript
// src/services/api.ts

const DEFAULT_API_URL = "https://api.anthropic.com/v1/messages";

interface SettingsEnv {
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
}

function readSettingsEnv(): SettingsEnv {
  try {
    const settingsPath = join(homedir(), ".claude", "settings.json");
    const raw = readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(raw) as { env?: Record<string, string> };
    const env = settings.env ?? {};
    return {
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN,
    };
  } catch {
    return {};
  }
}

export function resolveApiUrl(): string {
  const env = readSettingsEnv();
  if (env.ANTHROPIC_BASE_URL) {
    return `${env.ANTHROPIC_BASE_URL.replace(/\/+$/, "")}/v1/messages`;
  }
  return DEFAULT_API_URL;
}

export function resolveApiKey(): string {
  const env = readSettingsEnv();
  return env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? "";
}

const ANTHROPIC_API_URL = resolveApiUrl();
```

**配置示例**（`~/.claude/settings.json`）：
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://open.bigmodel.cn/api/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "your-api-key-here"
  }
}
```
上述配置将生成 API URL：`https://open.bigmodel.cn/api/anthropic/v1/messages`，并使用 `ANTHROPIC_AUTH_TOKEN` 作为 API Key。

**CI 环境兼容**：无 `settings.json` 时，URL 回退到默认值，API Key 回退到环境变量 `ANTHROPIC_API_KEY`。

## 四、交互循环架构

### 4.1 状态模型

```typescript
interface REPLState {
  // 消息列表（不可变，追加式更新）
  readonly messages: readonly Message[];
  // 当前用户输入
  readonly inputValue: string;
  // 是否正在等待响应
  readonly isLoading: boolean;
  // 流式文本（正在生成的响应）
  readonly streamingText: string | null;
  // 中断控制器
  readonly abortController: AbortController | null;
}
```

### 4.2 交互流程

```
┌─────────────────────────────────────────────────────────┐
│                     REPL 主循环                          │
└─────────────────────────────────────────────────────────┘

  用户输入文本，按 Enter
         │
         ▼
  ┌─────────────────┐
  │ 1. 创建 UserMsg │  { type: "user", content: [{ type: "text", text }] }
  │    追加到消息列表 │  setMessages(prev => [...prev, userMsg])
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │ 2. 创建 AbortCtl│  new AbortController()
  │    设置 loading  │  setIsLoading(true)
  └────────┬────────┘
           │
           ▼
  ┌─────────────────────┐
  │ 3. 调用 API 流式请求 │  streamChat(messages, config, signal)
  │    逐 token 回调     │  onToken → setStreamingText
  └────────┬────────────┘
           │
           ▼  (流式完成)
  ┌─────────────────────┐
  │ 4. 创建 AssistantMsg │  { type: "assistant", content: [...] }
  │    追加到消息列表     │  setMessages(prev => [...prev, asstMsg])
  │    清除流式状态       │  setStreamingText(null), setIsLoading(false)
  └────────┬────────────┘
           │
           ▼
     等待下次用户输入

  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  中断路径：用户按 Ctrl+C
           │
           ▼
  abortController.abort()
  setIsLoading(false)
  setStreamingText(null)
```

### 4.3 中断处理

```typescript
// Ctrl+C 中断
function handleInterrupt(): void {
  if (isLoading && abortController) {
    abortController.abort("user-cancel");
    setAbortController(null);
    setIsLoading(false);
    setStreamingText(null);
  }
}
```

Ink 的 `useInput` 监听 Ctrl+C：
```typescript
useInput((_input, key) => {
  if (key.ctrl && _input === "c") {
    handleInterrupt();
  }
});
```

## 五、API 服务层设计

### 5.1 流式请求函数

```typescript
// src/services/api.ts

/**
 * 流式调用 Anthropic API
 * 使用 AsyncGenerator 模式
 */
export async function* streamChat(
  messages: readonly Message[],
  config: APIConfig,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent, void> {
  // 1. 构建请求参数
  const params = {
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    system: config.systemPrompt,
    messages: normalizeForAPI(messages),
    stream: true,
  };

  // 2. 发起请求（URL 从 ~/.claude/settings.json 读取，见 resolveApiUrl()）
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(params),
    signal,
  });

  // 3. 解析 SSE 流
  yield* parseSSEStream(response);
}
```

### 5.2 SSE 流解析

```typescript
/**
 * 解析 Server-Sent Events 流
 */
async function* parseSSEStream(response: Response): AsyncGenerator<StreamEvent, void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") return;
        yield JSON.parse(data) as StreamEvent;
      }
    }
  }
}
```

### 5.3 消息规范化

```typescript
/**
 * 将内部消息转换为 API 格式
 */
function normalizeForAPI(messages: readonly Message[]): unknown[] {
  return messages.map((msg) => ({
    role: msg.type === "user" ? "user" : "assistant",
    content: msg.content.map((block) => {
      if (block.type === "text") return { type: "text", text: block.text };
      if (block.type === "tool_use") return { type: "tool_use", id: block.id, name: block.name, input: block.input };
      if (block.type === "tool_result") return { type: "tool_result", tool_use_id: block.tool_use_id, content: block.content };
      return block;
    }),
  }));
}
```

## 六、UI 组件设计

### 6.1 PromptInput

```typescript
interface PromptInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
  readonly isLoading: boolean;
  readonly placeholder?: string;
}
```

- 单行输入，Enter 提交
- 加载时显示禁用状态
- 简洁提示符 `> `

### 6.2 MessageList

```typescript
interface MessageListProps {
  readonly messages: readonly Message[];
  readonly streamingText: string | null;
}
```

- 遍历 messages 渲染 Message 组件
- 若 streamingText 非空，追加流式渲染

### 6.3 Message

```typescript
interface MessageProps {
  readonly message: Message;
}
```

- 用户消息：`[You] text`
- 助手消息：`[Assistant] text`
- 工具调用：`[Tool: name] input...`
- 工具结果：`[Result] content...`

### 6.4 Spinner

```typescript
interface SpinnerProps {
  readonly mode: "thinking" | "responding";
}
```

- thinking: `⠋ Thinking...`
- responding: `⠋ Responding...`

## 七、流式响应 Hook

```typescript
// src/hooks/useStreamResponse.ts

interface UseStreamResponseOptions {
  readonly onToken: (token: string) => void;
  readonly onComplete: (message: AssistantMessage) => void;
  readonly onError: (error: Error) => void;
}

interface UseStreamResponseReturn {
  readonly isLoading: boolean;
  readonly abortController: AbortController | null;
  readonly sendMessage: (content: string) => Promise<void>;
  readonly cancel: () => void;
}

export function useStreamResponse(
  messages: readonly Message[],
  setMessages: (updater: (prev: readonly Message[]) => readonly Message[]) => void,
  config: APIConfig,
  options: UseStreamResponseOptions,
): UseStreamResponseReturn;
```

**职责**：
1. 管理 isLoading / abortController 状态
2. 封装 sendMessage 流程（创建用户消息 → 流式调用 → 创建助手消息）
3. 提供 cancel 方法

## 八、依赖说明

Phase 1 不引入新的 npm 依赖，仅使用已有：
- `ink` + `react`：终端 UI
- `chalk`：终端着色

API 调用使用 Node.js 内置 `fetch`（Node.js >= 18 内置），不依赖 Anthropic SDK。
这是为了深入理解 SSE 流式协议，而非直接使用 SDK 封装。

## 九、测试策略

### 9.1 单元测试目标

| 测试模块 | 覆盖目标 | 重点用例 |
|---------|---------|---------|
| messages.ts | 90%+ | 消息创建、ID生成、内容块类型 |
| services/api.ts | 70%+ | SSE解析、中断处理、错误处理、URL/Key解析 |
| hooks/useStreamResponse | 60%+ | 发送流程、取消流程 |

### 9.2 集成测试

| 测试文件 | 说明 |
|---------|------|
| `tests/integration/api-integration.test.ts` | 真实 API 调用测试 |

- 有 API Key 时执行，无 Key 时自动跳过（`describe.skipIf`）
- 验证流式响应完整性、中断信号处理
- CI 环境中自动跳过，不影响门禁

### 9.3 Mock 策略

```typescript
// Mock fetch 用于 API 测试
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock node:fs 用于配置解析测试
const fsMock = vi.hoisted(() => ({
  readFileSync: vi.fn(),
}));
vi.mock("node:fs", () => fsMock);

// 创建 mock SSE 流
function createMockSSEStream(events: object[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return { body: stream } as Response;
}
```

## 十、实现顺序（TDD）

```
1. messages.ts（消息类型 + 工厂函数）
   ├── RED:   编写消息创建/ID生成测试
   ├── GREEN: 实现 messages.ts
   └── REFACTOR

2. services/api.ts（SSE 解析 + API 调用）
   ├── RED:   编写 SSE 解析/中断测试
   ├── GREEN: 实现 api.ts
   └── REFACTOR

3. hooks/useStreamResponse.ts（流式响应 Hook）
   ├── RED:   编写发送/取消测试
   ├── GREEN: 实现 hook
   └── REFACTOR

4. UI 组件（PromptInput → Message → Spinner → MessageList）
   ├── RED:   编写渲染测试
   ├── GREEN: 实现组件
   └── REFACTOR

5. App.tsx 改造（集成 REPL 循环）
   └── 集成所有模块
```
