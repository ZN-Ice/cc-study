# Phase 2: BashTool 工具系统 - 源码研读笔记

> 研读日期：2026-04-11
> 源码版本：free-code/ (claude-code sourcemap)
> 对应任务：Phase 2 工具系统 - BashTool 模块

---

## 一、BashTool 总体架构

### 1.1 文件结构

BashTool 是 Claude Code 中最复杂的工具，涉及 16 个源文件：

```
src/tools/BashTool/
├── BashTool.tsx              # 主工具定义（~1100行），工具注册、执行、输出处理
├── prompt.ts                 # 工具提示词（LLM可见的描述和使用说明）
├── bashSecurity.ts           # 安全检查核心（~2450行），验证器链
├── bashCommandHelpers.ts     # 命令分段权限检查（管道/复合命令处理）
├── bashPermissions.ts        # 权限规则匹配引擎
├── commandSemantics.ts       # 命令退出码语义解释
├── sedEditParser.ts          # sed -i 编辑命令解析
├── sedValidation.ts          # sed 命令权限验证
├── readOnlyValidation.ts     # 只读命令检查
├── pathValidation.ts         # 路径权限验证
├── shouldUseSandbox.ts       # 沙箱使用决策
├── destructiveCommandWarning.ts  # 危险命令警告检测
├── modeValidation.ts         # 执行模式验证
├── commentLabel.ts           # 命令注释标签
├── toolName.ts               # 工具名常量
├── utils.ts                  # 输出格式化工具函数
└── UI.tsx                    # 终端UI渲染组件
```

### 1.2 核心调用链

```
用户输入命令 → BashTool.call()
  ├── validateInput()           # 输入验证（sleep模式检测等）
  ├── checkPermissions()        # 权限检查
  │   ├── bashToolHasPermission()
  │   ├── checkCommandOperatorPermissions()  # 管道/操作符分段检查
  │   └── bashSecurity.bashCommandIsSafe()   # 安全验证器链
  ├── runShellCommand()         # 异步生成器，执行命令
  │   ├── exec()                # Shell.ts 中的底层执行
  │   │   ├── provider.buildExecCommand()    # 构建命令字符串
  │   │   ├── spawn()           # child_process.spawn
  │   │   └── wrapSpawn()       # 包装超时/中断/进度
  │   └── 进度/超时/后台化处理
  ├── interpretCommandResult()  # 退出码语义解释
  ├── 输出处理（截断、图片检测、持久化）
  └── 返回 ToolResult
```

---

## 二、命令执行机制

### 2.1 执行方式：child_process.spawn（非 PersistentShell）

**关键发现**：Claude Code 的 BashTool 使用 `child_process.spawn` 而非 PersistentShell 来执行命令。每个命令创建一个新的子进程。

核心执行入口在 `Shell.ts` 的 `exec()` 函数：

```typescript
export async function exec(
  command: string,
  abortSignal: AbortSignal,
  shellType: ShellType,   // 'bash' | 'zsh' | 'powershell'
  options?: ExecOptions,
): Promise<ShellCommand> {
  // ...
  const childProcess = spawn(spawnBinary, shellArgs, {
    env: { ...subprocessEnv(), SHELL: binShell, GIT_EDITOR: 'true', CLAUDECODE: '1' },
    cwd,
    stdio: usePipeMode ? ['pipe', 'pipe', 'pipe'] : ['pipe', outputHandle?.fd, outputHandle?.fd],
    detached: provider.detached,
    windowsHide: true,
  })
  // ...
}
```

**spawn 参数详解**：
- `spawnBinary`：根据 shellType 决定，通常为 `/bin/bash` 或 `/bin/zsh`
- `shellArgs`：`['-c', commandString]`，通过 `-c` 传入命令
- `env`：继承用户环境变量，添加 `CLAUDECODE=1` 标识
- `cwd`：当前工作目录（通过 `pwd()` 获取内存状态）
- `stdio`：stdin 用 pipe，stdout/stderr 合并写入同一个文件 fd（O_APPEND 保证原子性）

### 2.2 工作目录持久化机制

工作目录持久化通过临时文件实现，而非持久化 Shell：

