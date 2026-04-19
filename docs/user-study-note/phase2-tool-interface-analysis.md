# Phase 2: Tool 接口深度分析 — execute vs call 与关键辅助方法

> 研读日期：2026-04-12
> 参考来源：`docs/notes/phase2-tool-system.md`、`docs/notes/phase2-bash-tool.md`、`src/tools/types.ts`

---

## 一、接口签名对比

### cc-study 当前实现

```typescript
// src/tools/types.ts
interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JSONSchema;
  readonly requiresConfirmation?: boolean;

  execute(
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult>;
}
```

### Claude Code 原始设计

```typescript
// free-code/src/Tool.ts（简化）
type Tool<Input, Output, P> = {
  name: string;
  description(): Promise<string>;
  inputSchema: Input;   // Zod Schema
  outputSchema: Output; // Zod Schema

  // 三阶段生命周期
  validateInput(input, context): Promise<ValidationResult>;
  checkPermissions(input, context): Promise<PermissionDecision>;
  call(input, context, ...): Promise<ToolResult<Output>>;

  // 辅助方法
  isConcurrencySafe(): boolean;
  isReadOnly(): boolean;
  getPath(input): string;
  extractSearchText(output): string;
  isSearchOrReadCommand(): { isSearch, isRead };

  // UI 渲染
  renderToolUseMessage(...);
  renderToolResultMessage(...);
  renderToolUseErrorMessage(...);
};
```

---

## 二、核心差异逐项分析

### 差异 1：生命周期 — 单阶段 vs 三阶段

| 维度 | cc-study `execute` | Claude Code `call` |
|------|-------------------|-------------------|
| 阶段数 | 1 个方法做所有事 | 3 个方法分工协作 |
| 验证 | 在 execute 内部夹杂 | `validateInput` 独立方法 |
| 权限 | 只有 `requiresConfirmation` 布尔值 | `checkPermissions` 独立方法，返回细粒度决策 |
| 执行 | `execute` | `call` |

**cc-study 当前的问题**：

在 FileEditTool 的 `execute` 中，验证逻辑和执行逻辑混在一起：

```typescript
// src/tools/FileEditTool.ts — execute 内部混杂了验证和执行
async execute(params, context) {
  // ---- 验证逻辑（本应在 validateInput 中）----
  if (oldString === newString) { return error; }

  let content = await readFile(filePath);
  // BOM 处理、CRLF 转换 — 这是输入预处理

  if (oldString === "" && content.length > 0) { return error; }
  if (!content.includes(oldString)) { return error; }

  const matchCount = content.split(oldString).length - 1;
  if (matchCount > 1) { return error; }  // 唯一性检查

  // ---- 执行逻辑（本应在 call 中）----
  const updatedContent = applyEditToFile(content, oldString, newString, replaceAll);
  await writeFile(filePath, updatedContent, "utf-8");
}
```

**Claude Code 的三阶段分离**：

```
validateInput:  编码检测 → CRLF→LF → 匹配检查 → 唯一性检查
     ↓ 通过
checkPermissions: deny规则 → readFileState → mtime一致性
     ↓ 允许
call: 原子区间{再次读文件 → 一致性检查 → 替换 → 写盘}
```

好处：
- **提前失败**：验证不过就不进入权限检查，节省开销
- **关注点分离**：改验证逻辑不影响执行逻辑
- **LLM 友好**：验证失败返回的错误信息更精确，帮助 LLM 修正下次调用

---

### 差异 2：参数类型 — 松散 Record vs 强类型 Zod

| 维度 | cc-study | Claude Code |
|------|----------|-------------|
| Schema 定义 | `JSONSchema`（手写对象） | Zod `strictObject` |
| 参数类型 | `Record<string, unknown>` | 泛型 `Input`（从 Zod Schema 推导） |
| 运行时验证 | 手动 `String(params.xxx ?? "")` | Zod 自动 parse + 类型推导 |
| 防幻觉 | 无 | `strictObject` 拒绝未定义的字段 |

**cc-study 当前的问题**：

每个工具的 `execute` 开头都要手动提取和转换参数：

```typescript
// 所有工具都有这种样板代码
const command = String(params.command ?? "");
const filePath = resolve(context.workingDirectory, String(params.file_path ?? ""));
const oldString = String(params.old_string ?? "");
```

Claude Code 用 Zod 后，参数类型是自动推导的：

```typescript
// Zod 定义
const inputSchema = z.strictObject({
  file_path: z.string(),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().default(false),
});

// call 方法直接拿到类型安全的 input
async call(input: z.infer<typeof inputSchema>, context) {
  // input.file_path 已经是 string，无需手动转换
  // input.replace_all 已经是 boolean，有默认值
}
```

---

