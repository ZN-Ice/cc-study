/**
 * Fork Subagent unit tests.
 *
 * Covers: buildForkedMessages, buildChildMessage, isInForkChild,
 * buildWorktreeNotice, FORK_AGENT definition, isForkSubagentEnabled.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  FORK_AGENT,
  buildForkedMessages,
  buildChildMessage,
  isInForkChild,
  buildWorktreeNotice,
  isForkSubagentEnabled,
  FORK_SUBAGENT_TYPE,
} from "../../../src/tools/AgentTool/forkSubagent.js";
import type { AssistantMessage, UserMessage, Message } from "../../../src/messages.js";
import { createAssistantMessage, createUserMessage } from "../../../src/messages.js";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeAssistantWithToolUse(
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>,
): AssistantMessage {
  return createAssistantMessage({
    content: [
      { type: "text", text: "I will use some tools." },
      ...toolUses.map((tu) => ({
        type: "tool_use" as const,
        id: tu.id,
        name: tu.name,
        input: tu.input,
      })),
    ],
    model: "test-model",
    stopReason: "tool_use",
  });
}

// ──────────────────────────────────────────────
// isForkSubagentEnabled
// ──────────────────────────────────────────────

describe("isForkSubagentEnabled", () => {
  const originalEnv = process.env.CC_FORK_SUBAGENT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CC_FORK_SUBAGENT;
    } else {
      process.env.CC_FORK_SUBAGENT = originalEnv;
    }
  });

  test("returns false when CC_FORK_SUBAGENT is not set", () => {
    delete process.env.CC_FORK_SUBAGENT;
    expect(isForkSubagentEnabled()).toBe(false);
  });

  test("returns false when CC_FORK_SUBAGENT is '0'", () => {
    process.env.CC_FORK_SUBAGENT = "0";
    expect(isForkSubagentEnabled()).toBe(false);
  });

  test("returns true when CC_FORK_SUBAGENT is '1'", () => {
    process.env.CC_FORK_SUBAGENT = "1";
    expect(isForkSubagentEnabled()).toBe(true);
  });
});

// ──────────────────────────────────────────────
// FORK_AGENT
// ──────────────────────────────────────────────

describe("FORK_AGENT", () => {
  test("has agentType 'fork'", () => {
    expect(FORK_AGENT.agentType).toBe("fork");
  });

  test("tools is ['*'] for full inheritance", () => {
    expect(FORK_AGENT.tools).toEqual(["*"]);
  });

  test("permissionMode is 'bubble'", () => {
    expect(FORK_AGENT.permissionMode).toBe("bubble");
  });

  test("model is 'inherit'", () => {
    expect(FORK_AGENT.model).toBe("inherit");
  });

  test("maxTurns is 200", () => {
    expect(FORK_AGENT.maxTurns).toBe(200);
  });

  test("getSystemPrompt returns empty string", () => {
    expect(FORK_AGENT.getSystemPrompt()).toBe("");
  });
});

// ──────────────────────────────────────────────
// buildForkedMessages
// ──────────────────────────────────────────────

describe("buildForkedMessages", () => {
  test("returns cloned assistant + user message with placeholder results", () => {
    const assistant = makeAssistantWithToolUse([
      { id: "tu-1", name: "Read", input: { file_path: "/tmp/a.txt" } },
      { id: "tu-2", name: "Bash", input: { command: "ls" } },
    ]);

    const messages = buildForkedMessages("research the codebase", assistant);

    // Should return 2 messages: cloned assistant + user message
    expect(messages).toHaveLength(2);
    expect(messages[0]!.type).toBe("assistant");
    expect(messages[1]!.type).toBe("user");
  });

  test("cloned assistant preserves all content blocks", () => {
    const assistant = makeAssistantWithToolUse([
      { id: "tu-1", name: "Read", input: { file_path: "/tmp/a.txt" } },
    ]);

    const [clonedAssistant] = buildForkedMessages("test directive", assistant);
    expect(clonedAssistant!.type).toBe("assistant");

    // Should have text + tool_use = 2 content blocks
    const content = (clonedAssistant as AssistantMessage).content;
    expect(content).toHaveLength(2);
    expect(content[0]!.type).toBe("text");
    expect(content[1]!.type).toBe("tool_use");
  });

  test("cloned assistant has different id from original", () => {
    const assistant = makeAssistantWithToolUse([
      { id: "tu-1", name: "Read", input: { file_path: "/tmp/a.txt" } },
    ]);

    const [clonedAssistant] = buildForkedMessages("test", assistant);
    expect((clonedAssistant as AssistantMessage).id).not.toBe(assistant.id);
  });

  test("user message has placeholder tool_results for all tool_use blocks", () => {
    const assistant = makeAssistantWithToolUse([
      { id: "tu-1", name: "Read", input: { file_path: "/tmp/a.txt" } },
      { id: "tu-2", name: "Bash", input: { command: "ls" } },
      { id: "tu-3", name: "Grep", input: { pattern: "TODO" } },
    ]);

    const [, userMsg] = buildForkedMessages("do something", assistant);
    const content = (userMsg as UserMessage).content;

    // 3 tool_results + 1 directive text = 4 blocks
    const toolResults = content.filter((b) => b.type === "tool_result");
    const textBlocks = content.filter((b) => b.type === "text");

    expect(toolResults).toHaveLength(3);
    expect(textBlocks).toHaveLength(1);
  });

  test("all placeholder results have identical content", () => {
    const assistant = makeAssistantWithToolUse([
      { id: "tu-1", name: "Read", input: { file_path: "/tmp/a.txt" } },
      { id: "tu-2", name: "Bash", input: { command: "ls" } },
    ]);

    const [, userMsg] = buildForkedMessages("test", assistant);
    const content = (userMsg as UserMessage).content;
    const toolResults = content.filter((b) => b.type === "tool_result");

    // All tool_results should have the same content string
    const contents = toolResults.map((b) => (b as { type: "tool_result"; content: string }).content);
    const uniqueContents = new Set(contents);
    expect(uniqueContents.size).toBe(1);
  });

  test("tool_results reference correct tool_use_ids", () => {
    const assistant = makeAssistantWithToolUse([
      { id: "tu-1", name: "Read", input: { file_path: "/tmp/a.txt" } },
      { id: "tu-2", name: "Bash", input: { command: "ls" } },
    ]);

    const [, userMsg] = buildForkedMessages("test", assistant);
    const toolResults = (userMsg as UserMessage).content.filter(
      (b) => b.type === "tool_result",
    );

    const ids = toolResults.map(
      (b) => (b as { type: "tool_result"; tool_use_id: string }).tool_use_id,
    );
    expect(ids).toContain("tu-1");
    expect(ids).toContain("tu-2");
  });

  test("directive text block is at the end of user message", () => {
    const assistant = makeAssistantWithToolUse([
      { id: "tu-1", name: "Read", input: { file_path: "/tmp/a.txt" } },
    ]);

    const [, userMsg] = buildForkedMessages("my directive here", assistant);
    const content = (userMsg as UserMessage).content;
    const lastBlock = content[content.length - 1]!;

    expect(lastBlock.type).toBe("text");
    expect((lastBlock as { type: "text"; text: string }).text).toContain(
      "my directive here",
    );
  });

  test("falls back to simple user message when no tool_use blocks", () => {
    const assistant = createAssistantMessage({
      content: [{ type: "text", text: "No tools needed." }],
      model: "test-model",
    });

    const messages = buildForkedMessages("do something", assistant);

    // Should return a single user message (no assistant clone)
    expect(messages).toHaveLength(1);
    expect(messages[0]!.type).toBe("user");
    const content = (messages[0] as UserMessage).content;
    expect(content.some((b) => b.type === "text")).toBe(true);
  });
});

// ──────────────────────────────────────────────
// buildChildMessage
// ──────────────────────────────────────────────

describe("buildChildMessage", () => {
  test("contains fork-boilerplate tag", () => {
    const msg = buildChildMessage("test directive");
    expect(msg).toContain("<fork-boilerplate>");
    expect(msg).toContain("</fork-boilerplate>");
  });

  test("contains all 10 RULES", () => {
    const msg = buildChildMessage("test directive");
    for (let i = 1; i <= 10; i++) {
      expect(msg).toContain(`${i}.`);
    }
  });

  test("contains the directive after the tag", () => {
    const msg = buildChildMessage("fix the auth bug");
    expect(msg).toContain("fix the auth bug");
  });

  test("contains structured output format", () => {
    const msg = buildChildMessage("test");
    expect(msg).toContain("Scope:");
    expect(msg).toContain("Result:");
  });

  test("contains directive prefix", () => {
    const msg = buildChildMessage("test");
    expect(msg).toContain("Your directive: test");
  });
});

// ──────────────────────────────────────────────
// isInForkChild
// ──────────────────────────────────────────────

describe("isInForkChild", () => {
  test("returns false for empty messages", () => {
    expect(isInForkChild([])).toBe(false);
  });

  test("returns false for messages without fork boilerplate", () => {
    const messages: Message[] = [
      createUserMessage("Hello, how are you?"),
      createAssistantMessage({ content: [{ type: "text", text: "Fine, thanks!" }], model: "test" }),
    ];
    expect(isInForkChild(messages)).toBe(false);
  });

  test("returns true when user message contains fork-boilerplate", () => {
    const messages: Message[] = [
      createUserMessage("Normal message"),
      createUserMessage([
        { type: "tool_result" as const, tool_use_id: "tu-1", content: "some result" },
      ]),
      createUserMessage(
        "<fork-boilerplate>Some fork rules here</fork-boilerplate>\nYour directive: do something",
      ),
    ];
    expect(isInForkChild(messages)).toBe(true);
  });

  test("returns false for system messages", () => {
    const messages: Message[] = [
      { type: "system", id: "sys-1", content: [{ type: "text", text: "system msg" }], timestamp: Date.now() },
    ];
    expect(isInForkChild(messages)).toBe(false);
  });
});

// ──────────────────────────────────────────────
// buildWorktreeNotice
// ──────────────────────────────────────────────

describe("buildWorktreeNotice", () => {
  test("contains parent working directory", () => {
    const notice = buildWorktreeNotice("/home/user/project", "/home/user/project/.claude/worktrees/agent-abc");
    expect(notice).toContain("/home/user/project");
  });

  test("contains worktree path", () => {
    const notice = buildWorktreeNotice("/home/user/project", "/home/user/project/.claude/worktrees/agent-abc");
    expect(notice).toContain("/home/user/project/.claude/worktrees/agent-abc");
  });

  test("mentions translating paths", () => {
    const notice = buildWorktreeNotice("/parent", "/worktree");
    expect(notice.toLowerCase()).toContain("translate");
  });

  test("mentions re-reading files", () => {
    const notice = buildWorktreeNotice("/parent", "/worktree");
    expect(notice.toLowerCase()).toContain("re-read");
  });

  test("mentions isolated/changes", () => {
    const notice = buildWorktreeNotice("/parent", "/worktree");
    expect(notice.toLowerCase()).toContain("isolat");
  });
});

// ──────────────────────────────────────────────
// FORK_SUBAGENT_TYPE constant
// ──────────────────────────────────────────────

describe("FORK_SUBAGENT_TYPE", () => {
  test("is 'fork'", () => {
    expect(FORK_SUBAGENT_TYPE).toBe("fork");
  });
});