```typescript
// Shell.ts 中 exec() 的关键逻辑
const { commandString, cwdFilePath } = await provider.buildExecCommand(command, { ... })

// 命令执行完成后，读取临时文件获取新 cwd
void shellCommand.result.then(async result => {
  if (result && !preventCwdChanges && !result.backgroundTaskId) {
    let newCwd = readFileSync(nativeCwdFilePath, { encoding: 'utf8' }).trim()
    if (newCwd.normalize('NFC') !== cwd) {
      setCwd(newCwd, cwd)         // 更新全局 cwd 状态
      invalidateSessionEnvCache()
    }
  }
  unlinkSync(nativeCwdFilePath)   // 清理临时文件
})
```

**工作流程**：
1. `buildExecCommand()` 生成包含 `pwd -P >| $cwdFilePath` 的命令字符串
2. 用户命令执行后，`pwd` 将当前目录写入临时文件
3. 命令完成后，读取临时文件获取新的 cwd
4. 与旧 cwd 比较，不同则更新全局状态 `setCwd()`
5. 删除临时文件

**重要设计决策**：每次命令都是新进程，Shell 状态（环境变量、别名、函数）不会持久化。只有 cwd 跨命令持久化。

### 2.3 工作目录安全检查

```typescript
// BashTool.tsx 中的 CWD 重置逻辑
if (!preventCwdChanges) {
  const appState = getAppState();
  if (resetCwdIfOutsideProject(appState.toolPermissionContext)) {
    stderrForShellReset = stdErrAppendShellResetMessage('');
  }
}
```

`resetCwdIfOutsideProject()` 的逻辑：
- 如果 `shouldMaintainProjectWorkingDir()` 为 true（项目目录锁定模式），始终重置到原始目录
- 如果 cwd 跑到允许的工作路径之外，重置到原始目录
- 子Agent（非主线程）通过 `preventCwdChanges = true` 完全禁止更改工作目录

---

## 三、超时控制和 AbortSignal 取消

### 3.1 超时配置

```typescript
// timeouts.ts
const DEFAULT_TIMEOUT_MS = 120_000   // 2 分钟
const MAX_TIMEOUT_MS = 600_000       // 10 分钟

// 支持环境变量覆盖
export function getDefaultBashTimeoutMs(env = process.env): number {
  const envValue = env.BASH_DEFAULT_TIMEOUT_MS
  if (envValue) { /* 解析环境变量 */ }
  return DEFAULT_TIMEOUT_MS
}
```

工具输入 schema 中的超时定义：
```typescript
timeout: semanticNumber(z.number().optional())
  .describe(`Optional timeout in milliseconds (max ${getMaxTimeoutMs()})`)
```

### 3.2 超时处理流程

在 `runShellCommand()` 中：

```typescript
const timeoutMs = timeout || getDefaultTimeoutMs();  // 使用传入或默认超时

const shellCommand = await exec(command, abortController.signal, 'bash', {
  timeout: timeoutMs,
  shouldAutoBackground,
  // ...
});

// 注册超时回调：超时后自动后台化（而非直接杀死进程）
if (shellCommand.onTimeout && shouldAutoBackground) {
  shellCommand.onTimeout(backgroundFn => {
    startBackgrounding('tengu_bash_command_timeout_backgrounded', backgroundFn);
  });
}
```

**关键设计**：超时不直接杀进程，而是将命令自动移到后台继续运行。这避免了长时间命令（如构建）的输出丢失。

### 3.3 AbortSignal 中断

中断通过 `abortController.signal` 传递到 `exec()` 内部的 `wrapSpawn()`：

- 当用户按 Ctrl+C 时，REPL 层面的 `abortController.abort('interrupt')` 触发
- `wrapSpawn()` 检测到 signal 后，对子进程树执行 `tree-kill`（杀掉整个进程组）
- 返回 `interrupted: true` 标记

### 3.4 后台任务机制

BashTool 支持三种后台化方式：

1. **显式后台化**：`run_in_background: true` 参数
2. **超时自动后台化**：超时触发后自动转入后台
3. **Assistant 模式自动后台化**：Kairos 模式下，阻塞超过 15 秒自动后台化

```typescript
// Assistant 模式自动后台化
if (feature('KAIROS') && getKairosActive() && isMainThread) {
  setTimeout(() => {
    if (shellCommand.status === 'running' && backgroundShellId === undefined) {
      assistantAutoBackgrounded = true;
      startBackgrounding('tengu_bash_command_assistant_auto_backgrounded');
    }
  }, ASSISTANT_BLOCKING_BUDGET_MS).unref();  // 15秒
}
```

