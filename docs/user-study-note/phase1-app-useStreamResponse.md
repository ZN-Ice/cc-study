# App 组件与 useStreamResponse 机制研读笔记

> 基于 Phase 1 REPL 交互循环，分析 App.tsx、useStreamResponse Hook、消息系统、API 流式通信的协作机制。

---

## 1. App 组件角色与 Props 传入

`App` 是整个终端 UI 的**顶层编排组件**，基于 Ink（React for CLI）。

### Props 来源链路

```
命令行参数 → parseCliArgs() → options → React.createElement() → App props
```

| Prop | 来源 | 默认值 |
|------|------|--------|
| `model` | `-m` / `--model` 参数 | `DEFAULT_MODEL` |
| `debug` | `--debug` 参数 | `false` |
| `apiKey` | 未从 CLI 传入（永远 `undefined`） | 由 `resolveApiKey()` 自动解析 |

`resolveApiKey()` 优先级：`~/.claude/settings.json` 中 `env.ANTHROPIC_AUTH_TOKEN` > 环境变量 `ANTHROPIC_API_KEY`。

### 核心状态

```typescript
const [inputValue, setInputValue] = useState("");                     // 输入框当前值
const [messages, setMessages] = useState<readonly Message[]>([]);     // 对话历史
```

- `messages` 是整个对话的状态核心，包含所有 user/assistant 消息
- 使用 `readonly` 防止就地修改，保证状态不可变

---

## 2. useStreamResponse 机制详解

### 整体架构：三个角色分工

```
App.tsx (房东)
  │
  ├── 持有 messages 状态（房产）
  ├── 把 setMessages 交给 useStreamResponse（钥匙）
  │
  └── useStreamResponse (管家)
        ├── 管理 isLoading / streamingText / error（水电表）
        ├── 通过 sendMessage() 接收指令
        └── 调用 api.ts streamChat() 干活（跑腿）
```

**关键设计**：`setMessages` 不在 Hook 内部创建，而是从外部传入。这样 App 持有唯一的状态源，Hook 只是修改者。

### Hook 签名

```typescript
export function useStreamResponse(
  messages: readonly Message[],                                                          // 只读消息列表
  setMessages: (updater: (prev: readonly Message[]) => readonly Message[]) => void,     // 修改函数
  config: APIConfig,                                                                    // API 配置
): UseStreamResponseReturn
```

返回值：

```typescript
interface UseStreamResponseReturn {
  readonly isLoading: boolean;                // 是否正在请求
  readonly streamingText: string | null;      // 流式输出缓冲
  readonly sendMessage: (content: string) => Promise<void>;  // 发送消息
  readonly cancel: () => void;                // 取消请求
  readonly error: string | null;              // 错误信息
}
```

### Hook 内部私有状态

```typescript
const [isLoading, setIsLoading] = useState(false);                // 是否正在请求
const [streamingText, setStreamingText] = useState<string | null>(null);  // 流式输出缓冲
const [error, setError] = useState<string | null>(null);          // 错误信息
```

这三个是 Hook **私有**的状态，不暴露 setter，只暴露 getter。外部只能通过 `sendMessage` / `cancel` 间接改变它们。

### Ref 的作用

```typescript
const abortControllerRef = useRef<AbortController | null>(null);  // 取消请求用
const messagesRef = useRef(messages);                              // 最新消息的引用
messagesRef.current = messages;                                    // 每次渲染同步
```

为什么需要 `messagesRef`？因为 `sendMessage` 是 `useCallback` 缓存的函数，闭包捕获的 `messages` 是**创建时的快照**，不会自动更新。通过 `messagesRef.current` 始终拿到最新值。

---

## 3. sendMessage 完整流程

### 阶段 1：追加用户消息

```typescript
const userMsg = createUserMessage("hello");
setMessages((prev) => [...prev, userMsg]);
```

`messages` 立刻变成 `[...旧消息, userMsg]`，`MessageList` 重新渲染显示用户消息。

### 阶段 2：准备请求

