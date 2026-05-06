# Phase 10: ScrollBox 设计文档

> 目标：为 cc-study 引入 ScrollBox 视口管理系统，解决流式输出时的滚动弹跳 bug。
>
> 参考：`free-code/src/ink/components/ScrollBox.tsx`、`free-code/src/components/ScrollKeybindingHandler.tsx`
>
> 设计日期：2026-05-05

---

## 一、问题定义

### 1.1 当前问题

`MessageList.tsx` 使用 `messages.slice(-pageSize)` 做简单分页，所有消息平铺渲染到终端。当模型流式输出时：

1. **新 token 触发 re-render** → Ink 重写终端缓冲区
2. **分页切换**（`setShowAll(false)` on streaming）→ 渲染行数突变
3. **用户滚动终端 scrollback 时** → 终端视口被 Ink 输出干扰，发生弹跳

### 1.2 根因

缺少 viewport 管理和 sticky scroll 机制。无法区分"用户手动滚动"和"自动跟随新内容"。

---

## 二、设计目标

1. **Sticky scroll flag**：自动跟随 vs 用户手动滚动，互不干扰
2. **Viewport-aware 渲染**：只渲染视口内的内容，大幅减少重绘范围
3. **键盘滚动**：PgUp/PgDn/↑/↓ 直接控制 ScrollBox，不干扰 PromptInput
4. **兼容现有架构**：最小侵入性，不破坏现有 API

---

## 三、架构设计

### 3.1 组件层级

```
App.tsx
├── MessageList (包装 ScrollBox)
│   └── ScrollBox ← 新增：视口容器
│       └── messages.map(MessageView)  ← 只渲染视口内的
├── ... (StatusLine, PromptInput, etc.)
```

### 3.2 ScrollBox 接口

```typescript
export interface ScrollBoxHandle {
  scrollTo(y: number): void;
  scrollBy(dy: number): void;
  scrollToBottom(): void;
  getScrollTop(): number;
  getViewportHeight(): number;
  isSticky(): boolean;
  getTotalRows(): number;       // cc-study addition
}

interface ScrollBoxProps {
  children: React.ReactNode;
  /** Enable sticky auto-follow on mount */
  stickyScroll?: boolean;
  /** Fixed viewport height in rows (default: terminal height - reserved rows) */
  viewportHeight?: number;
  /** Callback when sticky state changes */
  onStickyChange?: (sticky: boolean) => void;
  /** Ref for imperative API */
  ref?: React.Ref<ScrollBoxHandle>;
}
```

### 3.3 核心状态机

```
         scrollToBottom()         用户按 ↑/PgUp/scrollBy()
     ┌───────────────────┐     ┌────────────────────────┐
     │                   │     │                        │
     ▼                   │     ▼                        │
 ┌─────────┐       ┌─────────┐       ┌──────────────┐
 │ isSticky │ ────→ │ isSticky │ ────→ │   isSticky   │
 │ = true   │       │ = true   │       │   = false    │
 │ (初始)   │       │ (滚动中) │       │ (用户浏览)   │
 └─────────┘       └─────────┘       └──────────────┘
     │                   │                    │
     │                   │                    │
     │  新消息到达        │  新消息到达        │  新消息到达
     │  自动滚到底部      │  自动滚到底部      │  不滚动！
     ▼                   ▼                    ▼
 保持底部            保持底部              保持当前位置
```

### 3.4 数据流

```
用户输入 (PgUp/PgDn/↑/↓)
  │
  ▼
App.useInput() → scrollRef.current.scrollBy(dy)
  │
  ▼
ScrollBox.setState({ scrollTop, isSticky: false })
  │
  ▼
React re-render → 计算 visible range → 渲染可见 children
  │
  ▼
新 token 到达 → streamingText 更新
  │
  ├── isSticky === true  → scrollTop = max(0, totalRows - viewportHeight)
  └── isSticky === false → scrollTop 保持不变
```

---

## 四、接口设计

### 4.1 ScrollBox.tsx（新增）

```typescript
// src/components/ScrollBox.tsx

import React, { useState, useCallback, useImperativeHandle, useRef, useEffect } from "react";
import { Box, useInput } from "ink";

const DEFAULT_VIEWPORT_HEIGHT = 24;
const HEADER_ROWS = 2;   // cc-study header
const FOOTER_ROWS = 5;   // input + status + hints

export function computeViewportHeight(): number {
  return Math.max(5, process.stdout.rows - HEADER_ROWS - FOOTER_ROWS);
}

export interface ScrollBoxHandle {
  scrollTo(y: number): void;
  scrollBy(dy: number): void;
  scrollToBottom(): void;
  isSticky(): boolean;
  getScrollTop(): number;
  getViewportHeight(): number;
}

interface ScrollBoxProps {
  children: React.ReactNode;
  stickyScroll?: boolean;
  viewportHeight?: number;
}

export const ScrollBox: React.FC<ScrollBoxProps> = ({
  children,
  stickyScroll = true,
  viewportHeight = computeViewportHeight(),
}) => {
  // ...
};
```

### 4.2 MessageList.tsx（重构）

