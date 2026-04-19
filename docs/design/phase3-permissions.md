# Phase 3: 权限系统设计文档

> 版本: v1.0
> 日期: 2026-04-19
> 参考: `free-code/src/permissions.ts`, `free-code/src/hooks/useCanUseTool.tsx`

---

## 一、设计目标

1. 工具执行前进行权限检查
2. 支持交互式权限确认（Yes/Always/No）
3. 支持权限规则持久化（settings.json）
4. Tool 接口扩展 checkPermissions 方法
5. 覆盖率目标 80%+

---

## 二、类型定义

### 2.1 权限模式

```typescript
// src/permissions/types.ts

/** 权限行为（三态） */
type PermissionBehavior = 'allow' | 'deny' | 'ask';

/** 权限决策结果 */
type PermissionDecision = {
  behavior: PermissionBehavior;
  message?: string;
  updatedInput?: Record<string, unknown>;
};

/** 权限模式 */
type PermissionMode = 'default' | 'bypassPermissions' | 'plan';
```

### 2.2 权限规则

```typescript
/** 规则来源 */
type PermissionRuleSource =
  | 'userSettings'      // ~/.claude/settings.json
  | 'projectSettings'   // ./.claude/settings.json
  | 'session';          // 仅内存（"Always" 选项产生）

/** 规则值 */
interface PermissionRuleValue {
  toolName: string;           // 工具名（如 "Bash", "Read"）
  ruleContent?: string;       // 内容匹配（如 "npm install*", "*.md"）
}

/** 权限规则 */
interface PermissionRule {
  source: PermissionRuleSource;
  behavior: PermissionBehavior;
  value: PermissionRuleValue;
}
```

### 2.3 权限上下文

```typescript
/** 工具权限上下文（运行时状态） */
interface ToolPermissionContext {
  mode: PermissionMode;
  allowRules: PermissionRule[];
  denyRules: PermissionRule[];
  askRules: PermissionRule[];
}
```

### 2.4 Tool 接口扩展

```typescript
// 扩展 src/tools/types.ts 的 Tool 接口
interface Tool<T extends z.ZodType = z.ZodType> {
  // ... 现有字段 ...

  /** 权限检查（可选，默认 passthrough） */
  checkPermissions?(
    input: z.infer<T>,
    context: ToolContext,
    permContext: ToolPermissionContext,
  ): Promise<PermissionDecision>;

  /** 是否为只读/搜索操作 */
  isSearchOrReadCommand?(input: z.infer<T>): {
    isSearch: boolean;
    isRead: boolean;
  };
}
```

---

## 三、核心模块

### 3.1 模块结构

```
src/permissions/
├── types.ts           # 权限类型定义
├── manager.ts         # PermissionManager 权限管理器
├── rules.ts           # 规则匹配引擎
└── config.ts          # 配置文件读写
```

### 3.2 PermissionManager

```typescript
class PermissionManager {
  private context: ToolPermissionContext;

  constructor(mode?: PermissionMode);

  /** 核心权限检查入口 */
  async check(
    tool: Tool,
    input: Record<string, unknown>,
    toolContext: ToolContext,
  ): Promise<PermissionDecision>;

  /** 添加规则 */
  addRule(rule: PermissionRule): void;

  /** 从配置文件加载规则 */
  loadFromConfig(config: PermissionConfig): void;

  /** 获取当前上下文 */
  getContext(): ToolPermissionContext;
}
```

### 3.3 规则匹配引擎 (rules.ts)

```typescript
/** 检查工具是否匹配规则 */
function toolMatchesRule(toolName: string, rule: PermissionRule): boolean;

/** 检查内容是否匹配规则 */
function contentMatchesRule(content: string, rule: PermissionRule): boolean;

/** 获取工具的拒绝规则 */
function getDenyRuleForTool(
  context: ToolPermissionContext, toolName: string
): PermissionRule | null;

/** 获取工具的询问规则 */
function getAskRuleForTool(
  context: ToolPermissionContext, toolName: string
): PermissionRule | null;

/** 获取工具的允许规则 */
function getAllowRuleForTool(
  context: ToolPermissionContext, toolName: string
): PermissionRule | null;
```

---

## 四、权限检查流程

```
executeTool() 调用
    │
    ▼
PermissionManager.check(tool, input, context)
    │
    ├─ Step 1: deny 规则匹配 → deny
    ├─ Step 2: ask 规则匹配 → ask
    ├─ Step 3: tool.checkPermissions() → deny/ask/passthrough
    ├─ Step 4: bypassPermissions 模式 → allow
    ├─ Step 5: plan 模式 + isSearchOrReadCommand → allow
    ├─ Step 6: allow 规则匹配 → allow
    └─ Step 7: 默认 → ask
```

