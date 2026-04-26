# Phase 6 源码研读笔记：Hook 系统

> **任务**：P6005
> **日期**：2026-04-26
> **实现日期**：2026-04-26
> **源码路径**：`free-code/src/hooks/`

---

## 一、Hook 系统概述

Hook 系统提供**事件驱动的扩展机制**，允许在工具执行前后和停止时注入自定义逻辑。

### 1.1 三种 Hook 类型

```
Hook 系统
├── PreToolUseHook   → 工具执行前调用
├── PostToolUseHook  → 工具执行后调用
└── StopHook         → 收到停止信号时调用
```

### 1.2 典型使用场景

| Hook 类型 | 使用场景 |
|-----------|---------|
| PreToolUse | 权限检查、日志记录、参数验证、流量控制 |
| PostToolUse | 结果日志、使用量追踪、性能监控、错误上报 |
| Stop | 资源清理、状态持久化、优雅关闭 |

---

## 二、Hook 类型定义

### 2.1 基础 Hook 接口

```typescript
interface Hook {
  type: HookType
  name: string
  description?: string
  enabled?: boolean  // 默认 true
}
```

### 2.2 PreToolUseHook

```typescript
interface PreToolUseHook extends Hook {
  type: 'PreToolUse'
  beforeToolUse(
    toolName: string,
    input: unknown
  ): boolean | Promise<boolean>
}
```

**返回值意义**：
- `true` → 允许执行
- `false` → 阻止执行

### 2.3 PostToolUseHook

```typescript
interface PostToolUseHook extends Hook {
  type: 'PostToolUse'
  afterToolUse(
    toolName: string,
    input: unknown,
    result: ToolResult
  ): void | Promise<void>
}
```

**注意**：返回值为空，不影响执行流程。

### 2.4 StopHook

```typescript
interface StopHook extends Hook {
  type: 'Stop'
  onStop(): void | Promise<void>
}
```

---

## 三、HookRunner 执行器

### 3.1 核心实现

```typescript
class HookRunner {
  private readonly preToolUseHooks: PreToolUseHook[]
  private readonly postToolUseHooks: PostToolUseHook[]
  private readonly stopHooks: StopHook[]

  constructor(config: HookConfig) {
    this.preToolUseHooks = config.preToolUse ?? []
    this.postToolUseHooks = config.postToolUse ?? []
    this.stopHooks = config.stop ?? []
  }

  async runPreToolUseHooks(
    toolName: string,
    input: unknown
  ): Promise<boolean> {
    for (const hook of this.preToolUseHooks) {
      if (hook.enabled === false) continue

      const result = await Promise.resolve(
        hook.beforeToolUse(toolName, input)
      )

      if (result === false) return false  // 短路
    }
    return true
  }

  async runPostToolUseHooks(
    toolName: string,
    input: unknown,
    result: ToolResult
  ): Promise<void> {
    for (const hook of this.postToolUseHooks) {
      if (hook.enabled === false) continue

      try {
        await Promise.resolve(hook.afterToolUse(toolName, input, result))
      } catch (error) {
        console.error(`PostToolUse hook "${hook.name}" failed:`, error)
      }
    }
  }

  async runStopHooks(): Promise<void> {
    for (const hook of this.stopHooks) {
      if (hook.enabled === false) continue

      try {
        await Promise.resolve(hook.onStop())
      } catch (error) {
        console.error(`Stop hook "${hook.name}" failed:`, error)
      }
    }
  }
}
```

### 3.2 设计亮点

| 特性 | 实现方式 |
|------|---------|
| 短路逻辑 | PreToolUse 返回 false 时立即停止 |
| 错误隔离 | Post/Stop hook 错误捕获，不影响主流程 |
| 异步支持 | 所有方法返回 Promise |
| 禁用跳过 | `enabled === false` 时跳过执行 |

---

## 四、Hook 配置格式

### 4.1 settings.json 结构

```json
{
  "hooks": {
    "preToolUse": [
      {
        "name": "log-tool-use",
        "type": "PreToolUse",
        "enabled": true
      }
    ],
    "postToolUse": [
      {
        "name": "track-usage",
        "type": "PostToolUse",
        "enabled": true
      }
    ],
    "stop": [
      {
        "name": "cleanup",
        "type": "Stop",
        "enabled": true
      }
    ]
  }
}
```

### 4.2 配置加载

```typescript
interface HookSettings {
  hooks?: {
    preToolUse?: Array<{ name: string; enabled?: boolean }>
    postToolUse?: Array<{ name: string; enabled?: boolean }>
    stop?: Array<{ name: string; enabled?: boolean }>
  }
}

export async function loadHookConfigFromFile(
  filePath: string
): Promise<HookSettings> {
  const raw = await readFile(filePath, 'utf-8')
  const json = JSON.parse(raw)
  return json.hooks ?? {}
}
```

