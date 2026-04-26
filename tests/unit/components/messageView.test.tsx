/**
 * Tests for MessageView component — tool_use and tool_result rendering.
 */

import { describe, test, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { MessageView } from "../../../src/components/MessageView.js";
import type { Message } from "../../../src/messages.js";

// ──────────────────────────────────────────────
// tool_use display tests
// ──────────────────────────────────────────────

describe("MessageView — tool_use display", () => {
  function makeAssistantMessage(content: Message["content"]): Message {
    return {
      type: "assistant",
      id: "test",
      content,
      timestamp: Date.now(),
      model: "test",
      stopReason: "tool_use",
    };
  }

  test("renders Read tool_use with file path", () => {
    const msg = makeAssistantMessage([
      { type: "tool_use", id: "1", name: "Read", input: { file_path: "/tmp/test.ts" } },
    ]);
    const { lastFrame } = render(React.createElement(MessageView, { message: msg }));
    expect(lastFrame()).toContain("Read: /tmp/test.ts");
  });

  test("renders Read tool_use with offset/limit", () => {
    const msg = makeAssistantMessage([
      { type: "tool_use", id: "1", name: "Read", input: { file_path: "/tmp/a.ts", offset: 10, limit: 20 } },
    ]);
    const { lastFrame } = render(React.createElement(MessageView, { message: msg }));
    expect(lastFrame()).toContain("lines 10-29");
  });

  test("renders Write tool_use with line count", () => {
    const msg = makeAssistantMessage([
      { type: "tool_use", id: "1", name: "Write", input: { file_path: "/tmp/new.ts", content: "line1\nline2\nline3" } },
    ]);
    const { lastFrame } = render(React.createElement(MessageView, { message: msg }));
    expect(lastFrame()).toContain("Write: /tmp/new.ts");
    expect(lastFrame()).toContain("3 lines");
  });

  test("renders Edit tool_use with truncated old_string", () => {
    const msg = makeAssistantMessage([
      { type: "tool_use", id: "1", name: "Edit", input: { file_path: "/tmp/a.ts", old_string: "function hello()", new_string: "function greet()" } },
    ]);
    const { lastFrame } = render(React.createElement(MessageView, { message: msg }));
    expect(lastFrame()).toContain("Edit: /tmp/a.ts");
    expect(lastFrame()).toContain("function hello()");
  });

  test("renders Bash tool_use with truncated command", () => {
    const msg = makeAssistantMessage([
      { type: "tool_use", id: "1", name: "Bash", input: { command: "npm install --save-dev vitest" } },
    ]);
    const { lastFrame } = render(React.createElement(MessageView, { message: msg }));
    expect(lastFrame()).toContain("Bash: npm install --save-dev vitest");
  });

  test("renders Glob tool_use with pattern", () => {
    const msg = makeAssistantMessage([
      { type: "tool_use", id: "1", name: "Glob", input: { pattern: "**/*.ts" } },
    ]);
    const { lastFrame } = render(React.createElement(MessageView, { message: msg }));
    expect(lastFrame()).toContain("Glob: **/*.ts");
  });

  test("renders Grep tool_use with pattern", () => {
    const msg = makeAssistantMessage([
      { type: "tool_use", id: "1", name: "Grep", input: { pattern: "TODO" } },
    ]);
    const { lastFrame } = render(React.createElement(MessageView, { message: msg }));
    expect(lastFrame()).toContain('Grep: "TODO"');
  });

  test("renders Agent tool_use with type and description", () => {
    const msg = makeAssistantMessage([
      { type: "tool_use", id: "1", name: "Agent", input: { description: "search code", prompt: "Find X", subagent_type: "Explore" } },
    ]);
    const { lastFrame } = render(React.createElement(MessageView, { message: msg }));
    expect(lastFrame()).toContain("Agent (Explore): search code");
  });
});

// ──────────────────────────────────────────────
// tool_result display tests
// ──────────────────────────────────────────────

describe("MessageView — tool_result display", () => {
  function makeUserMessage(content: Message["content"]): Message {
    return {
      type: "user",
      id: "test",
      content,
      timestamp: Date.now(),
    };
  }

  test("renders error tool_result in red", () => {
    const msg = makeUserMessage([
      { type: "tool_result", tool_use_id: "1", content: "Something went wrong", is_error: true },
    ]);
    const { lastFrame } = render(React.createElement(MessageView, { message: msg }));
    expect(lastFrame()).toContain("Something went wrong");
  });

  test("renders Write result with create action", () => {
    const msg = makeUserMessage([
      {
        type: "tool_result",
        tool_use_id: "1",
        content: "File created successfully at: /tmp/new.ts (3 lines)",
        tool_name: "Write",
        metadata: { path: "/tmp/new.ts", action: "create", lines: 3 },
      },
    ]);
    const { lastFrame } = render(React.createElement(MessageView, { message: msg }));
    expect(lastFrame()).toContain("Created: /tmp/new.ts");
    expect(lastFrame()).toContain("3 lines");
  });

  test("renders Edit result with replacement count", () => {
    const msg = makeUserMessage([
      {
        type: "tool_result",
        tool_use_id: "1",
        content: "Updated",
        tool_name: "Edit",
        metadata: { path: "/tmp/a.ts", action: "edit", replacements: 1 },
      },
    ]);
    const { lastFrame } = render(React.createElement(MessageView, { message: msg }));
    expect(lastFrame()).toContain("Edited: /tmp/a.ts");
  });

  test("renders Glob result with file count", () => {
    const msg = makeUserMessage([
      {
        type: "tool_result",
        tool_use_id: "1",
        content: "a.ts\nb.ts",
        tool_name: "Glob",
        metadata: { pattern: "*.ts", count: 2 },
      },
    ]);
    const { lastFrame } = render(React.createElement(MessageView, { message: msg }));
    expect(lastFrame()).toContain("2 files found");
  });

  test("renders Grep result with match count", () => {
    const msg = makeUserMessage([
      {
        type: "tool_result",
        tool_use_id: "1",
        content: "5 matches",
        tool_name: "Grep",
        metadata: { pattern: "TODO", count: 5 },
      },
    ]);
    const { lastFrame } = render(React.createElement(MessageView, { message: msg }));
    expect(lastFrame()).toContain('"TODO"');
    expect(lastFrame()).toContain("5 matches");
  });

  test("renders Agent result with tool use count and duration", () => {
    const msg = makeUserMessage([
      {
        type: "tool_result",
        tool_use_id: "1",
        content: "Found the answer",
        tool_name: "Agent",
        metadata: { agentType: "Explore", toolUseCount: 3, durationMs: 5200 },
      },
    ]);
    const { lastFrame } = render(React.createElement(MessageView, { message: msg }));
    expect(lastFrame()).toContain("Explore");
    expect(lastFrame()).toContain("3 tool uses");
    expect(lastFrame()).toContain("5.2s");
  });

  test("renders Bash result with duration", () => {
    const msg = makeUserMessage([
      {
        type: "tool_result",
        tool_use_id: "1",
        content: "hello\nworld",
        tool_name: "Bash",
        metadata: { command: "echo hello && echo world", exitCode: 0, durationMs: 150 },
      },
    ]);
    const { lastFrame } = render(React.createElement(MessageView, { message: msg }));
    expect(lastFrame()).toContain("echo hello && echo world");
    expect(lastFrame()).toContain("150ms");
  });

  test("renders fallback for unknown tool results", () => {
    const msg = makeUserMessage([
      { type: "tool_result", tool_use_id: "1", content: "some output text" },
    ]);
    const { lastFrame } = render(React.createElement(MessageView, { message: msg }));
    expect(lastFrame()).toContain("some output text");
  });
});
