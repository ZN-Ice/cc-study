# Phase 7: Skills 系统源码研读笔记

> **日期**: 2026-04-27
> **源码参考**: free-code/src/skills/, free-code/src/tools/SkillTool/, free-code/src/utils/suggestions/skillUsageTracking.ts

---

## 1. Skills 系统概述

Skills 是 Claude Code 的技能扩展机制，允许：
- **用户/项目级**: 通过 `~/.claude/skills/` 或 `.claude/skills/` 目录下的 SKILL.md 文件定义技能
- **内置级**: 通过 `registerBundledSkill()` 编程式注册技能
- **MCP 级**: 通过 MCP Server 提供的 skills

LLM 可以通过 `Skill` 工具主动调用技能，也可以通过斜杠命令 `/skill-name` 由用户触发。

---

## 2. 核心文件映射

| cc-study 文件 | 源码参考 | 功能 |
|--------------|----------|------|
| `src/skills/types.ts` | `free-code/src/types/command.ts` | SkillCommand 类型定义 |
| `src/skills/parser.ts` | `free-code/src/skills/loadSkillsDir.ts` | Frontmatter 解析 + createSkillCommand |
| `src/skills/loader.ts` | `free-code/src/skills/loadSkillsDir.ts` | 多源目录扫描 + 去重 |
| `src/skills/bundledRegistry.ts` | `free-code/src/skills/bundledSkills.ts` | Bundled Skill 注册 |
| `src/skills/bundled/*.ts` | `free-code/src/skills/bundled/*.ts` | 内置 skill 实现 |
| `src/skills/usageTracking.ts` | `free-code/src/utils/suggestions/skillUsageTracking.ts` | 使用追踪排序 |
| `src/tools/SkillTool/index.ts` | `free-code/src/tools/SkillTool/SkillTool.ts` | SkillTool 工具 |
| `src/tools/SkillTool/prompt.ts` | `free-code/src/tools/SkillTool/prompt.ts` | 预算管理 |

---

## 3. SKILL.md 格式规范

### 3.1 目录结构

```
skill-name/
└── SKILL.md     # 必须，技能定义文件
```

### 3.2 Frontmatter 字段

```yaml
---
name: display-name           # 可选，显示名称（默认用目录名）
description: xxx            # 描述（必填，LLM 可见）
when_to_use: xxx             # 使用场景（帮助 LLM 决策何时调用）
allowed_tools: [Read, Bash]  # 该 skill 允许的工具列表
argument_hint: "<message>"   # 参数提示文本
arguments: [msg, files]      # 命名参数列表
model: sonnet                # 模型覆盖（如 opus、sonnet）
effort: high                 # 努力等级（low/medium/high）
context: fork                # 执行上下文：inline(默认) 或 fork
agent: Bash                  # fork 时的 agent 类型
paths: ["src/**/*.ts"]       # 条件激活路径（匹配时才激活）
user_invocable: true         # 是否允许用户 /skill-name 调用
disable_model_invocation: false  # 禁止 LLM 自动调用
---
```

### 3.3 Markdown 内容

SKILL.md 的 markdown 内容作为 skill 的 prompt，支持：
- `$ARGUMENTS` 替换（用户传入的参数）
- `${CLAUDE_SKILL_DIR}` 替换（skill 目录路径）
- Shell 命令注入（`!command` 语法）

---

## 4. 多源加载架构

### 4.1 加载优先级

```
1. Managed  (~/.claude/managed/.claude/skills/)  — 企业策略管控
2. User     (~/.claude/skills/)                  — 用户全局
3. Project  (.claude/skills/)                      — 项目级（向上遍历）
4. Additional (--add-dir 指定的目录)
5. Legacy    (.claude/commands/)                — 向后兼容
6. Bundled   (编程式注册)
7. MCP       (MCP Server 提供)
```

### 4.2 去重策略

使用 `realpath()` 解析符号链接，获得 canonical path 后用 Set 去重。先加载的优先。

### 4.3 条件 Skills

含有 `paths` frontmatter 的 skill 存入 `conditionalSkills` Map，当文件操作匹配路径时才激活。

---

## 5. createSkillCommand 工厂

关键实现逻辑：

```typescript
function createSkillCommand(params): SkillCommand {
  return {
    type: 'prompt',
    name: skillName,
    getPromptForCommand(args) {
      let content = baseDir
        ? `Base directory: ${baseDir}\n\n${markdownContent}`
        : markdownContent;

      // 替换变量
      content = content.replace(/\$ARGUMENTS/g, args);
      content = content.replace(/\$\{CLAUDE_SKILL_DIR\}/g, baseDir);
      content = content.replace(/\$\{CLAUDE_SESSION_ID\}/g, sessionId);

      // 执行 shell 命令注入
      if (loadedFrom !== 'mcp') {
        content = await executeShellCommandsInPrompt(content, ...);
      }

      return [{ type: 'text', text: content }];
    },
  };
}
```

---

## 6. Bundled Skills 注册

### 6.1 接口定义

```typescript
interface BundledSkillDefinition {
  name: string;
  description: string;
  whenToUse?: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  isEnabled?: () => boolean;  // 动态可见性控制
  hooks?: HookConfig;
  getPromptForCommand(args: string): Promise<ContentBlockParam[]>;
}
```

