# Claude Code 学习与复刻 - 研发手册

> **核心定位**：本文档是 cc-study 项目的唯一开发准则。通过研读 Claude Code 源码，逐步从 0 到 1 复刻其核心特性，在每个阶段深入理解设计决策与实现原理。
>
> **适用对象**：核心引擎Agent、工具系统Agent、终端UI Agent、权限系统Agent、测试质检Agent、Claude Code 协同开发

---

## 一、项目概述

| 项目属性 | 规范值 |
|---------|--------|
| 项目名称 | `cc-study` |
| 参考源码 | `free-code/`（本地目录，基于 claude-code sourcemap 提取，已加入 `.gitignore`） |
| 开发语言 | TypeScript |
| 运行时 | Node.js (>=20) |
| 构建工具 | tsup / esbuild |
| 终端UI框架 | Ink (React for CLI) |
| 测试框架 | Vitest |
| 包管理 | pnpm |
| Linter | ESLint + Prettier |
| License | Apache 2.0 |

### 1.1 学习目标

通过分阶段复刻 Claude Code 的核心特性，最终产出：

- 一个可工作的 CLI Agent 框架
- 完整的工具系统（文件读写、搜索、Shell执行等）
- 终端交互式 REPL
- 权限与安全管控
- MCP (Model Context Protocol) 集成能力

### 1.2 Claude Code 源码架构概览

```
free-code/                     # 参考源码（.gitignore，不提交）
├── package.json               # 项目配置
├── scripts/                   # 构建/安装脚本
├── assets/                    # 静态资源
├── src/                       # 源码根目录
│   ├── entrypoints/
│   │   ├── cli.tsx            # CLI 启动入口
│   │   └── mcp.ts             # MCP Server 入口
│   ├── screens/
│   │   └── REPL.tsx           # 核心 REPL 交互屏幕
│   ├── tools/                 # 工具系统（核心模块）
│   │   ├── AgentTool/         # 子Agent工具
│   │   ├── ArchitectTool/     # 架构设计工具
│   │   ├── BashTool/          # Shell命令执行
│   │   ├── FileEditTool/      # 文件编辑（精确替换）
│   │   ├── FileReadTool/      # 文件读取
│   │   ├── FileWriteTool/     # 文件写入
│   │   ├── GlobTool/          # 文件模式匹配
│   │   ├── GrepTool/          # 内容搜索（基于ripgrep）
│   │   ├── MCPTool/           # MCP协议工具
│   │   ├── MemoryReadTool/    # 记忆读取
│   │   ├── MemoryWriteTool/   # 记忆写入
│   │   ├── NotebookEditTool/  # Jupyter编辑
│   │   ├── NotebookReadTool/  # Jupyter读取
│   │   ├── ThinkTool/         # 思考工具
│   │   └── lsTool/            # 目录列表
│   ├── services/
│   │   ├── claude.ts          # Anthropic API 交互
│   │   ├── mcpClient.ts       # MCP 客户端
│   │   ├── oauth.ts           # OAuth 认证
│   │   ├── notifier.ts        # 系统通知
│   │   └── statsig.ts         # 功能开关
│   ├── components/            # Ink UI 组件
│   │   ├── Message.tsx        # 消息渲染
│   │   ├── PromptInput.tsx    # 用户输入
│   │   ├── permissions/       # 权限对话框
│   │   └── ...
│   ├── commands/              # 斜杠命令
│   ├── hooks/                 # React Hooks
│   ├── utils/                 # 工具函数
│   ├── constants/
│   │   └── prompts.ts         # 系统提示词
│   └── permissions.ts         # 权限系统
└── vendor/
    ├── ripgrep/               # 内置 ripgrep 二进制
    └── sdk/                   # Anthropic SDK
```

---

## 二、分阶段学习路线

### Phase 0: 项目骨架

**目标**：搭建可运行的项目骨架，理解 Claude Code 的启动流程。

```
产出物：
├── package.json               # 项目配置
├── tsconfig.json              # TypeScript 配置
├── src/
│   ├── index.ts               # 入口
│   └── cli.ts                 # CLI 参数解析
├── tests/
│   └── cli.test.ts
└── pnpm-lock.yaml
```

