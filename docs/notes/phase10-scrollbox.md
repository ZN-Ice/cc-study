# Phase 10: ScrollBox 源码研读笔记

> 研读目标：理解 free-code 的 ScrollBox 视口管理系统，解决 cc-study 的滚动弹跳 bug。
>
> 源码参考：`free-code/src/ink/components/ScrollBox.tsx`（237行）、`free-code/src/hooks/useVirtualScroll.ts`（721行）、`free-code/src/components/ScrollKeybindingHandler.tsx`（1012行）、`free-code/src/components/VirtualMessageList.tsx`（1082行）
>
> 研读时间：2026-05-05

---

## 一、核心问题

cc-study 当前的 `MessageList.tsx` 直接平铺渲染所有可见消息到终端，依赖终端原生 scrollback。当模型流式输出新内容时，Ink 每次 re-render 都会重写终端缓冲区，导致用户手动滚动查看历史消息时视口位置发生不可预测的跳转（弹跳 bug）。

free-code 通过自建一套完整的 viewport 管理系统彻底解决了这个问题。

---

## 二、ScrollBox 架构

### 2.1 整体结构

```
┌─────────────────────────────────────────────────────────────┐
│  REPL.tsx                                                   │
│  └── FullscreenLayout                                       │
│      └── VirtualMessageList (1082行)                        │
│          ├── useVirtualScroll (721行) — 虚拟滚动 Hook        │
│          └── ScrollBox (237行) — 视口容器                    │
│      └── ScrollKeybindingHandler (1012行) — 键盘/鼠标滚动    │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 ScrollBox 核心职责

ScrollBox 是 free-code 自定义的 Ink 组件，提供以下能力：

1. **Viewport 管理**：通过 `overflow: scroll` 约束高度，子元素按完整高度布局
2. **Viewport culling**：渲染器只渲染与视口相交的子元素
3. **程序化滚动 API**：`scrollTo(y)`, `scrollBy(dy)`, `scrollToBottom()`
4. **粘性滚动**：`stickyScroll` 属性控制是否自动跟随新内容
5. **滚动位置查询**：`getScrollTop()`, `getScrollHeight()`, `isSticky()`

### 2.3 ScrollBoxHandle 接口

```typescript
type ScrollBoxHandle = {
  scrollTo(y: number): void;
  scrollBy(dy: number): void;
  scrollToElement(el: DOMElement, offset?: number): void;
  scrollToBottom(): void;
  getScrollTop(): number;
  getScrollHeight(): number;
  getViewportHeight(): number;
  isSticky(): boolean;
  subscribe(listener: () => void): () => void;
  setClampBounds(min?: number, max?: number): void;
};
```

### 2.4 stickyScroll 机制（核心）

这是解决弹跳 bug 的关键机制：

```
stickyScroll = true
  → 渲染器自动将 scrollTop 固定在 maxScrollTop
  → 新内容到来时自动滚到底部
  → 通过 scrollToBottom() 设置

scrollTo(y) / scrollBy(dy)
  → el.stickyScroll = false
  → 用户手动滚动 → 断开自动跟随
  → 用户停在当前视口位置，新内容不会把视口拽走

scrollToBottom()
  → el.stickyScroll = true
  → 用户回到底部 → 恢复自动跟随
```

**实现细节**：

```typescript
// ScrollBox.tsx
scrollTo(y: number) {
  el.stickyScroll = false;   // ← 手动滚动 → 断开粘性
  el.scrollTop = Math.max(0, Math.floor(y));
  scrollMutated(el);
}

scrollBy(dy: number) {
  el.stickyScroll = false;   // ← 用户按键/滚轮 → 断开粘性
  el.pendingScrollDelta = (el.pendingScrollDelta ?? 0) + Math.floor(dy);
  scrollMutated(el);
}

scrollToBottom() {
  el.stickyScroll = true;    // ← 到底 → 恢复粘性
  forceRender(n => n + 1);   // ← 触发 React re-render
}
```

**渲染器侧的行为**（来自 `render-node-to-output`）：

```
if (el.stickyScroll === true && contentHeight > viewportHeight) {
  el.scrollTop = contentHeight - viewportHeight;  // 自动滚到底
}
```

### 2.5 渲染管线

ScrollBox 绕过了 React 的渲染管线：

```
用户滚轮事件
  → ScrollKeybindingHandler 调用 scrollBy(dy)
  → ScrollBox.scrollBy() 直接操作 DOM 元素属性
    → el.stickyScroll = false
    → el.pendingScrollDelta += dy
    → markDirty(el) — 标记 DOM 脏
    → queueMicrotask → scheduleRenderFrom(el) — 触发渲染器重绘
  → 渲染器 drain pendingScrollDelta → 更新 scrollTop
  → 渲染器计算 viewport culling → 只输出可见子元素
```

**React 只负责数据层，渲染器负责视觉层。** React component 不持有 scrollTop state，scrollTop 存储在 DOM 元素上。

### 2.6 Viewport Culling

渲染器在 `renderNodeToOutput` 中：

1. 读取 ScrollBox 的 `scrollTop` 和 `viewportHeight`
2. 遍历子元素，通过 Yoga 计算每个子元素的 `computedTop` 和 `computedHeight`
3. 只渲染满足 `(top + height > scrollTop) && (top < scrollTop + viewportHeight)` 的子元素
4. 超出视口的子元素不输出任何字符

---

## 三、VirtualMessageList + useVirtualScroll

### 3.1 虚拟滚动原理

不是只做简单的 viewport culling，而是维护一个**滑动窗口**：

```
所有消息（500条）
  ┌─────────────────────────────────────────────┐
  │  topSpacer (虚拟占位)                        │
  │  ↓ scrollTop                               │
  ├─────────────────────────────────────────────┤
  │  mounted messages (~100条)  ← 实际渲染       │
  │  [80行 overscan above] + viewportH + [80行 below]
  ├─────────────────────────────────────────────┤
  │  ↓ scrollTop + viewportHeight               │
  │  bottomSpacer (虚拟占位)                     │
  └─────────────────────────────────────────────┘