```typescript
const controller = new AbortController();   // 创建取消控制器
abortControllerRef.current = controller;    // 保存引用，供 cancel() 使用
setIsLoading(true);                         // UI 显示 Spinner
setStreamingText(null);                     // 清空上次残留
setError(null);
```

### 阶段 3：流式接收

```typescript
const allMessages = [...messagesRef.current, userMsg]; // 拼上最新消息

for await (const event of streamChat(allMessages, config, controller.signal)) {
  if (event.type === "content_block_delta") {
    fullText += delta.delta.text;   // 累积文本
    setStreamingText(fullText);     // 每收到一个 chunk 就更新 UI
  }
}
```

`streamChat` 是一个 async generator，底层流程：

```
streamChat()                         Anthropic API
    │                                     │
    ├── fetch POST ──────────────────────→ │
    │                                     │
    │ ←─── SSE data: {"type":"message_start"} ────
    │ ←─── SSE data: {"type":"content_block_delta","delta":{"text":"你"}} ────
    │      → yield event → fullText = "你" → setStreamingText("你")
    │ ←─── SSE data: {"type":"content_block_delta","delta":{"text":"好"}} ────
    │      → yield event → fullText = "你好" → setStreamingText("你好")
    │ ←─── SSE data: [DONE] ────
    │
    └── for await 循环结束
```

每次 `setStreamingText` 触发 React 重渲染，用户看到文字逐字出现。

### 阶段 4：完成

```typescript
const assistantMsg = createAssistantMessage({
  content: [{ type: "text", text: fullText }],
  model: config.model,
  stopReason: "end_turn",
});
setMessages((prev) => [...prev, assistantMsg]);
```

流式输出结束，把完整的 assistant 消息追加到 `messages`。此时 `streamingText` 被清空，显示从"流式缓冲区"切换到"正式消息列表"。

### 异常处理

- **用户取消**（Ctrl+C）：`controller.abort()` → fetch 抛出 `AbortError` → 已有部分文本则保存为 `"[Cancelled]"` 消息，否则静默忽略。
- **API 错误**（429/500 等）：抛出 Error → `setError(message)` → UI 显示红色错误。

---

## 4. cancel 取消机制

```typescript
const cancel = useCallback(() => {
  abortControllerRef.current?.abort("user-cancel");
  setIsLoading(false);
  setStreamingText(null);
}, []);
```

调用链：`cancel()` → `AbortController.abort()` → 底层 fetch 的 signal 触发 → `streamChat` 抛出 `AbortError` → 被 `sendMessage` 的 catch 捕获。

---

## 5. 消息类型系统

### 消息模型

```typescript
type Message = UserMessage | AssistantMessage;

interface UserMessage {
  readonly type: "user";
  readonly id: MessageId;              // UUID
  readonly content: readonly ContentBlock[];
  readonly timestamp: number;          // Date.now()
}

interface AssistantMessage {
  readonly type: "assistant";
  readonly id: MessageId;
  readonly content: readonly ContentBlock[];
  readonly timestamp: number;
  readonly model: string;              // 使用的模型名
  readonly stopReason: string | null;  // "end_turn" | null（取消时）
}
```

### 内容块类型

```typescript
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;
```

当前 Phase 1 只使用了 `TextBlock`，后续 Phase 2 会用到 `ToolUseBlock` 和 `ToolResultBlock`。

### 工厂函数

所有消息通过 `createUserMessage()` / `createAssistantMessage()` 创建，内部使用 `Object.freeze()` 冻结对象，保证不可变。

### API 格式转换

发送给 API 时，通过 `normalizeForAPI()` 转换：

```typescript
// 内部格式 → API 格式
{ type: "user", id: "xxx", content: [...], timestamp: 123 }
→ { role: "user", content: [...] }
```

去掉 `id`、`timestamp`、`model` 等内部字段，只保留 API 需要的 `role` 和 `content`。

---

## 6. API 流式通信（SSE）

### streamChat 函数

```typescript
async function* streamChat(
  messages: readonly Message[],
  config: APIConfig,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent, void>
```

