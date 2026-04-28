# Phase 7: chokidar 监听 Skills 目录机制分析

> **问题**：Skills 系统的动态发现机制是什么？chokidar 监听是指什么？

---

## 一、一句话总结

**chokidar 监听是指 Claude Code 使用 chokidar 库实时监控 `~/.claude/skills/`、`.claude/skills/` 等目录的文件变化，当 SKILL.md 被添加、修改或删除时，自动重新加载 skills 列表，无需重启 CLI。**

---

## 二、为什么需要文件监听？

### 2.1 静态加载的问题

如果只在 CLI 启动时加载一次 skills：
- 用户新增或修改 skill 后必须重启 CLI 才能生效
- 体验差，不符合 Claude Code 的实时性要求

### 2.2 chokidar 监听的优势

| 特性 | 说明 |
|------|------|
| 实时感知 | skill 文件变化时立即触发 reload |
| 零配置 | 无需用户手动刷新 |
| 统一接口 | 对用户 skills、项目 skills、commands 等多源统一监听 |

---

## 三、核心实现

### 3.1 文件位置

```
free-code/src/utils/skills/skillChangeDetector.ts
```

### 3.2 监听配置

```typescript
watcher = chokidar.watch(paths, {
  persistent: true,           // 后台持续运行，不阻塞进程
  ignoreInitial: true,       // 忽略初始化时的已有文件，只监听变化
  depth: 2,                  // 最多扫描 2 层（skill-name/SKILL.md）
  awaitWriteFinish: {
    stabilityThreshold: 1000,  // 等待文件写入稳定（1秒）
    pollInterval: 500,         // 轮询间隔
  },
  ignored: /\.git/,           // 忽略 .git 目录
  ignorePermissionErrors: true,
  usePolling: Bun ? true : false,  // Bun 环境使用轮询，其他用原生事件
})
```

### 3.3 监听的事件

```typescript
watcher.on('add', handleChange)     // 新增 SKILL.md
watcher.on('change', handleChange)  // 修改 SKILL.md
watcher.on('unlink', handleChange)  // 删除 SKILL.md
```

---

## 四、监听的生命周期

### 4.1 启动监听：`initialize()`

```typescript
export async function initialize(): Promise<void> {
  if (initialized || disposed) return
  initialized = true

  // 注册动态 skills 加载的回调
  onDynamicSkillsLoaded(() => {
    clearCommandMemoizationCaches()
    skillsChanged.emit()  // 通知所有订阅者
  })

  const paths = await getWatchablePaths()
  watcher = chokidar.watch(paths, { ... })
}
```

### 4.2 停止监听：`dispose()`

```typescript
export function dispose(): Promise<void> {
  disposed = true
  if (watcher) {
    await watcher.close()
    watcher = null
  }
  if (reloadTimer) {
    clearTimeout(reloadTimer)
    reloadTimer = null
  }
  pendingChangedPaths.clear()
  return closePromise
}
```

---

## 五、变化的回调处理

### 5.1 防抖处理

```typescript
function scheduleReload(changedPath: string): void {
  pendingChangedPaths.add(changedPath)
  if (reloadTimer) clearTimeout(reloadTimer)

  // 300ms 防抖：等待文件写入完成，避免频繁 reload
  reloadTimer = setTimeout(async () => {
    const paths = [...pendingChangedPaths]
    pendingChangedPaths.clear()

    // 执行 ConfigChange hook（可阻止 reload）
    const results = await executeConfigChangeHooks('skills', paths[0])
    if (hasBlockingResult(results)) return

    // 清除缓存并通知
    clearSkillCaches()
    clearCommandsCache()
    skillsChanged.emit()
  }, 300)
}
```

### 5.2 触发的操作

