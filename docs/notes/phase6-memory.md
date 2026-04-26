# Phase 6 源码研读笔记：记忆系统

> **任务**：P6002
> **日期**：2026-04-26
> **源码路径**：`free-code/src/commands/memory/`、`free-code/src/memdir/`

---

## 一、记忆系统概述

Claude Code 的记忆系统是**基于文件存储**的持久化机制，用于在会话之间保存和检索信息。

**重要发现**：Claude Code **没有**独立的 `MemoryReadTool` 或 `MemoryWriteTool`。记忆功能是通过 `/memory` 命令（LocalJSXCommand）实现的，用户通过命令界面编辑记忆文件。

```
记忆系统架构
├── /memory 命令        → 用户交互界面
├── 记忆文件           → 实际存储
│   ├── user.md
│   ├── feedback.md
│   ├── project.md
│   └── reference.md
└── MEMORY.md          → 索引文件
```

---

## 二、记忆文件结构

### 2.1 目录位置

```
~/.claude/projects/{project-id}/memory/
├── MEMORY.md     # 索引文件
├── user.md       # 用户偏好
├── feedback.md   # 用户反馈
├── project.md    # 项目信息
└── reference.md  # 外部引用
```

### 2.2 记忆类型分类

| 类型 | 文件 | 描述 |
|------|------|------|
| user | `user.md` | 用户偏好和习惯（编码风格、常用工具等） |
| feedback | `feedback.md` | 用户的纠正和偏好（不要做什么、应该怎么做） |
| project | `project.md` | 项目特定信息（项目背景、技术栈） |
| reference | `reference.md` | 外部系统参考（文档链接、API 地址等） |

### 2.3 MEMORY.md 索引格式

```markdown
---
name: memory_index
description: "Memory index file tracking all memory entries"
type: "index"
---

# Memory Index

This file tracks all persistent memory entries.

## Memory Types

- **user** *(exists)* - User memory
- **feedback** *(exists)* - Feedback memory
- **project** *(not created)* - Project memory
- **reference** *(exists)* - Reference memory

## Usage

- `/memory user` - View user preferences memory
- `/memory feedback` - View feedback memory
- `/memory project` - View project memory
- `/memory reference` - View reference memory
```

---

## 三、/memory 命令实现

### 3.1 命令类型

```typescript
export const memoryCommand: Command = {
  type: 'local',  // 注意：实现为 LocalCommand，不是 LocalJSXCommand
  name: 'memory',
  description: 'Manage persistent memory files',
  argumentHint: '[type]',
  userInvocable: true,
  load: async () => ({ call: memoryCall }),
}
```

### 3.2 参数解析

```typescript
function parseMemoryArgs(args: string): {
  type: MemoryType | null
  action: 'read' | 'write'
  content: string
} {
  const parts = args.trim().split(/\s+/)
  const firstPart = parts[0]
  const memoryType = getMemoryType(firstPart)

  if (!memoryType) {
    return { type: null, action: 'read', content: '' }
  }

  // 检测 write 命令
  if (parts.length > 1 && parts[1].toLowerCase() === 'write') {
    const content = parts.slice(2).join(' ')
    return { type: memoryType, action: 'write', content }
  }

  return { type: memoryType, action: 'read', content: '' }
}
```

### 3.3 记忆文件读写

```typescript
// 读取记忆
async function readMemoryFile(filePath: string, type: MemoryType): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return `# Memory: ${type}\n\n${content}`
  } catch {
    return `# Memory: ${type}\n\n(No content yet...)`
  }
}

// 写入记忆
async function writeMemoryFile(
  basePath: string,
  type: MemoryType,
  content: string
): Promise<string> {
  const filePath = path.join(basePath, `${type}.md`)
  await fs.writeFile(filePath, content, 'utf-8')
  await updateMemoryIndex(basePath)  // 更新索引
  return `Memory "${type}" updated successfully.`
}
```

---

## 四、记忆索引管理

### 4.1 更新 MEMORY.md

```typescript
async function updateMemoryIndex(basePath: string): Promise<void> {
  const types: MemoryType[] = ['user', 'feedback', 'project', 'reference']
  const entries = []

  for (const type of types) {
    const filePath = path.join(basePath, `${type}.md`)
    const exists = fs.existsSync(filePath)
    const description = exists ? await getFirstLine(filePath) : `${type} memory`

    entries.push({ type, exists, description })
  }

  const indexContent = buildMemoryIndexContent(entries)
  await fs.writeFile(path.join(basePath, 'MEMORY.md'), indexContent, 'utf-8')
}
```

### 4.2 索引内容构建

```typescript
function buildMemoryIndexContent(entries: MemoryEntry[]): string {
  const lines = []
  lines.push('---')
  lines.push('name: memory_index')
  lines.push('description: "Memory index file tracking all memory entries"')
  lines.push('type: "index"')
  lines.push('---')
  lines.push('')
  lines.push('# Memory Index')
  lines.push('')
  lines.push('## Memory Types')
  lines.push('')

  for (const entry of entries) {
    const status = entry.exists ? '*(exists)*' : '*(not created)*'
    lines.push(`- **${entry.type}** ${status} - ${entry.description}`)
  }

  return lines.join('\n')
}
```

---

## 五、记忆文件检测机制

### 5.1 free-code/src/utils/memoryFileDetection.ts

```typescript
// 检测记忆文件是否存在
export function detectMemoryFileType(filePath: string): MemoryType | null {
  const fileName = path.basename(filePath, '.md')
  const validTypes: MemoryType[] = ['user', 'feedback', 'project', 'reference']

  if (validTypes.includes(fileName as MemoryType)) {
    return fileName as MemoryType
  }
  return null
}

