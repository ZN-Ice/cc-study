/**
 * Tests for AgentTool — the Tool interface implementation.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { AgentTool } from "../../../../src/tools/AgentTool/index.js";
import type { ToolContext } from "../../../../src/tools/types.js";
import { ToolRegistry } from "../../../../src/tools/registry.js";

// Mock the orchestrator
vi.mock("../../../../src/tools/AgentTool/orchestrator.js", () => ({
  runSubAgent: vi.fn(),
  filterToolsForAgent: vi.fn(),
}));

import { runSubAgent } from "../../../../src/tools/AgentTool/orchestrator.js";

const mockedRunSubAgent = vi.mocked(runSubAgent);

function createTestContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    workingDirectory: process.cwd(),
    abortSignal: new AbortController().signal,
    apiConfig: {
      apiKey: "test-key",
      model: "test-model",
      maxTokens: 4096,
      systemPrompt: "test",
      temperature: 0,
    },
    toolRegistry: new ToolRegistry(),
    ...overrides,
  };
}

describe("AgentTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateInput", () => {
    test("accepts valid input with default agent type", async () => {
      const result = await AgentTool.validateInput(
        { description: "search", prompt: "Find all TODOs" },
        createTestContext(),
      );
      expect(result.ok).toBe(true);
    });

    test("accepts valid input with explicit agent type", async () => {
      const result = await AgentTool.validateInput(
        { description: "explore", prompt: "Search codebase", subagent_type: "Explore" },
        createTestContext(),
      );
      expect(result.ok).toBe(true);
    });

    test("rejects empty prompt", async () => {
      const result = await AgentTool.validateInput(
        { description: "task", prompt: "" },
        createTestContext(),
      );
      expect(result.ok).toBe(false);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("prompt");
      }
    });

    test("rejects unknown agent type", async () => {
      const result = await AgentTool.validateInput(
        { description: "task", prompt: "Do something", subagent_type: "NonExistentAgent" },
        createTestContext(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Unknown agent type");
        expect(result.error).toContain("NonExistentAgent");
      }
    });
  });

  describe("execute", () => {
    test("returns text result from sub-agent", async () => {
      mockedRunSubAgent.mockResolvedValueOnce({
        agentType: "general-purpose",
        content: "Found 3 TODO comments",
        totalToolUseCount: 2,
        totalDurationMs: 1500,
      });

      const result = await AgentTool.execute(
        { description: "search", prompt: "Find TODOs" },
        createTestContext(),
      );

      expect(result.output).toBe("Found 3 TODO comments");
      expect(result.error).toBeUndefined();
    });

    test("returns error when API config is missing", async () => {
      const ctx = createTestContext({ apiConfig: undefined });

      const result = await AgentTool.execute(
        { description: "task", prompt: "Do something" },
        ctx,
      );

      expect(result.error).toBe(true);
      expect(result.output).toContain("API config");
    });

    test("returns error when tool registry is missing", async () => {
      const ctx = createTestContext({ toolRegistry: undefined });

      const result = await AgentTool.execute(
        { description: "task", prompt: "Do something" },
        ctx,
      );

      expect(result.error).toBe(true);
      expect(result.output).toContain("Tool registry");
    });

    test("handles sub-agent execution error", async () => {
      mockedRunSubAgent.mockRejectedValueOnce(new Error("API timeout"));

      const result = await AgentTool.execute(
        { description: "task", prompt: "Do something" },
        createTestContext(),
      );

      expect(result.error).toBe(true);
      expect(result.output).toContain("Agent execution error");
      expect(result.output).toContain("API timeout");
    });

    test("handles abort gracefully", async () => {
      const controller = new AbortController();
      controller.abort();

      mockedRunSubAgent.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

      const result = await AgentTool.execute(
        { description: "task", prompt: "Do something" },
        createTestContext({ abortSignal: controller.signal }),
      );

      expect(result.error).toBe(true);
      expect(result.output).toContain("cancelled");
    });

    test("uses correct agent type from input", async () => {
      mockedRunSubAgent.mockResolvedValueOnce({
        agentType: "Explore",
        content: "Found files",
        totalToolUseCount: 0,
        totalDurationMs: 500,
      });

      await AgentTool.execute(
        { description: "explore", prompt: "Find files", subagent_type: "Explore" },
        createTestContext(),
      );

      expect(mockedRunSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentDefinition: expect.objectContaining({ agentType: "Explore" }),
        }),
      );
    });
  });

  describe("isSearchOrReadCommand", () => {
    test("returns false for both search and read", () => {
      const result = AgentTool.isSearchOrReadCommand!({ description: "task", prompt: "Do it" });
      expect(result.isSearch).toBe(false);
      expect(result.isRead).toBe(false);
    });
  });

  describe("isReadOnly", () => {
    test("returns false", () => {
      expect(AgentTool.isReadOnly!({ description: "task", prompt: "Do it" })).toBe(false);
    });
  });
});
