# Phase 0 学习笔记：CLI 入口与启动链

> 研读日期：2026-04-03
> 源码参考：`free-code/src/entrypoints/cli.tsx`

## 1. 启动链路

```
bin (claude)
  └── entrypoints/cli.tsx       # 快速路径判断
      └── main.tsx              # Commander.js 参数解析 + init()
          ├── init.ts           # 配置加载、认证、MCP连接
          └── replLauncher.tsx  # Ink render(App → REPL)
              └── screens/REPL.tsx  # 主交互界面
```

## 2. 关键发现

### 2.1 快速路径优化
- `--version`、`--daemon` 等命令在 cli.tsx 中直接处理，跳过重型初始化
- 使用 `bun:bundle` 的 `feature()` 做死代码消除

### 2.2 参数解析
- 使用 **Commander.js**（`@commander-js/extra-typings`）
- `preAction` Hook 统一执行初始化
- 关键选项：`--model`、`--resume`、`--mcp-config`、`--allowedTools`

### 2.3 Ink 渲染
- Ink v6.8.0 + React v19.2.4
- 组件树：`App → AppStateProvider → REPL`
- ThemeProvider 包裹根组件

### 2.4 系统提示词结构
- 静态部分（可缓存）：身份说明、工具使用指南、编码规范
- 动态部分（每次生成）：环境信息、工作目录、Git 状态、用户偏好
- 通过 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 标记分隔
- 工具描述独立于系统提示词，通过 API 的 `tools` 参数传入

## 3. 核心依赖

| 依赖 | 用途 |
|------|------|
| Ink (^6.8.0) | 终端 UI 框架 |
| React (^19.2.4) | UI 组件 |
| Commander.js (^14) | CLI 参数解析 |
| @anthropic-ai/sdk | API 客户端 |
| Chalk (^5) | 终端颜色 |

## 4. 设计决策

1. **快速路径优先**：常用命令（version/help）无需加载整个应用
2. **懒加载**：动态 import 减少启动时间
3. **缓存策略**：系统提示词静态部分全局缓存，动态部分每次请求重新生成
4. **模块化提示词**：各 section 独立函数，可按需组合
