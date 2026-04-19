# Phase 2: 工具系统 - 源码研读笔记

> 研读日期：2026-04-11
> 源码版本：free-code/ (claude-code sourcemap)
> 任务编号：P2001 ~ P2006

---

## 一、工具注册机制（tools.ts + Tool.ts）

### 1.1 Tool 接口核心定义

`free-code/src/Tool.ts` 定义了完整的 Tool 类型系统：

```typescript
// 工具接口（约 60+ 个可选/必选方法）
type Tool<Input, Output, P> = {
  name: string                           // 工具名（面向 LLM）
  description(): Promise<string>         // 异步描述
  inputSchema: Input                     // Zod Schema
  outputSchema: Output                   // Zod Schema
  
  // 生命周期方法
  validateInput(input, context): Promise<ValidationResult>
  checkPermissions(input, context): Promise<PermissionDecision>
  call(input, context, ...): Promise<ToolResult<Output>>
  
  // 辅助方法
  isConcurrencySafe(): boolean           // 是否可并行
  isReadOnly(): boolean                  // 是否只读
  getPath(input): string                 // 获取操作路径
  preparePermissionMatcher(input): ...   // 权限匹配预处理
  
  // UI 渲染
  renderToolUseMessage(...)
  renderToolResultMessage(...)
  renderToolUseErrorMessage(...)
  
  // 搜索相关
  extractSearchText(output): string
  isSearchOrReadCommand(): { isSearch, isRead }
}
```

### 1.2 buildTool 工厂函数

```typescript
function buildTool<D>(def: D): BuiltTool<D> {
  return { ...TOOL_DEFAULTS, userFacingName: () => def.name, ...def }
}
```

提供默认值合并，`ToolDef` 可以省略可选方法。

### 1.3 工具注册（tools.ts）

```typescript
// 所有工具在 getAllBaseTools() 中统一注册
function getAllBaseTools(): Tools {
  return [
    AgentTool, TaskOutputTool, BashTool,
    ...(hasEmbeddedSearchTools() ? [] : [GlobTool, GrepTool]),
    FileReadTool, FileEditTool, FileWriteTool,
    // ... 40+ 个工具
  ]
}

// getTools() 根据 permissionContext 过滤
function getTools(permissionContext): Tools {
  const tools = getAllBaseTools().filter(...)
  return filterToolsByDenyRules(tools, permissionContext)
}

// assembleToolPool() 合并内置工具 + MCP 工具
function assembleToolPool(permissionContext, mcpTools): Tools {
  return uniqBy(
    [...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)),
    'name'
  )
}
```

**关键设计**：
- 条件注册：通过 feature flag 控制哪些工具可用
- 内置优先：`uniqBy('name')` 保证内置工具覆盖同名 MCP 工具
- 按 name 排序：保证 prompt cache 稳定性

---

## 二、FileReadTool

### 2.1 核心流程

```
call() -> 去重检查 -> callInner() -> 按文件类型分发:
  - .ipynb -> readNotebook()
  - .png/.jpg/... -> readImageWithTokenBudget()
  - .pdf -> readPDF() / extractPDFPages()
  - 文本 -> readFileInRange()
             快速路径 (<10MB): readFile + 内存分割
             流式路径 (>=10MB): createReadStream + 逐行扫描
```

### 2.2 输入参数

```typescript
z.strictObject({
  file_path: z.string(),        // 绝对路径
  offset: z.number().optional(), // 起始行（1-indexed，默认1）
  limit: z.number().optional(),  // 读取行数
  pages: z.string().optional(),  // PDF 页码范围
})
```

### 2.3 行号格式

```typescript
// 标准模式: "     1→content"（右对齐6字符 + →）
// 紧凑模式: "1\tcontent"（行号 + tab）
function addLineNumbers({ content, startLine }) {
  return lines.map((line, i) => 
    `${String(i + startLine).padStart(6, ' ')}→${line}`
  ).join('\n')
}
```

### 2.4 输出限制

| 限制层 | 默认值 | 检查对象 |
|--------|--------|----------|
| maxSizeBytes | 256 KB | 文件总大小 |
| maxTokens | 25000 | 输出 Token 数 |

---

## 三、FileEditTool

### 3.1 核心算法（applyEditToFile）

```typescript
function applyEditToFile(original, oldString, newString, replaceAll) {
  const f = replaceAll
    ? (c, s, r) => c.replaceAll(s, () => r)
    : (c, s, r) => c.replace(s, () => r)
  
  // 删除操作：智能处理尾部换行
  if (newString === '' && !oldString.endsWith('\n') && original.includes(oldString + '\n')) {
    return f(original, oldString + '\n', newString)
  }
  return f(original, oldString, newString)
}
```

**关键**：`() => replace` 避免 `$` 特殊字符问题。

### 3.2 唯一性检查

```typescript
const matches = file.split(actualOldString).length - 1
if (matches > 1 && !replace_all) {
  return { result: false, message: `Found ${matches} matches...` }
}
```

### 3.3 两阶段处理

1. **validateInput**: 编码检测 + CRLF→LF + 匹配 + 唯一性
2. **call**: 原子区间内（无 async 让步）再次读文件 → 时序一致性检查 → 替换 → 写盘