**学习要点**：
- CLI 入口如何初始化（`free-code/src/entrypoints/cli.tsx`）
- Ink 框架如何将 React 组件渲染到终端
- 配置文件加载链（`.claude/` 目录 → `settings.json` → `CLAUDE.md`）

**完成标准**：
- [ ] `pnpm dev` 可启动交互式 REPL 骨架
- [ ] 支持 `--help`、`--version` 参数
- [ ] 基础日志输出

### Phase 1: REPL 交互循环

**目标**：实现核心的 REPL (Read-Eval-Print Loop) 循环。

```
产出物：
├── src/
│   ├── screens/
│   │   └── REPL.tsx           # 主交互屏幕
│   ├── components/
│   │   ├── PromptInput.tsx    # 输入组件
│   │   ├── Message.tsx        # 消息渲染
│   │   └── Spinner.tsx        # 加载指示器
│   └── hooks/
│       └── useTextInput.ts    # 输入 Hook
```

**学习要点**：
- `src/screens/REPL.tsx` 的状态管理（消息列表、加载状态、用户输入）
- 流式响应如何通过 Ink 组件渲染
- 消息类型系统（UserMessage、AssistantMessage、ToolUseMessage、ToolResultMessage）
- 上下文窗口管理与消息压缩（`src/commands/compact.ts`）

**完成标准**：
- [ ] 用户输入 → API 调用 → 流式渲染响应
- [ ] 支持多轮对话
- [ ] 支持 Ctrl+C 中断请求

### Phase 2: 工具系统

**目标**：实现核心工具注册、调用、结果处理机制。

```
产出物：
├── src/
│   ├── tools/
│   │   ├── types.ts           # 工具类型定义
│   │   ├── registry.ts        # 工具注册表
│   │   ├── FileReadTool/      # 文件读取
│   │   ├── FileWriteTool/     # 文件写入
│   │   ├── FileEditTool/      # 文件编辑
│   │   ├── BashTool/          # Shell 执行
│   │   ├── GlobTool/          # 文件搜索
│   │   └── GrepTool/          # 内容搜索
```

**学习要点**：
- 工具定义接口：`name`、`description`、`parameters`（JSON Schema）、`execute`
- `src/tools/` 各工具的实现模式
- FileEditTool 的精确字符串替换算法（`src/utils/diff.ts`）
- GrepTool 如何集成 ripgrep（`vendor/ripgrep/`）
- BashTool 的持久化 Shell（`src/utils/PersistentShell.ts`）
- 工具结果的格式化与截断策略

**完成标准**：
- [ ] 至少实现 5 个核心工具（Read、Write、Edit、Bash、Glob）
- [ ] 工具调用结果正确回传给 LLM
- [ ] 支持工具调用链（LLM 返回多个工具调用）

### Phase 3: 权限系统

**目标**：实现细粒度的工具权限控制。

```
产出物：
├── src/
│   ├── permissions/
│   │   ├── types.ts           # 权限类型定义
│   │   ├── manager.ts         # 权限管理器
│   │   ├── rules.ts           # 权限规则引擎
│   │   └── prompts.ts         # 权限提示模板
│   └── components/
│       └── permissions/       # 权限确认 UI
```

**学习要点**：
- `src/permissions.ts` 的权限模型（allow / deny / ask）
- `src/hooks/useCanUseTool.ts` 的权限检查 Hook
- 权限规则匹配（glob 模式、正则、工具名）
- `settings.json` 中的权限配置格式
- `CLAUDE.md` 对权限决策的影响

**完成标准**：
- [ ] 工具执行前进行权限检查
- [ ] 支持交互式权限确认（Y/N/Always）
- [ ] 支持权限规则持久化

### Phase 4: Agent 子系统

**目标**：实现子 Agent 机制，支持并行任务分发。

```
产出物：
├── src/
│   ├── tools/
│   │   └── AgentTool/
│   │       ├── index.ts       # Agent 工具入口
│   │       ├── types.ts       # Agent 类型定义
│   │       └── orchestrator.ts # Agent 编排器
```

**学习要点**：
- `src/tools/AgentTool/` 的实现（Agent 作为工具调用）
- Agent 类型定义（general-purpose、Explore、Plan 等）
- 子 Agent 的上下文隔离与结果回传
- 并行 Agent 执行模式
- `src/hooks/useCancelRequest.ts` 的取消机制