是一个 **async generator**，调用方用 `for await...of` 逐个消费事件。使用原生 `fetch` + 手动 SSE 解析，而非 Anthropic SDK，目的是**手动理解流式协议**。

### streamChat 执行流程

```
streamChat()
  │
  ├─ 1. 构造请求体（L166-173）
  │     把内部消息格式转为 API 格式
  │
  ├─ 2. 发起 fetch 请求（L175-184）
  │     POST 到 Anthropic Messages API
  │     传入 AbortSignal 支持取消
  │
  ├─ 3. 检查响应状态（L186-191）
  │     非 200 直接 throw Error
  │
  └─ 4. 委托给 parseSSEStream 解析（L193）
        yield* 逐个产出 SSE 事件
```

#### 请求体构造

```typescript
const body = {
  model: config.model,           // "claude-sonnet-4-6"
  max_tokens: config.maxTokens,  // 最大输出 token
  temperature: config.temperature,
  system: config.systemPrompt,   // 系统提示词
  messages: normalizeForAPI(messages),  // 转换为 {role, content} 格式
  stream: true,                  // 关键：启用流式
};
```

`normalizeForAPI` 做的事很简单 — 去掉 `id`、`timestamp`、`model` 等内部字段，只保留 API 需要的 `role` 和 `content`。

#### Fetch 请求

```typescript
const response = await fetch(ANTHROPIC_API_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": config.apiKey,           // API Key 放在 header
    "anthropic-version": "2023-06-01",     // API 版本号
  },
  body: JSON.stringify(body),
  signal,                                  // 绑定取消信号
});
```

没使用 Anthropic SDK，直接原生 `fetch`。

#### 错误处理

```typescript
if (!response.ok) {
  const errorText = await response.text().catch(() => "Unknown error");
  throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
}
```

只在 HTTP 层面检查，不处理业务错误（如内容过滤），这些会在 SSE 事件中体现。

#### `yield*` 委托

```typescript
yield* parseSSEStream(response);
```

`yield*` 是 generator 委托语法 — 把 `parseSSEStream` 产出的每个事件**透传**给调用方，`streamChat` 自身不做任何过滤或转换。

### SSE 解析流程

```
HTTP Response Body（SSE 格式，逐块到达）
    │
    │  data: {"type":"message_start","message":{"id":"msg_xxx"}}
    │  data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}
    │  data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你"}}
    │  data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"好"}}
    │  data: {"type":"content_block_stop","index":0}
    │  data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}
    │  data: {"type":"message_stop"}
    │  data: [DONE]
    │
    ▼
parseSSEStream() 逐行解析
    │
    ├── 跳过非 "data: " 开头的行（空行、注释等）
    ├── 遇到 "[DONE]" 结束
    └── yield JSON.parse(data) as StreamEvent
```

#### parseSSEStream 核心逻辑

```typescript
const reader = response.body!.getReader();  // 拿到 ReadableStream
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { done, value } = await reader.read();  // 读一块数据
  if (done) break;

  buffer += decoder.decode(value, { stream: true });  // 解码为文本追加到缓冲
  const lines = buffer.split("\n");                    // 按换行切割
  buffer = lines.pop() ?? "";                          // 最后一段可能不完整，留到下次

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;          // 跳过非数据行
    const data = line.slice(6);                        // 去掉 "data: " 前缀
    if (data === "[DONE]") return;                     // 结束标记
    yield JSON.parse(data);                            // 解析并产出事件
  }
}
```

关键细节：

- **buffer 机制**：TCP 分包可能导致一条 SSE 消息被切成两块到达，`buffer` 保留未完成的尾部，下次拼接后继续解析
- **`{ stream: true }`**：告诉 `TextDecoder` 后续还有数据，不要在多字节字符中间截断
- **`lines.pop()`**：最后一行可能不完整（如只收到 `"data": {"ty`），留在缓冲区等下一块数据

### SSE 事件类型

