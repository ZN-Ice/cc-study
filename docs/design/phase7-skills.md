# Phase 7: Skills 系统设计文档

## 1. 源码研读摘要

### 1.1 Skills 加载与注册 (loadSkillsDir.ts)

**5 种 Skill 来源**（按加载优先级）：
1. **Managed** — `~/.claude/managed/.claude/skills/`（企业策略管控）
2. **User** — `~/.claude/skills/`（用户全局）
3. **Project** — `.claude/skills/`（项目级，向上遍历到 home）
4. **Additional** — `--add-dir` 指定的额外目录
5. **Legacy Commands** — `.claude/commands/`（向后兼容）
6. **Bundled** — 编程式注册（bundledSkills.ts）
7. **MCP** — MCP Server 提供的 skills

**目录格式**：仅支持 `skill-name/SKILL.md` 格式（skills 目录），legacy commands 也支持单 `.md` 文件。

**去重策略**：`realpath()` 解析符号链接获得 canonical path，Set 去重，first-wins。

**条件 Skills**：含 `paths` frontmatter 的 skill 存入 `conditionalSkills` Map，当文件操作匹配时激活。

**动态发现**：`discoverSkillDirsForPaths()` 从文件路径向上遍历找 `.claude/skills/`，gitignored 目录跳过。

### 1.2 SKILL.md Frontmatter 字段

```yaml
---
name: display-name           # 可选，覆盖目录名
description: xxx             # 描述
when_to_use: xxx             # 使用场景（LLM 可见）
allowed-tools: [Read, Bash]  # 该 skill 允许的工具列表
argument-hint: "<message>"   # 参数提示
arguments: [msg, files]      # 命名参数
model: sonnet                # 模型覆盖
effort: high                 # 努力等级
context: fork                # inline(默认) 或 fork(子 Agent)
agent: Bash                  # fork 时的 agent 类型
paths: ["src/**/*.ts"]       # 条件激活路径
user-invocable: true         # 用户可 /skill-name 调用
disable-model-invocation: false  # 禁止 LLM 自动调用
hooks:                       # skill 执行时注册的 hooks
  PreToolUse: [...]
shell: command               # shell 注入命令
---
```

### 1.3 createSkillCommand 工厂

将 frontmatter + markdown content 封装为 `Command` 对象（type: 'prompt'）：
- `getPromptForCommand(args, context)` → `[ContentBlockParam]`
  - 替换 `$ARGUMENTS` / `${CLAUDE_SKILL_DIR}` / `${CLAUDE_SESSION_ID}`
  - 执行 shell 命令注入（`!command` 语法）

### 1.4 SkillTool (tools/SkillTool/)

**核心功能**：让 LLM 能通过 `Skill` 工具主动调用 skills。

**validateInput 链**：
1. 格式检查（非空、去 `/` 前缀）
2. 命令存在性检查（getAllCommands → findCommand）
3. `disableModelInvocation` 检查
4. `type === 'prompt'` 检查

**checkPermissions 链**：
1. deny 规则匹配（精确 + 前缀通配 `skill:*`）
2. allow 规则匹配
3. 安全属性自动放行（`skillHasOnlySafeProperties`）
4. 默认 ask

**执行路径**：
- **Inline**（默认）：调用 `processPromptSlashCommand`，返回 `newMessages` + `contextModifier`
- **Fork**（context=fork）：`executeForkedSkill`，通过 `runAgent` 在子 Agent 中执行
- **Remote**（experimental）：从 AKI/GCS 加载 SKILL.md

### 1.5 prompt.ts 预算管理

- Skills 列表占上下文窗口的 **1%**（~8000 字符）
- Bundled skills 永远保留完整描述
- 其他 skills 描述按预算截断
- 每条描述上限 250 字符

### 1.6 Bundled Skills (bundledSkills.ts)

编程式注册接口 `BundledSkillDefinition`：
- `getPromptForCommand` 返回 skill prompt
- `files` 字段：首次调用时提取到磁盘（`getBundledSkillExtractDir`）
- `isEnabled()` 控制动态可见性

### 1.7 辅助系统

- **skillUsageTracking**：使用次数 + 时间戳，7 天半衰期指数衰减排序
- **skillChangeDetector**：chokidar 监听 skill 目录变更，防抖 300ms
- **registerSkillHooks**：skill 执行时注册 session-scoped hooks

---

## 2. cc-study 实现设计

### 2.1 模块划分

