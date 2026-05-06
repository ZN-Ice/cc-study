# Phase 10: 虚拟滚动与滚动处理研读笔记

> 研读日期：2026-05-05
> 参考源码：`free-code/src/components/VirtualMessageList.tsx`, `free-code/src/components/ScrollKeybindingHandler.tsx`

## 一、VirtualMessageList.tsx 架构（1082 行）

### 核心思想

VirtualMessageList 实现了一个完整的虚拟滚动系统，只渲染可见区域内的消息项，大幅减少 Ink 渲染压力。

### 组件结构

```
VirtualMessageList
├── useVirtualScroll(scrollRef, keys, columns)
│   └── 返回 { range, topSpacer, bottomSpacer, measureRef, offsets,
│             getItemTop, getItemElement, getItemHeight, scrollToIndex }
│
├── JumpHandle (命令式接口)
│   ├── jumpToIndex(i)      — 跳转到指定消息
│   ├── setSearchQuery(q)   — 设置搜索词
│   ├── nextMatch()          — 下一个搜索结果
│   ├── prevMatch()          — 上一个搜索结果
│   ├── setAnchor()          — 设置锚点
│   ├── warmSearchIndex()    — 预热搜索索引
│   └── disarmSearch()       — 清除搜索状态
│
├── StickyTracker
│   └── 跟踪视口上方最近的用户 Prompt，固定在顶部
│
└── 搜索系统
    ├── setSearchQuery → 构建匹配列表 + 前缀和
    ├── step(delta) → 导航搜索结果（支持循环）
    └── highlight(ord) → 计算屏幕坐标高亮
```

### 关键 Props

```typescript
type Props = {
  messages: RenderableMessage[];        // 可渲染消息列表
  scrollRef: RefObject<ScrollBoxHandle>; // 滚动容器引用
  columns: number;                       // 终端列数
  itemKey: (msg) => string;             // 列表 key
  renderItem: (msg, index) => ReactNode; // 单项渲染
  extractSearchText?: (msg) => string;   // 搜索文本提取
  trackStickyPrompt?: boolean;           // 启用 Sticky header
  selectedIndex?: number;                // 选中项
  jumpRef?: RefObject<JumpHandle>;       // 跳转接口
};
```

### 虚拟滚动核心

```typescript
function useVirtualScroll(scrollRef, keys, columns) {
  return {
    range: [startIndex, endIndex],     // 当前可见范围
    topSpacer: number,                 // 顶部占位高度
    bottomSpacer: number,              // 底部占位高度
    measureRef: RefCallback,           // 测量组件高度的 ref
    offsets: number[],                 // 每个 item 的偏移
    getItemTop: (i) => number,         // 获取 item 顶部位置
    getItemElement: (i) => Element,    // 获取 item DOM 元素（Ink 中为文本行）
    getItemHeight: (i) => number,      // 获取 item 高度
    scrollToIndex: (i) => void,        // 滚动到指定项目
  };
}
```

## 二、ScrollKeybindingHandler.tsx 架构（1012 行）

### 滚动加速算法

Claude Code 实现了复杂的滚动加速行为：

| 终端类型 | 算法 | 说明 |
|---------|------|------|
| 原生终端 | 线性加速（40ms 窗口内） | 连续滚轮事件触发加速 |
| xterm.js (VS Code) | 指数衰减 | 适配浏览器事件模式 |
| 触控板 | 无加速 | 5+ 连续 <5ms 事件 = 触控板，解除加速 |

### 键盘快捷键

| 快捷键 | 操作 |
|--------|------|
| ↑ / ↓ | 逐行滚动 |
| PgUp / PgDn | 翻页 |
| Home / End | 跳转到顶/底部 |
| Ctrl+U / Ctrl+D | 半页滚动（Modal Pager） |
| Ctrl+B / Ctrl+F | 整页滚动（Modal Pager） |
| g / G | 顶部/底部（Modal Pager） |
| Space / b | 下翻/上翻（Modal Pager） |

### Modal Pager

当用户进入搜索或浏览模式时，激活 Modal Pager：
- 阻止正常输入
- 使用 vim 风格的导航键
- 按 Escape 退出

### 拖拽滚动

`useDragToScroll()` Hook 实现鼠标选择拖拽时的自动滚动。

## 三、cc-study 简化方案

### 决策：使用分页而非虚拟滚动

原因：
1. Ink 没有真实的 DOM/Canvas，无法精确测量组件高度
2. 虚拟滚动需要 ScrollBoxHandle 等复杂基础设施
3. 学习项目应优先可理解性

### 简化后的 MessageList

```typescript
interface MessageListProps {
  messages: readonly Message[];
  streamingText: string | null;
  pageSize?: number;  // 默认 20
}
```

### 分页行为

```
# 消息数量 ≤ pageSize
[所有消息]

# 消息数量 > pageSize
[最后 pageSize 条消息]
─── 15 more messages ─── [Show All] ───

# Show All 模式
[所有消息]
─── showing all 35 messages ─── [Collapse] ───
```

### 自动行为

1. **新消息到来**：自动跳转到最新（显示最后 N 条）
2. **流式输出中**：始终显示最新消息
3. **用户已 Show All**：继续保持 Show All 模式

### 设计权衡

| 方面 | 虚拟滚动 | 分页方案 |
|------|---------|---------|
| 内存 | 低（只渲染可见项） | 高（渲染所有消息） |
| 实现复杂度 | 高（~2000 lines） | 低（~50 lines） |
| 用户体验 | 无缝滚动 | 手动分页 |
| Ink 兼容性 | 需要自定义滚动容器 | 原生支持 |
| 维护成本 | 高 | 低 |

### 结论

对于 cc-study 学习项目，分页方案是合理的选择。它简单、可靠、易于理解，同时提供了基本的导航能力。完整的虚拟滚动更适合生产环境，但不是当前阶段的学习目标。