```typescript
type StreamEvent =
  | MessageStartEvent         // 消息开始，包含 message id
  | ContentBlockStartEvent    // 内容块开始
  | ContentBlockDeltaEvent    // 内容增量（逐 token）
  | ContentBlockStopEvent     // 内容块结束
  | MessageDeltaEvent         // 消息级增量（stop_reason）
  | MessageStopEvent;         // 消息结束
```

当前 Phase 1 只关心 `content_block_delta` 中的 `text_delta`。后续 Phase 2 加入工具系统后，还需要处理 `tool_use` 类型的 delta。

---

## 7. 数据流全景图

```
         App.tsx
           │
    ┌──────┴──────┐
    │  messages   │ ←── 唯一真相源
    │  setMessages│ ──→ 交给 Hook 使用
    └──────┬──────┘
           │
    useStreamResponse
    ┌──────┴──────────────────────────────────┐
    │                                          │
    │  sendMessage("hello")                    │
    │    │                                     │
    │    ├→ setMessages(+userMsg)  ──────────→ messages 更新
    │    │                                     │
    │    ├→ setIsLoading(true)     ──────────→ 显示 Spinner
    │    │                                     │
    │    ├→ streamChat() ──fetch──→ API        │
    │    │     │                               │
    │    │     ├ delta "你" → setStreamingText("你")
    │    │     ├ delta "好" → setStreamingText("你好")
    │    │     └ done                             │
    │    │                                     │
    │    ├→ setMessages(+assistantMsg) ─────→ messages 更新
    │    │                                     │
    │    └→ setIsLoading(false)    ──────────→ 隐藏 Spinner
    │       setStreamingText(null) ──────────→ 清空缓冲
    │                                          │
    └──────────────────────────────────────────┘
```

---

## 8. 设计要点总结

1. **状态所有权分离**：`messages` 和 `setMessages` 分居两地。App 持有状态所有权，useStreamResponse 只持有修改权。这使未来可以在 App 层面加入 `/compact`、`/clear` 等操作。

2. **Ref 绕过闭包陷阱**：`messagesRef` 确保 `sendMessage` 回调始终能拿到最新的 `messages`，不受 `useCallback` 闭包限制。

3. **AbortController 贯穿全链路**：从 UI 层的 `cancel()` 到 fetch 层的 `signal`，通过同一个 `AbortController` 实现取消。

4. **双缓冲渲染策略**：流式阶段用 `streamingText` 实时显示，完成后转入 `messages` 正式列表，避免频繁操作大数组。

5. **不可变消息模型**：`Object.freeze()` + `readonly` 类型约束 + 展开运算符更新，保证消息历史不被意外修改。

---

## 9. Spinner 组件

纯展示组件，提供**视觉反馈**，告诉用户"程序在干活，没有卡死"。

### 两种状态

在 `App.tsx` 中的使用：

```typescript
{isLoading && !streamingText && <Spinner mode="thinking" />}
{isLoading && streamingText && <Spinner mode="responding" />}
```

| 条件 | 模式 | 含义 |
|------|------|------|
| `isLoading` 但还没收到第一个 token | `thinking` | 请求已发出，等待 API 响应 |
| `isLoading` 且已有流式文本 | `responding` | 正在接收 token |

### 动画原理

```typescript
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

useEffect(() => {
  const timer = setInterval(() => {
    setFrameIndex((prev) => (prev + 1) % FRAMES.length);  // 0→1→2...→9→0 循环
  }, 80);  // 每 80ms 切换一帧

  return () => clearInterval(timer);  // 组件卸载时清理定时器
}, []);
```

`80ms × 10帧 = 800ms` 一个完整周期，利用 braille 字符的旋转动画模拟终端经典的 spinner 效果。

### 渲染效果

```
⠸ Thinking...       ← 等 API 响应时
⠦ Responding...     ← 开始收到 token 时
```

### 组件卸载时机

`isLoading` 变为 `false` → `Spinner` 不再渲染 → `useEffect` 的 cleanup 执行 → `clearInterval` 清除定时器，不浪费资源。