```

当滚动超过 overscan 范围时，滑动窗口（`SLIDE_STEP=25` 每次重新挂载25条）。

### 3.2 高度缓存

```typescript
const heightCache = new Map<string, number>();
// 每渲染一个 message，Yoga 布局后通过 measureRef 回调缓存高度
measureRef: (key: string) => (el: DOMElement | null) => {
  if (el) heightCache.set(key, el.yogaNode.getComputedHeight());
}
```

默认估计高度 = 3 行（有意低估，宁可多 mount 一些也不出现空白）。

### 3.3 scrollTop 量化

```typescript
const SCROLL_QUANTUM = OVERSCAN_ROWS >> 1; // = 40

// 不是每帧都 re-render，而是 scrollTop 每 40px 变化才触发
// 视觉滚动由 renderer 直接读 DOM scrollTop 完成，不依赖 React
```

---

## 四、ScrollKeybindingHandler（1012行）

### 4.1 键盘导航

| 按键 | 行为 |
|------|------|
| `j` / `↓` | 向下滚动 1 行 |
| `k` / `↑` | 向上滚动 1 行 |
| `PgDn` / `Ctrl+D` | 向下滚动半屏 |
| `PgUp` / `Ctrl+U` | 向上滚动半屏 |
| `g`（连按两次） | 滚到顶部 |
| `G`（Shift+G） | 滚到底部 |
| `Ctrl+F` | 向下滚动一屏 |

### 4.2 鼠标滚轮加速

free-code 实现了复杂的鼠标滚轮加速算法：

- **线性加速**（原生终端）：40ms 窗口内连续滚动触发加速，最高 6x
- **指数衰减**（xterm.js 终端如 VS Code）：`momentum = 0.5^(gap/halflife)`，滚得越快加速越多
- **编码器弹跳检测**：检测便宜鼠标滚轮的逆向脉冲，过滤掉 28% 的虚假事件

### 4.3 选择模式（Selection）

ScrollKeybindingHandler 还处理文本选择（xterm.js 支持的终端）：
- 鼠标拖拽选择文本
- 自动复制到剪贴板
- 选择时暂停自动滚动

---

## 五、对 cc-study 的意义

### 5.1 不能直接移植的原因

free-code 使用自定义 Ink 分支，其自定义程度包括：
- 自定义 DOM 元素类型（`DOMElement` with `scrollTop`/`scrollHeight`/`stickyScroll`）
- 自定义渲染器（`renderNodeToOutput` 含 viewport culling）
- 自定义 Yoga 集成
- `overflow: scroll` 支持

cc-study 使用标准 `ink` npm 包，不具备这些底层能力。

### 5.2 cc-study 适配策略

用 React state 替代 DOM 属性存储 scrollTop，构建一个 Viewport-aware 的 ScrollBox：

1. **`scrollTop` 存储在 React state** 中（而非 DOM 属性）
2. **Viewport culling 在 React 层实现**：根据 scrollTop + viewportHeight 过滤 children
3. **`isSticky` 用 React state** 追踪自动跟随状态
4. **键盘处理**：在 App.tsx 的 useInput 中添加 PgUp/PgDn/↑/↓
5. **放弃虚拟滚动**（useVirtualScroll）—— cc-study 的消息量远达不到需要虚拟滚动的规模

### 5.3 设计决策

| 决策 | free-code | cc-study |
|------|-----------|----------|
| scrollTop 存储 | DOM 元素属性 | React state |
| Viewport culling | 渲染器层（C） | React 组件层（JSX） |
| 虚拟滚动 | useVirtualScroll（721行） | 不需要（消息量少） |
| 鼠标滚轮加速 | 自定义（~200行） | 不需要（终端原生滚动） |
| 文本选择 | 支持 | 暂不支持 |
| 关键保留 | stickyScroll 机制 | ✅ 完整保留 |

---

## 六、关键代码片段

### 6.1 ScrollBox.stickyScroll 判断

```typescript
// custom Ink renderer (render-node-to-output)
// 只有在 stickyScroll === true 时才自动跟随

if (element.stickyScroll === true) {
  const contentHeight = element.scrollHeight;
  const viewportHeight = element.scrollViewportHeight;
  if (contentHeight > viewportHeight) {
    element.scrollTop = contentHeight - viewportHeight;  // auto-follow
  }
}
```

### 6.2 VirtualMessageList 的 StickyTracker

```typescript
// VirtualMessageList 通过 StickyTracker 检测是否需要 scrollToBottom
// 当所有可见消息都已显示且用户在底部时，新消息到达触发 scrollToBottom

function StickyTracker({ scrollRef, messages, offsets, itemTop }) {
  // 遍历 mounted range，找到视口边界
  // 如果用户最后一条可见消息在视口内 → isAtBottom = true
  // 新消息到达时 → scrollRef.current.scrollToBottom()
}
```

---

**总结**：free-code 的 ScrollBox 是一个完整的终端 viewport 仿真系统，通过在 Ink 的渲染管线中插入自定义逻辑来实现。它的核心价值在于 **stickyScroll 机制** — 精确区分"自动跟随"和"用户手动滚动"，彻底解决了终端 CLI 应用中"新内容到来时视口乱跳"的经典问题。

cc-study 的适配方案保留这个核心机制，但用 React state 替代底层 DOM 操作，在标准 Ink 框架下实现同等效果。
