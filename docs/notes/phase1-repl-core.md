# Phase 1: REPL 核心交互循环 - 源码研读笔记

> 研读日期：2026-04-03
> 源码版本：free-code/ (claude-code sourcemap)
> 任务编号：P1001 ~ P1004

---

## 一、REPL.tsx 主屏幕架构（P1001）

### 1.1 组件结构

**文件路径**：`free-code/src/screens/REPL.tsx`（~900KB，核心文件）

#### Props 定义

```typescript
export type Props = {
  commands: Command[];                    // 斜杠命令列表
  debug: boolean;                        // 调试模式
  initialTools: Tool[];                  // 初始化工具集
  initialMessages?: MessageType[];       // 初始化消息（会话恢复用）
  pendingHookMessages?: Promise<HookResultMessage[]>;
  thinkingConfig: ThinkingConfig;        // 思考配置
  // ... 其他配置项
}
```

#### 主要子组件

| 组件 | 用途 |
|------|------|
| `PromptInput` | 用户输入组件（支持多行、历史、Tab 补全） |
| `Messages` | 消息列表渲染 |
| `TaskListV2` | 任务列表组件 |
| `Spinner` | 加载动画 |
| `TeammateViewHeader` | 队友视图头部 |

### 1.2 状态管理

REPL 组件使用了约 **70 个状态变量**，核心状态如下：

```typescript
// ===== 消息相关 =====
const [messages, rawSetMessages] = useState<MessageType[]>(initialMessages ?? []);

// ===== 输入相关 =====
const [inputValue, setInputValueRaw] = useState(() => consumeEarlyInput());
const [inputMode, setInputMode] = useState<PromptInputMode>('prompt');

// ===== 加载和流式响应 =====
const [isLoading, setIsLoadingRaw] = useState(false);
const [streamMode, setStreamMode] = useState<SpinnerMode>('responding');
const [streamingText, setStreamingText] = useState<string | null>(null);

// ===== 中断控制 =====
const [abortController, setAbortController] = useState<AbortController | null>(null);
```

**关键设计**：`messages` 同时维护了 `messagesRef`（useRef），确保回调函数中始终能拿到最新消息，避免闭包陷阱。

```typescript
// 包装 setMessages 以同步更新 ref
const setMessages = useCallback((action: React.SetStateAction<MessageType[]>) => {
  const prev = messagesRef.current;
  const next = typeof action === 'function' ? action(messagesRef.current) : action;
  messagesRef.current = next;
  rawSetMessages(next);
}, [rawSetMessages]);
```

### 1.3 核心 Hooks

```typescript
// 输入处理
const { setInputValue } = useTextInput(setInputValueRaw, inputValueRef, abortController);

// 工具权限检查
const canUseTool = useCanUseTool(setToolUseConfirmQueue, setToolPermissionContext);

// REPL 桥接（子 Agent 通信）
const { sendBridgeResult } = useReplBridge(messages, setMessages, abortControllerRef, commands, mainLoopModel);

// 命令队列（斜杠命令）
const queuedCommands = useCommandQueue();

// 搜索输入
const searchInputProps = useSearchInput();
```

### 1.4 消息处理完整流程

```
用户输入
  │
  ▼
onSubmit()              ← 第 3145 行：创建 AbortController + UserMessage
  │
  ▼
onQuery()               ← 第 2858 行：queryGuard 并发保护，追加消息
  │
  ▼
onQueryImpl()           ← 第 2664 行：构建 systemPrompt，执行查询
  │                       ├── getSystemPrompt()
  │                       ├── getUserContext()
  │                       ├── getSystemContext()
  │                       └── buildEffectiveSystemPrompt()
  │
  ▼
query()                 ← 核心查询函数（来自 services/claude.ts）
  │                       返回 AsyncGenerator<StreamEvent>
  │
  ▼
onQueryEvent()          ← 第 2587 行：处理流事件，更新消息列表
  │
  ▼
handleMessageFromStream() ← 根据消息类型分别处理：
                            ├── CompactBoundary → 压缩边界
                            ├── Progress → 临时进度（替换而非追加）
                            └── 常规消息 → 追加到消息列表
```

### 1.5 中断处理（Ctrl+C）

```typescript
// AbortController 管理
const [abortController, setAbortController] = useState<AbortController | null>(null);
const abortControllerRef = useRef<AbortController | null>(null);

// 取消请求
const onCancel = useCallback(() => {
  if (activeRemote.isRemoteMode) {
    activeRemote.cancelRequest();
  } else {
    abortController?.abort('user-cancel');  // 传播 abort signal
  }
  setAbortController(null);
}, [activeRemote]);

// 高优先级命令中断
useEffect(() => {
  if (queuedCommands.some(cmd => cmd.priority === 'now')) {
    abortControllerRef.current?.abort('interrupt');
  }
}, [queuedCommands]);
```