```typescript
// src/components/MessageList.tsx — 简化版

interface MessageListProps {
  messages: readonly Message[];
  streamingText: string | null;
  scrollRef: React.Ref<ScrollBoxHandle>;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  streamingText,
  scrollRef,
}) => {
  return (
    <ScrollBox ref={scrollRef} stickyScroll={streamingText !== null}>
      {messages.map(msg => <MessageView key={msg.id} message={msg} />)}
      {streamingText && <StreamingTextDisplay text={streamingText} />}
    </ScrollBox>
  );
};
```

### 4.3 App.tsx 变更

```typescript
// 新增 scrollRef 和 scroll 按键处理
const scrollRef = useRef<ScrollBoxHandle>(null);

useInput((input, key) => {
  // 已有 Ctrl+C / Escape 处理...

  // 新增：滚动按键（仅在非 loading 或非输入状态）
  if (key.upArrow)    { scrollRef.current?.scrollBy(-3); return; }
  if (key.downArrow)  { scrollRef.current?.scrollBy(3); return; }
  if (key.pageUp)     { scrollRef.current?.scrollBy(-viewportHeight / 2); return; }
  if (key.pageDown)   { scrollRef.current?.scrollBy(viewportHeight / 2); return; }
  if (key.home)       { scrollRef.current?.scrollTo(0); return; }
  if (key.end)        { scrollRef.current?.scrollToBottom(); return; }
});
```

---

## 五、实现细节

### 5.1 scrollTop 状态管理

```
scrollTop ∈ [0, totalRows - viewportHeight]

isSticky === true:
  每次 render: scrollTop = Math.max(0, totalRows - viewportHeight)

isSticky === false:
  scrollTop = 用户手动设置的值
  clamp to [0, totalRows - viewportHeight]
```

### 5.2 Viewport Culling 算法

```typescript
function computeVisibleRange(
  children: React.ReactNode[],
  scrollTop: number,
  viewportHeight: number,
  rowHeights: number[],
): [number, number] {
  let offset = 0;
  let start = 0;
  let end = children.length;

  for (let i = 0; i < children.length; i++) {
    const h = rowHeights[i] ?? 1;
    if (offset + h <= scrollTop) {
      offset += h;
      continue;
    }
    start = i;
    break;
  }

  for (let i = start; i < children.length && offset < scrollTop + viewportHeight; i++) {
    offset += rowHeights[i] ?? 1;
    end = i + 1;
  }

  return [start, end];
}
```

### 5.3 Sticky 判断

```typescript
const isSticky = useRef(stickyScroll);

const scrollTo = useCallback((y: number) => {
  isSticky.current = false;
  setScrollTop(clamp(y));
}, []);

const scrollBy = useCallback((dy: number) => {
  isSticky.current = false;
  setScrollTop(prev => clamp(prev + dy));
}, []);

const scrollToBottom = useCallback(() => {
  isSticky.current = true;
  setScrollTop(totalRows - viewportHeight);
}, [totalRows, viewportHeight]);
```

### 5.4 流式输出时的自动跟随

```typescript
useEffect(() => {
  if (isSticky.current) {
    const maxScroll = Math.max(0, totalRows - viewportHeight);
    setScrollTop(maxScroll);
  }
}, [totalRows, viewportHeight]);
```

---

## 六、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/components/ScrollBox.tsx` | **新增** | ScrollBox 组件（~150行） |
| `src/components/MessageList.tsx` | **重构** | 移除 pageSize 分页，包装 ScrollBox |
| `src/components/App.tsx` | **修改** | 添加 scrollRef、键盘滚动处理、移除旧的滚动相关逻辑 |
| `src/components/MessageView.tsx` | **可能修改** | 如需返回消息置信行数用于 viewport 计算 |
| `tests/unit/components/scrollBox.test.tsx` | **新增** | ScrollBox 单元测试 |
| `tests/unit/components/messageList.test.tsx` | **修改** | 适配新 MessageList API |

---

## 七、测试规划

### 7.1 ScrollBox 单元测试

```
describe("ScrollBox", () => {
  // 核心功能
  test("renders children within viewport")
  test("clips children outside viewport")
  test("sticky scroll auto-follows new content")
  test("scrollBy breaks stickiness")
  test("scrollToBottom restores stickiness")
  test("scrollTo sets precise position")
  test("scrollBy with positive dy scrolls down")
  test("scrollBy with negative dy scrolls up")
  test("scrollTop clamped to valid range")
  test("isSticky reflects current state")

  // 边界条件
  test("empty children renders nothing")
  test("total content smaller than viewport")
  test("viewport height changes on terminal resize")
})
```

### 7.2 MessageList 集成测试

```
describe("MessageList with ScrollBox", () => {
  test("displays all messages within viewport")
  test("streaming text triggers auto-scroll")
  test("does not scroll when user has scrolled up")
})
```

---

## 八、设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| scrollTop 存储位置 | React state | 标准 Ink 不支持 DOM 属性操作 |
| Viewport culling | React 层过滤 children | 标准 Ink 的 renderer 不可修改 |
| 虚拟滚动 | **不做** | cc-study 消息量通常 < 100 条，虚拟滚动收益不大 |
| 行高估算 | 固定 1行初始值 | 简化实现，后续可优化 |
| 鼠标滚轮 | 依赖终端原生滚动 | 标准 Ink 没有鼠标事件 API |
| Sticky 状态 | `useRef`（非 state） | 避免不必要的 re-render；读取快 |
