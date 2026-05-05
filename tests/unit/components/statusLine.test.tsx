/**
 * Tests for StatusLine component.
 */

import { describe, test, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { StatusLine } from "../../../src/components/StatusLine.js";

const idleProps = {
  model: "claude-3",
  tokenUsage: null as never,
  totalCost: 0,
  executingTools: [] as readonly string[],
  isLoading: false,
  sessionDuration: 0,
};

describe("StatusLine", () => {
  test("renders model name in idle state", () => {
    const { lastFrame } = render(
      React.createElement(StatusLine, idleProps),
    );
    expect(lastFrame()).toContain("claude-3");
  });

  test("shows token counts when idle with tokens", () => {
    const { lastFrame } = render(
      React.createElement(StatusLine, {
        ...idleProps,
        tokenUsage: { inputTokens: 1500, outputTokens: 800 },
      }),
    );
    const frame = lastFrame();
    expect(frame).toContain("1,500 in");
    expect(frame).toContain("800 out");
  });

  test("shows cost in green when present", () => {
    const { lastFrame } = render(
      React.createElement(StatusLine, {
        ...idleProps,
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
        totalCost: 150,
      }),
    );
    expect(lastFrame()).toContain("$1.50");
  });

  test("shows executing tools in yellow", () => {
    const { lastFrame } = render(
      React.createElement(StatusLine, {
        ...idleProps,
        executingTools: ["Read", "Grep"],
      }),
    );
    expect(lastFrame()).toContain("[Executing: Read, Grep]");
  });

  test("shows thinking indicator when loading with no executing tools", () => {
    const { lastFrame } = render(
      React.createElement(StatusLine, {
        ...idleProps,
        isLoading: true,
      }),
    );
    expect(lastFrame()).toContain("● Thinking...");
  });

  test("shows total tokens during thinking mode", () => {
    const { lastFrame } = render(
      React.createElement(StatusLine, {
        ...idleProps,
        tokenUsage: { inputTokens: 2000, outputTokens: 1000 },
        isLoading: true,
      }),
    );
    expect(lastFrame()).toContain("3,000 tokens");
  });

  test("hides cost when totalCost is 0", () => {
    const { lastFrame } = render(
      React.createElement(StatusLine, {
        ...idleProps,
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
        totalCost: 0,
      }),
    );
    expect(lastFrame()).not.toContain("$");
  });

  test("handles null tokenUsage without error", () => {
    const { lastFrame } = render(
      React.createElement(StatusLine, {
        ...idleProps,
        tokenUsage: null,
      }),
    );
    expect(lastFrame()).toContain("claude-3");
  });

  test("shows session duration when non-zero", () => {
    const { lastFrame } = render(
      React.createElement(StatusLine, {
        ...idleProps,
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
        sessionDuration: 90_000,
      }),
    );
    expect(lastFrame()).toContain("1m 30s");
  });

  test("hides session duration when zero", () => {
    const { lastFrame } = render(
      React.createElement(StatusLine, {
        ...idleProps,
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
        sessionDuration: 0,
      }),
    );
    expect(lastFrame()).not.toContain("0s");
  });
});