```
src/skills/
├── types.ts              # Skill 类型定义（扩展 PromptCommand）
├── parser.ts             # SKILL.md frontmatter 解析
├── loader.ts             # 多源目录扫描 + 去重
├── bundledRegistry.ts    # Bundled Skills 注册表
├── bundled/index.ts      # Bundled Skills 初始化
├── bundled/simplify.ts   # simplify skill
├── bundled/review.ts     # review skill
├── discovery.ts          # 动态发现 + 条件激活
├── usageTracking.ts      # 使用追踪
└── index.ts              # 统一导出

src/tools/SkillTool/
├── index.ts              # SkillTool 实现
├── prompt.ts             # Skill 列表 prompt（预算管理）
└── constants.ts          # 常量
```

### 2.2 接口设计

#### SkillFrontmatter

```typescript
interface SkillFrontmatter {
  name?: string
  description?: string
  when_to_use?: string
  allowed_tools?: string[]
  argument_hint?: string
  arguments?: string[]
  model?: string
  effort?: string
  context?: 'inline' | 'fork'
  agent?: string
  paths?: string[]
  user_invocable?: boolean
  disable_model_invocation?: boolean
  hooks?: HooksSettings
}
```

#### ParsedSkill

```typescript
interface ParsedSkill {
  name: string
  description: string
  whenToUse?: string
  allowedTools: string[]
  argumentHint?: string
  argumentNames: string[]
  model?: string
  effort?: string
  executionContext?: 'inline' | 'fork'
  agent?: string
  paths?: string[]
  userInvocable: boolean
  disableModelInvocation: boolean
  hooks?: HooksSettings
  content: string
  baseDir?: string
  source: SettingSource
}
```

#### BundledSkillDefinition

```typescript
interface BundledSkillDefinition {
  name: string
  description: string
  whenToUse?: string
  allowedTools?: string[]
  model?: string
  disableModelInvocation?: boolean
  userInvocable?: boolean
  isEnabled?: () => boolean
  getPromptForCommand(args: string): Promise<ContentBlockParam[]>
}
```

### 2.3 SkillTool 设计

继承现有 Tool 接口：

```typescript
const SkillTool: Tool = {
  name: 'Skill',
  description: 'Execute a named skill',
  inputSchema: z.object({
    skill: z.string().describe('Skill name'),
    args: z.string().optional().describe('Arguments'),
  }),

  validateInput({ skill }, context) {
    // 1. 非空检查
    // 2. 命令存在性
    // 3. disableModelInvocation 检查
  },

  checkPermissions({ skill }, context, permContext) {
    // 1. deny 规则
    // 2. allow 规则
    // 3. 安全属性自动放行
    // 4. 默认 ask
  },

  execute({ skill, args }, context) {
    // 1. findCommand
    // 2. 如果 context === 'fork'，走子 Agent
    // 3. 否则 inline：getPromptForCommand → 返回结果
  },
}
```

### 2.4 集成点

1. **commands/index.ts**：`getCommands()` 合并磁盘 skills + bundled skills
2. **tools/registry.ts**：注册 SkillTool
3. **hooks/useStreamResponse.ts**：支持 contextModifier（allowedTools/model 覆盖）
4. **components/PromptInput.tsx**：斜杠命令自动补全包含 skills

### 2.5 测试规划

| 测试文件 | 覆盖范围 | 用例数 |
|---------|---------|--------|
| parser.test.ts | frontmatter 解析（正常/异常/默认值） | ~15 |
| loader.test.ts | 多源加载、去重、条件 skills | ~10 |
| bundledRegistry.test.ts | 注册/获取/清空 | ~8 |
| skillTool.test.ts | validate/permissions/execute | ~15 |
| usageTracking.test.ts | 记录/排序/衰减 | ~8 |
| discovery.test.ts | 路径发现/条件激活 | ~8 |

**Mock 策略**：Mock fs 操作（使用临时目录），不依赖真实 skill 文件。

---

## 3. 设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| frontmatter 解析 | 自实现简易 YAML 解析 | 避免引入额外依赖，cc-study 只需支持核心字段 |
| 去重 | realpath + Set | 简化版，cc-study 不需要复杂的 symlink 场景 |
| 条件 Skills | ignore 库 glob 匹配 | 与 free-code 保持一致 |
| SkillTool 权限 | 复用 PermissionManager | 统一权限模型 |
| Bundled Skills | 简化版（无 files 提取） | cc-study 不需要磁盘提取功能 |
| 动态发现 | 简化版（无 chokidar） | 第一版不做文件监听，仅支持启动时加载 |