| 操作 | 说明 |
|------|------|
| `executeConfigChangeHooks('skills', ...)` | 可被 ConfigChange hook 阻止 |
| `clearSkillCaches()` | 清除 skills 缓存 |
| `clearCommandsCache()` | 清除命令缓存 |
| `skillsChanged.emit()` | 通知订阅者 skills 已更新 |

---

## 六、监听的目录

### 6.1 目录列表

```typescript
async function getWatchablePaths(): Promise<string[]> {
  const paths: string[] = []

  // 1. 用户级 skills
  if (userSkillsDir) paths.push(join(userSkillsDir, 'skills'))
  // 2. 用户级 commands（兼容旧目录）
  if (userCommandsDir) paths.push(userCommandsDir)
  // 3. 项目级 skills（向上遍历查找）
  if (projectSkillsDir) paths.push(projectSkillsDir)
  // 4. 项目级 commands（兼容旧目录）
  if (projectCommandsDir) paths.push(projectCommandsDir)
  // 5. 额外指定目录（--add-dir）
  for (const dir of additionalDirs) {
    paths.push(join(dir, '.claude', 'skills'))
  }

  return paths
}
```

### 6.2 目录优先级

```
~/.claude/skills/           (用户级)
~/.claude/commands/          (用户级 - 兼容)
.claude/skills/              (项目级)
.claude/commands/            (项目级 - 兼容)
--add-dir 指定的目录/.claude/skills/
```

---

## 七、与 cc-study 的差异

| 特性 | free-code | cc-study (Phase 7) |
|------|-----------|---------------------|
| 动态监听 | chokidar 实时监控 | 启动时一次性加载 |
| 缓存失效 | 文件变化触发清除 | 无动态更新机制 |
| hook 集成 | ConfigChange hook | 无 |
| 防抖策略 | 300ms + 1s 文件稳定等待 | 无 |

---

## 八、关键设计决策

### 8.1 为什么用 chokidar？

- **跨平台兼容**：统一 Windows/macOS/Linux 事件 API 差异
- **过滤能力**：支持 `ignoreInitial`、`depth`、`ignored` 等细粒度控制
- **稳定性保障**：`awaitWriteFinish` 防止文件写入中途中断 reload

### 8.2 为什么防抖？

用户编辑文件时可能连续触发多个 change 事件，防抖确保：
- 减少 reload 次数
- 等待文件写入完全结束（`stabilityThreshold`）
- 降低缓存清除和重新解析的开销

### 8.3 为什么分层清理缓存？

```
skillsChanged.emit() → 各模块自行清除缓存
                   ↘ clearSkillCaches()     (loadSkillsDir.ts 的缓存)
                   ↘ clearCommandsCache()  (Command 注册表的缓存)
```

分离缓存职责，避免集中式耦合。

---

## 九、总结流程图

```
┌─────────────────────────────────────────────────────────────┐
│  CLI 启动                                                    │
└────────────────────────┬──────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  skillChangeDetector.initialize()                            │
│  - 扫描所有 skills 目录                                       │
│  - chokidar.watch() 开始监听                                │
└────────────────────────┬──────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  用户修改 ~/.claude/skills/my-skill/SKILL.md                  │
└────────────────────────┬──────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  chokidar 捕获 change 事件 → handleChange()                  │
│  - scheduleReload() 添加防抖（300ms）                        │
└────────────────────────┬──────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  防抖到期 → executeConfigChangeHooks()                      │
│  - 可被 hook 阻止（hasBlockingResult）                        │
└────────────────────────┬──────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  清除缓存 + 通知订阅者                                       │
│  - clearSkillCaches()                                       │
│  - clearCommandsCache()                                     │
│  - skillsChanged.emit()                                     │
└────────────────────────┬──────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  各模块订阅者收到通知，重新加载 skills                        │
│  - loadSkillsDir.ts 重新扫描                                │
│  - Command 注册表更新                                       │
└─────────────────────────────────────────────────────────────┘
```

---

**版本**: v1.0.0
**更新**: 2026-04-28