**完成标准**：
- [ ] 支持 Agent 类型注册与分发
- [ ] 支持 Agent 结果回传主循环
- [ ] 支持 Agent 并行执行

### Phase 5: MCP 集成

**目标**：实现 MCP (Model Context Protocol) 客户端，支持外部工具扩展。

```
产出物：
├── src/
│   ├── services/
│   │   ├── mcpClient.ts       # MCP 客户端
│   │   └── mcpServerApproval.tsx
│   └── tools/
│       └── MCPTool/           # MCP 工具适配器
```

**学习要点**：
- MCP 协议的 JSON-RPC 通信机制
- `src/services/mcpClient.ts` 的连接管理
- MCP Server 的配置与发现（`settings.json` 中的 `mcpServers`）
- MCP 工具到内部工具的适配
- Server 生命周期管理（启动、重连、关闭）

**完成标准**：
- [ ] 可连接到 MCP Server
- [ ] MCP 工具可在 REPL 中调用
- [ ] 支持多个 MCP Server 同时连接

### Phase 6: 高级特性

**目标**：实现记忆系统、斜杠命令、Hook 机制等高级特性。

```
产出物：
├── src/
│   ├── commands/              # 斜杠命令
│   │   ├── help.ts            # /help
│   │   ├── compact.ts         # /compact
│   │   ├── config.tsx         # /config
│   │   └── ...
│   ├── hooks/                 # Hook 系统
│   │   ├── types.ts           # Hook 类型定义
│   │   └── runner.ts          # Hook 执行器
│   ├── services/
│   │   └── vcr.ts             # 会话记录与回放
│   └── utils/
│       ├── state.ts           # 全局状态管理
│       └── thinking.ts        # 扩展思考
```

**学习要点**：
- `src/commands/` 的命令注册与分发机制
- Hook 系统（PreToolUse、PostToolUse、Stop）
- 记忆系统（`MemoryReadTool` / `MemoryWriteTool`）
- 上下文压缩策略（`/compact` 命令）
- 会话恢复（`src/commands/resume.tsx`）

---

## 三、工程规范

### 3.1 包名结构

```
cc-study/
├── free-code/                 # 参考源码（.gitignore，不提交）
│   └── src/                   # Claude Code 源码
├── src/                       # 本项目源码（我们自己实现）
│   ├── index.ts               # 主入口
│   ├── cli.ts                 # CLI 启动
│   ├── screens/               # 终端屏幕
│   │   └── REPL.tsx
│   ├── tools/                 # 工具系统
│   │   ├── types.ts           # 工具接口定义
│   │   ├── registry.ts        # 工具注册表
│   │   ├── FileReadTool/
│   │   ├── FileWriteTool/
│   │   ├── FileEditTool/
│   │   ├── BashTool/
│   │   ├── GlobTool/
│   │   ├── GrepTool/
│   │   ├── AgentTool/
│   │   └── MCPTool/
│   ├── services/              # 核心服务
│   │   ├── api.ts             # Anthropic API 封装
│   │   ├── mcpClient.ts       # MCP 客户端
│   │   └── stream.ts          # 流式处理
│   ├── components/            # Ink UI 组件
│   │   ├── Message.tsx
│   │   ├── PromptInput.tsx
│   │   ├── Spinner.tsx
│   │   └── permissions/
│   ├── commands/              # 斜杠命令
│   ├── hooks/                 # React Hooks
│   ├── permissions/           # 权限系统
│   ├── utils/                 # 工具函数
│   │   ├── file.ts
│   │   ├── diff.ts
│   │   ├── shell.ts
│   │   ├── format.ts
│   │   └── tokens.ts
│   └── constants/             # 常量定义
│       └── prompts.ts         # 系统提示词
├── tests/                     # 测试目录
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/                      # 学习笔记与设计文档
│   ├── notes/                 # 源码学习笔记
│   ├── design/                # 设计决策记录
│   └── task/
│       └── task_records.json  # 任务记录
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── CLAUDE.md                  # 本文档
└── README.md
```

### 3.2 代码分层