`sleep` 命令不允许自动后台化，会被 `DISALLOWED_AUTO_BACKGROUND_COMMANDS` 过滤。

---

## 四、输出捕获与处理

### 4.1 输出捕获方式

```typescript
// 两种模式：
// 1. 文件模式（默认）：stdout+stderr 写入同一个文件 fd（O_APPEND 保证原子交织）
// 2. 管道模式（onStdout 回调存在时）：通过 pipe 实时回调

const taskOutput = new TaskOutput(taskId, onProgress ?? null, !usePipeMode)

// 文件模式下 stdio 配置
stdio: usePipeMode
  ? ['pipe', 'pipe', 'pipe']
  : ['pipe', outputHandle?.fd, outputHandle?.fd]  // stdout/stderr 共享同一 fd
```

### 4.2 输出截断策略

```typescript
// utils.ts 中的 formatOutput()
export function formatOutput(content: string): {
  totalLines: number;
  truncatedContent: string;
  isImage?: boolean;
} {
  const maxOutputLength = getMaxOutputLength();
  if (content.length <= maxOutputLength) {
    return { totalLines, truncatedContent: content };
  }
  const truncatedPart = content.slice(0, maxOutputLength);
  const remainingLines = countCharInString(content, '\n', maxOutputLength) + 1;
  return {
    totalLines,
    truncatedContent: `${truncatedPart}\n\n... [${remainingLines} lines truncated] ...`
  };
}
```

### 4.3 大输出持久化

当输出文件超过 `getMaxOutputLength()` 时：
1. 复制输出文件到 `tool-results` 目录
2. 超过 64MB 时截断文件
3. 通过 `persistedOutputPath` 传给 LLM，使用 `<persisted-output>` 标签包装

### 4.4 图片输出检测

```typescript
// 检测 data URI 格式的图片输出
export function isImageOutput(content: string): boolean {
  return /^data:image\/[a-z0-9.+_-]+;base64,/i.test(content);
}
```

如果输出是图片，会：
- 检测 data URI 并解析
- 调用 `maybeResizeAndDownsampleImageBuffer()` 压缩
- 以 `image` content block 形式返回给 API（而非文本）

---

## 五、安全检查体系

### 5.1 安全检查架构

BashTool 的安全检查分为多层：

```
Layer 1: bashSecurity.ts — 命令级安全验证（验证器链）
  ├── 早期验证器（可短路 allow）
  │   ├── validateEmpty                      # 空命令
  │   ├── validateIncompleteCommands         # 不完整命令（tab开头、flag开头）
  │   ├── validateSafeCommandSubstitution     # 安全heredoc替换 $(cat <<'EOF'...EOF)
  │   └── validateGitCommit                  # 简单git commit直接放行
  │
  └── 主验证器链（顺序执行）
      ├── validateJqCommand                  # jq system() 阻断
      ├── validateObfuscatedFlags            # 混淆flag检测
      ├── validateShellMetacharacters        # shell元字符检测
      ├── validateDangerousVariables         # 危险变量上下文检测
      ├── validateCommentQuoteDesync         # 注释-引号去同步攻击
      ├── validateQuotedNewline              # 引号内换行符注入
      ├── validateCarriageReturn             # 回车符误解析攻击
      ├── validateNewlines                   # 换行符命令分隔
      ├── validateIFSInjection               # IFS变量注入
      ├── validateProcEnvironAccess          # /proc/*/environ 读取
      ├── validateDangerousPatterns          # 命令替换($()、反引号等)
      ├── validateRedirections               # 输入/输出重定向
      ├── validateBackslashEscapedWhitespace # 反斜杠转义空白
      ├── validateBackslashEscapedOperators  # 反斜杠转义操作符
      ├── validateUnicodeWhitespace          # Unicode空白字符
      ├── validateMidWordHash                # 词中#号注入
      ├── validateBraceExpansion             # 大括号展开
      ├── validateZshDangerousCommands       # Zsh危险命令
      └── validateMalformedTokenInjection    # 畸形token注入

Layer 2: bashCommandHelpers.ts — 复合命令分段检查
  ├── 管道分段：每个管道段独立检查权限
  ├── 复合命令：子shell / 命令组阻断
  └── cd+git 跨段检测：防止 bare repo 攻击

Layer 3: pathValidation.ts — 路径级权限检查
Layer 4: readOnlyValidation.ts — 只读约束检查
Layer 5: bashPermissions.ts — 规则匹配引擎
Layer 6: shouldUseSandbox.ts — 沙箱决策
Layer 7: destructiveCommandWarning.ts — 危险命令警告（信息性，不影响权限）
```