**AbortSignal 传播链**：REPL → query() → anthropic.messages.stream() → 工具 execute()

### 1.6 多轮对话消息维护

```typescript
// 流式响应处理
const onQueryEvent = useCallback((event) => {
  handleMessageFromStream(event, newMessage => {
    if (isCompactBoundaryMessage(newMessage)) {
      // 压缩边界：丢弃压缩前的消息
      setMessages(old => [...getMessagesAfterCompactBoundary(old), newMessage]);
    } else if (newMessage.type === 'progress' && isEphemeralToolProgress(newMessage.data.type)) {
      // 临时进度：替换最后一个同类型进度消息（避免累积）
      setMessages(oldMessages => { /* 替换逻辑 */ });
    } else {
      // 常规消息：追加
      setMessages(oldMessages => [...oldMessages, newMessage]);
    }
  });
}, [setMessages]);
```

### 1.7 架构要点总结

| 设计要点 | 实现方式 |
|---------|---------|
| 响应式状态 | React useState + useRef 同步 |
| 并发保护 | `queryGuard.tryStart()` 防止并发查询 |
| 流式处理 | AsyncGenerator + 事件流 |
| 中断安全 | AbortController 贯穿全链路 |
| 消息不可变 | 展开运算符创建新数组 `[...oldMessages, newMessage]` |
| 关注点分离 | 大量自定义 Hooks 拆分逻辑 |

---

## 二、消息类型系统（P1002）

### 2.1 核心消息类型

**文件路径**：`free-code/src/messages.ts`

```typescript
// 消息联合类型
type Message =
  | UserMessage
  | AssistantMessage
  | SystemMessage
  | AttachmentMessage
  | ProgressMessage
  | TombstoneMessage;
```

### 2.2 UserMessage 结构

```typescript
interface UserMessage {
  type: 'user';
  message: {
    role: 'user';
    content: string | ContentBlockParam[];  // 支持纯文本或内容块数组
  };
  uuid: UUID;
  timestamp: string;
  isMeta?: true;                    // 元消息，不显示给用户
  isVirtual?: true;                 // 虚拟消息，仅用于显示
  isCompactSummary?: true;          // 压缩摘要标记
  toolUseResult?: unknown;          // 工具结果
  mcpMeta?: {                       // MCP 协议元数据
    _meta?: Record<string, unknown>;
    structuredContent?: Record<string, unknown>;
  };
  imagePasteIds?: number[];
  sourceToolAssistantUUID?: UUID;   // 关联的助手消息 ID
  permissionMode?: PermissionMode;
  summarizeMetadata?: {
    messagesSummarized: number;
    userContext?: string;
    direction?: PartialCompactDirection;
  };
}
```

### 2.3 AssistantMessage 结构

```typescript
interface AssistantMessage {
  type: 'assistant';
  message: {
    id: string;                     // API 返回的消息 ID
    container: null;
    model: string;                  // 使用的模型名
    role: 'assistant';
    stop_reason: BetaStopReason;    // 停止原因
    stop_sequence?: string;
    type: 'message';
    usage: Usage;                   // token 使用量
    content: BetaContentBlock[];    // 内容块数组
    context_management: null;
  };
  uuid: UUID;
  timestamp: string;
  requestId?: string;
  apiError?: APIError;
  error?: SDKAssistantMessageError;
  isApiErrorMessage?: boolean;
  isVirtual?: true;
}
```

### 2.4 内容块类型

```typescript
type ContentBlock =
  | TextBlock          // { type: 'text', text: string }
  | ToolUseBlock       // { type: 'tool_use', id: string, name: string, input: {} }
  | ToolResultBlock    // { type: 'tool_result', tool_use_id: string, content: any }
  | ThinkingBlock      // { type: 'thinking', thinking: string }
  | ImageBlock         // { type: 'image', source: { type: 'base64', ... } }
  | RedactedThinkingBlock  // { type: 'redacted_thinking' }
  | ConnectorTextBlock     // 连接器文本
  | ServerToolUseBlock     // 服务器工具调用
  | MCPToolUseBlock        // MCP 工具调用
  | WebSearchToolResult;   // 网络搜索结果
```

### 2.5 工具调用配对关系

```
AssistantMessage (content: [ToolUseBlock])
  ↕ tool_use_id 匹配
UserMessage (content: [ToolResultBlock])
```

**关键函数**：`ensureToolResultPairing()` 确保每个 tool_use 都有对应的 tool_result，缺失时创建合成错误块。

### 2.6 消息序列化流程（normalizeMessagesForAPI）

