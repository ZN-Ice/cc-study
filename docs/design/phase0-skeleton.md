# Phase 0 设计文档：项目骨架

> 日期：2026-04-03
> 源码参考：`free-code/src/entrypoints/cli.tsx`、`free-code/src/main.tsx`

## 1. 架构设计

```
cc-study/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts              # 主入口（bin 指向）
│   ├── cli.ts                # CLI 参数解析（Commander.js）
│   ├── screens/
│   │   └── REPL.tsx           # Ink REPL 空壳组件
│   ├── components/
│   │   └── App.tsx            # 根组件
│   └── constants/
│       └── version.ts         # 版本号常量
├── tests/
│   └── unit/
│       └── cli.test.ts        # CLI 参数测试
└── pnpm-lock.yaml
```

## 2. 启动流程

```
bin (cc-study)
  └── src/index.ts
      ├── 快速路径：--version → 输出版本号 → exit
      ├── 快速路径：--help → 输出帮助信息 → exit
      └── 默认路径：
          └── src/cli.ts
              └── parseArgs()
                  └── 启动 Ink 渲染
                      └── <App><REPL /></App>
```

## 3. 接口定义

### 3.1 CLI 参数

```typescript
interface CliOptions {
  version: boolean;       // --version, -v
  help: boolean;          // --help, -h
  model: string;          // --model (默认: claude-sonnet-4-6)
  debug: boolean;         // --debug
}
```

### 3.2 REPL 空壳组件

```typescript
// 最小 REPL：显示欢迎信息 + 等待输入提示
const REPL: React.FC = () => (
  <Box flexDirection="column">
    <Text color="green">cc-study v{VERSION}</Text>
    <Text dimColor>输入消息开始对话...</Text>
  </Box>
);
```

## 4. 核心依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| ink | ^4.x | 终端 UI（使用 v4 稳定版，非 v6 实验版） |
| react | ^18.x | UI 组件 |
| commander | ^12.x | CLI 参数解析 |
| chalk | ^5.x | 终端颜色 |
| typescript | ^5.x | 类型系统 |
| tsup | ^8.x | 构建工具 |
| vitest | ^2.x | 测试框架 |

> 注意：原版使用 Ink v6 + React 19，我们使用 Ink v4 + React 18 稳定版。

## 5. 测试用例规划

| 用例 | 描述 |
|------|------|
| --version | 输出版本号并退出 |
| --help | 输出帮助信息并退出 |
| --model | 解析 model 参数 |
| 无参数 | 默认启动 REPL |
| --debug | 启用调试模式 |
| 无效参数 | 显示错误提示 |

## 6. 构建配置

- **构建工具**：tsup（esbuild 上层）
- **输出格式**：ESM
- **bin 入口**：`dist/index.js`
- **开发命令**：`pnpm dev` → `tsx src/index.ts`
