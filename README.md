# cc-study

参考 Claude Code 源码，逐步从 0 到 1 复刻其核心特性，在每个阶段深入理解设计决策与实现原理。

## 项目结构

```
cc-study/
├── free-code/                 # 参考源码（.gitignore，不提交）
│   └── src/                   # Claude Code 完整源码
│       ├── entrypoints/       # CLI / MCP 入口
│       ├── screens/           # REPL 交互屏幕
│       ├── tools/             # 工具系统（Read/Write/Edit/Bash/Glob/Grep/Agent/MCP...）
│       ├── services/          # 核心服务（API/MCP/OAuth/通知）
│       ├── components/        # Ink 终端 UI 组件
│       ├── commands/          # 斜杠命令（/help, /compact, /config...）
│       ├── hooks/             # React Hooks
│       ├── utils/             # 工具函数（diff, shell, format, tokens...）
│       ├── constants/         # 常量（系统提示词、配置）
│       └── permissions.ts     # 权限系统
├── src/                       # 本项目源码（自己实现，逐步补全）
├── tests/                     # 测试目录
├── docs/                      # 学习笔记与设计文档
│   ├── notes/                 # 源码学习笔记
│   ├── design/                # 设计决策记录
│   └── task/                  # 任务记录
├── CLAUDE.md                  # 研发手册（核心规范）
└── README.md                  # 本文件
```

## 学习路线

| Phase | 目标 | 状态 |
|-------|------|------|
| Phase 0 | 项目骨架（CLI 入口、参数解析） | - |
| Phase 1 | REPL 交互循环（流式渲染、多轮对话） | - |
| Phase 2 | 工具系统（Read/Write/Edit/Bash/Glob/Grep） | - |
| Phase 3 | 权限系统（allow/deny/ask、规则引擎） | - |
| Phase 4 | Agent 子系统（并行任务、上下文隔离） | - |
| Phase 5 | MCP 集成（JSON-RPC、外部工具扩展） | - |
| Phase 6 | 高级特性（记忆、Hook、斜杠命令、会话恢复） | - |

## 技术栈

- **语言**：TypeScript
- **运行时**：Node.js (>=20)
- **终端 UI**：Ink (React for CLI)
- **测试**：Vitest
- **构建**：tsup / esbuild
- **包管理**：pnpm

## 开发流程

每个模块遵循 **源码研读 → 设计文档 → TDD 开发** 的学习驱动流程：

1. 阅读 `free-code/src/` 对应模块源码
2. 记录学习笔记到 `docs/notes/`
3. 编写设计文档到 `docs/design/`
4. TDD：先写测试（RED） → 最小实现（GREEN） → 重构优化（REFACTOR）
5. 对照源码比较设计差异，记录心得

详细规范见 [CLAUDE.md](./CLAUDE.md)。

## 快速开始

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 运行测试
pnpm test

# 完整检查
pnpm lint && pnpm typecheck && pnpm test
```

## License

Apache 2.0