### 差异 3：描述 — 静态字符串 vs 异步函数

| 维度 | cc-study | Claude Code |
|------|----------|-------------|
| 类型 | `readonly description: string` | `description(): Promise<string>` |
| 特点 | 编译时固定 | 运行时可动态生成 |

Claude Code 的描述是异步函数，意味着：
- 可根据上下文动态调整描述（如根据项目类型显示不同提示）
- 可注入运行时信息（如当前工作目录、可用命令等）
- description 和 inputSchema 都可以是动态的

---

### 差异 4：返回类型 — 简单 output vs 泛型 Output

| 维度 | cc-study | Claude Code |
|------|----------|-------------|
| 结果类型 | `{ output: string; error?: boolean }` | `ToolResult<Output>`（泛型） |
| 结构化数据 | 全部序列化为字符串 | 可以保留结构化数据 |

cc-study 当前的 `ToolResult` 简单够用，但 Claude Code 的泛型设计允许工具保留结构化数据，方便后续的 `extractSearchText` 等方法处理。

---

### 差异 5：辅助能力缺失

cc-study 完全缺失的能力：

| 能力 | Claude Code | cc-study | 影响 |
|------|------------|----------|------|
| `isReadOnly()` | 标识只读工具 | 无 | 无法对读/写采用不同权限策略 |
| `isConcurrencySafe()` | 标识可并行工具 | 无 | 无法安全并行执行工具 |
| `getPath(input)` | 获取操作路径 | 无 | 权限系统无法基于路径做规则匹配 |
| `extractSearchText()` | 提取搜索文本 | 无 | 上下文压缩缺乏信息 |
| `isSearchOrReadCommand()` | 标识搜索/读取 | 无 | 无法差异化处理搜索类工具 |
| UI 渲染方法 | `renderToolUseMessage` 等 | 无 | 工具执行过程无自定义渲染 |

---

## 三、执行流程对比

### cc-study 当前流程

```
REPL 收到 tool_use
  → executeTool(registry, name, input, context)
    → tool.execute(input, context)    ← 验证 + 执行混在一起
    → try/catch 包裹
  → 返回 ToolResult 给 LLM
```

### Claude Code 完整流程

```
REPL 收到 tool_use
  → tool.validateInput(input, context)     ← 独立验证阶段
    ↓ 失败 → 直接返回错误给 LLM
  → tool.checkPermissions(input, context)  ← 独立权限阶段
    ↓ deny → 返回权限拒绝
    ↓ ask  → 弹出交互确认 UI
    ↓ allow → 继续
  → tool.call(input, context)              ← 纯执行阶段
  → 返回 ToolResult<Output>
  → 可选: extractSearchText(result)        ← 后处理
```

---

## 四、关键辅助方法详解

### 4.1 validateInput — 输入验证

`validateInput` 是工具执行生命周期中的**第一步**，在权限检查和实际执行之前运行。

**各工具的具体验证逻辑**：

**FileEditTool**：
1. 编码检测 — 检查文件编码是否为 UTF-8
2. CRLF → LF 转换 — 统一换行符，保证匹配准确性
3. 字符串匹配 — 检查 `old_string` 是否存在于文件中
4. 唯一性检查 — `replace_all` 为 false 时，`old_string` 必须只出现一次

**FileWriteTool**：
1. 密钥检测 — 检查内容是否包含 API key 等敏感信息
2. deny 规则检查 — 文件路径是否在禁止写入列表中
3. 文件存在性 — 判断是创建还是更新
4. readFileState 检查 — 写入前必须先读取
5. mtime 一致性 — 防止读到的是过期内容

**BashTool**：
- sleep 模式检测 — 识别 `sleep` 命令，给出更合理的超时建议

**设计意义**：
- **提前失败**：不合法的输入不会进入权限检查和执行阶段
- **关注点分离**：验证是"参数对不对"，权限是"能不能做"，执行是"怎么做"
- **给 LLM 更好的错误信息**：验证失败返回具体原因，帮助 LLM 修正下一次调用

---

### 4.2 extractSearchText — 搜索文本提取

从工具的**执行结果**中提取有意义的搜索文本，供上层系统使用。

**使用场景**：
1. **上下文压缩（compact）**：对话上下文接近 token 上限时，对历史消息压缩。工具调用结果通过 `extractSearchText` 提取关键文本，压缩后仍保留可检索信息。
2. **结果索引**：将工具输出的关键内容建立索引，方便后续引用。
3. **语义检索**：提取文本用于判断工具结果与后续用户问题的相关性。

**各工具的实现差异**：
- **GrepTool**：提取匹配行内容（去除 ripgrep 输出格式化前缀）
- **GlobTool**：提取文件路径列表
- **FileReadTool**：提取文件内容摘要
- **BashTool**：提取 stdout 输出中的关键文本