### 4.1 与 executeTool 的集成

```typescript
// 修改 src/tools/registry.ts 的 executeTool
export async function executeTool(
  registry: ToolRegistry,
  name: string,
  rawInput: Record<string, unknown>,
  context: ToolContext,
  permissionManager?: PermissionManager,
): Promise<ToolResult> {
  const tool = registry.get(name);
  // ... Zod parse + validateInput (不变) ...

  // ★ 新增: 权限检查（在 execute 之前）
  if (permissionManager) {
    const decision = await permissionManager.check(tool, rawInput, context);
    if (decision.behavior === 'deny') {
      return { output: decision.message ?? 'Permission denied', error: true };
    }
    if (decision.behavior === 'ask') {
      // 需要交互式确认（由上层 REPL 处理）
      return { output: 'Permission required', error: true };
    }
    // allow → 继续执行
    if (decision.updatedInput) {
      rawInput = { ...rawInput, ...decision.updatedInput };
    }
  }

  // Phase 3: execute
  return await tool.execute(parsed.data, context);
}
```

### 4.2 ask 模式的处理策略

由于权限确认需要用户交互（Ink UI），而 executeTool 是同步流程，我们采用以下策略:

1. `PermissionManager.check()` 返回 `ask` 决策
2. REPL 层（useStreamResponse）拦截 `ask` 决策
3. 显示权限确认 UI
4. 用户选择后，将决策（allow/deny）回传给工具执行

**简化方案（Phase 3 初版）**:
- `ask` 直接返回 deny，要求用户预先配置规则
- 后续 Phase 可以添加交互式 UI

---

## 五、规则匹配算法

### 5.1 工具名匹配

```typescript
function toolMatchesRule(toolName: string, rule: PermissionRule): boolean {
  // 1. 无 ruleContent → 匹配整个工具
  if (!rule.value.ruleContent) {
    return rule.value.toolName === toolName;
  }
  return false;
}
```

### 5.2 内容匹配（glob 模式）

```typescript
function contentMatchesRule(content: string, rule: PermissionRule): boolean {
  if (!rule.value.ruleContent) return false;

  // 支持 glob 匹配
  // "npm install*" → 匹配 "npm install xyz"
  // "*.md" → 匹配 "README.md"
  return minimatch(content, rule.value.ruleContent);
}
```

### 5.3 匹配优先级

```
deny 规则 > ask 规则 > tool.checkPermissions > allow 规则
```

---

## 六、配置文件格式

### 6.1 settings.json 示例

```json
{
  "permissions": {
    "mode": "default",
    "allow": [
      "Read",
      "Glob",
      "Grep",
      "Bash(git status*)",
      "Bash(npm test*)"
    ],
    "deny": [
      "Bash(rm -rf*)",
      "Bash(sudo*)"
    ],
    "ask": [
      "Bash",
      "Edit",
      "Write"
    ]
  }
}
```

---

## 七、isSearchOrReadCommand 实现

| 工具 | isSearch | isRead |
|------|----------|--------|
| FileReadTool | false | true |
| FileWriteTool | false | false |
| FileEditTool | false | false |
| BashTool | 动态判断 | 动态判断 |
| GlobTool | true | false |
| GrepTool | true | false |

BashTool 动态判断规则:
- `grep/rg/ag/ack` → isSearch=true
- `cat/less/more/head/tail` → isRead=true
- 其他 → isSearch=false, isRead=false

---

## 八、测试规划

### 8.1 单元测试 (tests/unit/permissions/)

| 测试文件 | 测试内容 | 用例数估计 |
|---------|---------|-----------|
| rules.test.ts | 规则匹配（工具名/内容/优先级） | 12 |
| manager.test.ts | 权限检查流程、模式切换 | 10 |
| config.test.ts | 配置文件读写、规则加载 | 5 |

### 8.2 关键测试场景

1. deny 规则优先于 allow 规则
2. bypassPermissions 模式跳过权限检查
3. plan 模式自动允许只读操作
4. 内容特定规则匹配（glob 模式）
5. 规则持久化（addRule → settings.json）
6. checkPermissions 方法拒绝危险操作
7. isSearchOrReadCommand 正确分类

---

## 九、与现有代码的集成点

### 9.1 src/tools/types.ts
- Tool 接口新增 `checkPermissions` 和 `isSearchOrReadCommand` 可选方法

### 9.2 src/tools/registry.ts
- `executeTool` 新增 `permissionManager` 可选参数
- 在 Zod parse 之后、execute 之前插入权限检查

### 9.3 src/components/App.tsx
- 创建 PermissionManager 实例
- 传递给 useStreamResponse

### 9.4 src/hooks/useStreamResponse.ts
- 处理 `ask` 决策（Phase 3 初版简化为 deny）
