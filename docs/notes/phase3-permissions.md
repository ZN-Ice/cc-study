# Phase 3: 权限系统源码研读笔记

> 研读日期: 2026-04-19
> 参考源码: `free-code/src/permissions.ts`, `free-code/src/hooks/useCanUseTool.tsx`

---

## 一、权限模式 (PermissionMode)

### 1.1 外部模式（用户可设置）

| 模式 | 说明 |
|------|------|
| `default` | 标准权限检查，需要用户确认 |
| `bypassPermissions` | 绕过所有权限检查（危险，--dangerously-skip-permissions） |
| `plan` | 计划模式，只读操作自动通过 |
| `dontAsk` | 拒绝所有需要权限的操作，不提示用户 |
| `acceptEdits` | 自动允许文件编辑操作 |

### 1.2 内部模式

| 模式 | 说明 |
|------|------|
| `auto` | AI 分类器自动决策（需 TRANSCRIPT_CLASSIFIER 功能） |
| `bubble` | 子 Agent 权限冒泡 |

---

## 二、权限规则 (PermissionRule)

### 2.1 规则结构

```typescript
type PermissionRule = {
  source: PermissionRuleSource      // 规则来源
  ruleBehavior: PermissionBehavior  // allow / deny / ask
  ruleValue: {
    toolName: string                // 工具名（如 "Bash", "Read"）
    ruleContent?: string           // 内容匹配（如 "npm publish:*", "*.md"）
  }
}
```

### 2.2 规则来源优先级（从高到低）

```
policySettings → flagSettings → cliArg → command → session → localSettings → projectSettings → userSettings
```

- `policySettings` / `flagSettings`: 只读，管理员设定
- `cliArg`: 命令行 `--allowedTools` 参数
- `session`: 本次会话临时规则（"Always allow" 选项产生）
- `localSettings`: `.claude/settings.local.json`
- `projectSettings`: `.claude/settings.json`
- `userSettings`: `~/.claude/settings.json`

### 2.3 规则字符串格式

```
"Bash"                     → 匹配整个 Bash 工具
"Bash(npm install*)"       → Bash 工具中 npm install 开头的命令
"Read(*.md)"               → Read 工具中 .md 后缀文件
"Write(/etc/*)"            → Write 工具中 /etc/ 目录下文件
"mcp__server1"             → MCP server1 的所有工具
```

---

## 三、权限检查核心流程

### 3.1 hasPermissionsToUseTool 决策链

```
工具调用请求
    │
    ├─ 1a. getDenyRuleForTool → 整个工具被拒绝 → deny
    ├─ 1b. getAskRuleForTool  → 整个工具需询问 → ask
    ├─ 1c. tool.checkPermissions() → 工具特定检查
    │     ├─ behavior='deny' → deny
    │     ├─ requiresUserInteraction → ask (即使 bypass)
    │     └─ safetyCheck → ask (bypass 免疫)
    ├─ 2a. bypassPermissions 模式 → allow (跳过)
    ├─ 2b. toolAlwaysAllowedRule → allow
    └─ 默认 → ask
```

### 3.2 关键设计原则

1. **安全检查绕过免疫**: .git/、.claude/、shell 配置等敏感操作，即使 bypassPermissions 也需要确认
2. **deny 优先于 allow**: 拒绝规则始终优先检查
3. **工具可实现 checkPermissions**: 每个工具有自定义的权限逻辑
4. **isSearchOrReadCommand**: 区分只读/写入操作，影响 UI 折叠和权限策略

---

## 四、Tool 接口的权限扩展

### 4.1 checkPermissions 方法

```typescript
interface Tool {
  checkPermissions?(
    input: ParsedInput,
    context: ToolUseContext
  ): Promise<PermissionResult>
}
```

- BashTool: 检查危险命令、沙盒规则、命令前缀匹配
- FileReadTool: 检查受保护命名空间、路径特定规则
- FileEditTool/FileWriteTool: 检查文件路径权限

### 4.2 isSearchOrReadCommand 方法

```typescript
interface Tool {
  isSearchOrReadCommand?(input): {
    isSearch: boolean
    isRead: boolean
    isList?: boolean
  }
}
```

工具实现示例:
- GrepTool: `{ isSearch: true, isRead: false }`
- FileReadTool: `{ isSearch: false, isRead: true }`
- BashTool: 根据 command 内容判断（grep/rg → search, cat/less → read）
- FileWriteTool/FileEditTool: `{ isSearch: false, isRead: false }`

---

## 五、权限更新与持久化

### 5.1 PermissionUpdate 类型

```typescript
type PermissionUpdate =
  | { type: 'addRules'; destination; rules; behavior }
  | { type: 'replaceRules'; destination; rules; behavior }
  | { type: 'removeRules'; destination; rules; behavior }
  | { type: 'setMode'; destination; mode }
```

### 5.2 持久化目标

| 目标 | 路径 | 作用域 |
|------|------|--------|
| userSettings | ~/.claude/settings.json | 全局 |
| projectSettings | ./.claude/settings.json | 项目 |
| localSettings | ./.claude/settings.local.json | 本地 |
| session | 仅内存 | 会话 |

### 5.3 用户选择 "Always allow" 时

1. 创建 `addRules` 更新，behavior='allow'
2. 根据路径确定 destination（项目内 → projectSettings，否则 → userSettings）
3. 写入 settings.json
4. 更新内存中的 ToolPermissionContext

---

## 六、用户交互（ask 模式）

### 6.1 权限确认选项

- **Yes**: 仅本次允许
- **Always allow**: 创建持久化允许规则
- **No**: 拒绝本次操作

### 6.2 不同工具的权限对话框

| 工具 | 对话框组件 |
|------|-----------|
| BashTool | BashPermissionRequest |
| FileEditTool | FileEditPermissionRequest |
| FileWriteTool | FileWritePermissionRequest |
| FileReadTool/GlobTool/GrepTool | FilesystemPermissionRequest |

---

## 七、cc-study 简化设计要点

与 Claude Code 源码的差异:
1. 不实现 auto 模式（AI 分类器太复杂）
2. 不实现 sandbox 机制
3. 简化规则来源（仅 session/project/user 三级）
4. 简化权限对话框（统一为 Yes/Always/No）
5. 保留核心: checkPermissions 方法、规则匹配、持久化