---

### 4.3 isSearchOrReadCommand — 搜索/读取命令标识

返回 `{ isSearch: boolean, isRead: boolean }`，标识当前工具调用类型。

**使用场景**：
1. **权限策略差异化**：搜索/读取操作通常安全（只读），可采用更宽松的权限策略
2. **并发控制**：只读操作可并行执行，写入/编辑操作需串行
3. **结果缓存**：只读操作结果可安全缓存
4. **上下文管理优化**：搜索类工具输出在压缩时可更激进截断（信息可重新搜索获取）

**各工具的返回值**：

| 工具 | isSearch | isRead |
|------|----------|--------|
| GrepTool | true | false |
| GlobTool | true | false |
| FileReadTool | false | true |
| FileEditTool | false | false |
| FileWriteTool | false | false |
| BashTool | 视命令而定 | 视命令而定 |

BashTool 的返回值会根据具体命令动态判断（`grep`、`cat`、`ls` 等被识别为搜索或读取操作）。

---

### 4.4 三个辅助方法的协作关系

```
┌─────────────────────────────────────────────────┐
│              Tool 执行生命周期                     │
│                                                   │
│  1. validateInput(input)                          │
│     → 验证参数合法性，提前拦截无效调用               │
│                                                   │
│  2. checkPermissions(input)                       │
│     → 权限检查（可参考 isSearchOrReadCommand）      │
│     → 搜索/读取类操作可能走快速通道                 │
│                                                   │
│  3. call(input)                                   │
│     → 实际执行，返回 ToolResult                    │
│                                                   │
│  4. extractSearchText(output)                     │
│     → 从结果中提取可索引文本                        │
│     → 供上下文管理和压缩使用                        │
└─────────────────────────────────────────────────┘

  isSearchOrReadCommand() 贯穿始终：
  → 影响权限策略（步骤2）
  → 影响并发控制
  → 影响结果缓存策略
  → 影响上下文压缩策略
```

---

## 五、为什么 Claude Code 选择三阶段

### 5.1 时序一致性（最关键的差异）

FileEditTool 和 FileWriteTool 都需要保证"读到的内容没被篡改"。

```
validateInput: 读文件 → 验证匹配性              ← 可能让出事件循环
checkPermissions: 权限检查                       ← 可能弹出 UI 等待用户
call: 再次读文件 → mtime 对比 → 替换 → 写入     ← 原子区间，不让出事件循环
```

`call` 内部的"再次读文件"和"写入"在**同一个微任务**内完成，防止：
- validateInput 读到的内容和实际写入时的内容不一致
- 用户在权限确认期间文件被其他进程修改

### 5.2 cc-study 当前的风险

```typescript
let content = await readFile(filePath);     // ← 读文件（让出事件循环）
// ... 验证逻辑 ...
const updatedContent = applyEditToFile(...);
await writeFile(filePath, updatedContent);  // ← 写文件（再次让出事件循环）
```

两次 `await` 之间，理论上文件可能被修改。当前单线程场景下风险不大，但在有并发工具调用时会出问题。

---

## 六、总结与演进建议

### 总览对比

| 维度 | cc-study `execute` | Claude Code `call` |
|------|-------------------|-------------------|
| 复杂度 | 简单直接，一个方法搞定 | 三阶段分离，职责清晰 |
| 类型安全 | `Record<string, unknown>`，手动转换 | Zod 泛型，编译时+运行时双保险 |
| 描述 | 静态字符串 | 异步动态生成 |
| 验证 | 混在 execute 中 | `validateInput` 独立 |
| 权限 | 布尔值 `requiresConfirmation` | `checkPermissions` 细粒度决策 |
| 时序安全 | 两次 await 之间有窗口 | call 内原子区间 |
| 辅助能力 | 无 | readonly/并发安全/搜索标识/UI渲染 |

### 演进优先级

cc-study 当前的简洁设计是合理的起步，建议逐步引入：

| 优先级 | 内容 | 理由 |
|--------|------|------|
| **P0** | `validateInput` | 对 FileEditTool 精确替换至关重要，能显著提升编辑成功率 |
| **P1** | Zod 替代手写 JSONSchema | 消除手动类型转换样板代码，防止 LLM 幻觉参数 |
| **P1** | `isSearchOrReadCommand` | 对权限系统和并发控制有帮助 |
| **P2** | `checkPermissions` | 细粒度权限决策，Phase 3 权限系统时引入 |
| **P2** | `extractSearchText` | 上下文压缩时才需要，实现 `/compact` 命令时再加 |
| **P3** | `isReadOnly`、`isConcurrencySafe` 等 | 并行 Agent 执行时才需要 |