```
┌──────────────────────────────────────────────────────────────┐
│                      CLI Layer                               │
│  cli.ts / index.ts                                           │
│  - 参数解析、环境初始化、启动 REPL                             │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                     Screen Layer                             │
│  screens/REPL.tsx                                            │
│  - 交互循环、消息状态管理、组件编排                             │
│  - 对应源码: src/screens/REPL.tsx                             │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                    Service Layer                             │
│  services/claude.ts, mcpClient.ts, stream.ts                │
│  - API 通信、流式处理、MCP 连接                               │
│  - 对应源码: src/services/                                    │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                     Tool Layer                               │
│  tools/*                                                     │
│  - 工具定义、执行、结果处理                                   │
│  - 对应源码: src/tools/                                       │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                    Utility Layer                             │
│  utils/*, constants/*, permissions/*                         │
│  - 基础设施：文件操作、Diff、Shell、权限、提示词               │
│  - 对应源码: src/utils/, src/constants/, src/permissions.ts   │
└──────────────────────────────────────────────────────────────┘
```

### 3.3 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 文件名 | 小驼峰或 PascalCase（工具目录） | `fileReadTool.ts` / `FileReadTool/` |
| 类名 | PascalCase | `FileReadTool` |
| 接口名 | PascalCase + I 前缀（可选） | `Tool` / `ITool` |
| 函数名 | 小驼峰 | `executeTool()` |
| 变量名 | 小驼峰 | `messageList` |
| 常量 | 全大写下划线 | `MAX_TOKEN_LIMIT` |
| 类型名 | PascalCase | `ToolResult` |
| 枚举 | PascalCase | `PermissionMode` |
| 测试文件 | 被测文件名 + .test.ts | `fileReadTool.test.ts` |
| React 组件 | PascalCase.tsx | `Message.tsx` |

### 3.4 TypeScript 规范

```typescript
// 优先使用 interface 定义对象类型
interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute(params: Record<string, unknown>): Promise<ToolResult>;
}

// 使用 type 定义联合类型和工具类型
type PermissionMode = "allow" | "deny" | "ask";
type MessageRole = "user" | "assistant" | "system";

// 泛型约束使用 extends
function createTool<TParams extends Record<string, unknown>>(
  definition: ToolDefinition<TParams>
): Tool { /* ... */ }

// 优先不可变：使用 readonly、as const
const TOOLS = ["read", "write", "edit"] as const;
type ToolName = typeof TOOLS[number];

// 错误处理使用 Result 模式
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

### 3.5 Git 提交规范

```
格式：<type>(<scope>): <description>

类型：
- feat: 新功能（对应 Phase 进度）
- fix: Bug 修复
- refactor: 重构
- docs: 文档更新（含学习笔记）
- test: 测试相关
- chore: 构建/工具

scope 对应模块：
- repl: REPL 交互循环
- tool: 工具系统
- perm: 权限系统
- agent: Agent 子系统
- mcp: MCP 集成
- ui: 终端 UI 组件
- api: API 通信
- cmd: 斜杠命令

示例：
feat(tool): 实现 FileReadTool 基础功能
fix(repl): 修复流式渲染中断问题
docs(notes): 添加 Phase2 工具系统学习笔记
refactor(perm): 重构权限规则匹配引擎
```

### 3.6 版本号规则

```
格式：0.PHASE.INCREMENT

- PHASE: 对应当前学习阶段（0-6）
- INCREMENT: 阶段内功能递增

示例：
0.0.1  项目骨架初始化
0.1.0  REPL 基础交互完成
0.2.0  核心工具系统完成
0.3.0  权限系统完成
0.4.0  Agent 子系统完成
0.5.0  MCP 集成完成
0.6.0  高级特性完成
1.0.0  全部核心特性复刻完成
```

---

## 四、核心模块设计规范

### 4.1 工具接口标准

```typescript
// src/tools/types.ts

/** JSON Schema 定义 */
interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  description?: string;
  items?: JSONSchema;
}

/** 工具执行结果 */
interface ToolResult {
  output: string;           // 文本输出
  error?: boolean;          // 是否为错误结果
  metadata?: Record<string, unknown>;  // 额外元数据
}