```
原始消息列表
  │
  ├── 1. reorderAttachmentsForAPI()    ← 附件冒泡到工具结果前
  ├── 2. 过滤虚拟消息
  ├── 3. 过滤 progress / system 类消息
  ├── 4. 合并连续 UserMessage
  ├── 5. 规范化工具输入参数
  ├── 6. 合并相同 message.id 的 AssistantMessage
  ├── 7. filterTrailingThinkingFromLastAssistant()
  ├── 8. filterWhitespaceOnlyAssistantMessages()
  ├── 9. smooshSystemReminderSiblings()
  └── 10. sanitizeErrorToolResultContent()
        │
        ▼
  (UserMessage | AssistantMessage)[]  ← API 可用格式
```

---

## 三、API 交互层（P1003）

### 3.1 流式请求架构

**文件路径**：`free-code/src/services/claude.ts`

```
queryModelWithStreaming()
  │
  ▼
withStreamingVCR()       ← VCR 录制/回放包装
  │
  ▼
queryModel()
  ├── getAnthropicClient()       ← 创建 Anthropic SDK 客户端
  ├── paramsFromContext()        ← 构建 API 参数
  │     ├── normalizeMessagesForAPI()
  │     ├── toolToAPISchema()
  │     └── 配置 thinking / max_tokens / temperature
  │
  ▼
withRetry()              ← 重试机制包装
  │
  ▼
anthropic.beta.messages.stream()  ← SDK 流式调用
  │
  ▼
processStreamEvent()     ← 事件处理
        │
        ├── message_start
        ├── content_block_start
        ├── content_block_delta     ← 逐 token 输出
        ├── content_block_stop
        ├── message_delta
        ├── message_stop
        └── error
```

### 3.2 关键 API 参数

```typescript
const params = {
  model: normalizeModelStringForAPI(options.model),
  messages: normalizeMessagesForAPI(messages, tools),
  system: systemPrompt.text,
  tools: tools.map(toolToAPISchema),
  tool_choice: options.toolChoice,
  thinking: { type: 'auto', budget_tokens: thinkingConfig.budgetTokens },
  max_tokens: maxOutputTokens,
  temperature: 0,
  stream: true,
  metadata: getAPIMetadata(),
};
```

### 3.3 重试机制

| 错误类型 | 处理策略 |
|---------|---------|
| 429/529 容量错误 | 指数退避重试，最大 `MAX_529_RETRIES` 次 |
| ECONNRESET/EPIPE | 清理凭证缓存后重试 |
| APIUserAbortError | 立即抛出（用户中断） |
| 其他错误 | 直接抛出 |

```typescript
// 退避参数
const delay = Math.min(
  BASE_DELAY_MS * Math.pow(2, attempt - 1),
  PERSISTENT_MAX_BACKOFF_MS
);
```

### 3.4 API 客户端配置

**源码做法**：使用 Anthropic SDK，通过环境变量配置。

```typescript
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxRetries: DEFAULT_MAX_RETRIES,
  timeout: {
    response: 300_000,  // 5 分钟
    error: 600_000,     // 10 分钟
  },
});
```

**cc-study 实现**：不使用 SDK，直接 fetch + SSE 解析。配置优先从 `~/.claude/settings.json` 读取。

```typescript
// URL 解析优先级：settings.json > 默认值
export function resolveApiUrl(): string {
  const env = readSettingsEnv();
  if (env.ANTHROPIC_BASE_URL) {
    return `${env.ANTHROPIC_BASE_URL.replace(/\/+$/, "")}/v1/messages`;
  }
  return "https://api.anthropic.com/v1/messages";
}

// API Key 解析优先级：settings.json ANTHROPIC_AUTH_TOKEN > 环境变量 ANTHROPIC_API_KEY
export function resolveApiKey(): string {
  const env = readSettingsEnv();
  return env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? "";
}
```

> **设计差异**：源码用 SDK 封装了重试和超时，cc-study 直接用 fetch 以深入理解 SSE 流式协议。配置来源增加了 settings.json 支持，与 Claude Code 实际运行时行为一致。

---

## 四、上下文管理（P1004）

### 4.1 上下文结构

**文件路径**：`free-code/src/context.ts`（190 行，简洁但关键）

三个核心函数，全部使用 `memoize` 缓存：

```typescript
// 1. Git 状态（对话期间不变）
export const getGitStatus = memoize(async (): Promise<string | null> => { ... });

// 2. 系统上下文（对话期间不变）
export const getSystemContext = memoize(async (): Promise<{ [k: string]: string }> => { ... });

// 3. 用户上下文（对话期间不变）
export const getUserContext = memoize(async (): Promise<{ [k: string]: string }> => { ... });
```