### 3.4 编辑前必须先读取

```typescript
if (!readTimestamp || readTimestamp.isPartialView) {
  return { result: false, message: 'File has not been read yet...' }
}
```

### 3.5 错误码体系（11个）

| 码 | 场景 | 码 | 场景 |
|----|------|----|------|
| 0 | 密钥检测 | 6 | 文件未读取 |
| 1 | old===new | 7 | 文件被修改 |
| 2 | 权限拒绝 | 8 | old_string 找不到 |
| 3 | 文件已存在 | 9 | 匹配多处 |
| 4 | 文件不存在 | 10 | 文件太大 |
| 5 | .ipynb 拦截 | | |

---

## 四、FileWriteTool

### 4.1 核心流程

```
validateInput: 密钥检查 → deny规则 → 文件存在性 → readFileState检查 → mtime一致性
call: mkdir → fileHistory备份 → 原子区间{读取→一致性检查→写入} → LSP通知 → readFileState更新
```

### 4.2 输入参数

```typescript
z.strictObject({
  file_path: z.string(),  // 绝对路径
  content: z.string(),    // 完整内容
})
```

### 4.3 结果类型

- `create`: 新文件创建，返回 "File created successfully at: {path}"
- `update`: 文件更新，返回 "The file {path} has been updated successfully."

---

## 五、BashTool

### 5.1 命令执行流程

```
BashTool.call()
  → bashPermissions.check() 安全检查链
  → Shell.exec(command, abortSignal, shellType)
    → provider.buildExecCommand() 构建命令
    → spawn(binShell, args, { env, cwd, stdio })
    → wrapSpawn(childProcess, abortSignal, timeout)
    → 命令完成后: pwd -P 更新 cwd
```

### 5.2 安全检查链（bashSecurity.ts）

20+ 个验证器按顺序执行：
- 控制字符检测
- shell-quote 反斜杠 bug
- heredoc 处理
- 命令替换检测
- flag 混淆检测
- 危险变量检测
- 重定向检测
- IFS 注入检测
- Unicode 空白字符检测

### 5.3 命令语义分析（commandSemantics.ts）

不同命令的 exit code 语义：
- `grep`/`rg`: exit 1 = 无匹配（非错误）
- `find`: exit 1 = 部分目录不可访问
- `diff`: exit 1 = 有差异
- `test`/`[`: exit 1 = 条件为 false

### 5.4 超时与取消

- 默认超时：120秒
- 通过 AbortController 取消
- 使用 tree-kill 终止子进程树

---

## 六、GlobTool

### 6.1 核心

```typescript
// 输入
z.strictObject({
  pattern: z.string(),    // glob 模式
  path: z.string().optional(),  // 搜索目录
})

// 调用 fast-glob
const { files, truncated } = await glob(pattern, searchDir, { limit: 100 })
const filenames = files.map(toRelativePath)  // 相对路径节省 token
```

### 6.2 结果限制

默认最多返回 100 个文件，超出时 truncated=true。

---

## 七、GrepTool

### 7.1 核心

```typescript
// 输入
z.strictObject({
  pattern: z.string(),           // 正则
  path: z.string().optional(),   // 搜索路径
  glob: z.string().optional(),   // 文件过滤
  output_mode: z.enum(['content', 'files_with_matches', 'count']),
  '-B': z.number().optional(),   // 上下文行数
  '-A': z.number().optional(),
  '-C': z.number().optional(),
  '-i': z.boolean().optional(),  // 忽略大小写
  head_limit: z.number().optional(), // 结果限制（默认250）
  multiline: z.boolean().optional(),
})
```

### 7.2 ripgrep 集成

```typescript
// 构建 ripgrep 参数
const args = ['--hidden', '--max-columns', '500']
// 排除 VCS 目录
for (const dir of ['.git', '.svn', ...]) args.push('--glob', `!${dir}`)
// 添加 pattern, type, glob 等
// 调用 ripgrep 子进程
const results = await ripGrep(args, absolutePath, abortController.signal)
```

### 7.3 三种输出模式

- `content`: 匹配行内容（带行号、上下文）
- `files_with_matches`: 文件列表（按 mtime 排序）
- `count`: 匹配计数

---

## 八、设计决策总结与复刻建议

### 8.1 关键模式

1. **buildTool 工厂模式**: 统一的工具定义接口，提供默认值
2. **validateInput → checkPermissions → call 三阶段**: 分离校验、权限、执行
3. **Zod strictObject**: 防止 LLM 幻觉参数
4. **readFileState 追踪**: 文件变更时序一致性保证
5. **原子区间**: 读写操作间不插入 async，防止竞争

### 8.2 复刻优先级

**P0 - 核心必须**：
- Tool 接口定义 + buildTool
- ToolRegistry 注册表
- FileReadTool（文本文件 + offset/limit）
- FileEditTool（精确替换 + replace_all）
- FileWriteTool（完整写入）
- BashTool（spawn + 超时 + 取消）

**P1 - 重要但可简化**：
- GlobTool（fast-glob 集成）
- GrepTool（ripgrep 子进程调用）
- 基本权限检查

**P2 - 可延后**：
- 图片/PDF 处理
- 引用归一化、反消毒
- 文件去重
- 安全检查链（先做基本的）