// 检测是否为索引文件
export function isMemoryIndexFile(filePath: string): boolean {
  return path.basename(filePath) === 'MEMORY.md'
}
```

### 5.2 记忆文件路径验证

```typescript
export function isMemoryFilePath(filePath: string): boolean {
  // 必须是 memory/ 子目录下的文件
  const normalized = path.normalize(filePath)
  return normalized.includes('/memory/') && normalized.endsWith('.md')
}
```

---

## 六、记忆老化机制

### 6.1 free-code/src/memdir/memoryAge.ts

记忆文件可能随着时间推移而变得过时，需要清理机制。

```typescript
export interface MemoryAge {
  type: MemoryType
  lastModified: Date
  contentAge: number  // 天数
}

// 计算记忆内容年龄
export function getMemoryAge(filePath: string): MemoryAge | null {
  try {
    const stats = fs.statSync(filePath)
    const content = fs.readFileSync(filePath, 'utf-8')
    const lastLine = content.split('\n').pop()

    // 尝试从最后一行解析日期戳
    const dateMatch = lastLine?.match(/^# Memory Age: (\d+)$/)
    const contentAge = dateMatch
      ? daysSince(parseInt(dateMatch[1]))
      : daysSince(stats.mtimeMs)

    return {
      type: detectMemoryFileType(filePath),
      lastModified: stats.mtime,
      contentAge,
    }
  } catch {
    return null
  }
}
```

---

## 七、记忆扫描机制

### 7.1 free-code/src/memdir/memoryScan.ts

扫描项目目录中的记忆文件。

```typescript
export interface MemoryScanResult {
  projectPath: string
  memories: {
    type: MemoryType
    filePath: string
    exists: boolean
    lastModified?: Date
  }[]
}

// 扫描项目记忆
export function scanProjectMemories(projectPath: string): MemoryScanResult {
  const memoryDir = path.join(projectPath, '.claude', 'memory')
  const types: MemoryType[] = ['user', 'feedback', 'project', 'reference']

  return {
    projectPath,
    memories: types.map((type) => {
      const filePath = path.join(memoryDir, `${type}.md`)
      const exists = fs.existsSync(filePath)
      const stats = exists ? fs.statSync(filePath) : null

      return {
        type,
        filePath,
        exists,
        lastModified: stats?.mtime,
      }
    }),
  }
}
```

---

## 八、与 free-code 源码的差异

### 8.1 cc-study 实现 vs free-code 源码

| 方面 | free-code 源码 | cc-study 实现 |
|------|---------------|---------------|
| 记忆工具 | 无独立工具 | 无独立工具 |
| 命令类型 | LocalJSXCommand | LocalCommand |
| UI | React 组件渲染 | 文本输出 |
| 写入支持 | 命令界面编辑 | /memory type write content |
| 索引更新 | 惰性更新 | 写入时同步更新 |

### 8.2 设计决策

**问题**：为什么不需要独立的 MemoryReadTool/MemoryWriteTool？

**答案**：
1. 记忆是**用户主动管理**的内容，不是 LLM 主动使用的工具
2. LLM 通过读取记忆文件内容自行决定如何使用
3. 用户通过 `/memory` 命令管理记忆
4. 记忆内容可以作为上下文的一部分在需要时提供

---

## 九、已实现文件

```
src/commands/builtins/
└── memory.ts        # /memory 命令实现
```

### 9.1 实现的功能

- `getMemoryBasePath()` - 获取记忆目录路径
- `getMemoryFilePath()` - 获取特定类型记忆文件路径
- `getMemoryType()` - 解析记忆类型
- `parseMemoryArgs()` - 解析命令参数
- `readMemoryFile()` - 读取记忆
- `writeMemoryFile()` - 写入记忆
- `updateMemoryIndex()` - 更新索引
- `buildMemoryOverview()` - 构建概览输出

---

## 十、使用示例

```
# 查看记忆概览
/memory

# 查看特定记忆
/memory user

# 写入记忆
/memory user write 用户偏好使用 TypeScript

# 更新反馈记忆
/memory feedback write 不要过度设计
```

---

**版本**：v1.0
**状态**：已完成源码研读