/** 工具定义（核心接口） */
interface Tool {
  /** 工具唯一名称 */
  name: string;
  /** 工具描述（LLM 可见，影响调用决策） */
  description: string;
  /** 参数 JSON Schema */
  parameters: JSONSchema;
  /** 是否需要用户确认 */
  requiresConfirmation?: boolean;
  /** 执行工具 */
  execute(
    params: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult>;
}

/** 工具执行上下文 */
interface ToolContext {
  workingDirectory: string;
  abortSignal: AbortSignal;
  permissionMode: PermissionMode;
}
```

### 4.2 消息类型标准

```typescript
// 对应源码 src/messages.ts 的消息模型

type Message =
  | UserMessage
  | AssistantMessage;

interface UserMessage {
  role: "user";
  content: UserContent[];
}

type UserContent =
  | { type: "text"; text: string }
  | { type: "image"; source: ImageSource }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AssistantMessage {
  role: "assistant";
  content: AssistantContent[];
}

type AssistantContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "thinking"; thinking: string };
```

### 4.3 API 交互规范

```typescript
// 对应源码 src/services/claude.ts

interface APIConfig {
  model: string;
  maxTokens: number;
  temperature?: number;
  systemPrompt: string;
}

interface StreamCallbacks {
  onToken: (token: string) => void;
  onToolUse: (id: string, name: string, input: unknown) => void;
  onToolResult: (id: string, result: ToolResult) => void;
  onComplete: (message: AssistantMessage) => void;
  onError: (error: Error) => void;
}

// 流式请求规范
// 1. 使用 Anthropic SDK 的 messages.stream()
// 2. 逐 token 渲染到终端
// 3. 遇到 tool_use 时暂停渲染，执行工具后回传结果
// 4. 支持中断（AbortController）
```

### 4.4 权限系统规范

```typescript
// 对应源码 src/permissions.ts

type PermissionMode = "allow" | "deny" | "ask";

interface PermissionRule {
  tool: string;          // 工具名（支持通配符 *）
  pattern: string;       // 路径/命令匹配模式
  mode: PermissionMode;
}

// 权限检查优先级：
// 1. 命令行参数指定（--allowedTools）
// 2. settings.json 中的 permissions 规则
// 3. 交互式用户确认（默认行为）
// 4. CLAUDE.md 中声明的安全约束

// 权限决策流程：
// tool.execute() → PermissionManager.check() → {
//   allow: 直接执行
//   deny: 返回权限拒绝错误
//   ask:  弹出交互确认 → 用户选择
// }
```

---

## 五、研发Agent职责拆分

### 5.1 核心引擎Agent

**职责范围**：
- REPL 主循环实现
- 消息状态管理
- API 通信与流式处理
- 上下文窗口管理

**学习参考**（路径前缀 `free-code/`）：
- `free-code/src/screens/REPL.tsx` - REPL 主屏幕
- `free-code/src/services/claude.ts` - API 交互
- `free-code/src/query.ts` - 查询处理
- `free-code/src/context.ts` - 上下文管理

**产出标准**：
- 多轮对话流畅无阻塞
- 流式渲染逐 token 输出
- 上下文超限时自动压缩

### 5.2 工具系统Agent

**职责范围**：
- 工具接口设计与注册表
- 各工具的具体实现
- 工具结果格式化与截断
- ripgrep 集成

**学习参考**（路径前缀 `free-code/`）：
- `free-code/src/tools/` - 全部工具实现
- `free-code/src/tools.ts` - 工具注册
- `free-code/src/utils/PersistentShell.ts` - 持久化 Shell
- `free-code/src/utils/diff.ts` - Diff 算法

**产出标准**：
- 工具接口统一，新工具可插拔注册
- FileEditTool 支持精确字符串替换
- GrepTool 正确调用 ripgrep

### 5.3 终端UI Agent

**职责范围**：
- Ink 组件开发
- 终端布局与交互
- 代码高亮（`src/components/HighlightedCode.tsx`）
- Markdown 渲染

**学习参考**（路径前缀 `free-code/`）：
- `free-code/src/components/` - 全部 UI 组件
- `free-code/src/components/PromptInput.tsx` - 输入组件
- `free-code/src/components/Message.tsx` - 消息渲染
- `free-code/src/utils/style.ts` - 样式系统

**产出标准**：
- UI 响应终端尺寸变化
- 代码块语法高亮
- Diff 视图清晰可读

### 5.4 权限系统Agent

**职责范围**：
- 权限规则引擎
- 权限确认 UI
- 规则持久化
- 安全审计日志

**学习参考**（路径前缀 `free-code/`）：
- `free-code/src/permissions.ts` - 权限定义
- `free-code/src/hooks/useCanUseTool.ts` - 权限检查
- `free-code/src/components/permissions/` - 权限 UI
- `free-code/src/utils/permissions/` - 权限工具

**产出标准**：
- 权限检查覆盖所有工具
- 支持 allow/deny/ask 三种模式
- 规则可通过配置文件管理

### 5.5 测试质检Agent

**职责范围**：
- 单元测试编写
- 集成测试编写
- 测试覆盖率验证
- 代码规范检查

**产出标准**：
- 工具模块覆盖率 80%+
- 核心服务覆盖率 70%+
- 所有 PR 测试通过

---

## 六、安全护栏

### 6.1 代码安全约束

```typescript
// 禁止事项
// ❌ 硬编码 API 密钥
// ❌ 直接执行用户输入的命令（必须经过权限检查）
// ❌ 未限制的文件系统访问
// ❌ 忽略工具执行的错误输出

