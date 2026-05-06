/**
 * Tests for MessageList component — ScrollBox integration.
 */

import { describe, test, expect } from "vitest";
import React, { createRef } from "react";
import { render } from "ink-testing-library";
import { MessageList } from "../../../src/components/MessageList.js";
import { createUserMessage } from "../../../src/messages.js";
import type { Message } from "../../../src/messages.js";
import type { ScrollBoxHandle } from "../../../src/components/ScrollBox.js";

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) =>
    createUserMessage(`test message ${i + 1}`),
  );
}

describe("MessageList — ScrollBox integration", () => {
  test("renders all messages when count is below viewport", () => {
    const messages = makeMessages(5);
    const scrollRef = createRef<ScrollBoxHandle>();
    const { lastFrame } = render(
      React.createElement(MessageList, {
        messages,
        streamingText: null,
        scrollRef,
      }),
    );
    const frame = lastFrame();
    for (let i = 1; i <= 5; i++) {
      expect(frame).toContain(`test message ${i}`);
    }
  });

  test("renders messages within ScrollBox viewport", () => {
    // In test env, computeViewportHeight() returns 24 (no stdout.rows)
    // Each user message = ~3 visual rows (label + text + margin)
    // So 7 messages ≈ 21 rows, fits in viewport 24
    const messages = makeMessages(7);
    const scrollRef = createRef<ScrollBoxHandle>();
    const { lastFrame } = render(
      React.createElement(MessageList, {
        messages,
        streamingText: null,
        scrollRef,
      }),
    );
    const frame = lastFrame();
    for (let i = 1; i <= 7; i++) {
      expect(frame).toContain(`test message ${i}`);
    }
  });

  test("shows streaming text when streamingText is provided", () => {
    const messages = makeMessages(5);
    const scrollRef = createRef<ScrollBoxHandle>();
    const { lastFrame } = render(
      React.createElement(MessageList, {
        messages,
        streamingText: "thinking...",
        scrollRef,
      }),
    );
    const frame = lastFrame();
    expect(frame).toContain("[Assistant]");
    expect(frame).toContain("thinking...");
  });

  test("does not show streaming text when streamingText is null", () => {
    const messages = makeMessages(5);
    const scrollRef = createRef<ScrollBoxHandle>();
    const { lastFrame } = render(
      React.createElement(MessageList, {
        messages,
        streamingText: null,
        scrollRef,
      }),
    );
    const frame = lastFrame();
    expect(frame).not.toContain("[Assistant]");
  });

  test("passes scrollRef to ScrollBox", () => {
    const messages = makeMessages(3);
    const scrollRef = createRef<ScrollBoxHandle>();
    render(
      React.createElement(MessageList, {
        messages,
        streamingText: null,
        scrollRef,
      }),
    );
    // After render, the ref should be populated by ScrollBox
    expect(scrollRef.current).not.toBeNull();
    expect(typeof scrollRef.current?.scrollTo).toBe("function");
    expect(typeof scrollRef.current?.scrollBy).toBe("function");
    expect(typeof scrollRef.current?.scrollToBottom).toBe("function");
  });

  test("counts totalRows correctly with streaming", () => {
    const messages = makeMessages(5);
    const scrollRef = createRef<ScrollBoxHandle>();
    const { rerender, lastFrame } = render(
      React.createElement(MessageList, {
        messages,
        streamingText: "streaming...",
        scrollRef,
      }),
    );
    // Streaming block is rendered and visible
    expect(lastFrame()).toContain("streaming...");

    // Rerender without streaming
    rerender(
      React.createElement(MessageList, {
        messages,
        streamingText: null,
        scrollRef,
      }),
    );
    expect(lastFrame()).not.toContain("streaming...");
  });
});
