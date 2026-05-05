/**
 * Tests for MessageList component — pagination behavior.
 */

import { describe, test, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { MessageList } from "../../../src/components/MessageList.js";
import { createUserMessage } from "../../../src/messages.js";
import type { Message } from "../../../src/messages.js";

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) =>
    createUserMessage(`test message ${i + 1}`),
  );
}

describe("MessageList — pagination", () => {
  test("renders all messages when count is below pageSize", () => {
    const messages = makeMessages(5);
    const { lastFrame } = render(
      React.createElement(MessageList, {
        messages,
        streamingText: null,
        pageSize: 10,
      }),
    );
    const frame = lastFrame();
    for (let i = 1; i <= 5; i++) {
      expect(frame).toContain(`test message ${i}`);
    }
    // No pagination footer
    expect(frame).not.toContain("more messages");
  });

  test("renders all messages when count equals pageSize", () => {
    const messages = makeMessages(10);
    const { lastFrame } = render(
      React.createElement(MessageList, {
        messages,
        streamingText: null,
        pageSize: 10,
      }),
    );
    const frame = lastFrame();
    for (let i = 1; i <= 10; i++) {
      expect(frame).toContain(`test message ${i}`);
    }
    expect(frame).not.toContain("more messages");
  });

  test("shows pagination footer when messages exceed pageSize", () => {
    const messages = makeMessages(25);
    const { lastFrame } = render(
      React.createElement(MessageList, {
        messages,
        streamingText: null,
        pageSize: 10,
      }),
    );
    const frame = lastFrame();
    expect(frame).toContain("more messages");
    expect(frame).toContain("test message 16");
    expect(frame).toContain("test message 25");
  });

  test("shows correct hidden count in footer", () => {
    const messages = makeMessages(30);
    const { lastFrame } = render(
      React.createElement(MessageList, {
        messages,
        streamingText: null,
        pageSize: 20,
      }),
    );
    const frame = lastFrame();
    expect(frame).toContain("10 more messages");
  });

  test("shows all messages when pageSize is not provided (defaults to 20)", () => {
    const messages = makeMessages(5);
    const { lastFrame } = render(
      React.createElement(MessageList, {
        messages,
        streamingText: null,
        // pageSize intentionally omitted — defaults to 20
      }),
    );
    const frame = lastFrame();
    for (let i = 1; i <= 5; i++) {
      expect(frame).toContain(`test message ${i}`);
    }
    expect(frame).not.toContain("more messages");
  });

  test("hides pagination footer during streaming", () => {
    const messages = makeMessages(25);
    const { lastFrame } = render(
      React.createElement(MessageList, {
        messages,
        streamingText: "...",
        pageSize: 10,
      }),
    );
    const frame = lastFrame();
    expect(frame).not.toContain("more messages");
    // Streaming indicator should be present
    expect(frame).toContain("[Assistant]");
  });

  test("shows footer again after streaming stops", () => {
    const messages = makeMessages(25);
    const { lastFrame, rerender } = render(
      React.createElement(MessageList, {
        messages,
        streamingText: "...",
        pageSize: 10,
      }),
    );
    // Footer hidden during streaming
    expect(lastFrame()).not.toContain("more messages");

    // Stop streaming
    rerender(
      React.createElement(MessageList, {
        messages,
        streamingText: null,
        pageSize: 10,
      }),
    );
    // Footer should reappear
    expect(lastFrame()).toContain("more messages");
  });
});