// 正确做法
// ✅ API 密钥通过环境变量或配置文件加载
// ✅ BashTool 执行前必须经过权限确认
// ✅ 文件操作限定在工作目录范围内
// ✅ 工具输出有截断限制，防止上下文溢出
```

### 6.2 工具执行安全

```
限制规则：
- BashTool: 禁止执行的命令黑名单（rm -rf /, sudo 等）
- FileWriteTool: 禁止写入 .env、credentials 等敏感文件
- FileEditTool: 编辑前备份原文件
- GrepTool: 搜索结果有数量上限
- 所有工具执行有超时限制（默认 120 秒）

自动防护：
- 路径穿越检查（../ 等）
- 敏感文件保护（.git/、.ssh/、.env）
- 执行结果大小限制
- 并发工具执行数量限制
```

### 6.3 API 调用安全

```typescript
// API 安全规范
// 1. 不记录完整的 system prompt
// 2. 用户消息内容不写入日志
// 3. API Key 不出现在错误信息中
// 4. 请求失败时脱敏错误信息
// 5. 支持 token 使用量追踪（对应 src/cost-tracker.ts）
```

---

## 七、核心开发流程

### 7.1 学习驱动开发流程

```
┌──────────────────────────────────────────────────────────────┐
│          cc-study 学习驱动开发流程                              │
└──────────────────────────────────────────────────────────────┘

     ┌──────────────┐
     │  选择学习模块  │  参考 CLAUDE.md 阶段规划
     └──────┬───────┘
            │
            ▼
     ┌──────────────────────────────┐
     │  Step 1: 源码研读             │
     │  - 阅读对应源码模块            │
     │  - 记录设计笔记到 docs/notes/  │
     │  - 理解接口定义和数据流         │
     └──────────────┬───────────────┘
                    │
                    ▼
     ┌──────────────────────────────┐
     │  Step 2: 设计文档             │
     │  - 编写设计文档到 docs/design/ │
     │  - 定义接口、数据结构          │
     │  - 识别测试用例               │
     └──────────────┬───────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│                    🔴 RED Phase - 编写失败测试                │
└─────────────────────────────────────────────────────────────┘
     ┌──────────────────────────────┐
     │  Step 3: 编写测试用例 🔴      │
     │  - 按设计文档编写测试          │
     │  - 覆盖正常流程和边界条件      │
     └──────────────┬───────────────┘
                    │
                    ▼
     ┌──────────────────────────────┐
     │  Step 4: 确认测试失败 🔴      │
     │  pnpm test                   │
     └──────────────┬───────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│                    🟢 GREEN Phase - 最小实现                  │
└─────────────────────────────────────────────────────────────┘
     ┌──────────────────────────────┐
     │  Step 5: 编码实现 🟢          │
     │  - 编写最小代码通过测试        │
     │  - 参考源码但不直接复制        │
     └──────────────┬───────────────┘
                    │
                    ▼
     ┌──────────────────────────────┐
     │  Step 6: 测试通过 🟢          │
     │  pnpm test                   │
     └──────────────┬───────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│                    🔵 REFACTOR Phase - 重构优化               │