### 5.2 关键安全验证器详解

#### 5.2.1 validateSafeCommandSubstitution — 安全 heredoc 检测

这是唯一的"早期允许"路径。当命令是严格的 `$(cat <<'DELIM'...DELIM)` 形式时直接放行。

安全条件极其严格：
- 分隔符必须单引号包裹或反斜杠转义（确保 heredoc body 是字面文本）
- 关闭分隔符必须独占一行（精确匹配 bash 行为）
- `$()` 必须在参数位置（前面有命令词），不能是命令名位置
- 剩余文本只允许 `[a-zA-Z0-9 \t"'.\-/_@=,:+~]` 字符
- 嵌套匹配直接拒绝
- 剩余文本必须通过所有其他安全验证器

#### 5.2.2 validateGitCommit — git commit 快速放行

对简单的 `git commit -m "message"` 形式快速放行：

```typescript
// 匹配：git commit [flags] -m "quoted message"
const messageMatch = originalCommand.match(
  /^git[ \t]+commit[ \t]+[^;&|`$<>()\n\r]*?-m[ \t]+(["'])([\s\S]*?)\1(.*)$/
)
```

安全检查：
- 不允许反斜杠（防止引号边界混淆）
- commit message 中不允许 `$()`、反引号、`${}`（命令替换）
- 剩余部分不允许 shell 操作符
- 未引用的 `<>` 重定向检测
- 以 dash 开头的 message 阻断

#### 5.2.3 validateObfuscatedFlags — 混淆检测

这是最复杂的验证器之一，检测多种 flag 混淆技术：

1. **ANSI-C 引用** `$'...'`：可编码任意字符
2. **Locale 引用** `$"..."`：同样可使用转义序列
3. **空引号+dash**：`''-flag`、`""-flag`
4. **引号链拼接**：`"-""exec"` 在 bash 中连接为 `-exec`
5. **齐次空引号对**：`"""-f"` 绕过其他检查
6. **词首三引号**：`"""x"file` 混淆

逐字符扫描引擎跟踪引号状态，检测引号内的 dash 字符。

#### 5.2.4 validateZshDangerousCommands — Zsh 特有攻击

Zsh 有许多独特的攻击向量，通过黑名单阻断：

```typescript
const ZSH_DANGEROUS_COMMANDS = new Set([
  'zmodload',   // 模块加载网关
  'emulate',    // eval 等价物
  'sysopen',    // 精细文件控制 (zsh/system)
  'sysread', 'syswrite', 'sysseek',
  'zpty',       // 伪终端命令执行 (zsh/zpty)
  'ztcp',       // TCP连接数据外泄 (zsh/net/tcp)
  'zsocket',    // Unix/TCP socket
  'zf_rm', 'zf_mv', 'zf_ln',  // zsh/files 内建命令绕过二进制检查
  'zf_chmod', 'zf_chown', 'zf_mkdir', 'zf_rmdir', 'zf_chgrp',
])
```

### 5.3 验证器链执行逻辑

验证器链有两种类型，执行逻辑不同：

1. **早期验证器**（earlyValidators）：任何返回 `allow` 的验证器直接短路放行
2. **主验证器**（validators）：顺序执行，区分"误解析"和"非误解析"两类

**关键设计**：非误解析验证器（如 `validateNewlines`、`validateRedirections`）返回 `ask` 时不会短路，而是推迟（deferred），继续执行后续的误解析验证器。如果后续有误解析验证器触发，优先返回带 `isBashSecurityCheckForMisparsing` 标记的结果。只有所有误解析验证器都通过后，才返回推迟的非误解析结果。

```typescript
let deferredNonMisparsingResult: PermissionResult | null = null
for (const validator of validators) {
  const result = validator(context)
  if (result.behavior === 'ask') {
    if (nonMisparsingValidators.has(validator)) {
      if (deferredNonMisparsingResult === null) {
        deferredNonMisparsingResult = result  // 推迟
      }
      continue  // 不短路，继续执行
    }
    return { ...result, isBashSecurityCheckForMisparsing: true }  // 误解析直接返回
  }
}
if (deferredNonMisparsingResult !== null) {
  return deferredNonMisparsingResult  // 最后返回推迟的结果
}
```

### 5.4 Tree-sitter 集成

Claude Code 使用 Tree-sitter 进行 shell 语法解析，提供比正则更精确的 AST 分析：

```typescript
export async function bashCommandIsSafeAsync_DEPRECATED(
  command: string,
): Promise<PermissionResult> {
  const parsed = await ParsedCommand.parse(command)
  const tsAnalysis = parsed?.getTreeSitterAnalysis() ?? null
  // 使用 tree-sitter 增强的上下文信息进行安全检查
  // ...
}
```

Tree-sitter 提供的分析能力包括：
- 子 shell 检测（`(cmd)` 形式）
- 命令组检测（`{ cmd; }` 形式）
- 精确的引号状态跟踪
- 管道分段
- 重定向解析

---

## 六、命令语义分析

### 6.1 退出码语义解释

`commandSemantics.ts` 实现了命令特定的退出码解释：

```typescript
const COMMAND_SEMANTICS: Map<string, CommandSemantic> = new Map([
  // grep: 0=匹配, 1=无匹配, 2+=错误
  ['grep', (exitCode) => ({ isError: exitCode >= 2, message: exitCode === 1 ? 'No matches found' : undefined })],
  ['rg',   /* 同 grep */],
  // find: 0=成功, 1=部分成功, 2+=错误
  ['find', (exitCode) => ({ isError: exitCode >= 2 })],
  // diff: 0=相同, 1=不同, 2+=错误
  ['diff', (exitCode) => ({ isError: exitCode >= 2 })],
  // test/[: 0=真, 1=假, 2+=错误
  ['test', (exitCode) => ({ isError: exitCode >= 2 })],
])
```

**设计意义**：防止 LLM 误判非零退出码为错误。例如 `grep` 返回 1（无匹配）不是错误，不应触发错误处理。

### 6.2 sed 编辑检测与模拟

`sedEditParser.ts` 解析 `sed -i 's/pattern/replacement/flags' file` 形式的命令：

**安全措施**：
- 只支持 `s/pattern/replacement/flags` 替换命令
- 只支持 `/` 作为分隔符
- flags 限制为 `[gpimIM1-9]`
- 不支持 glob 参数、多文件

**模拟执行**：当用户批准 sed 编辑时，不实际运行 sed，而是：
1. 解析 sed 命令提取 pattern/replacement/file
2. 读取文件内容
3. 在 JavaScript 中执行正则替换（包括 BRE 到 ERE 的转换）
4. 直接写入新内容

```typescript
// BashTool.tsx 中的 applySedEdit()
async function applySedEdit(simulatedEdit, toolUseContext, parentMessage) {
  const absoluteFilePath = expandPath(filePath);
  const originalContent = await fs.readFile(absoluteFilePath, { encoding });
  // 写入新内容（保留原始编码和行尾符）
  writeTextContent(absoluteFilePath, newContent, encoding, endings);
  // 通知 VS Code 文件更新
  notifyVscodeFileUpdated(absoluteFilePath, originalContent, newContent);
}
```

**为什么模拟执行**：确保用户在权限预览中看到的内容与实际写入完全一致。如果实际运行 sed，不同的 sed 实现（GNU vs BSD）可能产生不同结果。

### 6.3 命令分类（UI 折叠）

BashTool 对命令进行语义分类，决定 UI 中的折叠显示：

```typescript
// 搜索命令 — 可折叠
const BASH_SEARCH_COMMANDS = new Set(['find', 'grep', 'rg', 'ag', 'ack', 'locate', 'which', 'whereis']);

// 读取命令 — 可折叠
const BASH_READ_COMMANDS = new Set(['cat', 'head', 'tail', 'less', 'more', 'wc', 'stat', 'file', 'strings', 'jq', 'awk', 'cut', 'sort', 'uniq', 'tr']);

// 目录列表命令 — 可折叠
const BASH_LIST_COMMANDS = new Set(['ls', 'tree', 'du']);

// 静默命令 — 显示 "Done" 而非 "(No output)"
const BASH_SILENT_COMMANDS = new Set(['mv', 'cp', 'rm', 'mkdir', 'rmdir', 'chmod', 'chown', 'touch', 'ln', 'cd', 'export', 'unset', 'wait']);

// 语义中性命令 — 不影响管道分类
const BASH_SEMANTIC_NEUTRAL_COMMANDS = new Set(['echo', 'printf', 'true', 'false', ':']);
```

对于复合命令，所有非中性部分必须是同一类别才会折叠。

---

## 七、沙箱系统

### 7.1 沙箱决策流程

```typescript
export function shouldUseSandbox(input: Partial<SandboxInput>): boolean {
  // 1. 全局开关检查
  if (!SandboxManager.isSandboxingEnabled()) return false;

  // 2. 显式禁用检查（需要策略允许）
  if (input.dangerouslyDisableSandbox && SandboxManager.areUnsandboxedCommandsAllowed())
    return false;

  // 3. 排除命令检查（用户配置 + 动态配置）
  if (containsExcludedCommand(input.command)) return false;

  return true;
}
```

### 7.2 排除命令匹配

`containsExcludedCommand()` 对复合命令（`&&` 连接的）逐一检查每个子命令。支持三种匹配模式：
- **前缀匹配**：`bazel:*` 匹配 `bazel run`、`bazel test`
- **精确匹配**：`npm run lint` 只匹配完全相同的命令
- **通配符匹配**：使用 `matchWildcardPattern()` 函数

还会迭代剥离环境变量前缀和包装命令（如 `timeout 30 bazel run`），直到不动点。

---

## 八、工具提示词（prompt.ts）

### 8.1 工具描述结构

`getSimplePrompt()` 生成的提示词包含：

1. **基本描述**：执行 bash 命令并返回输出
2. **工作目录说明**：cwd 在命令间持久化，但 shell 状态不持久化
3. **工具偏好引导**：引导 LLM 使用专用工具（Grep/Glob/Read/Edit/Write）而非 bash 命令
4. **使用说明**：
   - 创建文件前先 `ls` 验证目录存在
   - 路径含空格时使用双引号
   - 使用绝对路径维持工作目录
   - 超时设置（默认2分钟，最大10分钟）
   - 后台执行（`run_in_background`）
   - 多命令规则（独立并行，依赖串行 `&&`，不关心失败用 `;`）
   - Git 安全协议
   - 避免 `sleep`
5. **Sandbox 说明**：沙箱限制详情
6. **Git 操作指南**：commit 和 PR 创建的详细步骤

### 8.2 工具偏好设计

提示词明确引导 LLM 不使用 bash 内建命令：

```
File search: Use Glob (NOT find or ls)
Content search: Use Grep (NOT grep or rg)
Read files: Use FileReadTool (NOT cat/head/tail)
Edit files: Use FileEditTool (NOT sed/awk)
Write files: Use FileWriteTool (NOT echo >/cat <<EOF)
Communication: Output text directly (NOT echo/printf)
```

**设计原因**：专用工具提供更好的用户体验（权限控制更精细、输出格式化更好、UI 折叠更友好）。

---

## 九、输入 Schema 设计

### 9.1 参数定义

```typescript
const fullInputSchema = lazySchema(() => z.strictObject({
  command: z.string().describe('The command to execute'),
  timeout: semanticNumber(z.number().optional())
    .describe(`Optional timeout in milliseconds (max ${getMaxTimeoutMs()})`),
  description: z.string().optional()
    .describe('Clear, concise description of what this command does...'),
  run_in_background: semanticBoolean(z.boolean().optional())
    .describe('Set to true to run this command in the background...'),
  dangerouslyDisableSandbox: semanticBoolean(z.boolean().optional())
    .describe('Set this to true to dangerously override sandbox mode...'),
  _simulatedSedEdit: z.object({ filePath: z.string(), newContent: z.string() }).optional()
    .describe('Internal: pre-computed sed edit result from preview')
}));
```

**关键设计**：
- `_simulatedSedEdit` 是内部字段，从模型可见 schema 中移除，防止 LLM 绕过权限检查
- `run_in_background` 可通过环境变量 `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` 禁用
- `description` 字段帮助用户理解工具调用的目的（显示在 UI 中）
- `semanticNumber`/`semanticBoolean` 包装器确保类型安全

### 9.2 输出 Schema

```typescript
const outputSchema = lazySchema(() => z.object({
  stdout: z.string(),
  stderr: z.string(),
  rawOutputPath: z.string().optional(),
  interrupted: z.boolean(),
  isImage: z.boolean().optional(),
  backgroundTaskId: z.string().optional(),
  backgroundedByUser: z.boolean().optional(),
  assistantAutoBackgrounded: z.boolean().optional(),
  dangerouslyDisableSandbox: z.boolean().optional(),
  returnCodeInterpretation: z.string().optional(),
  noOutputExpected: z.boolean().optional(),
  structuredContent: z.array(z.any()).optional(),
  persistedOutputPath: z.string().optional(),
  persistedOutputSize: z.number().optional(),
}));
```

---

## 十、危险命令警告

`destructiveCommandWarning.ts` 提供纯信息性的危险模式检测：

| 类别 | 模式 | 警告 |
|------|------|------|
| Git 数据丢失 | `git reset --hard` | may discard uncommitted changes |
| Git 强推 | `git push --force` | may overwrite remote history |
| Git 清理 | `git clean -f` | may permanently delete untracked files |
| Git 签出 | `git checkout .` | may discard all working tree changes |
| Git 绕过 | `--no-verify` | may skip safety hooks |
| Git 修改 | `--amend` | may rewrite the last commit |
| 文件删除 | `rm -rf` | may recursively force-remove files |
| 数据库 | `DROP TABLE` | may drop or truncate database objects |
| K8s | `kubectl delete` | may delete Kubernetes resources |
| Terraform | `terraform destroy` | may destroy Terraform infrastructure |

---

## 十一、关键设计决策总结

### 11.1 为什么每次命令都创建新进程

**权衡**：持久化 Shell（如 PersistentShell）可以保持环境变量和 Shell 状态，但：
- 安全风险更高（状态累积可能导致意外行为）
- 实现复杂度更高（需要管理 Shell 生命周期、超时、中断）
- 调试更困难（不可预测的环境状态）

**Claude Code 的选择**：每次新进程 + cwd 通过临时文件持久化。简单、安全、可预测。

### 11.2 为什么 sed 编辑要模拟执行

确保用户预览与实际写入一致。不同平台的 sed 行为差异（GNU vs BSD/macOS）会导致预览与实际结果不一致。

### 11.3 安全验证器链的两级延迟策略

误解析攻击（如 CR 注入、控制字符）比普通重定向更危险，因此误解析验证器优先级更高。非误解析结果被推迟，确保不会被忽略。

### 11.4 stdout/stderr 合并到同一文件

使用 `O_APPEND` 标志打开文件，stdout 和 stderr 共享同一个 fd。在 POSIX 上 O_APPEND 保证每次 write 原子（seek-to-end + write），实现时间顺序正确的交织输出。

---

## 十二、对我们实现的启示

### 12.1 核心架构选择

1. **使用 spawn 而非持久化 Shell**：更简单、更安全，适合 CLI Agent 场景
2. **cwd 通过临时文件持久化**：在命令末尾追加 `pwd -P >| tempfile`，完成后读取
3. **输出写文件而非管道**：O_APPEND 保证交织，避免 pipe buffer 问题

### 12.2 安全模型

1. **分层验证**：先快速放行安全模式，再深度检查可疑模式
2. **误解析优先**：将 shell 解析差异攻击的检测放在最高优先级
3. **最小权限**：默认超时 2 分钟，最大 10 分钟
4. **沙箱可选**：通过 SandboxManager 提供进程级隔离

### 12.3 LLM 体验优化

1. **语义退出码**：避免 LLM 误判非零退出码
2. **工具偏好引导**：提示词引导 LLM 使用专用工具
3. **后台任务**：超时不杀进程，自动转后台
4. **输出截断**：大输出持久化到文件，预览 + 指引 LLM 用 Read 工具读取

### 12.4 值得注意的实现细节

- `lazySchema()` 延迟 schema 初始化，避免模块加载时执行配置读取
- `semanticNumber`/`semanticBoolean` 提供类型安全的 schema 包装
- 引号状态跟踪在多个验证器中重复实现（`extractQuotedContent`、`validateObfuscatedFlags`、`validateCarriageReturn` 各有独立的状态机）
- `_simulatedSedEdit` 内部字段防止 LLM 绕过权限
