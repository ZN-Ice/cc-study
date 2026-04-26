/**
 * Tests for the agent orchestrator: tool filtering and sub-agent loop.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { ToolRegistry } from "../../../../src/tools/registry.js";
import { filterToolsForAgent, runSubAgent } from "../../../../src/tools/AgentTool/orchestrator.js";
import type { AgentDefinition } from "../../../../src/tools/AgentTool/types.js";
import type { ToolContext } from "../../../../src/tools/types.js";
import type { APIConfig } from "../../../../src/services/api.js";
import { FileReadTool } from "../../../../src/tools/FileReadTool.js";
import { FileWriteTool } from "../../../../src/tools/FileWriteTool.js";
import { FileEditTool } from "../../../../src/tools/FileEditTool.js";
import { BashTool } from "../../../../src/tools/BashTool.js";
import { GlobTool } from "../../../../src/tools/GlobTool.js";
import { GrepTool } from "../../../../src/tools/GrepTool.js";

// Mock streamChat
vi.mock("../../../../src/services/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/services/api.js")>();
  return { ...actual, streamChat: vi.fn() };
});

import { streamChat } from "../../../../src/services/api.js";

const mockedStreamChat = vi.mocked(streamChat);

function createTestRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(FileReadTool);
  registry.register(FileWriteTool);
  registry.register(FileEditTool);
  registry.register(BashTool);
  registry.register(GlobTool);
  registry.register(GrepTool);
  return registry;
}

function createTestContext(): ToolContext {
  return {
    workingDirectory: process.cwd(),
    abortSignal: new AbortController().signal,
  };
}

function createTestApiConfig(): APIConfig {
  return {
    apiKey: "test-key",
    model: "test-model",
    maxTokens: 4096,
    systemPrompt: "test prompt",
    temperature: 0,
  };
}

/** Helper: create a mock SSE stream that yields the given events */
function* mockStream(events: unknown[]): Generator<unknown, void> {
  for (const event of events) {
    yield event;
  }
}

describe("filterToolsForAgent", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createTestRegistry();
  });

  test("undefined tools and disallowedTools passes all tools through", () => {
    const def: AgentDefinition = {
      agentType: "test",
      whenToUse: "test",
      getSystemPrompt: () => "test",
    };
    const filtered = filterToolsForAgent(registry, def);
    expect(filtered.size).toBe(registry.size);
    expect(filtered.getNames()).toEqual(expect.arrayContaining(["Read", "Write", "Edit", "Bash", "Glob", "Grep"]));
  });

  test("disallowedTools removes specified tools", () => {
    const def: AgentDefinition = {
      agentType: "test",
      whenToUse: "test",
      getSystemPrompt: () => "test",
      disallowedTools: ["Write", "Edit"],
    };
    const filtered = filterToolsForAgent(registry, def);
    expect(filtered.size).toBe(4);
    expect(filtered.has("Write")).toBe(false);
    expect(filtered.has("Edit")).toBe(false);
    expect(filtered.has("Read")).toBe(true);
  });

  test("tools allowlist restricts to specified tools", () => {
    const def: AgentDefinition = {
      agentType: "test",
      whenToUse: "test",
      getSystemPrompt: () => "test",
      tools: ["Read", "Grep", "Glob"],
    };
    const filtered = filterToolsForAgent(registry, def);
    expect(filtered.size).toBe(3);
    expect(filtered.has("Read")).toBe(true);
    expect(filtered.has("Grep")).toBe(true);
    expect(filtered.has("Glob")).toBe(true);
    expect(filtered.has("Write")).toBe(false);
  });

  test("tools with wildcard '*' allows all tools", () => {
    const def: AgentDefinition = {
      agentType: "test",
      whenToUse: "test",
      getSystemPrompt: () => "test",
      tools: ["*"],
    };
    const filtered = filterToolsForAgent(registry, def);
    expect(filtered.size).toBe(registry.size);
  });

  test("both disallowedTools and tools allowlist work together", () => {
    const def: AgentDefinition = {
      agentType: "test",
      whenToUse: "test",
      getSystemPrompt: () => "test",
      tools: ["Read", "Grep", "Glob", "Bash"],
      disallowedTools: ["Bash"],
    };
    const filtered = filterToolsForAgent(registry, def);
    expect(filtered.size).toBe(3);
    expect(filtered.has("Bash")).toBe(false);
    expect(filtered.has("Read")).toBe(true);
  });

  test("disallowedTools with non-existent tool names is safe", () => {
    const def: AgentDefinition = {
      agentType: "test",
      whenToUse: "test",
      getSystemPrompt: () => "test",
      disallowedTools: ["NonExistentTool"],
    };
    const filtered = filterToolsForAgent(registry, def);
    expect(filtered.size).toBe(registry.size);
  });
});