└─────────────────────────────────────────────────────────────┘
     ┌──────────────────────────────┐
     │  Step 7: 重构与对照 🔵        │
     │  - 优化代码结构               │
     │  - 对照源码比较设计差异        │
     │  - 记录设计决策到笔记          │
     └──────────────┬───────────────┘
                    │
                    ▼
     ┌──────────────────────────────┐
     │  Step 8: 验证与提交           │
     │  pnpm lint && pnpm test      │
     │  git commit                  │
     └──────────────┬───────────────┘
                    │
                    ▼
     ┌──────────────────────────────┐
     │  Step 9: 学习总结             │
     │  - 更新 docs/notes/ 笔记      │
     │  - 标记 Phase 进度            │
     └──────────────────────────────┘
```

### 7.2 任务记录规范

**任务文件**：`docs/task/task_records.json`

```json
{
  "task_id": "P{phase}{序号}",
  "task_type": "源码研读/设计文档/功能开发/测试编写/重构优化",
  "phase": "Phase 0-6",
  "module": "repl/tool/perm/agent/mcp/ui/cmd",
  "source_ref": "源码参考路径（如 src/tools/FileReadTool/）",
  "task_desc": "任务描述",
  "executor": "Claude Code/人工",
  "status": "待执行/进行中/已完成/驳回",
  "create_time": "2026-04-01 10:00:00",
  "finish_time": null,
  "check_result": null,
  "remark": "备注（含学习心得）"
}
```

### 7.3 分支命名规范

| 类型 | 命名格式 | 示例 |
|------|---------|------|
| Phase 开发 | `phase/{N}-{描述}` | `phase/1-repl-loop` |
| 功能开发 | `feat/{模块}-{描述}` | `feat/tool-file-read` |
| Bug修复 | `fix/{描述}` | `fix/stream-render-crash` |
| 学习笔记 | `docs/notes-{主题}` | `docs/notes-tool-system` |
| 重构 | `refactor/{模块}-{描述}` | `refactor/tool-registry` |

---

## 八、测试规范

### 8.1 测试目录结构

```
tests/
├── unit/                      # 单元测试
│   ├── tools/
│   │   ├── fileReadTool.test.ts
│   │   ├── fileWriteTool.test.ts
│   │   ├── fileEditTool.test.ts
│   │   ├── bashTool.test.ts
│   │   ├── globTool.test.ts
│   │   └── grepTool.test.ts
│   ├── services/
│   │   ├── api.test.ts
│   │   └── stream.test.ts
│   ├── permissions/
│   │   └── manager.test.ts
│   └── utils/
│       ├── diff.test.ts
│       └── file.test.ts
├── integration/               # 集成测试
│   ├── repl.test.ts
│   ├── toolChain.test.ts
│   └── mcpClient.test.ts
└── e2e/                       # 端到端测试
    └── fullFlow.test.ts
```

### 8.2 测试命名规范

```typescript
// 格式：describe 分组 + test 场景描述
describe("FileReadTool", () => {
  test("reads existing file successfully", async () => {
    // ...
  });

  test("throws on non-existent file", async () => {
    // ...
  });

  test("respects line offset and limit", async () => {
    // ...
  });
});
```

### 8.3 测试覆盖率要求

| 模块 | 最低覆盖率 | 优先级 |
|------|-----------|--------|
| 工具系统 (tools/) | 80% | P0 |
| 核心服务 (services/) | 70% | P0 |
| 权限系统 (permissions/) | 80% | P0 |
| 工具函数 (utils/) | 90% | P1 |
| REPL (screens/) | 50% | P2 |
| UI 组件 (components/) | 50% | P2 |

### 8.4 Mock 策略

```typescript
// API 调用必须 Mock，不依赖真实 API
vi.mock("../services/claude", () => ({
  createStream: vi.fn(() => mockStream),
}));

// 文件系统使用临时目录
import { mkdtempSync } from "fs";
const tmpDir = mkdtempSync(path.join(os.tmpdir(), "cc-study-test-"));

