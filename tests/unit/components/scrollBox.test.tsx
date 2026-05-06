import { describe, test, expect } from "vitest";
import React, { createRef } from "react";
import { render } from "ink-testing-library";
import { ScrollBox, estimateLines } from "../../../src/components/ScrollBox.js";
import type { ScrollBoxHandle } from "../../../src/components/ScrollBox.js";
import { Text } from "ink";
import type { Message } from "../../../src/messages.js";

function makeChildren(count: number): React.ReactElement[] {
  return Array.from({ length: count }, (_, i) => (
    <Text key={i}>Line {i}</Text>
  ));
}

describe("ScrollBox", () => {
  test("renders children in fixed-height viewport", () => {
    const children = makeChildren(5);
    const { lastFrame } = render(
      <ScrollBox viewportHeight={10} totalRows={5} stickyScroll={false}>
        {children}
      </ScrollBox>,
    );
    const frame = lastFrame();
    for (let i = 0; i < 5; i++) {
      expect(frame).toContain(`Line ${i}`);
    }
  });

  test("viewport clips output to viewportHeight when content exceeds", () => {
    const children = makeChildren(20);
    const ref = createRef<ScrollBoxHandle>();
    const { lastFrame } = render(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={20} stickyScroll={false}>
        {children}
      </ScrollBox>,
    );
    // With @jrichman/ink, the renderer clips output to viewport height.
    // scrollTop=0 shows the first children.
    const frame = lastFrame();
    expect(frame).toBeTruthy();
    expect(ref.current?.getViewportHeight()).toBe(5);
    expect(ref.current?.getScrollTop()).toBe(0);
  });

  test("sticky scroll auto-follows when new children added", () => {
    const ref = createRef<ScrollBoxHandle>();
    const children5 = makeChildren(5);
    const children10 = makeChildren(10);

    const { rerender } = render(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={5} stickyScroll={true}>
        {children5}
      </ScrollBox>,
    );

    expect(ref.current?.getScrollTop()).toBe(0);

    rerender(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={10} stickyScroll={true}>
        {children10}
      </ScrollBox>,
    );

    expect(ref.current?.getScrollTop()).toBe(5);
    expect(ref.current?.isSticky()).toBe(true);
  });

  test("scrollBy breaks stickiness", () => {
    const ref = createRef<ScrollBoxHandle>();
    const children = makeChildren(20);

    render(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={20} stickyScroll={true}>
        {children}
      </ScrollBox>,
    );

    expect(ref.current?.isSticky()).toBe(true);
    ref.current?.scrollBy(-3);
    expect(ref.current?.isSticky()).toBe(false);
  });

  test("scrollToBottom restores stickiness", () => {
    const ref = createRef<ScrollBoxHandle>();
    const children = makeChildren(20);

    render(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={20} stickyScroll={true}>
        {children}
      </ScrollBox>,
    );

    ref.current?.scrollBy(-3);
    expect(ref.current?.isSticky()).toBe(false);

    ref.current?.scrollToBottom();
    expect(ref.current?.isSticky()).toBe(true);
  });

  test("scrollTo sets precise position", () => {
    const ref = createRef<ScrollBoxHandle>();
    const children = makeChildren(20);

    render(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={20} stickyScroll={false}>
        {children}
      </ScrollBox>,
    );

    ref.current?.scrollTo(7);
    expect(ref.current?.getScrollTop()).toBe(7);
  });

  test("empty children renders empty", () => {
    const { lastFrame } = render(
      <ScrollBox viewportHeight={10} totalRows={0}>
        {[]}
      </ScrollBox>,
    );
    const frame = lastFrame();
    expect(frame).not.toContain("Line");
  });

  test("scrollTop clamped to valid range", () => {
    const ref = createRef<ScrollBoxHandle>();
    const children = makeChildren(10);

    render(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={10} stickyScroll={false}>
        {children}
      </ScrollBox>,
    );

    ref.current?.scrollTo(100);
    expect(ref.current?.getScrollTop()).toBe(5);

    ref.current?.scrollTo(-10);
    expect(ref.current?.getScrollTop()).toBe(0);
  });

  test("ScrollBoxHandle imperative API works via ref", () => {
    const ref = createRef<ScrollBoxHandle>();
    const children = makeChildren(30);

    render(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={30} stickyScroll={false}>
        {children}
      </ScrollBox>,
    );

    expect(ref.current).not.toBeNull();
    expect(ref.current?.getViewportHeight()).toBe(5);
    expect(typeof ref.current?.scrollTo).toBe("function");
    expect(typeof ref.current?.scrollBy).toBe("function");
    expect(typeof ref.current?.scrollToBottom).toBe("function");
    expect(typeof ref.current?.isSticky).toBe("function");
    expect(typeof ref.current?.getScrollTop).toBe("function");
  });

  // ========== Sticky Scroll behavior ==========

  describe("Sticky Scroll - Content Growth Detection", () => {
    test("does NOT follow when content grows but user scrolled up", () => {
      const ref = createRef<ScrollBoxHandle>();
      const { rerender } = render(
        <ScrollBox ref={ref} viewportHeight={5} totalRows={10} stickyScroll={true}>
          {makeChildren(10)}
        </ScrollBox>,
      );

      expect(ref.current?.getScrollTop()).toBe(5);

      ref.current?.scrollBy(-3);
      expect(ref.current?.isSticky()).toBe(false);
      expect(ref.current?.getScrollTop()).toBe(2);

      rerender(
        <ScrollBox ref={ref} viewportHeight={5} totalRows={15} stickyScroll={true}>
          {makeChildren(15)}
        </ScrollBox>,
      );

      expect(ref.current?.getScrollTop()).toBe(2);
      expect(ref.current?.isSticky()).toBe(false);
    });

    test("follows when sticky is on and content grows", () => {
      const ref = createRef<ScrollBoxHandle>();
      const { rerender } = render(
        <ScrollBox ref={ref} viewportHeight={5} totalRows={5} stickyScroll={true}>
          {makeChildren(5)}
        </ScrollBox>,
      );

      expect(ref.current?.getScrollTop()).toBe(0);

      rerender(
        <ScrollBox ref={ref} viewportHeight={5} totalRows={10} stickyScroll={true}>
          {makeChildren(10)}
        </ScrollBox>,
      );

      expect(ref.current?.getScrollTop()).toBe(5);
      expect(ref.current?.isSticky()).toBe(true);
    });
  });

  describe("Sticky Scroll - Prop Changes", () => {
    test("stickyScroll prop change to true restores stickiness", () => {
      const ref = createRef<ScrollBoxHandle>();
      const { rerender } = render(
        <ScrollBox ref={ref} viewportHeight={5} totalRows={10} stickyScroll={false}>
          {makeChildren(10)}
        </ScrollBox>,
      );

      expect(ref.current?.isSticky()).toBe(false);
      expect(ref.current?.getScrollTop()).toBe(0);

      rerender(
        <ScrollBox ref={ref} viewportHeight={5} totalRows={10} stickyScroll={true}>
          {makeChildren(10)}
        </ScrollBox>,
      );

      expect(ref.current?.isSticky()).toBe(true);
      expect(ref.current?.getScrollTop()).toBe(5);
    });

    test("stickyScroll prop change to false breaks stickiness", () => {
      const ref = createRef<ScrollBoxHandle>();
      const { rerender } = render(
        <ScrollBox ref={ref} viewportHeight={5} totalRows={10} stickyScroll={true}>
          {makeChildren(10)}
        </ScrollBox>,
      );

      expect(ref.current?.isSticky()).toBe(true);

      rerender(
        <ScrollBox ref={ref} viewportHeight={5} totalRows={10} stickyScroll={false}>
          {makeChildren(10)}
        </ScrollBox>,
      );

      expect(ref.current?.isSticky()).toBe(false);
    });
  });

  // ========== estimateLines tests ==========

  describe("estimateLines", () => {
    function makeMsg(type: "user" | "assistant" | "system", text: string): Message {
      return {
        id: `msg-${Math.random()}`,
        type,
        content: [{ type: "text", text }],
      } as Message;
    }

    test("single short line message = 3 rows", () => {
      const msg = makeMsg("user", "hello");
      expect(estimateLines(msg)).toBe(3);
    });

    test("multi-line text message counts newlines", () => {
      const msg = makeMsg("assistant", "line1\nline2\nline3");
      expect(estimateLines(msg)).toBe(5);
    });

    test("message with tool_use block", () => {
      const msg: Message = {
        id: "test",
        type: "assistant",
        content: [
          { type: "text", text: "Let me read that file" },
          { type: "tool_use", id: "tu1", name: "Read", input: { file_path: "/foo" } },
        ],
      } as Message;
      expect(estimateLines(msg)).toBe(4);
    });
  });
});