describe("runSubAgent", () => {
  let registry: ToolRegistry;
  let context: ToolContext;
  let apiConfig: APIConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = createTestRegistry();
    context = createTestContext();
    apiConfig = createTestApiConfig();
  });

  test("single turn — returns text from assistant message", async () => {
    const def: AgentDefinition = {
      agentType: "test",
      whenToUse: "test",
      getSystemPrompt: () => "test prompt",
    };

    mockedStreamChat.mockReturnValueOnce(
      mockStream([
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello from agent" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
        { type: "message_stop" },
      ]) as AsyncGenerator<unknown, void>,
    );

    const result = await runSubAgent({
      agentDefinition: def,
      prompt: "Say hello",
      apiConfig,
      parentRegistry: registry,
      context,
    });

    expect(result.agentType).toBe("test");
    expect(result.content).toBe("Hello from agent");
    expect(result.totalToolUseCount).toBe(0);
  });

  test("multi-turn — executes tools and loops", async () => {
    const def: AgentDefinition = {
      agentType: "test",
      whenToUse: "test",
      getSystemPrompt: () => "test prompt",
    };

    // First API call: returns tool_use
    mockedStreamChat.mockReturnValueOnce(
      mockStream([
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me read the file." } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool_1", name: "Read", input: {} } },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "tool_use" } },
        { type: "message_stop" },
      ]) as AsyncGenerator<unknown, void>,
    );

    // Second API call: returns text after tool execution
    mockedStreamChat.mockReturnValueOnce(
      mockStream([
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "The file contains hello world." } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
        { type: "message_stop" },
      ]) as AsyncGenerator<unknown, void>,
    );

    const result = await runSubAgent({
      agentDefinition: def,
      prompt: "Read a file",
      apiConfig,
      parentRegistry: registry,
      context,
    });

    expect(result.content).toBe("The file contains hello world.");
    expect(result.totalToolUseCount).toBe(1);
    expect(mockedStreamChat).toHaveBeenCalledTimes(2);
  });

  test("respects maxTurns limit", async () => {
    const def: AgentDefinition = {
      agentType: "test",
      whenToUse: "test",
      getSystemPrompt: () => "test prompt",
    };

    // Each call returns a tool_use (infinite loop if no maxTurns)
    const toolUseStream = () =>
      mockStream([
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "Read", input: {} } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use" } },
        { type: "message_stop" },
      ]) as AsyncGenerator<unknown, void>;

    // Mock enough calls for maxTurns=2
    mockedStreamChat
      .mockReturnValueOnce(toolUseStream())
      .mockReturnValueOnce(toolUseStream());

    const result = await runSubAgent({
      agentDefinition: def,
      prompt: "loop test",
      apiConfig,
      parentRegistry: registry,
      context,
      maxTurns: 2,
    });

    // Should stop after 2 turns even though API keeps returning tool_use
    expect(mockedStreamChat).toHaveBeenCalledTimes(2);
    // No text in the last assistant message (only tool_use), so falls back
    expect(result.totalToolUseCount).toBe(2);
  });

  test("cancellation via AbortSignal stops the loop", async () => {
    const controller = new AbortController();
    const ctx: ToolContext = {
      workingDirectory: process.cwd(),
      abortSignal: controller.signal,
    };

    const def: AgentDefinition = {
      agentType: "test",
      whenToUse: "test",
      getSystemPrompt: () => "test prompt",
    };

    // Abort before stream starts
    controller.abort();

    const result = await runSubAgent({
      agentDefinition: def,
      prompt: "cancelled task",
      apiConfig,
      parentRegistry: registry,
      context: ctx,
    });

    // Should return without calling API
    expect(mockedStreamChat).not.toHaveBeenCalled();
    expect(result.content).toBe("(Agent completed with no text output)");
  });

  test("API error returns error message in result", async () => {
    const def: AgentDefinition = {
      agentType: "test",
      whenToUse: "test",
      getSystemPrompt: () => "test prompt",
    };

    mockedStreamChat.mockImplementation(() => {
      throw new Error("API connection failed");
    });

    const result = await runSubAgent({
      agentDefinition: def,
      prompt: "fail test",
      apiConfig,
      parentRegistry: registry,
      context,
    });

    expect(result.content).toContain("Agent error");
    expect(result.content).toContain("API connection failed");
  });

  test("unknown tool in sub-agent returns error tool result", async () => {
    const def: AgentDefinition = {
      agentType: "test",
      whenToUse: "test",
      getSystemPrompt: () => "test prompt",
      disallowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    };

    // Returns tool_use for a tool that's not in the filtered registry
    mockedStreamChat.mockReturnValueOnce(
      mockStream([
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "NonExistent", input: {} } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use" } },
        { type: "message_stop" },
      ]) as AsyncGenerator<unknown, void>,
    );

    // Second call: final response
    mockedStreamChat.mockReturnValueOnce(
      mockStream([
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "Tool not found." } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
        { type: "message_stop" },
      ]) as AsyncGenerator<unknown, void>,
    );

    const result = await runSubAgent({
      agentDefinition: def,
      prompt: "test unknown tool",
      apiConfig,
      parentRegistry: registry,
      context,
    });

    expect(result.totalToolUseCount).toBe(1);
    expect(result.content).toBe("Tool not found.");
  });
});
