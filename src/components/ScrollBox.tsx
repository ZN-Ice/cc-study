import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Box } from "ink";
import { createDebug } from "../utils/debug.js";

const HEADER_ROWS = 2;
const FOOTER_ROWS = 5;
const MIN_VIEWPORT = 5;

const debug = createDebug("scroll");

export function computeViewportHeight(): number {
  const rows = process.stdout.rows;
  if (rows == null || rows <= 0) return 24;
  return Math.max(MIN_VIEWPORT, rows - HEADER_ROWS - FOOTER_ROWS);
}

// ── Line height estimation (exported for MessageList) ─────────────────

import type { ContentBlock, Message } from "../messages.js";

function estimateTextLines(text: string): number {
  const termWidth = (process.stdout.columns ?? 80) - 4;
  let lines = 0;
  for (const paragraph of text.split("\n")) {
    if (paragraph.length === 0) {
      lines += 1;
    } else {
      lines += Math.max(1, Math.ceil(paragraph.length / termWidth));
    }
  }
  return lines;
}

function estimateBlockLines(block: ContentBlock): number {
  switch (block.type) {
    case "text":
      return estimateTextLines(block.text);
    case "tool_use":
      return 1;
    case "tool_result": {
      const lineCount = block.content.split("\n").length;
      return Math.min(lineCount, 4);
    }
    case "thinking":
      return 1;
    default:
      return 1;
  }
}

/** Estimate visual line count for a message: label (1) + blocks + margin (1) */
export function estimateLines(message: Message): number {
  let lines = 1;
  for (const block of message.content) {
    lines += estimateBlockLines(block);
  }
  lines += 1;
  return lines;
}

export interface ScrollBoxHandle {
  scrollTo(y: number): void;
  scrollBy(dy: number): void;
  scrollToBottom(): void;
  isSticky(): boolean;
  getScrollTop(): number;
  getViewportHeight(): number;
  getScrollHeight(): number;
  getViewportTop(): number;
}

interface ScrollBoxProps {
  children: React.ReactNode;
  totalRows?: number;
  stickyScroll?: boolean;
  viewportHeight?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export const ScrollBox = React.forwardRef<ScrollBoxHandle, ScrollBoxProps>(
  function ScrollBox(
    {
      children,
      totalRows: totalRowsProp,
      stickyScroll = true,
      viewportHeight: viewportHeightProp,
    },
    ref,
  ) {
    const vp = viewportHeightProp ?? computeViewportHeight();
    const totalRows = totalRowsProp ?? 0;
    const maxScroll = Math.max(0, totalRows - vp);

    // Source of truth: refs for synchronous imperative reads
    const scrollTopRef = useRef(0);
    const isStickyRef = useRef(stickyScroll);

    // Render trigger counter — incremented when refs change
    const [renderTick, setRenderTick] = useState(0);
    const forceRender = useCallback(() => setRenderTick((t) => t + 1), []);

    // React to maxScroll changes (content growth / shrink)
    const prevMaxScrollRef = useRef(maxScroll);
    useEffect(() => {
      const prevMax = prevMaxScrollRef.current;
      prevMaxScrollRef.current = maxScroll;

      if (isStickyRef.current && maxScroll > prevMax) {
        // Content grew while sticky — auto-follow
        debug(`GROW FOLLOW: ${scrollTopRef.current} -> ${maxScroll}`);
        scrollTopRef.current = maxScroll;
        forceRender();
      } else if (scrollTopRef.current > maxScroll) {
        // Content shrunk — clamp to new max
        scrollTopRef.current = maxScroll;
        forceRender();
      }
    }, [maxScroll, forceRender]);

    // React to stickyScroll prop changes (not maxScroll changes)
    const prevStickyScrollRef = useRef<boolean | null>(null);
    useEffect(() => {
      const prev = prevStickyScrollRef.current;
      prevStickyScrollRef.current = stickyScroll;
      if (prev === stickyScroll) return; // Skip — stickyScroll didn't change

      debug(`STICKY PROP: ${prev} -> ${stickyScroll}`);
      isStickyRef.current = stickyScroll;
      if (stickyScroll) {
        scrollTopRef.current = maxScroll;
        forceRender();
      }
    }, [stickyScroll, maxScroll, forceRender]);

    const scrollTo = useCallback(
      (y: number) => {
        const clamped = clamp(y, 0, maxScroll);
        debug(`scrollTo(${y}) -> clamped=${clamped} maxScroll=${maxScroll} prev=${scrollTopRef.current}`);
        isStickyRef.current = false;
        scrollTopRef.current = clamp(y, 0, maxScroll);
        forceRender();
      },
      [maxScroll, forceRender],
    );

    const scrollBy = useCallback(
      (dy: number) => {
        const prev = scrollTopRef.current;
        const next = clamp(prev + dy, 0, maxScroll);
        debug(`scrollBy(${dy}) prev=${prev} -> next=${next} maxScroll=${maxScroll}`);
        isStickyRef.current = false;
        scrollTopRef.current = next;
        if (next >= maxScroll) {
          isStickyRef.current = true;
        }
        forceRender();
      },
      [maxScroll, forceRender],
    );

    const scrollToBottom = useCallback(() => {
      debug(`scrollToBottom()`);
      isStickyRef.current = true;
      scrollTopRef.current = maxScroll;
      forceRender();
    }, [maxScroll, forceRender]);

    useImperativeHandle(
      ref,
      () => ({
        scrollTo,
        scrollBy,
        scrollToBottom,
        isSticky: () => isStickyRef.current,
        getScrollTop: () =>
          isStickyRef.current ? maxScroll : scrollTopRef.current,
        getViewportHeight: () => vp,
        getScrollHeight: () => totalRows,
        getViewportTop: () => {
          const rows = process.stdout.rows ?? 24;
          return rows - vp - FOOTER_ROWS;
        },
      }),
      [scrollTo, scrollBy, scrollToBottom, maxScroll, vp, totalRows],
    );

    // The @jrichman/ink renderer reads this prop and handles:
    // 1. Viewport clipping (constant output height → no bouncing)
    // 2. Content translation (y - scrollTop)
    // 3. Child culling (skip nodes outside visible range)
    const rendererScrollTop = isStickyRef.current
      ? Number.MAX_SAFE_INTEGER
      : scrollTopRef.current;

    debug(`RENDER: totalRows=${totalRows} vp=${vp} maxScroll=${maxScroll} scrollTop=${rendererScrollTop} isSticky=${isStickyRef.current} tick=${renderTick}`);

    const childArray = React.Children.toArray(children);

    // Mirrors Gemini CLI's VirtualizedList structure:
    // Outer Box: overflowY='scroll' + fixed height → renderer clips output
    // Inner Box: flexShrink={0} → prevents Yoga from compressing content
    return (
      <Box
        overflowY="scroll"
        height={vp}
        scrollTop={rendererScrollTop}
        flexDirection="column"
        flexShrink={0}
      >
        <Box flexShrink={0} flexDirection="column">
          {childArray}
        </Box>
      </Box>
    );
  },
);