### 4.2 getGitStatus()

```typescript
// 并行获取 5 个 Git 信息
const [branch, mainBranch, status, log, userName] = await Promise.all([
  getBranch(),
  getDefaultBranch(),
  execFileNoThrow(gitExe(), ['--no-optional-locks', 'status', '--short']),
  execFileNoThrow(gitExe(), ['--no-optional-locks', 'log', '--oneline', '-n', '5']),
  execFileNoThrow(gitExe(), ['config', 'user.name']),
]);

// 状态截断（超过 2000 字符时截断）
const truncatedStatus = status.length > MAX_STATUS_CHARS
  ? status.substring(0, MAX_STATUS_CHARS) + '\n... (truncated)'
  : status;
```

**输出格式**：
```
This is the git status at the start of the conversation...
Current branch: feature/xxx
Main branch: main
Git user: username
Status:
M  src/file.ts
Recent commits:
abc1234 commit message
```

### 4.3 getSystemContext()

```typescript
return {
  ...(gitStatus && { gitStatus }),         // Git 状态
  ...(injection && { cacheBreaker }),      // 缓存破坏（调试用）
};
```

### 4.4 getUserContext()

```typescript
// 加载 CLAUDE.md 文件内容
const claudeMd = shouldDisableClaudeMd
  ? null
  : getClaudeMds(filterInjectedMemoryFiles(await getMemoryFiles()));

return {
  ...(claudeMd && { claudeMd }),           // CLAUDE.md 内容
  currentDate: `Today's date is ${getLocalISODate()}.`,  // 当前日期
};
```

### 4.5 上下文注入位置

在 `onQueryImpl()` 中，上下文通过以下方式注入到 API 请求：

```typescript
const [defaultSystemPrompt, baseUserContext, systemContext] = await Promise.all([
  getSystemPrompt(...),   // 系统提示词（来自 prompts.ts）
  getUserContext(),       // 用户上下文（CLAUDE.md + 日期）
  getSystemContext(),     // 系统上下文（Git 状态）
]);

const systemPrompt = buildEffectiveSystemPrompt({
  defaultSystemPrompt,
  userContext: baseUserContext,
  systemContext,
});
```

---

## 五、关键设计模式总结

### 5.1 生成器模式（AsyncGenerator）

API 交互层使用 `async function*` 实现流式处理：

```typescript
async function* queryModel(): AsyncGenerator<StreamEvent> {
  const stream = await anthropic.beta.messages.stream(params);
  for await (const event of stream) {
    yield processStreamEvent(event);
  }
}
```

**优点**：
- 消费者可以按需处理事件（backpressure）
- 中断时通过 AbortSignal 自然终止
- 易于组合（`yield*` 委托）

### 5.2 不可变消息列表

消息列表更新始终创建新数组：

```typescript
setMessages(old => [...old, newMessage]);           // 追加
setMessages(old => [...getAfterBoundary(old), msg]); // 压缩后追加
```

### 5.3 ref 同步模式

解决 React 闭包陷阱的经典模式：

```typescript
const [value, rawSetValue] = useState(initial);
const valueRef = useRef(value);
valueRef.current = value;

const setValue = useCallback((action) => {
  const next = typeof action === 'function' ? action(valueRef.current) : action;
  valueRef.current = next;
  rawSetValue(next);
}, []);
```

### 5.4 Memoize 缓存

上下文信息使用 `lodash-es/memoize` 缓存，确保对话期间不重复计算：

```typescript
export const getGitStatus = memoize(async () => { ... });
export const getUserContext = memoize(async () => { ... });
export const getSystemContext = memoize(async () => { ... });
```

---

## 六、对 cc-study 实现的启示

### 6.1 状态管理策略

REPL.tsx 使用 ~70 个 useState，这在生产环境中是可以接受的（Ink 终端 UI 更新频率低），但我们在实现时应考虑：
- 使用 `useReducer` 合并相关状态
- 自定义 Hooks 分离关注点（已经在做了）
- 保持 `ref 同步模式` 确保回调中访问最新值

### 6.2 流式处理

核心是 AsyncGenerator 模式：
1. API 层 yield 流事件
2. REPL 层 onQueryEvent 消费事件
3. 通过 setMessages 更新 UI

### 6.3 消息规范化

消息发送给 API 前需要经过多步处理（10 步管道），这是防止 API 错误的关键防线。我们在实现时至少需要：
1. 合并连续用户消息
2. 过滤不发送的消息类型
3. 确保 tool_use / tool_result 配对

### 6.4 上下文管理

上下文信息（Git 状态、CLAUDE.md、日期）在对话期间不变，使用 memoize 缓存是合理的优化。