---

## 五、Hook 与工具系统的集成

### 5.1 集成点

```typescript
async function executeToolWithHooks(
  tool: Tool,
  params: Record<string, unknown>,
  context: ToolContext,
  hookRunner: HookRunner
): Promise<ToolResult> {
  // 1. Pre Hook
  const canProceed = await hookRunner.runPreToolUseHooks(tool.name, params)
  if (!canProceed) {
    return {
      output: `Tool "${tool.name}" blocked by PreToolUse hook`,
      error: true,
      metadata: { reason: 'hookRejected' }
    }
  }

  // 2. Execute
  const result = await tool.execute(params, context)

  // 3. Post Hook
  await hookRunner.runPostToolUseHooks(tool.name, params, result)

  return result
}
```

### 5.2 执行流程图

```
executeToolWithHooks(tool, params)
        │
        ▼
runPreToolUseHooks(tool.name, params)
        │
        ├── false → 返回错误，阻止执行
        │
        └── true → 继续
                    │
                    ▼
                  tool.execute(params, context)
                    │
                    ▼
          runPostToolUseHooks(tool.name, params, result)
                    │
                    ▼
                  返回 result
```

---

## 六、与 free-code 源码的差异

### 6.1 cc-study 实现 vs free-code 源码

| 方面 | free-code 源码 | cc-study 实现 |
|------|---------------|---------------|
| Hook 注册 | 程序化注册（JavaScript 对象） | 程序化注册 |
| 配置来源 | settings.json + 程序注册 | 仅程序注册 |
| 加载方式 | 多源合并（file + programmatic） | 仅文件加载 |
| hook 实现 | 外部模块化 | 内联 |

### 6.2 设计决策

**问题**：为什么 cc-study 采用较简单的实现？

**答案**：
1. Phase 6 是基础实现，不需要完整的模块化
2. Hook 配置通过程序注册更灵活
3. 保持最小化实现，符合 KISS 原则

---

## 七、已实现文件

```
src/hooks/
├── types.ts      # Hook 类型定义
├── config.ts    # 配置加载
├── runner.ts   # HookRunner 执行器
└── index.ts    # 导出
```

### 7.1 类型定义 (types.ts)

```typescript
export type HookType = 'PreToolUse' | 'PostToolUse' | 'Stop'

export interface PreToolUseHook extends Hook {
  type: 'PreToolUse'
  beforeToolUse(toolName: string, input: unknown): boolean | Promise<boolean>
}

export interface PostToolUseHook extends Hook {
  type: 'PostToolUse'
  afterToolUse(toolName: string, input: unknown, result: ToolResult): void | Promise<void>
}

export interface StopHook extends Hook {
  type: 'Stop'
  onStop(): void | Promise<void>
}

export interface HookConfig {
  preToolUse?: PreToolUseHook[]
  postToolUse?: PostToolUseHook[]
  stop?: StopHook[]
}
```

### 7.2 执行器 (runner.ts)

核心类 `HookRunner`，提供：
- `runPreToolUseHooks()` - 返回 boolean（短路）
- `runPostToolUseHooks()` - 无返回值，错误隔离
- `runStopHooks()` - 无返回值，错误隔离

---

## 八、使用示例

### 8.1 创建 Hook

```typescript
const loggingHook: PreToolUseHook = {
  type: 'PreToolUse',
  name: 'log-tool-use',
  enabled: true,
  async beforeToolUse(toolName, input) {
    console.log(`Tool ${toolName} is about to execute with input:`, input)
    return true  // Allow execution
  }
}

const trackingHook: PostToolUseHook = {
  type: 'PostToolUse',
  name: 'track-usage',
  async afterToolUse(toolName, input, result) {
    await analytics.track(toolName, result.output.length)
  }
}
```

### 8.2 注册 Hook

```typescript
const hookRunner = new HookRunner({
  preToolUse: [loggingHook],
  postToolUse: [trackingHook],
  stop: [cleanupHook],
})
```

### 8.3 在工具执行中使用

```typescript
const result = await executeToolWithHooks(
  tool,
  params,
  context,
  hookRunner
)
```

---

## 九、测试覆盖

### 9.1 测试用例

| 测试 | 描述 |
|------|------|
| PreToolUse 返回 true | 所有 hook 返回 true，工具正常执行 |
| PreToolUse 返回 false | 立即返回 false，阻止执行 |
| PreToolUse 禁用 | `enabled: false` 的 hook 被跳过 |
| PostToolUse 调用 | 所有启用的 hook 都被调用 |
| PostToolUse 错误 | 错误被捕获，不影响主流程 |
| StopHook 调用 | 所有启用的 hook 都被调用 |
| 异步 Hook | 支持 async hook 函数 |

---

**版本**：v1.0
**状态**：已完成实现