### 6.2 注册流程

```typescript
function registerBundledSkill(definition: BundledSkillDefinition) {
  const command: SkillCommand = {
    type: 'prompt',
    name: definition.name,
    source: 'bundled',
    loadedFrom: 'bundled',
    isEnabled: definition.isEnabled,
    async getPromptForCommand(args) {
      return definition.getPromptForCommand(args);
    },
  };
  bundledSkills.push(command);
}
```

---

## 7. SkillTool 实现

### 7.1 生命周期

```
validateInput → checkPermissions → execute
```

### 7.2 validateInput 四阶段

```typescript
async validateInput({ skill }) {
  // 1. 格式检查（非空）
  const trimmed = skill.trim();
  if (!trimmed) return { ok: false, error: 'empty' };

  // 2. 命令存在性（findCommand）
  const command = findCommand(normalizedName, commands);
  if (!command) return { ok: false, error: 'unknown' };

  // 3. disableModelInvocation 检查
  if (command.disableModelInvocation) {
    return { ok: false, error: 'disabled' };
  }

  // 4. type === 'prompt' 检查
  if (command.type !== 'prompt') {
    return { ok: false, error: 'not prompt type' };
  }

  return { ok: true };
}
```

### 7.3 checkPermissions 决策链

```
deny 规则匹配 ─→ deny
allow 规则匹配 ─→ allow
安全属性检查 ─→ allow（如果只有安全属性）
其他 ─→ ask（用户确认）
```

**安全属性白名单**:
```typescript
const SAFE_SKILL_PROPERTIES = new Set([
  'type', 'name', 'description', 'allowedTools',
  'model', 'effort', 'context', 'agent', 'paths',
  'getPromptForCommand', ...
]);
```

### 7.4 execute 执行路径

- **Inline**（默认）: 调用 `getPromptForCommand(args)` 返回 prompt 内容
- **Fork**（context=fork）: 在子 Agent 中执行，使用 `runAgent()`

---

## 8. 预算管理 (prompt.ts)

### 8.1 预算分配

- Skills 列表占上下文窗口的 **1%**
- 默认 8000 字符（200k tokens × 4 chars × 1%）
- 可通过 `SLASH_COMMAND_TOOL_CHAR_BUDGET` 环境变量覆盖

### 8.2 描述截断规则

- 每条描述上限 **250 字符**
- Bundled skills 永远保留完整描述
- 其他 skills 按预算截断
- 预算极小时降级为"仅显示名称"

```typescript
function formatSkillsWithinBudget(skills, budget) {
  // 分离 bundled 和非 bundled
  const bundled = skills.filter(s => s.source === 'bundled');
  const rest = skills.filter(s => s.source !== 'bundled');

  // bundled 保留完整描述
  // rest 按 maxDescLen 截断
}
```

---

## 9. 使用追踪与排序

### 9.1 追踪机制

每次 skill 执行时调用 `recordSkillUsage(skillName)`，记录：
- `usageCount`: 使用次数
- `lastUsedAt`: 时间戳

### 9.2 排序算法

使用**指数衰减**计算使用分数：

```typescript
function getSkillUsageScore(skillName): number {
  const usage = getUsageMap()[skillName];
  if (!usage) return 0;

  // 7 天半衰期
  const daysSinceUse = (Date.now() - usage.lastUsedAt) / (1000 * 60 * 60 * 24);
  const recencyFactor = Math.pow(0.5, daysSinceUse / 7);

  // 最低 0.1，防止老 skill 完全消失
  return usage.usageCount * Math.max(recencyFactor, 0.1);
}
```

---

## 10. 与斜杠命令的关系

Skills 与斜杠命令共用 `Command` 类型系统：
- `type: 'prompt'` 表示可被 LLM 调用的 skill
- `getPromptForCommand(args)` 返回注入到对话的 prompt
- 用户可通过 `/skill-name` 触发，LLM 可通过 `Skill` 工具触发

---

## 11. 与 cc-study 的差异

| 特性 | free-code | cc-study (Phase 7) |
|------|-----------|------------------|
| SKILL.md 解析 | 完整 YAML | 简化 frontmatter |
| 去重策略 | realpath + Set | realpath + Set |
| 条件激活 | ignore 库 glob 匹配 | 简化版（留待增强） |
| 动态发现 | chokidar 监听 | 启动时加载（留待增强） |
| Fork 执行 | runAgent 子进程 | 留待 Phase 8 |
| 使用追踪 | 全局配置持久化 | 内存存储 |
| MCP Skills | 支持 | 留待 Phase 5 扩展 |

---

## 12. 关键设计决策

1. **符号链接去重**: 使用 `realpath()` 避免通过不同路径加载同一 skill
2. **安全属性白名单**: 新增属性默认需要权限，防止权限逃逸
3. **预算管理**: 1% 上下文预算防止 skill 列表撑爆上下文窗口
4. **Bundled Skills**: 支持编程式注册，无需文件系统

---

**版本**: v1.0.0
**更新**: 2026-04-27