// Shell 命令使用 Mock
vi.mock("../utils/shell", () => ({
  executeCommand: vi.fn(() => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })),
}));
```

---

## 九、Harness 管控红线

### 9.1 禁止事项

- ❌ 直接复制粘贴源码（必须理解后自己实现）
- ❌ 跳过源码研读阶段直接编码
- ❌ 未编写测试就提交功能代码
- ❌ 跳过 lint 和类型检查
- ❌ 修改 docs/task/task_records.json 的字段结构

### 9.2 必须遵守

- ✅ 每个模块先写学习笔记（docs/notes/）
- ✅ 编码前必须有设计文档（docs/design/）
- ✅ 遵循 TDD：先写测试，再写实现
- ✅ 每次提交包含代码 + 测试 + 笔记
- ✅ 提交信息符合 3.5 规范
- ✅ 测试覆盖率达标

### 9.3 常用命令

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 运行测试
pnpm test

# 运行 lint
pnpm lint

# 类型检查
pnpm typecheck

# 测试覆盖率
pnpm test:coverage

# 完整检查（提交前）
pnpm lint && pnpm typecheck && pnpm test

# 构建
pnpm build
```

---

## 十、学习资源索引

### 10.1 源码关键文件速查

> 所有路径前缀为 `free-code/`

| 功能 | 源码路径 | 学习优先级 |
|------|---------|-----------|
| CLI 入口 | `free-code/src/entrypoints/cli.tsx` | P0 |
| REPL 主屏幕 | `free-code/src/screens/REPL.tsx` | P0 |
| 系统提示词 | `free-code/src/constants/prompts.ts` | P0 |
| API 交互 | `free-code/src/services/claude.ts` | P0 |
| 工具注册 | `free-code/src/tools.ts` | P0 |
| 文件读取工具 | `free-code/src/tools/FileReadTool/` | P1 |
| 文件编辑工具 | `free-code/src/tools/FileEditTool/` | P1 |
| Bash 工具 | `free-code/src/tools/BashTool/` | P1 |
| Grep 工具 | `free-code/src/tools/GrepTool/` | P1 |
| Glob 工具 | `free-code/src/tools/GlobTool/` | P1 |
| Agent 工具 | `free-code/src/tools/AgentTool/` | P2 |
| MCP 工具 | `free-code/src/tools/MCPTool/` | P2 |
| 权限系统 | `free-code/src/permissions.ts` | P1 |
| 权限检查 Hook | `free-code/src/hooks/useCanUseTool.ts` | P1 |
| 持久化 Shell | `free-code/src/utils/PersistentShell.ts` | P2 |
| Diff 算法 | `free-code/src/utils/diff.ts` | P2 |
| 消息模型 | `free-code/src/messages.ts` | P0 |
| 消息组件 | `free-code/src/components/Message.tsx` | P1 |
| 输入组件 | `free-code/src/components/PromptInput.tsx` | P1 |
| 斜杠命令 | `free-code/src/commands/` | P2 |
| OAuth 认证 | `free-code/src/services/oauth.ts` | P2 |
| 费用追踪 | `free-code/src/cost-tracker.ts` | P2 |
| 上下文管理 | `free-code/src/context.ts` | P1 |
| 压缩命令 | `free-code/src/commands/compact.ts` | P2 |

### 10.2 目录速查

| 内容 | 路径 |
|------|------|
| 研发规范 | `/CLAUDE.md` |
| 参考源码 | `/free-code/`（不提交 Git） |
| CI 流水线 | `/.github/workflows/ci.yml` |
| 学习笔记 | `/docs/notes/` |
| 设计文档 | `/docs/design/` |
| 任务记录 | `/docs/task/task_records.json` |
| 工具系统 | `/src/tools/` |
| 核心服务 | `/src/services/` |
| UI 组件 | `/src/components/` |
| 斜杠命令 | `/src/commands/` |
| 权限系统 | `/src/permissions/` |
| 工具函数 | `/src/utils/` |
| 单元测试 | `/tests/unit/` |
| 集成测试 | `/tests/integration/` |
| E2E 测试 | `/tests/e2e/` |

---

**版本**：v1.1.0
**创建日期**：2026-04-01
**维护者**：cc-study 学习项目
